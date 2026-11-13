import { promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  collectTagUsage,
  mayContainConstructionGraph,
  parseFluent,
  parseGraphFile,
  parsePrototypeFile,
  PrototypeRegistry,
  validateGraph,
  type ConstructionGraph,
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
} from '@ss14-studio/core';
import {
  isDirectory,
  isInside,
  normalizeSlashes,
  readTextFile,
  relativeToRoots,
  rootFor,
  walkFiles,
} from './paths.js';

export interface IndexProgress {
  message: string;
  done: number;
  total: number;
}

export interface StudioStatus {
  graphs: number;
  prototypes: number;
  errors: number;
  warnings: number;
  indexing: boolean;
  scannedFiles: number;
  scanDurationMs: number;
  roots: number;
}

export interface IndexCallbacks {
  onIndex?: (payload: IndexPayload) => void;
  onPrototypes?: (payload: PrototypeIndexPayload) => void;
  onProgress?: (progress: IndexProgress) => void;
  onStatus?: (status: StudioStatus) => void;
}

interface Root {
  path: string;
  name: string;
  isSs14: boolean;
}

interface PartialDeclaration {
  /** Path relative to the project root, e.g. Resources/Prototypes/_Fork/Partials. */
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

/**
 * Entity prototypes point at construction nodes with `Construction.node`, and
 * crafting recipes point at them with `startNode`. Those are valid alternate
 * entry points even when they are not reachable from the graph's `start`.
 */
const externalNodePattern =
  /^\s*(node|startNode):\s*['"]?([A-Za-z0-9_.-]+)/gm;

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

export class ProjectIndex {
  private readonly graphs = new Map<string, ConstructionGraph>();
  private readonly summaries = new Map<string, GraphSummary>();
  private readonly fileGraphs = new Map<string, string[]>();
  private roots: Root[] = [];
  private payload: IndexPayload = {
    summaries: [],
    project: EMPTY_PROJECT,
    knownTags: [],
  };
  private prototypes: PrototypeIndexPayload = EMPTY_PROTOTYPES;
  private prototypeRecords: RawPrototype[] = [];
  private prototypeFileRecords = new Map<string, RawPrototype[]>();
  private localization = new Map<string, string>();
  private partialDeclarations: PartialDeclaration[] = [];
  private registry: PrototypeRegistry | null = null;
  private refreshPromise: Promise<void> | undefined;
  private refreshAgain = false;
  private generation = 0;

  constructor(
    private readonly rootPaths: string[],
    private readonly callbacks: IndexCallbacks = {},
  ) {}

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
    const ss14Roots = this.roots.filter((root) => root.isSs14);
    return (ss14Roots.length > 0 ? ss14Roots : this.roots).map((root) => ({
      name: root.name,
      path: root.path,
    }));
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

  getPrototypeViewForSource(
    filePath: string,
    text: string,
    id?: string,
    kind?: string,
  ): PrototypeView | null {
    const parsed = this.parsePrototypeText(filePath, text);
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
    const records = this.prototypeRecords.filter(
      (candidate) => candidate.filePath !== filePath,
    );
    records.push(...parsed.prototypes);
    const registry = new PrototypeRegistry(records, this.localization);
    return registry.view(record.id, record.kind);
  }

  getEntitySprite(entityId: string): SpriteInfo | null {
    this.ensureRegistry();
    return this.registry?.resolve(entityId)?.sprite ?? null;
  }

  getGraphsForFile(filePath: string): string[] {
    return this.fileGraphs.get(filePath) ?? [];
  }

  getRootPaths(): string[] {
    return this.roots.map((root) => root.path);
  }

  resolveResourcePath(resourcePath: string): string | undefined {
    const normalized = resourcePath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/^Resources\//, '');
    const root = this.roots[0];
    if (!root) return undefined;
    return join(root.path, 'Resources', normalized);
  }

  resolveWorkspacePath(relativeOrAbsolute: string): string | undefined {
    const root = this.roots[0];
    if (!root) return undefined;
    return resolve(root.path, relativeOrAbsolute);
  }

  relativePath(path: string): string {
    return relativeToRoots(
      this.roots.map((root) => root.path),
      path,
    );
  }

  parseText(filePath: string, text: string): ParsedGraphFile {
    const relativePath = this.relativePath(filePath);
    return parseGraphFile(text, {
      filePath,
      relativePath,
      fileKey: relativePath,
    });
  }

  parsePrototypeText(
    filePath: string,
    text: string,
  ): ReturnType<typeof parsePrototypeFile> {
    const relativePath = this.relativePath(filePath);
    const partial = this.partialFor(relativePath);
    return parsePrototypeFile(text, {
      filePath,
      relativePath,
      fileKey: relativePath,
      isPartial: partial != null,
      partialIndex: partial?.index,
    });
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) {
      this.refreshAgain = true;
      return this.refreshPromise;
    }
    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = undefined;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        void this.refresh();
      }
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    const generation = ++this.generation;
    const started = Date.now();
    this.roots = await this.discoverRoots();
    this.callbacks.onStatus?.({
      graphs: this.payload.project.totalGraphs,
      prototypes: this.prototypes.total,
      errors: this.payload.project.errors,
      warnings: this.payload.project.warnings,
      indexing: true,
      scannedFiles: this.payload.project.scannedFiles,
      scanDurationMs: this.payload.project.scanDurationMs,
      roots: this.roots.length,
    });

    this.partialDeclarations = await this.findPartialDeclarations();
    const [files, localeFiles] = await Promise.all([
      this.findPrototypeFiles(),
      this.findLocaleFiles(),
    ]);

    if (files.length === 0 && localeFiles.length === 0) {
      this.replaceData([], [], new Map(), started, 0, generation);
      this.replacePrototypeData([], new Map(), started);
      return;
    }

    const total = files.length;
    let done = 0;
    let lastProgress = 0;
    const parsed: ParsedGraphFile[] = [];
    const entryNodes = new Set<string>();
    const prototypeFiles = new Map<string, RawPrototype[]>();
    const prototypeRecords: RawPrototype[] = [];

    this.callbacks.onProgress?.({
      message: `Scanning ${total} prototype files`,
      done: 0,
      total,
    });

    const localeEntries = new Map<string, string>();
    await mapLimit(localeFiles, 8, async (file) => {
      try {
        const { text } = await readTextFile(file);
        for (const entry of parseFluent(text, file)) {
          if (!localeEntries.has(entry.id)) {
            localeEntries.set(entry.id, entry.value);
          }
        }
      } catch {
        // A single unreadable locale file should not abort indexing.
      }
    });

    await mapLimit(files, 8, async (file) => {
      try {
        const { text } = await readTextFile(file);
        const graphFile = mayContainConstructionGraph(text);
        for (const match of text.matchAll(externalNodePattern)) {
          if (graphFile && match[1] !== 'startNode') continue;
          entryNodes.add(match[2]!);
        }
        if (graphFile) {
          parsed.push(this.parseText(file, text));
        }
        const prototypes = this.parsePrototypeText(file, text);
        if (prototypes.prototypes.length > 0) {
          prototypeFiles.set(file, prototypes.prototypes);
          prototypeRecords.push(...prototypes.prototypes);
        }
      } catch {
        // Keep indexing the rest of the project when one file is unreadable.
      }
      done++;
      const now = Date.now();
      if (now - lastProgress > 100 || done === total) {
        lastProgress = now;
        this.callbacks.onProgress?.({
          message: `Parsed ${done}/${total} files`,
          done,
          total,
        });
      }
    });

    if (generation !== this.generation) return;

    const graphs: ConstructionGraph[] = [];
    for (const file of parsed) {
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

  private async discoverRoots(): Promise<Root[]> {
    const roots: Root[] = [];
    const seen = new Set<string>();
    for (const candidate of this.rootPaths) {
      if (!candidate) continue;
      const path = resolve(candidate);
      if (seen.has(path)) continue;
      seen.add(path);
      roots.push({
        path,
        name: basename(path),
        isSs14: await isDirectory(join(path, 'Resources', 'Prototypes')),
      });
    }
    return roots;
  }

  private async findPrototypeFiles(): Promise<string[]> {
    const files: string[] = [];
    const roots = this.roots.filter((root) => root.isSs14);
    for (const root of roots.length > 0 ? roots : this.roots) {
      files.push(
        ...(await walkFiles(
          join(root.path, 'Resources', 'Prototypes'),
          (path) => /\.ya?ml$/i.test(path),
          { maxFiles: 50_000 },
        )),
      );
    }
    return [...new Set(files)].sort();
  }

  private async findLocaleFiles(): Promise<string[]> {
    const files: string[] = [];
    const roots = this.roots.filter((root) => root.isSs14);
    for (const root of roots.length > 0 ? roots : this.roots) {
      files.push(
        ...(await walkFiles(
          join(root.path, 'Resources', 'Locale'),
          (path) => /\.ftl$/i.test(path),
          { maxFiles: 50_000 },
        )),
      );
    }
    return [...new Set(files)].sort();
  }

  private async findPartialDeclarations(): Promise<PartialDeclaration[]> {
    const declarations: PartialDeclaration[] = [];
    let index = 0;
    for (const root of this.roots) {
      const directory = join(root.path, 'Resources', 'PartialPrototypes');
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
        try {
          const { text } = await readTextFile(join(directory, entry.name));
          for (const line of text.split(/\r?\n/)) {
            const match = /^\s*-\s*(\/[^\s#]+)/.exec(line);
            if (!match) continue;
            declarations.push({
              path: `Resources${match[1]}`.replace(/\/+$/, ''),
              index: index++,
              file: /\.ya?ml$/i.test(match[1]!),
            });
          }
        } catch {
          // Ignore unreadable manifests.
        }
      }
    }
    return declarations;
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

    summaries.sort(
      (a, b) =>
        a.folder.localeCompare(b.folder) || a.id.localeCompare(b.id),
    );

    const knownTags = this.buildTagUsage(graphs);
    const roots: ProjectRootInfo[] = this.roots
      .filter((root) => root.isSs14)
      .map((root) => ({ name: root.name, path: root.path }));

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
            : this.roots.map((root) => ({
                name: root.name,
                path: root.path,
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

    this.callbacks.onIndex?.(this.payload);
    this.callbacks.onStatus?.({
      graphs: graphs.length,
      prototypes: this.prototypes.total,
      errors,
      warnings,
      indexing: false,
      scannedFiles,
      scanDurationMs: this.payload.project.scanDurationMs,
      roots: this.roots.length,
    });
  }

  private replacePrototypeData(
    records: RawPrototype[],
    files: Map<string, RawPrototype[]>,
    started: number,
    partialFiles: string[] = [],
  ): void {
    this.prototypeRecords = records;
    this.prototypeFileRecords = files;
    this.registry = new PrototypeRegistry(records, this.localization);
    this.prototypes = this.registry.indexPayload(
      partialFiles,
      Date.now() - started,
    );
    this.callbacks.onPrototypes?.(this.prototypes);
    this.callbacks.onStatus?.({
      graphs: this.payload.project.totalGraphs,
      prototypes: this.prototypes.total,
      errors: this.payload.project.errors,
      warnings: this.payload.project.warnings,
      indexing: false,
      scannedFiles: this.payload.project.scannedFiles,
      scanDurationMs: this.payload.project.scanDurationMs,
      roots: this.roots.length,
    });
  }

  private ensureRegistry(): void {
    if (this.registry) return;
    this.registry = new PrototypeRegistry(
      this.prototypeRecords,
      this.localization,
    );
  }

  private partialFor(relativePath: string): PartialDeclaration | null {
    const normalized = normalizeSlashes(relativePath);
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

  dispose(): void {
    this.generation++;
    this.callbacks.onStatus?.({
      graphs: this.payload.project.totalGraphs,
      prototypes: this.prototypes.total,
      errors: this.payload.project.errors,
      warnings: this.payload.project.warnings,
      indexing: false,
      scannedFiles: this.payload.project.scannedFiles,
      scanDurationMs: this.payload.project.scanDurationMs,
      roots: this.roots.length,
    });
  }
}

function folderFor(relativePath: string): string {
  const normalized = normalizeSlashes(relativePath);
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
    return [moduleName, after].filter(Boolean).join('/') || 'Graphs';
  }
  const directory = normalized.split('/').slice(0, -1).join('/');
  return directory || 'Prototypes';
}
