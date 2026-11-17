import * as vscode from 'vscode';
import {
  buildCSharpView,
  buildGraphAtlas,
  collectTagUsage,
  constructionDisplayEntity,
  defaultXamlTheme,
  enrichGraphIcons,
  extractXamlThemes,
  mayContainConstructionGraph,
  parseCSharpFile,
  parseFluent,
  parseGraphFile,
  parsePrototypeFile,
  PrototypeRegistry,
  validateGraph,
  type AtlasConstructionLink,
  type ConstructionGraph,
  type CSharpIndexFile,
  type CSharpView,
  type GraphAtlas,
  type GraphSummary,
  type IndexPayload,
  type ParsedGraphFile,
  type ProjectInfo,
  type ProjectRootInfo,
  type PrototypeIndexPayload,
  type PrototypeSummary,
  type PrototypeView,
  type RawPrototype,
  type SpriteInfo,
  type TagUsage,
  type XamlClassEntry,
  type XamlTheme,
} from '@ss14-studio/core';

interface Root {
  uri: vscode.Uri;
  name: string;
  relativeName: string;
  isSs14: boolean;
}

export interface IndexProgress {
  message: string;
  done: number;
  total: number;
}

interface PartialDeclaration {
  /** Path relative to the workspace root, e.g. Resources/Prototypes/_Fork/Partials. */
  path: string;
  index: number;
  file: boolean;
}

const EMPTY_PROTOTYPES: PrototypeIndexPayload = {
  summaries: [],
  kinds: [],
  total: 0,
  errors: 0,
  warnings: 0,
  duplicates: 0,
  localizationCount: 0,
  partialFiles: [],
  scanDurationMs: 0,
};

const EMPTY_PROJECT: ProjectInfo = {
  roots: [],
  totalGraphs: 0,
  totalNodes: 0,
  totalEdges: 0,
  errors: 0,
  warnings: 0,
  scanDurationMs: 0,
  scannedFiles: 0,
  skipped: false,
};

const decoder = new TextDecoder('utf-8');

/**
 * Entity prototypes point at construction nodes with `Construction.node`, and
 * crafting recipes point at them with `startNode`. Those are valid alternate
 * entry points even when they are not reachable from the graph's `start`.
 */
