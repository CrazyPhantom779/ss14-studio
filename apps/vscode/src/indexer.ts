import * as vscode from 'vscode';
import {
  collectTagUsage,
  mayContainConstructionGraph,
  parseGraphFile,
  validateGraph,
  type ConstructionGraph,
  type GraphSummary,
  type IndexPayload,
  type ParsedGraphFile,
  type ProjectInfo,
  type ProjectRootInfo,
  type TagUsage,
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
  private roots: Root[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private disposables: vscode.Disposable[] = [];
  private refreshPromise: Promise<void> | undefined;
  private refreshAgain = false;
  private generation = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(this.output, this.changeEmitter, this.progressEmitter);
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

  getSummaries(): GraphSummary[] {
    return this.payload.summaries;
  }

  getRoots(): ProjectRootInfo[] {
    return this.payload.project.roots;
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
    const started = Date.now();
    this.roots = await this.discoverRoots();
    const folders = vscode.workspace.workspaceFolders ?? [];

    if (folders.length === 0) {
      this.replaceData([], [], new Map(), started, 0);
      return;
    }

    const uris = await this.findPrototypeFiles();
    const total = uris.length;
    let done = 0;
    let lastProgress = 0;
    const parsed: ParsedGraphFile[] = [];
    const entryNodes = new Set<string>();

    report?.(`Scanning ${total} prototype files`);
    this.progressEmitter.fire({
      message: 'Scanning prototype files',
      done: 0,
      total,
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

    this.replaceData(graphs, parsed, fileGraphMap, started, total, generation);
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
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{yml,yaml}');
    this.disposables.push(
      this.watcher,
      this.watcher.onDidChange((uri) => this.scheduleFileUpdate(uri)),
      this.watcher.onDidCreate((uri) => this.scheduleFileUpdate(uri)),
      this.watcher.onDidDelete((uri) => this.scheduleFileUpdate(uri)),
    );
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
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = decoder.decode(bytes);
      if (mayContainConstructionGraph(text)) {
        parsed = this.parseText(uri, text);
      }
    } catch {
      parsed = undefined;
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
