import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  applyGraphOperation,
  applyPrototypeOperation,
  applyRsiOperation,
  applyTextEdits,
  applyXamlOperation,
  buildRsiView,
  diffText,
  EditFailure,
  findOrphanImages,
  localizeXamlText,
  parseRsiMeta,
  parseXaml,
  renderGraphTemplate,
  robustColorToCss,
  serializeRsiMeta,
  type ConstructionGraph,
  type CreateGraphOptions,
  type CSharpView,
  type DiffPayload,
  type Diagnostic,
  type EditResult,
  type GraphOperation,
  type GraphView,
  type HostMessage,
  type PrototypeOperation,
  type PrototypeView,
  type RsiImageInfo,
  type RsiMeta,
  type RsiOperation,
  type RsiView,
  type SpriteInfo,
  type SpriteLayerInfo,
  type WebviewMessage,
  type WorkspaceView,
  type XamlDesignNode,
  type XamlImageInfo,
  type XamlOperation,
  type XamlView,
} from '@ss14-studio/core';
import { ProjectIndex, type StudioStatus } from './indexer.js';
import { StateStore } from './state.js';
import { IdeBridge, type IdeNotificationLevel } from './ide.js';
import {
  dataUrl,
  createTransparentPng,
  decodeDataUrl,
  pngDimensions,
} from './png.js';
import {
  ensureDirectory,
  isDirectory,
  isInside,
  normalizeSlashes,
  pathExists,
  readTextFile,
  resolveFileArgument,
  writeTextFile,
} from './paths.js';

interface IconSheetResult {
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
}

interface IconLayerResult extends IconSheetResult {
  uri: string;
  color?: string | null;
  scale?: number | null;
  offset?: { x: number; y: number } | null;
  visible?: boolean;
}

interface IconResult {
  uri: string | null;
  sheet?: IconSheetResult;
  layers?: IconLayerResult[];
}

export class StudioSession {
  readonly index: ProjectIndex;
  private currentView: WorkspaceView = { kind: 'dashboard' };
  private currentKey: string | undefined;
  private currentDiff: DiffPayload | undefined;
  private readonly iconCache = new Map<string, IconResult>();
  private ready = false;
  private theme: 'dark' | 'light' | 'high-contrast' = 'dark';
  private changeTimer: NodeJS.Timeout | undefined;

  constructor(
    roots: string[],
    private readonly store: StateStore,
    private readonly ide: IdeBridge,
    private readonly broadcast: (message: HostMessage) => void,
    private readonly onStatus?: (status: StudioStatus) => void,
  ) {
    this.index = new ProjectIndex(roots, {
      onIndex: (payload) => {
        this.iconCache.clear();
        this.broadcast({ type: 'index', payload });
        if (this.ready && this.currentView.kind === 'graph') {
          void this.showGraph(this.currentView.key, 'update');
        }
      },
      onPrototypes: (payload) => {
        this.iconCache.clear();
        this.broadcast({ type: 'prototypes', payload });
        if (this.ready && this.currentView.kind === 'prototype') {
          this.postPrototype(
            this.currentView.id,
            this.currentView.kindFilter,
          );
        }
      },
      onProgress: (progress) => {
        this.broadcast({ type: 'indexProgress', ...progress });
      },
      onStatus: (status) => {
        this.onStatus?.(status);
      },
    });
  }

  async start(): Promise<void> {
    await this.index.refresh();
  }

  setTheme(kind: 'dark' | 'light' | 'high-contrast'): void {
    this.theme = kind;
    this.broadcast({ type: 'theme', kind });
  }