const externalNodePattern = /^\s*(node|startNode):\s*['"]?([A-Za-z0-9_.-]+)/gm;

async function mapLimit<T>(
  items: T[],
  limit: number,
  callback: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        await callback(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
}

export class GraphIndex implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<IndexPayload>();
  readonly onDidChange = this.changeEmitter.event;

  private readonly progressEmitter = new vscode.EventEmitter<IndexProgress>();
  readonly onProgress = this.progressEmitter.event;

  private readonly prototypeEmitter = new vscode.EventEmitter<PrototypeIndexPayload>();
  readonly onDidPrototypesChange = this.prototypeEmitter.event;

  private readonly graphs = new Map<string, ConstructionGraph>();
  private readonly summaries = new Map<string, GraphSummary>();
  private readonly fileGraphs = new Map<string, string[]>();
  private readonly pendingFiles = new Map<string, NodeJS.Timeout>();
  private readonly output = vscode.window.createOutputChannel('SS14 Studio');

  private payload: IndexPayload = {
    summaries: [],
    project: EMPTY_PROJECT,
    knownTags: [],
  };
  private prototypes: PrototypeIndexPayload = EMPTY_PROTOTYPES;
  private prototypeRecords: RawPrototype[] = [];
  private prototypeFileRecords = new Map<string, RawPrototype[]>();
  private localization = new Map<string, string>();
  private localizationFiles = new Map<string, string>();
  private partialDeclarations: PartialDeclaration[] = [];
  private registry: PrototypeRegistry | null = null;
  private roots: Root[] = [];
  private csharpIndex = new Map<string, CSharpIndexFile>();
  private xamlClasses: XamlClassEntry[] = [];
  private csharpScan: Promise<void> | undefined;
  private csharpGeneration = 0;
  private watcher: vscode.FileSystemWatcher | undefined;
  private localeWatcher: vscode.FileSystemWatcher | undefined;
  private disposables: vscode.Disposable[] = [];
  private refreshPromise: Promise<void> | undefined;
  private refreshAgain = false;
  private generation = 0;
  private readonly pendingLocales = new Map<string, NodeJS.Timeout>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      this.output,
      this.changeEmitter,
      this.progressEmitter,
      this.prototypeEmitter,
    );
    this.installWatcher();
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
      }),
    );
  }

  getPayload(): IndexPayload {
    return this.payload;
  }

  getGraph(key: string): ConstructionGraph | undefined {
    return this.graphs.get(key);
  }

  getGraphs(): ConstructionGraph[] {
    return [...this.graphs.values()];
  }

  /** Build the workspace-wide construction atlas, including recipe links. */
  getAtlas(): GraphAtlas {
    return buildGraphAtlas(this.getGraphs(), {
      constructionLinks: this.constructionLinks(),
    });
  }

  /** Every UI theme that can be previewed in the XAML designer. */
  getXamlThemes(): XamlTheme[] {
    this.ensureRegistry();
    if (!this.registry) return [defaultXamlTheme([])];
    return extractXamlThemes({
      records: this.registry.records,
      resolve: (id, kind) => this.registry?.resolve(id, kind) ?? null,
      localization: this.localization,
    });
  }

  getSummaries(): GraphSummary[] {
    return this.payload.summaries;
  }

  getRoots(): ProjectRootInfo[] {
    return this.payload.project.roots;
  }

  getPrototypePayload(): PrototypeIndexPayload {
    return this.prototypes;
  }

  getPrototypeView(id: string, kind?: string): PrototypeView | null {
    this.ensureRegistry();
    return this.registry?.view(id, kind) ?? null;
  }

  getPrototypeSummary(id: string, kind?: string): PrototypeSummary | null {
    this.ensureRegistry();
    return this.registry?.summary(id, kind) ?? null;
  }

  findPrototypeByFile(uri: vscode.Uri): PrototypeView | null {
    this.ensureRegistry();
    const records = this.prototypeFileRecords.get(uri.toString()) ?? [];
    const record =
      records.find((candidate) => !candidate.abstract) ?? records[0];
    return record ? this.registry?.view(record.id, record.kind) ?? null : null;
  }

  findPrototypeBySource(
    uri: vscode.Uri,
    text: string,
  ): PrototypeView | null {
    const parsed = this.parsePrototypeText(uri, text);
    const record = parsed.prototypes.find((candidate) => !candidate.abstract) ?? parsed.prototypes[0];
    if (!record) return null;
    this.ensureRegistry();
    return this.registry?.view(record.id, record.kind) ?? null;
  }

  /**
   * Resolve a prototype using the editor's current (possibly unsaved) text.
   * The rest of the workspace still comes from the index, so inheritance and
   * partial overlays remain accurate while a file is being edited.
   */
  getPrototypeViewForSource(
    uri: vscode.Uri,
    text: string,
    id?: string,
    kind?: string,
  ): PrototypeView | null {
    const parsed = this.parsePrototypeText(uri, text);
    const record =
      (id
        ? parsed.prototypes.find(
            (candidate) =>
              candidate.id === id && (kind == null || candidate.kind === kind),
          )
        : undefined) ??
      parsed.prototypes.find((candidate) => !candidate.abstract) ??
      parsed.prototypes[0];
    if (!record) return null;
    const key = uri.toString();
    const records = this.prototypeRecords.filter((candidate) => candidate.filePath !== key);
    records.push(...parsed.prototypes);
    const registry = new PrototypeRegistry(
      records,
      this.localization,
      this.getGraphs(),
    );
    return registry.view(record.id, record.kind);
  }

  getEntitySprite(entityId: string): SpriteInfo | null {
    this.ensureRegistry();
    return this.registry?.spriteFor(entityId) ?? null;
  }

  getBoardTargets(component: string): { board: string; entity: string }[] {
    this.ensureRegistry();
    return this.registry?.boardTargets(component) ?? [];
  }

  resolveLocalization(key: string): string | undefined {
    return this.localization.get(key);
  }

  /**
   * Scan C# and XAML class declarations lazily. The result is cached until the
   * next workspace refresh; the first XAML or C# view pays the scan cost.
   */
  async ensureCSharpIndex(): Promise<void> {
    if (this.csharpScan) return this.csharpScan;
    const generation = this.csharpGeneration;
    this.csharpScan = (async () => {
      const roots = this.roots.length > 0
        ? this.roots
        : (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
            uri: folder.uri,
            name: folder.name,
            relativeName: folder.name,
            isSs14: false,
          }));
      const exclude =
        '**/{node_modules,.git,bin,obj,Library,Temp,.vs,.idea,dist,out}/**';
      const csharp = new Map<string, CSharpIndexFile>();
      const xamlClasses: XamlClassEntry[] = [];
      for (const root of roots) {
        try {
          const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(root.uri, '**/*.cs'),
            exclude,
            20000,
          );
          await mapLimit(files, 8, async (uri) => {
            try {
              const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
              const relativePath = this.relativePath(uri);
              const parsed = parseCSharpFile(text, {
                filePath: uri.toString(),
                relativePath,
              });
              csharp.set(uri.toString(), {
                filePath: uri.toString(),
                relativePath,
                namespace: parsed.namespace,
                types: parsed.types,
              });
            } catch {
              // Ignore unreadable files.
            }
          });
        } catch (error) {
          this.output.appendLine(`C# glob failed: ${String(error)}`);
        }
        try {
          const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(root.uri, '**/*.xaml'),
            exclude,
            20000,
          );
          await mapLimit(files, 8, async (uri) => {
            try {
              const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
              const className = /x:Class\s*=\s*"([^"]+)"/.exec(text)?.[1];
              if (!className) return;
              xamlClasses.push({
                filePath: uri.toString(),
                relativePath: this.relativePath(uri),
                className,
              });
            } catch {
              // Ignore unreadable files.
            }
          });
        } catch (error) {
          this.output.appendLine(`XAML glob failed: ${String(error)}`);
        }
      }
      if (generation === this.csharpGeneration) {
        this.csharpIndex = csharp;
        this.xamlClasses = xamlClasses;
      }
    })().finally(() => {
      this.csharpScan = undefined;
    });
    return this.csharpScan;
  }

  async getCSharpView(
    uri: vscode.Uri,
    text?: string,
  ): Promise<CSharpView | null> {
    await this.ensureCSharpIndex();
    let source = text;
    if (source == null) {
      try {
        source = decoder.decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        return null;
      }
    }
    const filePath = uri.toString();
    const file = parseCSharpFile(source, {
      filePath,
      relativePath: this.relativePath(uri),
    });
    const exists = (path: string) =>
      this.csharpIndex.has(path) ||
      vscode.workspace.textDocuments.some((document) => document.uri.toString() === path);
    return buildCSharpView(
      file,
      [...this.csharpIndex.values()],
      this.xamlClasses,
      exists,
    );
  }

  getXamlClassEntry(filePath: string): XamlClassEntry | undefined {
    return this.xamlClasses.find((entry) => entry.filePath === filePath);
  }

  findXamlClass(className: string): XamlClassEntry | undefined {
    return this.xamlClasses.find((entry) => entry.className === className);
  }

  resolveResourceUri(resourcePath: string): vscode.Uri | undefined {
    const normalized = resourcePath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/^Resources\//, '');
    const relative = normalized.startsWith('Textures/')
      ? normalized
      : `Textures/${normalized}`;
    for (const root of this.roots) {
      return vscode.Uri.joinPath(root.uri, 'Resources', relative);
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder
      ? vscode.Uri.joinPath(folder.uri, 'Resources', relative)
      : undefined;
  }

  resolveWorkspaceUri(relativeOrAbsolute: string): vscode.Uri | undefined {
    if (/^[a-zA-Z]+:/.test(relativeOrAbsolute)) {
      return vscode.Uri.parse(relativeOrAbsolute);
    }
    const root = this.roots[0] ?? vscode.workspace.workspaceFolders?.[0];
    if (!root) return undefined;
    const rootUri = 'uri' in root ? root.uri : root;
    return vscode.Uri.joinPath(rootUri, relativeOrAbsolute);
  }

  parsePrototypeText(uri: vscode.Uri, text: string): ReturnType<typeof parsePrototypeFile> {
    const relative = this.relativePath(uri);
    const partial = this.partialFor(relative);
    return parsePrototypeFile(text, {
      filePath: uri.toString(),
      relativePath: relative,
      isPartial: partial != null,
      partialIndex: partial?.index,
    });
  }

  private ensureRegistry(): void {
    if (this.registry) return;
    this.registry = new PrototypeRegistry(
      this.prototypeRecords,
      this.localization,
      this.getGraphs(),
    );
  }

  private partialFor(relativePath: string): PartialDeclaration | null {
    const normalized = relativePath.replace(/\\/g, '/');
    for (const declaration of this.partialDeclarations) {
      if (declaration.file) {
        if (normalized === declaration.path) return declaration;
      } else if (
        normalized === declaration.path ||
        normalized.startsWith(`${declaration.path}/`)
      ) {
        return declaration;
      }
    }
    return null;
  }

  parseText(uri: vscode.Uri, text: string): ParsedGraphFile {
    return parseGraphFile(text, {
      filePath: uri.toString(),
      relativePath: this.relativePath(uri),
      fileKey: uri.toString(),
    });
  }

  relativePath(uri: vscode.Uri): string {
    const root = this.rootFor(uri);
    if (root) {
      return pathRelative(root.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
    }
    return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
  }

  async refresh(showProgress = false): Promise<void> {
    if (this.refreshPromise) {
      this.refreshAgain = true;
      return this.refreshPromise;
    }

    const run = async () => {
      if (showProgress) {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'SS14 Studio: indexing construction graphs',
            cancellable: false,
          },
          async (progress) => {
            await this.doRefresh((message) => progress.report({ message }));
          },
        );
      } else {
        await this.doRefresh();
      }
    };

    this.refreshPromise = run().finally(() => {
      this.refreshPromise = undefined;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        void this.refresh(showProgress);
      }
    });
    return this.refreshPromise;
  }

  private async doRefresh(report?: (message: string) => void): Promise<void> {
    const generation = ++this.generation;
    this.csharpGeneration++;
    this.csharpIndex.clear();
    this.xamlClasses = [];
    const started = Date.now();
    this.roots = await this.discoverRoots();
    const folders = vscode.workspace.workspaceFolders ?? [];

    if (folders.length === 0) {
      this.replaceData([], [], new Map(), started, 0);
      this.replacePrototypeData([], new Map(), started);
      return;
    }

    this.partialDeclarations = await this.findPartialDeclarations();
    const [uris, localeUris] = await Promise.all([
      this.findPrototypeFiles(),
      this.findLocaleFiles(),
    ]);
    const total = uris.length;
    let done = 0;
    let lastProgress = 0;
    const parsed: ParsedGraphFile[] = [];
    const entryNodes = new Set<string>();
    const prototypeFiles = new Map<string, RawPrototype[]>();
    const prototypeRecords: RawPrototype[] = [];

    report?.(`Scanning ${total} prototype files`);
    this.progressEmitter.fire({
      message: 'Scanning prototype files',
      done: 0,
      total,
    });

    const localeEntries = new Map<string, string>();
    await mapLimit(localeUris, 8, async (uri) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        for (const entry of parseFluent(decoder.decode(bytes), uri.toString())) {
          if (!localeEntries.has(entry.id)) localeEntries.set(entry.id, entry.value);
        }
      } catch (error) {
        this.output.appendLine(`Could not read locale ${uri.toString()}: ${String(error)}`);
      }
    });

    await mapLimit(uris, 8, async (uri) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = decoder.decode(bytes);
        const graphFile = mayContainConstructionGraph(text);
        for (const match of text.matchAll(externalNodePattern)) {
          if (graphFile && match[1] !== 'startNode') continue;
          entryNodes.add(match[2]!);
        }
        if (graphFile) {
          parsed.push(this.parseText(uri, text));
        }
        if (this.roots.some((root) => this.isInside(uri, root.uri))) {
          const prototypes = this.parsePrototypeText(uri, text);
          if (prototypes.prototypes.length > 0) {
            prototypeFiles.set(uri.toString(), prototypes.prototypes);
            prototypeRecords.push(...prototypes.prototypes);
          }
          for (const diagnostic of prototypes.diagnostics.slice(0, 3)) {
            this.output.appendLine(
              `${prototypes.relativePath}:${diagnostic.line} [${diagnostic.code}] ${diagnostic.message}`,
            );
          }
        }
      } catch (error) {
        this.output.appendLine(`Could not read ${uri.toString()}: ${String(error)}`);
      }
      done++;
      const now = Date.now();
      if (now - lastProgress > 100 || done === total) {
        lastProgress = now;
        this.progressEmitter.fire({
          message: `Parsed ${done}/${total} files`,
          done,
          total,
        });
        report?.(`${done}/${total} files`);
      }
    });

    if (generation !== this.generation) return;

    const graphs: ConstructionGraph[] = [];
    for (const file of parsed) {
      if (file.diagnostics.length > 0) {
        for (const diagnostic of file.diagnostics.slice(0, 5)) {
          this.output.appendLine(
            `${file.relativePath}:${diagnostic.line} [${diagnostic.code}] ${diagnostic.message}`,
          );
        }
      }
      graphs.push(...file.graphs);
    }

    for (const graph of graphs) {
      graph.diagnostics = validateGraph(graph, { entryNodes });
    }

    const fileGraphMap = new Map<string, string[]>();
    for (const file of parsed) {
      fileGraphMap.set(
        file.filePath,
        file.graphs.map((graph) => graph.key),
      );
    }

    this.localization = localeEntries;
    this.localizationFiles = new Map(
      localeUris.map((uri) => [uri.toString(), uri.toString()]),
    );
    this.replaceData(graphs, parsed, fileGraphMap, started, total, generation);
    if (generation === this.generation) {
      this.replacePrototypeData(
        prototypeRecords,
        prototypeFiles,
        started,
        this.partialDeclarations.map((declaration) =>
          declaration.file
            ? declaration.path
            : `${declaration.path} (${declaration.index})`,
        ),
      );
    }
  }

  private async findLocaleFiles(): Promise<vscode.Uri[]> {
    const result: vscode.Uri[] = [];
    const seen = new Set<string>();
    for (const root of this.roots.length > 0
      ? this.roots
      : (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
          uri: folder.uri,
          name: folder.name,
          relativeName: folder.name,
          isSs14: false,
        }))) {
      try {
        const matches = await vscode.workspace.findFiles(
          new vscode.RelativePattern(root.uri, 'Resources/Locale/**/*.ftl'),
          '**/{node_modules,.git,bin,obj,Library,Temp,.vs,.idea,dist,out}/**',
          20000,
        );
        for (const uri of matches) {
          if (seen.has(uri.toString())) continue;
          seen.add(uri.toString());
          result.push(uri);
        }
      } catch (error) {
        this.output.appendLine(`Locale glob failed: ${String(error)}`);
      }
    }
    return result;
  }

  private async findPartialDeclarations(): Promise<PartialDeclaration[]> {
    const declarations: PartialDeclaration[] = [];
    let index = 0;
    for (const root of this.roots) {
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(
          vscode.Uri.joinPath(root.uri, 'Resources', 'PartialPrototypes'),
        );
      } catch {
        continue;
      }
      entries.sort((a, b) => a[0].localeCompare(b[0]));
      for (const [name, type] of entries) {
        if ((type & vscode.FileType.File) === 0 || !/\.ya?ml$/i.test(name)) continue;
        const uri = vscode.Uri.joinPath(
          root.uri,
          'Resources',
          'PartialPrototypes',
          name,
        );
        try {
          const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
          for (const line of text.split(/\r?\n/)) {
            const match = /^\s*-\s*(\/[^\s#]+)/.exec(line);
            if (!match) continue;
            declarations.push({
              path: `Resources${match[1]}`.replace(/\/+$/, ''),
              index: index++,
              file: /\.ya?ml$/i.test(match[1]!),
            });
          }
        } catch (error) {
          this.output.appendLine(`Could not read partial manifest ${name}: ${String(error)}`);
        }
      }
    }
    return declarations;
  }

  private replacePrototypeData(
    records: RawPrototype[],
    files: Map<string, RawPrototype[]>,
    started: number,
    partialFiles: string[] = [],
  ): void {
    this.prototypeRecords = records;
    this.prototypeFileRecords = files;
    this.registry = new PrototypeRegistry(
      records,
      this.localization,
      this.getGraphs(),
    );
    this.prototypes = this.registry.indexPayload(partialFiles, Date.now() - started);
    this.enrichGraphs();
    this.prototypeEmitter.fire(this.prototypes);
    this.changeEmitter.fire(this.payload);
  }

  private rebuildPrototypeData(): void {
    this.registry = new PrototypeRegistry(
      this.prototypeRecords,
      this.localization,
      this.getGraphs(),
    );
    this.prototypes = this.registry.indexPayload(
      this.partialDeclarations.map((declaration) => declaration.path),
      this.prototypes.scanDurationMs,
    );
    this.enrichGraphs();
    this.prototypeEmitter.fire(this.prototypes);
    this.changeEmitter.fire(this.payload);
  }

  /** Fill graph node icons after both graphs and prototypes are indexed. */
  private enrichGraphs(): void {
    this.ensureRegistry();
    if (!this.registry) return;
    for (const graph of this.graphs.values()) {
      enrichGraphIcons(graph, this.registry);
    }
  }

  /** Construction recipes that point at a node in another graph. */
  private constructionLinks(): AtlasConstructionLink[] {
    this.ensureRegistry();
    if (!this.registry) return [];
    const graphs = this.getGraphs();
    const links: AtlasConstructionLink[] = [];
    for (const record of this.registry.records) {
      if (record.kind !== 'construction' || record.abstract || record.partial.partial) {
        continue;
      }
      const resolved = this.registry.resolve(record.id, 'construction');
      if (!resolved) continue;
      const graphId =
        typeof resolved.fields.graph === 'string' ? resolved.fields.graph : null;
      const targetNode =
        typeof resolved.fields.targetNode === 'string'
          ? resolved.fields.targetNode
          : null;
      if (!graphId || !targetNode) continue;
      const graph = graphs.find((candidate) => candidate.id === graphId);
      if (!graph) continue;
      const entity = constructionDisplayEntity(graph, targetNode, this.registry);
      if (!entity) continue;
      links.push({ graphId, graphKey: graph.key, targetNode, entity });
    }
    return links;
  }

  private async findPrototypeFiles(): Promise<vscode.Uri[]> {
    const config = vscode.workspace.getConfiguration('ss14Studio');
    const globs = config.get<string[]>('graphGlobs') ?? [
      'Resources/Prototypes/**/*.yml',
      'Resources/Prototypes/**/*.yaml',
    ];
    const roots = this.roots.length > 0
      ? this.roots
      : (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
          uri: folder.uri,
          name: folder.name,
          relativeName: folder.name,
          isSs14: false,
        }));

    const seen = new Set<string>();
    const result: vscode.Uri[] = [];

    for (const root of roots) {
      for (const glob of globs) {
        try {
          const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(root.uri, glob),
            '**/{node_modules,.git,bin,obj,Library,Temp,.vs,.idea,dist,out}/**',
            20000,
          );
          for (const uri of matches) {
            const key = uri.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(uri);
          }
        } catch (error) {
          this.output.appendLine(`Glob failed (${glob}): ${String(error)}`);
        }
      }
    }

    return result;
  }

  private async discoverRoots(): Promise<Root[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const roots: Root[] = [];
    for (const folder of folders) {
      let isSs14 = false;
      try {
        const stat = await vscode.workspace.fs.stat(
          vscode.Uri.joinPath(folder.uri, 'Resources', 'Prototypes'),
        );
        isSs14 = (stat.type & vscode.FileType.Directory) !== 0;
      } catch {
        isSs14 = false;
      }
      roots.push({
        uri: folder.uri,
        name: folder.name,
        relativeName: folder.name,
        isSs14,
      });
    }
    return roots;
  }

  private replaceData(
    graphs: ConstructionGraph[],
    parsedFiles: ParsedGraphFile[],
    fileGraphMap: Map<string, string[]>,
    started: number,
    scannedFiles: number,
    generation = this.generation,
  ): void {
    if (generation !== this.generation) return;

    this.graphs.clear();
    this.summaries.clear();
    this.fileGraphs.clear();

    const summaries: GraphSummary[] = [];
    for (const graph of graphs) {
      this.graphs.set(graph.key, graph);
      const summary = this.summarize(graph);
      this.summaries.set(graph.key, summary);
      summaries.push(summary);
    }

    for (const [file, keys] of fileGraphMap) {
      this.fileGraphs.set(file, keys);
    }

    summaries.sort((a, b) =>
      a.folder.localeCompare(b.folder) || a.id.localeCompare(b.id),
    );

    const knownTags = this.buildTagUsage(graphs);
    const roots: ProjectRootInfo[] = this.roots
      .filter((root) => root.isSs14)
      .map((root) => ({ name: root.name, path: root.uri.fsPath }));

    let totalNodes = 0;
    let totalEdges = 0;
    let errors = 0;
    let warnings = 0;
    for (const graph of graphs) {
      totalNodes += graph.stats.nodes;
      totalEdges += graph.stats.edges;
      for (const diagnostic of graph.diagnostics) {
        if (diagnostic.severity === 'error') errors++;
        else if (diagnostic.severity === 'warning') warnings++;
      }
    }

    this.payload = {
      summaries,
      project: {
        roots:
          roots.length > 0
            ? roots
            : (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
                name: folder.name,
                path: folder.uri.fsPath,
              })),
        totalGraphs: graphs.length,
        totalNodes,
        totalEdges,
        errors,
        warnings,
        scanDurationMs: Date.now() - started,
        scannedFiles,
        skipped: false,
      },
      knownTags,
    };

    this.changeEmitter.fire(this.payload);
  }

  private summarize(graph: ConstructionGraph): GraphSummary {
    let errors = 0;
    let warnings = 0;
    for (const diagnostic of graph.diagnostics) {
      if (diagnostic.severity === 'error') errors++;
      else if (diagnostic.severity === 'warning') warnings++;
    }
    return {
      key: graph.key,
      id: graph.id,
      filePath: graph.filePath,
      relativePath: graph.relativePath,
      folder: folderFor(graph.relativePath),
      line: graph.line,
      nodes: graph.stats.nodes,
      edges: graph.stats.edges,
      errors,
      warnings,
    };
  }

  private buildTagUsage(graphs: ConstructionGraph[]): TagUsage[] {
    const usage = collectTagUsage(graphs);
    return [...usage.entries()]
      .map(([type, counts]) => ({
        type,
        actions: counts.actions,
        conditions: counts.conditions,
      }))
      .sort(
        (a, b) =>
          b.actions + b.conditions - (a.actions + a.conditions) ||
          a.type.localeCompare(b.type),
      );
  }

  private rootFor(uri: vscode.Uri): Root | undefined {
    return this.roots.find((root) => {
      const relative = pathRelative(root.uri.fsPath, uri.fsPath);
      return !relative.startsWith('..') && !pathIsAbsolute(relative);
    });
  }

  private installWatcher(): void {
    this.watcher?.dispose();
    this.localeWatcher?.dispose();
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{yml,yaml}');
    this.localeWatcher = vscode.workspace.createFileSystemWatcher('**/*.ftl');
    this.disposables.push(
      this.watcher,
      this.watcher.onDidChange((uri) => this.scheduleFileUpdate(uri)),
      this.watcher.onDidCreate((uri) => this.scheduleFileUpdate(uri)),
      this.watcher.onDidDelete((uri) => this.scheduleFileUpdate(uri)),
      this.localeWatcher,
      this.localeWatcher.onDidChange((uri) => this.scheduleLocaleUpdate(uri)),
      this.localeWatcher.onDidCreate((uri) => this.scheduleLocaleUpdate(uri)),
      this.localeWatcher.onDidDelete((uri) => this.scheduleLocaleUpdate(uri)),
    );
  }

  private scheduleLocaleUpdate(uri: vscode.Uri): void {
    if (!vscode.workspace.getConfiguration('ss14Studio').get<boolean>('autoRefresh', true)) {
      return;
    }
    const key = uri.toString();
    const existing = this.pendingLocales.get(key);
    if (existing) clearTimeout(existing);
    this.pendingLocales.set(
      key,
      setTimeout(() => {
        this.pendingLocales.delete(key);
        void this.updateLocale(uri);
      }, 250),
    );
  }

  private async updateLocale(uri: vscode.Uri): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      for (const entry of parseFluent(decoder.decode(bytes), uri.toString())) {
        if (!this.localization.has(entry.id)) this.localization.set(entry.id, entry.value);
      }
    } catch {
      // Deletions are handled by a full refresh; keeping the old values is
      // preferable to dropping every localized name after one save.
    }
    this.localizationFiles.set(uri.toString(), uri.toString());
    this.rebuildPrototypeData();
  }

  private scheduleFileUpdate(uri: vscode.Uri): void {
    if (!vscode.workspace.getConfiguration('ss14Studio').get<boolean>('autoRefresh', true)) {
      return;
    }
    const key = uri.toString();
    const existing = this.pendingFiles.get(key);
    if (existing) clearTimeout(existing);
    this.pendingFiles.set(
      key,
      setTimeout(() => {
        this.pendingFiles.delete(key);
        void this.updateFile(uri);
      }, 250),
    );
  }

  private async updateFile(uri: vscode.Uri): Promise<void> {
    if (!this.roots.some((root) => this.isInside(uri, root.uri))) return;

    const fileKey = uri.toString();
    let parsed: ParsedGraphFile | undefined;
    let prototypeRecords: RawPrototype[] = [];
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = decoder.decode(bytes);
      if (mayContainConstructionGraph(text)) {
        parsed = this.parseText(uri, text);
      }
      const prototypes = this.parsePrototypeText(uri, text);
      prototypeRecords = prototypes.prototypes;
    } catch {
      parsed = undefined;
    }

    const previousPrototypes = this.prototypeFileRecords.get(fileKey) ?? [];
    if (previousPrototypes.length > 0) {
      const previous = new Set(previousPrototypes);
      this.prototypeRecords = this.prototypeRecords.filter((record) => !previous.has(record));
    }
    if (prototypeRecords.length > 0) {
      this.prototypeFileRecords.set(fileKey, prototypeRecords);
      this.prototypeRecords.push(...prototypeRecords);
    } else {
      this.prototypeFileRecords.delete(fileKey);
    }

    const removed = this.fileGraphs.get(fileKey) ?? [];
    for (const key of removed) {
      this.graphs.delete(key);
      this.summaries.delete(key);
    }
    this.fileGraphs.delete(fileKey);

    if (parsed) {
      this.fileGraphs.set(
        fileKey,
        parsed.graphs.map((graph) => graph.key),
      );
      for (const graph of parsed.graphs) {
        this.graphs.set(graph.key, graph);
        this.summaries.set(graph.key, this.summarize(graph));
      }
    }

    // Graphs and prototypes must both be current before construction recipes
    // and graph node icons can resolve their target sprites.
    this.rebuildPrototypeData();
    this.rebuildPayload();
  }

  private rebuildPayload(): void {
    const graphs = [...this.graphs.values()];
    const summaries = [...this.summaries.values()].sort(
      (a, b) => a.folder.localeCompare(b.folder) || a.id.localeCompare(b.id),
    );
    let totalNodes = 0;
    let totalEdges = 0;
    let errors = 0;
    let warnings = 0;
    for (const graph of graphs) {
      totalNodes += graph.stats.nodes;
      totalEdges += graph.stats.edges;
      for (const diagnostic of graph.diagnostics) {
        if (diagnostic.severity === 'error') errors++;
        else if (diagnostic.severity === 'warning') warnings++;
      }
    }

    this.payload = {
      summaries,
      project: {
        ...this.payload.project,
        totalGraphs: graphs.length,
        totalNodes,
        totalEdges,
        errors,
        warnings,
        scanDurationMs: 0,
      },
      knownTags: this.buildTagUsage(graphs),
    };
    this.changeEmitter.fire(this.payload);
  }

  private isInside(uri: vscode.Uri, root: vscode.Uri): boolean {
    const relative = pathRelative(root.fsPath, uri.fsPath);
    return !relative.startsWith('..') && !pathIsAbsolute(relative);
  }

  dispose(): void {
    for (const timer of this.pendingFiles.values()) clearTimeout(timer);
    this.pendingFiles.clear();
    for (const timer of this.pendingLocales.values()) clearTimeout(timer);
    this.pendingLocales.clear();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }
}

function folderFor(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const marker = '/Graphs/';
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) {
    const before = normalized.slice(0, index).split('/');
    const moduleName = before.find(
      (part) =>
        part.startsWith('_') &&
        part !== '_' &&
        !['Resources', 'Prototypes'].includes(part),
    );
    const after = normalized
      .slice(index + marker.length)
      .split('/')
      .slice(0, -1)
      .join('/');
    const folder = [moduleName, after].filter(Boolean).join('/');
    return folder || 'Graphs';
  }
  const directory = normalized.split('/').slice(0, -1).join('/');
  return directory || 'Prototypes';
}

// These tiny wrappers keep the Node path dependency out of the rest of the file.
import { isAbsolute as pathIsAbsolute, relative as pathRelative } from 'node:path';