  async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          this.ready = true;
          this.postReadyState();
          this.post({ type: 'index', payload: this.index.getPayload() });
          this.post({
            type: 'prototypes',
            payload: this.index.getPrototypePayload(),
          });
          this.postTheme();
          await this.replayView();
          break;
        case 'requestIndex':
          this.post({ type: 'index', payload: this.index.getPayload() });
          break;
        case 'openGraph':
          await this.openGraph(message.key);
          break;
        case 'openDashboard':
          await this.openDashboard();
          break;
        case 'openSource':
          await this.openSource(
            message.key,
            message.line,
            message.node,
            message.edgeIndex,
          );
          break;
        case 'openFile':
          await this.openFile(message.uri);
          break;
        case 'openPath':
          await this.openPath(message.path, message.line);
          break;
        case 'openCodeBehind':
          await this.openPath(message.filePath);
          break;
        case 'saveLayout':
          this.store.setLayout(message.key, message.layout);
          break;
        case 'applyOperation': {
          const result = await this.applyOperation(
            message.key,
            message.operation,
          );
          this.post({
            type: 'operationResult',
            requestId: message.requestId,
            result,
          });
          break;
        }
        case 'createGraph': {
          const result = await this.createGraph(message.options);
          this.post({
            type: 'operationResult',
            requestId: message.requestId,
            result,
          });
          break;
        }
        case 'refreshIndex':
          await this.index.refresh();
          this.iconCache.clear();
          this.post({ type: 'index', payload: this.index.getPayload() });
          this.post({
            type: 'prototypes',
            payload: this.index.getPrototypePayload(),
          });
          this.toast('success', 'Index refreshed.');
          break;
        case 'requestEntityIcon':
          await this.postEntityIcon(message.entityId);
          break;
        case 'copyText':
          this.ide.copyText(message.text);
          this.toast('success', 'Copied to clipboard.');
          break;
        case 'openSettings':
          this.ide.openSettings();
          break;
        case 'openDocs':
          this.ide.openUrl(
            'https://github.com/ss14studio/ss14-studio#readme',
          );
          break;
        case 'openPrototype':
          this.postPrototype(message.id, message.kind);
          break;
        case 'openRsi':
          await this.postRsi(message.path);
          break;
        case 'openXaml':
          await this.postXaml(message.path);
          break;
        case 'openCSharp':
          await this.postCSharp(message.path);
          break;
        case 'pickRsi': {
          const path = await this.ide.pickFile({
            title: 'Open an RSI sprite folder',
            directory: true,
          });
          if (path) await this.postRsi(path);
          break;
        }
        case 'pickXaml': {
          const path = await this.ide.pickFile({
            title: 'Open a RobustToolbox XAML file',
            extensions: ['xaml'],
          });
          if (path) await this.postXaml(path);
          break;
        }
        case 'pickCSharp': {
          const path = await this.ide.pickFile({
            title: 'Open a C# file in SS14 Studio',
            extensions: ['cs'],
          });
          if (path) await this.postCSharp(path);
          break;
        }
        case 'openAbout':
          await this.openAbout();
          break;
        case 'requestDiff': {
          const payload = diffText({
            oldText: message.oldText,
            newText: message.newText,
            title: message.title,
            oldLabel: message.oldLabel,
            newLabel: message.newLabel,
          });
          await this.showDiff(payload);
          break;
        }
        case 'applyPrototypeOperation': {
          const result = await this.applyPrototypeOperation(
            message.filePath,
            message.operation,
          );
          this.post({
            type: 'operationResult',
            requestId: message.requestId,
            result,
          });
          break;
        }
        case 'applyRsiOperation': {
          const result = await this.applyRsiOperation(
            message.path,
            message.operation,
          );
          this.post({
            type: 'operationResult',
            requestId: message.requestId,
            result,
          });
          break;
        }
        case 'applyXamlOperation': {
          const result = await this.applyXamlOperation(
            message.filePath,
            message.operation,
          );
          this.post({
            type: 'operationResult',
            requestId: message.requestId,
            result,
          });
          break;
        }
        case 'saveRsiPng': {
          const result = await this.saveRsiPng(
            message.path,
            message.state,
            message.dataUrl,
          );
          this.post({
            type: 'operationResult',
            requestId: message.requestId,
            result,
          });
          break;
        }
        case 'importRsiFrames': {
          const result = await this.importRsiFrames(
            message.path,
            message.state,
          );
          this.post({
            type: 'operationResult',
            requestId: message.requestId,
            result,
          });
          break;
        }
        case 'deleteRsiImage': {
          const result = await this.deleteRsiImage(
            message.path,
            message.state,
          );
          this.post({
            type: 'operationResult',
            requestId: message.requestId,
            result,
          });
          break;
        }
        case 'saveConfig': {
          const incoming = message.config;
          this.store.settings.config = {
            ...this.store.settings.config,
            ...incoming,
          };
          if (
            incoming.graphSprites == null &&
            incoming.entityIcons != null
          ) {
            this.store.settings.config.graphSprites =
              incoming.entityIcons;
          }
          this.store.settings.config.entityIcons =
            this.store.settings.config.graphSprites;
          await this.store.saveSettings();
          this.post({ type: 'settings', config: this.store.settings.config });
          break;
        }
        case 'revealSetting':
          this.ide.openSettings(message.setting);
          break;
        case 'runXamlCleanup': {
          const result = await this.applyXamlOperation(message.filePath, {
            kind: 'cleanup',
          });
          this.post({
            type: 'operationResult',
            requestId: Date.now(),
            result,
          });
          break;
        }
        default:
          break;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.toast('error', text);
    }
  }

  async openDashboard(): Promise<void> {
    this.currentView = { kind: 'dashboard' };
    this.currentKey = undefined;
    this.currentDiff = undefined;
    this.post({ type: 'view', view: this.currentView });
    this.post({ type: 'graph', graph: null, reason: 'open' });
    this.post({ type: 'index', payload: this.index.getPayload() });
    this.post({
      type: 'prototypes',
      payload: this.index.getPrototypePayload(),
    });
  }

  async openGraph(key: string): Promise<void> {
    await this.showGraph(key, 'open');
  }

  async openAbout(): Promise<void> {
    this.currentView = { kind: 'about' };
    this.currentDiff = undefined;
    this.post({ type: 'view', view: this.currentView });
  }

  async openCSharp(path: string): Promise<void> {
    await this.postCSharp(path);
  }

  async showDiff(payload: DiffPayload): Promise<void> {
    this.currentDiff = payload;
    this.currentView = { kind: 'diff', payload };
    this.post({ type: 'diff', payload });
    this.post({ type: 'view', view: this.currentView });
  }

  async openForFile(
    path: string,
    line?: number,
    text?: string,
    quiet = false,
  ): Promise<void> {
    const absolute = this.resolvePath(path);
    if (!absolute) {
      if (!quiet) this.toast('error', `Could not resolve "${path}".`);
      return;
    }
    const lower = absolute.toLowerCase();
    if (lower.endsWith('.xaml.cs')) {
      await this.postXaml(absolute.slice(0, -3));
      return;
    }
    if (lower.endsWith('.xaml')) {
      await this.postXaml(absolute);
      return;
    }
    if (lower.endsWith('.cs')) {
      await this.postCSharp(absolute);
      return;
    }
    if (
      lower.endsWith('.rsi') ||
      lower.includes('.rsi/') ||
      lower.includes('.rsi\\')
    ) {
      await this.postRsi(absolute);
      return;
    }
    if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
      let source = text;
      if (source == null) {
        try {
          source = (await readTextFile(absolute)).text;
        } catch {
          if (!quiet) this.toast('error', `Could not read ${path}.`);
          return;
        }
      }
      const zeroBased = Math.max(0, (line ?? 1) - 1);
      const graphs = this.index.parseText(absolute, source).graphs;
      if (graphs.length > 0) {
        const nearest =
          [...graphs]
            .reverse()
            .find((graph) => graph.line - 1 <= zeroBased) ?? graphs[0]!;
        await this.openGraph(nearest.key);
        return;
      }
      const parsed = this.index.parsePrototypeText(absolute, source);
      const prototypes = parsed.prototypes.filter(
        (prototype) => !prototype.abstract,
      );
      if (prototypes.length > 0) {
        const nearest =
          [...prototypes]
            .reverse()
            .find((prototype) => prototype.line - 1 <= zeroBased) ??
          prototypes[0]!;
        const view = this.index.getPrototypeViewForSource(
          absolute,
          source,
          nearest.id,
          nearest.kind,
        );
        if (view) {
          this.postPrototypeView(view);
          return;
        }
      }
      if (!quiet) {
        this.toast(
          'info',
          'No construction graph or prototype was found in this file.',
        );
      }
      return;
    }
    if (await isDirectory(absolute)) {
      if (lower.endsWith('.rsi')) {
        await this.postRsi(absolute);
        return;
      }
    }
    if (!quiet) {
      this.toast(
        'info',
        'Open a graph/prototype YAML, XAML, XAML.cs, C# or RSI file.',
      );
    }
  }

  async openPath(path: string, line?: number): Promise<void> {
    if (/^https?:\/\//i.test(path)) {
      this.ide.openUrl(path);
      return;
    }
    const absolute = this.resolvePath(path);
    if (!absolute) {
      this.toast('error', `Could not resolve "${path}".`);
      return;
    }
    this.ide.openPath(absolute, line);
  }

  async openFile(uri: string): Promise<void> {
    const absolute = this.resolvePath(uri);
    if (!absolute) {
      this.toast('error', `Could not open ${uri}.`);
      return;
    }
    this.ide.openPath(absolute);
  }

  async openSource(
    key: string,
    line?: number,
    node?: string,
    edgeIndex?: number,
  ): Promise<void> {
    const graph = await this.getGraphForDisplay(key);
    if (!graph) return;
    let targetLine = line ?? graph.line;
    if (node) {
      const nodeModel = graph.nodes.find(
        (candidate) => candidate.name === node,
      );
      if (nodeModel) {
        targetLine =
          edgeIndex != null
            ? (nodeModel.edges[edgeIndex]?.line ?? nodeModel.line)
            : nodeModel.line;
      }
    }
    this.ide.openPath(graph.filePath, targetLine);
  }

  handleExternalChanges(paths: string[]): void {
    if (!this.store.settings.autoRefresh || paths.length === 0) return;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    const view = this.currentView;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      void (async () => {
        await this.index.refresh();
        if (view.kind === 'rsi') {
          if (paths.some((path) => isInside(view.path, path))) {
            await this.postRsi(view.path);
          }
        } else if (view.kind === 'xaml') {
          if (
            paths.some(
              (path) =>
                path === view.path || path === `${view.path}.cs`,
            )
          ) {
            await this.postXaml(view.path);
          }
        }
      })();
    }, 350);
  }

  dispose(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.index.dispose();
    this.ide.dispose();
  }

  private async replayView(): Promise<void> {
    switch (this.currentView.kind) {
      case 'dashboard':
        this.post({ type: 'view', view: this.currentView });
        this.post({ type: 'graph', graph: null, reason: 'open' });
        break;
      case 'graph':
        await this.showGraph(this.currentView.key, 'update');
        break;
      case 'prototype':
        this.postPrototype(
          this.currentView.id,
          this.currentView.kindFilter,
        );
        break;
      case 'rsi':
        await this.postRsi(this.currentView.path);
        break;
      case 'xaml':
        await this.postXaml(this.currentView.path);
        break;
      case 'csharp':
        await this.postCSharp(this.currentView.path);
        break;
      case 'diff':
        this.post({ type: 'diff', payload: this.currentView.payload });
        this.post({ type: 'view', view: this.currentView });
        break;
      case 'about':
        this.post({ type: 'view', view: this.currentView });
        break;
      default:
        break;
    }
  }

  private async showGraph(
    key: string,
    reason: 'open' | 'update' | 'created',
  ): Promise<void> {
    const graph = await this.getGraphForDisplay(key);
    if (!graph) {
      this.post({
        type: 'graphMissing',
        key,
        message:
          'This construction graph is no longer present in the workspace.',
      });
      return;
    }

    this.currentKey = key;
    this.currentView = { kind: 'graph', key };
    const view: GraphView = { ...graph, readOnly: this.store.readOnly };
    this.post({ type: 'view', view: this.currentView });
    this.post({ type: 'graph', graph: view, reason });
    this.post({
      type: 'layout',
      key,
      layout: this.store.getLayout(key) ?? null,
    });
  }

  private postPrototypeView(view: PrototypeView): void {
    this.currentView = {
      kind: 'prototype',
      id: view.summary.id,
      kindFilter: view.summary.kind,
    };
    this.currentKey = undefined;
    this.post({ type: 'view', view: this.currentView });
    this.post({
      type: 'prototypes',
      payload: this.index.getPrototypePayload(),
    });
    this.post({ type: 'prototype', view });
  }

  private postPrototype(id: string, kind?: string): void {
    const view = this.index.getPrototypeView(id, kind);
    this.currentView = { kind: 'prototype', id, kindFilter: kind };
    this.currentKey = undefined;
    this.post({ type: 'view', view: this.currentView });
    this.post({
      type: 'prototypes',
      payload: this.index.getPrototypePayload(),
    });
    if (!view) {
      this.post({
        type: 'prototype',
        view: null,
        message: `Prototype "${id}" was not found. It may have been renamed or removed.`,
      });
      return;
    }
    this.post({ type: 'prototype', view });
  }

  private async postRsi(path: string): Promise<void> {
    const loaded = await this.readRsi(path);
    this.currentView = { kind: 'rsi', path: loaded?.dir ?? path };
    this.currentKey = undefined;
    this.post({ type: 'view', view: this.currentView });
    if (!loaded) {
      this.post({
        type: 'rsi',
        view: null,
        message: `Could not find an RSI at "${path}".`,
      });
      return;
    }
    this.post({ type: 'rsi', view: loaded.view });
  }

  private async postXaml(path: string): Promise<void> {
    const absolute = this.resolvePath(path);
    if (!absolute) {
      this.post({
        type: 'xaml',
        view: null,
        message: `Could not resolve "${path}".`,
      });
      return;
    }
    const view = await this.readXaml(absolute);
    this.currentView = { kind: 'xaml', path: absolute };
    this.currentKey = undefined;
    this.post({ type: 'view', view: this.currentView });
    if (!view) {
      this.post({
        type: 'xaml',
        view: null,
        message: `Could not read ${basename(absolute)}.`,
      });
      return;
    }
    this.post({ type: 'xaml', view });
  }

  private async postCSharp(path: string): Promise<void> {
    const absolute = this.resolvePath(path);
    if (!absolute) {
      this.post({
        type: 'csharp',
        view: null,
        message: `Could not resolve "${path}".`,
      });
      return;
    }
    const view = await this.index.getCSharpView(absolute);
    this.currentView = { kind: 'csharp', path: absolute };
    this.currentKey = undefined;
    this.post({ type: 'view', view: this.currentView });
    if (!view) {
      this.post({
        type: 'csharp',
        view: null,
        message: `Could not read ${basename(absolute)}.`,
      });
      return;
    }
    this.post({ type: 'csharp', view });
  }

  private async getGraphForDisplay(
    key: string,
  ): Promise<ConstructionGraph | undefined> {
    const indexed = this.index.getGraph(key);
    if (!indexed) return undefined;
    try {
      const { text } = await readTextFile(indexed.filePath);
      const parsed = this.index.parseText(indexed.filePath, text);
      return (
        parsed.graphs.find((graph) => graph.key === key) ??
        parsed.graphs.find((graph) => graph.id === indexed.id) ??
        indexed
      );
    } catch {
      return indexed;
    }
  }

  private async applyOperation(
    key: string,
    operation: GraphOperation,
  ): Promise<EditResult> {
    const indexed = this.index.getGraph(key);
    if (!indexed) {
      return {
        ok: false,
        error: 'This graph no longer exists. Refresh the index.',
      };
    }
    const filePath = indexed.filePath;
    await this.ide.saveDocument(filePath);
    let file;
    try {
      file = await readTextFile(filePath);
    } catch {
      return { ok: false, error: 'Could not open the graph YAML file.' };
    }
    const parsed = this.index.parseText(filePath, file.text);
    const graph =
      parsed.graphs.find((candidate) => candidate.key === key) ??
      parsed.graphs.find((candidate) => candidate.id === indexed.id);
    if (!graph) {
      return {
        ok: false,
        error:
          'Could not find this graph in the current YAML. It may have been renamed.',
      };
    }

    let result;
    try {
      result = applyGraphOperation(graph, operation);
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof EditFailure || error instanceof Error
            ? error.message
            : String(error),
      };
    }

    if (result.edits.length === 0) {
      return { ok: true, message: result.message };
    }

    await writeTextFile(
      filePath,
      applyTextEdits(file.text, result.edits),
      file.bom,
    );
    this.ide.refreshFiles([filePath]);
    await this.index.refresh();

    const updated = this.index.getGraph(key);
    if (updated) {
      this.currentKey = key;
      this.currentView = { kind: 'graph', key };
      this.post({
        type: 'graph',
        graph: { ...updated, readOnly: this.store.readOnly },
        reason: 'update',
      });
      this.post({
        type: 'layout',
        key,
        layout: this.store.getLayout(key) ?? null,
      });
    } else {
      this.toast(
        'warn',
        'The edit was applied, but the graph could not be reparsed. Check the YAML.',
      );
    }
    return { ok: true, message: result.message };
  }

  private async applyPrototypeOperation(
    filePath: string,
    operation: PrototypeOperation,
  ): Promise<EditResult> {
    const absolute = this.resolvePath(filePath);
    if (!absolute) {
      return { ok: false, error: 'Could not resolve the prototype file.' };
    }
    await this.ide.saveDocument(absolute);
    let file;
    try {
      file = await readTextFile(absolute);
    } catch {
      return { ok: false, error: 'Could not open the prototype YAML file.' };
    }

    const result = applyPrototypeOperation(file.text, operation);
    if (operation.kind === 'extractPartial') {
      await this.ide.openScratch(
        `${basename(absolute).replace(/\.ya?ml$/i, '')}-partial.yml`,
        result.message,
        'yml',
      );
      return {
        ok: true,
        message:
          'Generated a YAML partial in a scratch editor. Save it under a declared partial directory.',
      };
    }
    if (result.edits.length === 0) {
      return { ok: true, message: result.message };
    }

    const updated = applyTextEdits(file.text, result.edits);
    await writeTextFile(absolute, updated, file.bom);
    this.ide.refreshFiles([absolute]);
    await this.index.refresh();

    const view = this.index.getPrototypeViewForSource(absolute, updated);
    if (view) this.postPrototypeView(view);
    return { ok: true, message: result.message };
  }

  private async applyRsiOperation(
    path: string,
    operation: RsiOperation,
  ): Promise<EditResult> {
    const dir = await this.resolveRsiDir(path);
    if (!dir) {
      return { ok: false, error: `Could not find an RSI at "${path}".` };
    }
    const metaPath = join(dir, 'meta.json');
    await this.ide.saveDocument(metaPath);
    let meta: RsiMeta;
    try {
      meta = parseRsiMeta(
        (await readTextFile(metaPath)).text,
        metaPath,
      ).meta;
    } catch {
      return { ok: false, error: 'Could not read meta.json.' };
    }

    const result = applyRsiOperation(meta, operation);
    const notes = [...result.notes];

    if (result.changed) {
      const config = this.store.settings.config;
      await writeTextFile(
        metaPath,
        serializeRsiMeta(result.meta, {
          indent: config.rsiMetaIndent,
          finalNewline: config.rsiMetaFinalNewline,
        }),
      );
      this.ide.refreshFiles([metaPath]);

      if (operation.kind === 'renameState' && operation.name !== operation.state) {
        const from = join(dir, `${operation.state}.png`);
        const to = join(dir, `${operation.name}.png`);
        try {
          await fs.rename(from, to);
        } catch {
          notes.push(
            `Could not rename ${operation.state}.png; rename the sheet manually.`,
          );
        }
      }

      if (operation.kind === 'removeState') {
        try {
          await fs.rm(join(dir, `${operation.state}.png`));
        } catch {
          // The sheet may already be gone.
        }
      }

      if (operation.kind === 'addState') {
        const state = result.meta.states.find(
          (candidate) => candidate.name === operation.state.name,
        );
        if (state) {
          const size = result.meta.size ?? { x: 32, y: 32 };
          const directions = [1, 4, 8].includes(state.directions)
            ? state.directions
            : 1;
          const sheet = createTransparentPng(
            size.x * directions,
            size.y,
          );
          const pngPath = join(dir, `${state.name}.png`);
          if (!(await pathExists(pngPath))) {
            await fs.writeFile(pngPath, sheet);
            notes.push(`Created an empty ${state.name}.png sheet.`);
          }
        }
      }

      if (operation.kind === 'cleanup') {
        try {
          const files = (await fs.readdir(dir)).filter((name) =>
            name.toLowerCase().endsWith('.png'),
          );
          const orphans = findOrphanImages(result.meta, files);
          for (const orphan of orphans) {
            await fs.rm(join(dir, orphan));
          }
          if (orphans.length > 0) {
            notes.push(`Removed ${orphans.length} unreferenced image(s).`);
          }
        } catch {
          notes.push('Could not scan for unreferenced images.');
        }
      }
    }

    const loaded = await this.readRsiFromDir(dir);
    if (loaded) {
      this.currentView = { kind: 'rsi', path: dir };
      this.post({ type: 'view', view: this.currentView });
      this.post({ type: 'rsi', view: loaded });
    }

    return {
      ok: true,
      message: [result.message, ...notes].filter(Boolean).join(' '),
    };
  }

  private async saveRsiPng(
    path: string,
    state: string,
    dataUrlValue: string,
  ): Promise<EditResult> {
    const dir = await this.resolveRsiDir(path);
    if (!dir) return { ok: false, error: 'Could not find the RSI directory.' };
    const data = decodeDataUrl(dataUrlValue);
    if (!data) {
      return { ok: false, error: 'The pixel editor did not produce a PNG.' };
    }
    await fs.writeFile(join(dir, `${state}.png`), data);
    this.ide.refreshFiles([join(dir, `${state}.png`)]);
    const loaded = await this.readRsiFromDir(dir);
    if (loaded) {
      this.currentView = { kind: 'rsi', path: dir };
      this.post({ type: 'view', view: this.currentView });
      this.post({ type: 'rsi', view: loaded });
    }
    return { ok: true, message: `Saved ${state}.png.` };
  }

  private async importRsiFrames(
    path: string,
    state: string,
  ): Promise<EditResult> {
    const dir = await this.resolveRsiDir(path);
    if (!dir) return { ok: false, error: 'Could not find the RSI directory.' };
    const picked = await this.ide.pickFile({
      title: `Import ${state}.png`,
      extensions: ['png'],
    });
    if (!picked) return { ok: true, message: 'No image selected.' };
    await fs.copyFile(picked, join(dir, `${state}.png`));
    this.ide.refreshFiles([join(dir, `${state}.png`)]);
    const loaded = await this.readRsiFromDir(dir);
    if (loaded) {
      this.currentView = { kind: 'rsi', path: dir };
      this.post({ type: 'view', view: this.currentView });
      this.post({ type: 'rsi', view: loaded });
    }
    return { ok: true, message: `Replaced ${state}.png.` };
  }

  private async deleteRsiImage(
    path: string,
    state: string,
  ): Promise<EditResult> {
    const dir = await this.resolveRsiDir(path);
    if (!dir) return { ok: false, error: 'Could not find the RSI directory.' };
    const pngPath = join(dir, `${state}.png`);
    try {
      await fs.rm(pngPath);
    } catch {
      return { ok: false, error: `${state}.png does not exist.` };
    }
    this.ide.refreshFiles([pngPath]);
    const loaded = await this.readRsiFromDir(dir);
    if (loaded) {
      this.currentView = { kind: 'rsi', path: dir };
      this.post({ type: 'view', view: this.currentView });
      this.post({ type: 'rsi', view: loaded });
    }
    return { ok: true, message: `Deleted ${state}.png.` };
  }

  private async applyXamlOperation(
    filePath: string,
    operation: XamlOperation,
  ): Promise<EditResult> {
    const absolute = this.resolvePath(filePath);
    if (!absolute) {
      return { ok: false, error: 'Could not resolve the XAML file.' };
    }
    await this.ide.saveDocument(absolute);
    let before: string;
    let bom = false;
    try {
      const file = await readTextFile(absolute);
      before = file.text;
      bom = file.bom;
    } catch {
      return { ok: false, error: 'Could not open the XAML file.' };
    }
    const result = applyXamlOperation(
      before,
      operation,
      this.index.relativePath(absolute),
      { indentSize: this.store.settings.config.xamlIndentSize },
    );
    if (result.text === before) {
      return { ok: true, message: result.message };
    }

    await writeTextFile(absolute, result.text, bom);
    this.ide.refreshFiles([absolute]);
    await this.index.refresh();

    const view = await this.readXamlText(absolute, result.text);
    this.currentView = { kind: 'xaml', path: absolute };
    this.post({ type: 'view', view: this.currentView });
    this.post({ type: 'xaml', view });

    const payload = diffText({
      oldText: before,
      newText: result.text,
      title: `${basename(absolute)} · ${operation.kind}`,
      oldLabel: 'Before',
      newLabel: 'After',
    });
    await this.showDiff(payload);

    return { ok: true, message: result.message };
  }

  private async createGraph(
    options: CreateGraphOptions,
  ): Promise<EditResult> {
    const id = options.id.trim();
    const start = options.start.trim() || 'start';
    if (!id) return { ok: false, error: 'A graph id is required.' };
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
      return {
        ok: false,
        error:
          'Graph ids may contain letters, numbers, underscores, dots and dashes.',
      };
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(start)) {
      return {
        ok: false,
        error:
          'Start node names may contain letters, numbers, underscores, dots and dashes.',
      };
    }

    const roots = this.index.getRootPaths();
    const root = roots[0];
    if (!root) {
      return { ok: false, error: 'Open an SS14 project first.' };
    }

    let targetPath = options.path.trim();
    if (!targetPath) {
      targetPath = `Resources/Prototypes/Recipes/Construction/Graphs/${id}.yml`;
    }
    if (!/\.ya?ml$/i.test(targetPath)) targetPath += '.yml';
    const absolute = isAbsolute(targetPath)
      ? resolve(targetPath)
      : resolve(root, targetPath);
    if (!roots.some((candidate) => isInside(candidate, absolute))) {
      return {
        ok: false,
        error: 'The new graph must be inside the project.',
      };
    }
    if (await pathExists(absolute)) {
      return {
        ok: false,
        error: `A file already exists at ${targetPath}.`,
      };
    }

    const content = renderGraphTemplate({
      id,
      start,
      entity: options.entity?.trim() || undefined,
    });
    await ensureDirectory(dirname(absolute));
    await writeTextFile(absolute, content);
    this.ide.refreshFiles([absolute]);
    await this.index.refresh();

    const created = this.index
      .getSummaries()
      .find(
        (summary) =>
          summary.id === id &&
          normalizeSlashes(summary.filePath) ===
            normalizeSlashes(absolute),
      );
    if (created) await this.openGraph(created.key);
    this.toast('success', `Created construction graph "${id}".`);
    return { ok: true, message: `Created ${targetPath}.` };
  }

  private async postEntityIcon(entityId: string): Promise<void> {
    const cached = this.iconCache.get(entityId);
    if (cached) {
      this.post({
        type: 'entityIcon',
        entityId,
        uri: cached.uri,
        sheet: cached.sheet,
        layers: cached.layers,
      });
      return;
    }
    const sprite = this.index.getEntitySprite(entityId);
    const result = await this.buildEntityIcon(sprite);
    this.iconCache.set(entityId, result);
    this.post({
      type: 'entityIcon',
      entityId,
      uri: result.uri,
      sheet: result.sheet,
      layers: result.layers,
    });
  }

  private async loadSpriteSheet(
    layer: Pick<SpriteLayerInfo, 'rsi' | 'state' | 'texture'>,
  ): Promise<{ uri: string; sheet: IconSheetResult } | null> {
    if (!layer.rsi && layer.texture) {
      const texturePath = this.resolveResourcePath(layer.texture);
      if (!texturePath) return null;
      try {
        const bytes = await fs.readFile(texturePath);
        const dimensions = pngDimensions(bytes);
        if (!dimensions) return null;
        return {
          uri: dataUrl(bytes),
          sheet: {
            width: dimensions.width,
            height: dimensions.height,
            frameWidth: dimensions.width,
            frameHeight: dimensions.height,
            columns: 1,
          },
        };
      } catch {
        return null;
      }
    }
    if (!layer.rsi) return null;
    const dir = await this.resolveRsiDir(layer.rsi);
    if (!dir) return null;
    const stateName = layer.state ?? 'icon';
    let size = { x: 32, y: 32 };
    try {
      const meta = parseRsiMeta(
        (await readTextFile(join(dir, 'meta.json'))).text,
      ).meta;
      size = meta.size ?? size;
    } catch {
      // Defaults are fine when metadata is unavailable.
    }
    try {
      const bytes = await fs.readFile(join(dir, `${stateName}.png`));
      const dimensions = pngDimensions(bytes);
      if (!dimensions) return null;
      const columns = Math.max(
        1,
        Math.floor(dimensions.width / Math.max(1, size.x)),
      );
      return {
        uri: dataUrl(bytes),
        sheet: {
          width: dimensions.width,
          height: dimensions.height,
          frameWidth: Math.max(1, size.x),
          frameHeight: Math.max(1, size.y),
          columns,
        },
      };
    } catch {
      return null;
    }
  }

  private async buildEntityIcon(
    sprite: SpriteInfo | null,
  ): Promise<IconResult> {
    if (!sprite) return { uri: null };
    const layers: SpriteLayerInfo[] =
      sprite.layers && sprite.layers.length > 0
        ? sprite.layers
        : [
            {
              index: 0,
              rsi: sprite.rsi,
              state: sprite.state ?? sprite.layerState ?? 'icon',
              texture: sprite.texture ?? null,
              color: sprite.color ?? null,
              scale: sprite.scale ?? null,
              offset: sprite.offset ?? null,
              visible: sprite.visible !== false,
              map: null,
              fields: {},
            },
          ];
    const resolved: IconLayerResult[] = [];
    for (const layer of layers) {
      if (layer.visible === false) continue;
      const loaded = await this.loadSpriteSheet(layer);
      if (!loaded) continue;
      resolved.push({
        ...loaded.sheet,
        uri: loaded.uri,
        color: layer.color,
        scale: layer.scale,
        offset: layer.offset,
        visible: layer.visible,
      });
    }
    if (resolved.length === 0) return { uri: null };
    const primary = resolved[0]!;
    return {
      uri: primary.uri,
      sheet: {
        width: primary.width,
        height: primary.height,
        frameWidth: primary.frameWidth,
        frameHeight: primary.frameHeight,
        columns: primary.columns,
      },
      layers: resolved.length > 1 ? resolved : undefined,
    };
  }

  private async readRsi(
    path: string,
  ): Promise<{ dir: string; view: RsiView } | null> {
    const dir = await this.resolveRsiDir(path);
    if (!dir) return null;
    const view = await this.readRsiFromDir(dir);
    return view ? { dir, view } : null;
  }

  private async readRsiFromDir(dir: string): Promise<RsiView | null> {
    const metaPath = join(dir, 'meta.json');
    let meta: RsiMeta;
    let diagnostics: Diagnostic[] = [];
    try {
      const parsed = parseRsiMeta(
        (await readTextFile(metaPath)).text,
        metaPath,
      );
      meta = parsed.meta;
      diagnostics = parsed.diagnostics;
    } catch {
      return null;
    }

    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((name) =>
        name.toLowerCase().endsWith('.png'),
      );
    } catch {
      files = [];
    }

    const images: Record<string, RsiImageInfo> = {};
    for (const state of meta.states) {
      const imagePath = `${state.name}.png`;
      try {
        const bytes = await fs.readFile(join(dir, imagePath));
        const dimensions = pngDimensions(bytes);
        images[state.name] = {
          path: imagePath,
          exists: true,
          width: dimensions?.width ?? 0,
          height: dimensions?.height ?? 0,
          uri: dataUrl(bytes),
        };
      } catch {
        images[state.name] = {
          path: imagePath,
          exists: false,
          width: 0,
          height: 0,
          uri: null,
        };
      }
    }

    return buildRsiView({
      dirPath: dir,
      relativePath: this.index.relativePath(dir),
      metaPath,
      meta,
      images,
      diagnostics,
      orphanImages: findOrphanImages(meta, files),
    });
  }

  private async resolveRsiDir(path: string): Promise<string | null> {
    const trimmed = path.trim().replace(/\\/g, '/');
    if (!trimmed) return null;
    const candidates: string[] = [];
    if (/^file:/i.test(trimmed)) {
      const resolved = resolveFileArgument(this.index.getRootPaths(), trimmed);
      if (resolved) candidates.push(resolved);
    } else if (isAbsolute(trimmed)) {
      candidates.push(resolve(trimmed));
    } else {
      const clean = trimmed.replace(/^\/+/, '');
      const resource = this.resolveResourcePath(clean);
      if (resource) candidates.push(resource);
      const workspace = this.index.resolveWorkspacePath(clean);
      if (workspace) candidates.push(workspace);
    }

    for (const candidate of candidates) {
      const normalized = normalizeSlashes(candidate);
      const marker = normalized.toLowerCase().lastIndexOf('.rsi');
      if (marker >= 0) {
        const end = normalized.indexOf('/', marker);
        const rsiPath =
          end >= 0 ? normalized.slice(0, end) : normalized;
        if (await isDirectory(rsiPath)) return resolve(rsiPath);
      }

      if (normalized.toLowerCase().endsWith('meta.json')) {
        const dir = dirname(candidate);
        if (await isDirectory(dir)) return dir;
      }
      if (await isDirectory(candidate)) return resolve(candidate);
      if (
        !candidate.toLowerCase().endsWith('.rsi') &&
        (await isDirectory(`${candidate}.rsi`))
      ) {
        return resolve(`${candidate}.rsi`);
      }
    }
    return null;
  }

  private async readXaml(path: string): Promise<XamlView | null> {
    try {
      const text = (await readTextFile(path)).text;
      return this.readXamlText(path, text);
    } catch {
      return null;
    }
  }

  private async readXamlText(
    path: string,
    text: string,
  ): Promise<XamlView> {
    const codeBehindPath = `${path}.cs`;
    let codeBehindSource: string | null = null;
    try {
      codeBehindSource = (await readTextFile(codeBehindPath)).text;
    } catch {
      codeBehindSource = null;
    }
    const view = parseXaml(text, {
      filePath: path,
      relativePath: this.index.relativePath(path),
      codeBehindPath,
      codeBehindSource,
    });
    return this.enrichXamlView(view);
  }

  /**
   * Fill in the parts of the simulated designer that need project data:
   * resolved Fluent strings, texture data URLs and entity sprites.
   */
  private async enrichXamlView(view: XamlView): Promise<XamlView> {
    const walk = async (node: XamlDesignNode): Promise<void> => {
      const text = localizeXamlText(node.text, (key) =>
        this.index.resolveLocalization(key),
      );
      node.textResolved = text.text;
      node.textKey = text.key;
      const tooltip = localizeXamlText(node.tooltip, (key) =>
        this.index.resolveLocalization(key),
      );
      node.tooltipResolved = tooltip.text;
      node.style.color = robustColorToCss(node.style.color);
      node.style.background = robustColorToCss(node.style.background);
      node.style.borderColor = robustColorToCss(node.style.borderColor);
      node.image = await this.resolveXamlImage(node);
      await Promise.all(node.children.map(walk));
    };
    if (view.design) await walk(view.design);
    return view;
  }

  private async resolveXamlImage(
    node: XamlDesignNode,
  ): Promise<XamlImageInfo | null> {
    const attributes = node.attributes ?? {};
    const fit = xamlImageFit(attributes.StretchMode ?? attributes.Stretch);
    const texture = (attributes.TexturePath ?? attributes.Texture ?? '').trim();
    const prototype = (
      attributes.Prototype ??
      attributes.Entity ??
      attributes.EntityPrototype ??
      ''
    ).trim();
    const state = (attributes.State ?? attributes.SpriteState ?? '').trim();

    if (prototype && !texture) {
      const sprite = this.index.getEntitySprite(prototype);
      if (!sprite) return null;
      const icon = await this.buildEntityIcon(sprite);
      if (!icon.uri || !icon.sheet) return null;
      return {
        uri: icon.uri,
        ...icon.sheet,
        fit,
        source: prototype,
        kind: 'entity',
      };
    }

    if (!texture || texture.startsWith('{') || texture.startsWith('$')) {
      return null;
    }
    if (texture.endsWith('.rsi') || state) {
      const sprite: SpriteInfo = {
        rsi: texture.replace(/^\/+/, '').replace(/^Resources\//i, ''),
        state: state || 'icon',
        layerState: state || 'icon',
        color: null,
        scale: null,
        component: 'Sprite',
        texture: texture.endsWith('.rsi') ? null : texture,
      };
      const icon = await this.buildEntityIcon(sprite);
      if (!icon.uri || !icon.sheet) return null;
      return {
        uri: icon.uri,
        ...icon.sheet,
        fit,
        source: texture,
        kind: 'sprite',
      };
    }

    const texturePath = this.resolveResourcePath(texture);
    if (!texturePath) return null;
    try {
      const bytes = await fs.readFile(texturePath);
      const dimensions = pngDimensions(bytes);
      if (!dimensions) return null;
      return {
        uri: dataUrl(bytes),
        width: dimensions.width,
        height: dimensions.height,
        frameWidth: dimensions.width,
        frameHeight: dimensions.height,
        columns: 1,
        fit,
        source: texture,
        kind: 'texture',
      };
    } catch {
      return null;
    }
  }

  private resolvePath(path: string): string | undefined {
    return resolveFileArgument(this.index.getRootPaths(), path);
  }

  private resolveResourcePath(resourcePath: string): string | undefined {
    const normalized = resourcePath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/^Resources\//, '');
    const relative = normalized.startsWith('Textures/')
      ? normalized
      : `Textures/${normalized}`;
    for (const root of this.index.getRootPaths()) {
      return join(root, 'Resources', relative);
    }
    return undefined;
  }

  private postReadyState(): void {
    this.post({
      type: 'readyState',
      readOnly: this.store.readOnly,
      config: this.store.settings.config,
    });
  }

  private postTheme(): void {
    this.post({ type: 'theme', kind: this.theme });
  }

  private toast(level: IdeNotificationLevel, message: string): void {
    this.post({ type: 'toast', level, message });
    if (level === 'error' || level === 'warn') {
      this.ide.notify(level, message);
    }
  }

  private post(message: HostMessage): void {
    this.broadcast(message);
  }
}

function xamlImageFit(value: string | undefined): XamlImageInfo['fit'] {
  switch ((value ?? '').toLowerCase()) {
    case 'scale':
    case 'stretch':
      return 'stretch';
    case 'keepaspectcovered':
    case 'keepaspectcover':
    case 'cover':
      return 'cover';
    case 'keep':
    case 'keepcentered':
    case 'none':
      return 'none';
    case 'keepaspectcentered':
    case 'keepaspect':
    case 'contain':
    default:
      return 'contain';
  }
}
