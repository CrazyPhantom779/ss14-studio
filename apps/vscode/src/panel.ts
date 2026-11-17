import * as vscode from 'vscode';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  applyGraphOperation,
  applyPrototypeOperation,
  applyRsiOperation,
  applyXamlOperation,
  buildRsiView,
  defaultXamlTheme,
  diffText,
  EditFailure,
  enrichGraphIcons,
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
  type EditResult,
  type GraphOperation,
  type GraphView,
  type HostMessage,
  type PersistedLayout,
  type PrototypeOperation,
  type PrototypeView,
  type RsiImageInfo,
  type RsiMeta,
  type RsiOperation,
  type RsiView,
  type SpriteInfo,
  type SpriteLayerInfo,
  type StudioConfig,
  type WebviewMessage,
  type WorkspaceView,
  type XamlDesignNode,
  type XamlImageInfo,
  type XamlOperation,
  type XamlTheme,
  type XamlView,
} from '@ss14-studio/core';
import { getWebviewHtml } from './html.js';
import type { GraphIndex } from './indexer.js';
import type { LayoutStore } from './layoutStore.js';

const VIEW_TYPE = 'ss14Studio.graphEditor';
const decoder = new TextDecoder('utf-8');

export interface PanelOpenOptions {
  /** Open the studio beside the active editor instead of in the active column. */
  beside?: boolean;
  /** Keep keyboard focus in the editor (used for automatic side previews). */
  preserveFocus?: boolean;
}

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

export class GraphEditorPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelPromise: Promise<void> | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private currentView: WorkspaceView = { kind: 'dashboard' };
  private currentKey: string | undefined;
  private currentDiff: DiffPayload | undefined;
  private readonly iconCache = new Map<string, IconResult>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly index: GraphIndex,
    private readonly layouts: LayoutStore,
  ) {
    this.disposables.push(
      index.onDidChange(() => this.onIndexChanged()),
      index.onDidPrototypesChange(() => this.onPrototypesChanged()),
      vscode.window.onDidChangeActiveColorTheme(() => this.postTheme()),
    );
  }

  async openDashboard(options: PanelOpenOptions = {}): Promise<void> {
    await this.ensurePanel(options);
    this.currentView = { kind: 'dashboard' };
    this.currentKey = undefined;
    this.currentDiff = undefined;
    if (!this.ready) return;
    this.setTitle();
    this.post({ type: 'view', view: this.currentView });
    this.post({ type: 'graph', graph: null, reason: 'open' });
    this.postIndex();
    this.postPrototypes();
  }

  async openGraph(key: string, options: PanelOpenOptions = {}): Promise<void> {
    await this.ensurePanel(options);
    this.currentView = { kind: 'graph', key };
    this.currentDiff = undefined;
    if (!this.ready) return;
    await this.showGraph(key, 'open');
  }

  async openAtlas(options: PanelOpenOptions = {}): Promise<void> {
    await this.ensurePanel(options);
    this.currentView = { kind: 'atlas' };
    this.currentKey = undefined;
    this.currentDiff = undefined;
    if (!this.ready) return;
    this.setTitle('Construction atlas');
    this.post({ type: 'view', view: this.currentView });
    this.postAtlas();
  }

  async openPrototype(
    id: string,
    kind?: string,
    options: PanelOpenOptions = {},
  ): Promise<void> {
    await this.ensurePanel(options);
    this.currentView = { kind: 'prototype', id, kindFilter: kind };
    this.currentDiff = undefined;
    if (!this.ready) return;
    this.postPrototype(id, kind);
  }

  /**
   * Show a prototype view that was resolved from an unsaved editor buffer.
   * The next index refresh will fall back to the indexed version.
   */
  async openPrototypeView(
    view: PrototypeView,
    options: PanelOpenOptions = {},
  ): Promise<void> {
    await this.ensurePanel(options);
    this.currentView = {
      kind: 'prototype',
      id: view.summary.id,
      kindFilter: view.summary.kind,
    };
    this.currentKey = undefined;
    this.currentDiff = undefined;
    if (!this.ready) return;
    this.post({ type: 'view', view: this.currentView });
    this.postPrototypes();
    this.post({ type: 'prototype', view });
    this.setTitle(view.summary.id);
  }

  async openRsi(path: string, options: PanelOpenOptions = {}): Promise<void> {
    await this.ensurePanel(options);
    this.currentView = { kind: 'rsi', path };
    this.currentDiff = undefined;
    if (!this.ready) return;
    await this.postRsi(path);
  }

  async openXaml(path: string, options: PanelOpenOptions = {}): Promise<void> {
    await this.ensurePanel(options);
    this.currentView = { kind: 'xaml', path };
    this.currentDiff = undefined;
    if (!this.ready) return;
    await this.postXaml(path);
  }

  async openCSharp(path: string, options: PanelOpenOptions = {}): Promise<void> {
    await this.ensurePanel(options);
    this.currentView = { kind: 'csharp', path };
    this.currentDiff = undefined;
    if (!this.ready) return;
    await this.postCSharp(path);
  }

  async openAbout(options: PanelOpenOptions = {}): Promise<void> {
    await this.ensurePanel(options);
    this.currentView = { kind: 'about' };
    this.currentDiff = undefined;
    if (!this.ready) return;
    this.setTitle('About');
    this.post({ type: 'view', view: this.currentView });
  }

  async showDiff(
    payload: DiffPayload,
    options: PanelOpenOptions = {},
  ): Promise<void> {
    await this.ensurePanel(options);
    this.currentDiff = payload;
    this.currentView = { kind: 'diff', payload };
    if (!this.ready) return;
    this.setTitle(payload.title);
    this.post({ type: 'diff', payload });
    this.post({ type: 'view', view: this.currentView });
  }

  async createGraphInteractive(): Promise<void> {
    await this.ensurePanel();
    const id = await vscode.window.showInputBox({
      title: 'Create Construction Graph',
      prompt: 'Graph prototype id',
      placeHolder: 'MyConstructionGraph',
      validateInput: (value) =>
        /^[A-Za-z0-9_.-]+$/.test(value.trim())
          ? undefined
          : 'Use letters, numbers, underscores, dots or dashes.',
    });
    if (!id?.trim()) return;

    const start = await vscode.window.showInputBox({
      title: 'Create Construction Graph',
      prompt: 'Start node name',
      value: 'start',
      validateInput: (value) =>
        /^[A-Za-z0-9_.-]+$/.test(value.trim())
          ? undefined
          : 'Use letters, numbers, underscores, dots or dashes.',
    });
    if (!start?.trim()) return;

    const entity = await vscode.window.showInputBox({
      title: 'Create Construction Graph',
      prompt: 'Entity prototype for the start node (optional)',
      placeHolder: 'SheetSteel1',
    });
    if (entity == null) return;

    const root = this.index.getRoots()[0] ?? vscode.workspace.workspaceFolders?.[0];
    if (!root) {
      vscode.window.showErrorMessage('SS14 Studio: open an SS14 workspace first.');
      return;
    }
    const rootUri = 'path' in root ? vscode.Uri.file(root.path) : root.uri;
    const defaultUri = vscode.Uri.joinPath(
      rootUri,
      'Resources',
      'Prototypes',
      'Recipes',
      'Construction',
      'Graphs',
      `${id.trim()}.yml`,
    );
    const save = await vscode.window.showSaveDialog({
      title: 'Create Construction Graph',
      defaultUri,
      saveLabel: 'Create Graph',
      filters: { YAML: ['yml', 'yaml'] },
    });
    if (!save) return;

    const result = await this.createGraph({
      id: id.trim(),
      start: start.trim(),
      entity: entity.trim() || undefined,
      path: save.fsPath,
    });
    if (!result.ok) {
      vscode.window.showErrorMessage(`SS14 Studio: ${result.error}`);
    } else {
      vscode.window.showInformationMessage(`SS14 Studio: ${result.message}`);
    }
  }

  notifyConfigChanged(): void {
    if (!this.panel || !this.ready) return;
    this.postReadyState();
    this.post({ type: 'settings', config: readStudioConfig() });
  }

  /** True when the studio webview currently exists. */
  get isOpen(): boolean {
    return this.panel != null;
  }

  /** Reveal an existing panel without changing the current view. */
  reveal(options: PanelOpenOptions = {}): void {
    if (!this.panel) return;
    this.panel.reveal(
      options.beside ? vscode.ViewColumn.Beside : undefined,
      options.preserveFocus ?? false,
    );
  }

  private async ensurePanel(options: PanelOpenOptions = {}): Promise<void> {
    if (this.panel) {
      this.panel.reveal(
        options.beside ? vscode.ViewColumn.Beside : undefined,
        options.preserveFocus ?? false,
      );
      return;
    }
    if (!this.panelPromise) {
      this.panelPromise = this.createPanel(options).finally(() => {
        this.panelPromise = undefined;
      });
    }
    await this.panelPromise;
  }

  private async createPanel(options: PanelOpenOptions = {}): Promise<void> {
    const localRoots = [
      vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
    ];

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'SS14 Studio',
      {
        viewColumn: options.beside
          ? vscode.ViewColumn.Beside
          : vscode.ViewColumn.Active,
        preserveFocus: options.preserveFocus ?? false,
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: localRoots,
      },
    );
    this.panel = panel;
    this.ready = false;
    panel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      'media',
      'studio-panel.svg',
    );
    panel.webview.html = await getWebviewHtml(
      panel.webview,
      this.context.extensionUri,
    );

    this.panelDisposables.push(
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = undefined;
          this.ready = false;
          this.currentKey = undefined;
        }
        for (const disposable of this.panelDisposables) disposable.dispose();
        this.panelDisposables = [];
      }),
      panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message as WebviewMessage);
      }),
    );
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          this.ready = true;
          this.postReadyState();
          this.postIndex();
          this.postPrototypes();
          this.postTheme();
          await this.replayView();
          break;
        case 'requestIndex':
          this.postIndex();
          break;
        case 'openGraph':
          this.currentView = { kind: 'graph', key: message.key };
          this.currentDiff = undefined;
          await this.showGraph(message.key, 'open');
          break;
        case 'openDashboard':
          await this.openDashboard();
          break;
        case 'openAtlas':
          await this.openAtlas();
          break;
        case 'openSource':
          await this.openSource(message.key, message.line, message.node, message.edgeIndex);
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
          this.layouts.set(message.key, message.layout);
          break;
        case 'applyOperation': {
          const result = await this.applyOperation(message.key, message.operation);
          this.post({ type: 'operationResult', requestId: message.requestId, result });
          break;
        }
        case 'createGraph': {
          const result = await this.createGraph(message.options);
          this.post({ type: 'operationResult', requestId: message.requestId, result });
          break;
        }
        case 'refreshIndex':
          await this.index.refresh(true);
          this.iconCache.clear();
          this.postIndex();
          this.postPrototypes();
          this.toast('success', 'Construction graph and prototype index refreshed.');
          break;
        case 'requestEntityIcon':
          await this.postEntityIcon(message.entityId);
          break;
        case 'copyText':
          await vscode.env.clipboard.writeText(message.text);
          this.toast('success', 'Copied to clipboard.');
          break;
        case 'openSettings':
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'ss14Studio',
          );
          break;
        case 'openDocs':
          await this.openDocs();
          break;
        case 'openPrototype':
          this.currentView = { kind: 'prototype', id: message.id, kindFilter: message.kind };
          this.currentDiff = undefined;
          this.postPrototype(message.id, message.kind);
          break;
        case 'openRsi':
          this.currentView = { kind: 'rsi', path: message.path };
          this.currentDiff = undefined;
          await this.postRsi(message.path);
          break;
        case 'openXaml':
          this.currentView = { kind: 'xaml', path: message.path };
          this.currentDiff = undefined;
          await this.postXaml(message.path);
          break;
        case 'openCSharp':
          this.currentView = { kind: 'csharp', path: message.path };
          this.currentDiff = undefined;
          await this.postCSharp(message.path);
          break;
        case 'pickRsi':
          await this.pickRsi();
          break;
        case 'pickXaml':
          await this.pickXaml();
          break;
        case 'pickCSharp':
          await this.pickCSharp();
          break;
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
          const result = await this.applyPrototypeOperation(message.filePath, message.operation);
          this.post({ type: 'operationResult', requestId: message.requestId, result });
          break;
        }
        case 'applyRsiOperation': {
          const result = await this.applyRsiOperation(message.path, message.operation);
          this.post({ type: 'operationResult', requestId: message.requestId, result });
          break;
        }
        case 'applyXamlOperation': {
          const result = await this.applyXamlOperation(message.filePath, message.operation);
          this.post({ type: 'operationResult', requestId: message.requestId, result });
          break;
        }
        case 'saveRsiPng': {
          const result = await this.saveRsiPng(message.path, message.state, message.dataUrl);
          this.post({ type: 'operationResult', requestId: message.requestId, result });
          break;
        }
        case 'importRsiFrames': {
          const result = await this.importRsiFrames(message.path, message.state);
          this.post({ type: 'operationResult', requestId: message.requestId, result });
          break;
        }
        case 'deleteRsiImage': {
          const result = await this.deleteRsiImage(message.path, message.state);
          this.post({ type: 'operationResult', requestId: message.requestId, result });
          break;
        }
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
        case 'saveConfig': {
          const entries = Object.entries(message.config) as [string, unknown][];
          for (const [key, value] of entries) {
            const setting =
              key === 'entityIcons'
                ? 'graphSprites'
                : key === 'showGrid'
                  ? 'graphGrid'
                  : key;
            await vscode.workspace
              .getConfiguration('ss14Studio')
              .update(setting, value, vscode.ConfigurationTarget.Workspace);
          }
          this.post({ type: 'settings', config: readStudioConfig() });
          break;
        }
        case 'revealSetting':
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            `ss14Studio.${message.setting}`,
          );
          break;
        default:
          break;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.toast('error', text);
    }
  }

  private async replayView(): Promise<void> {
    switch (this.currentView.kind) {
      case 'dashboard':
        this.post({ type: 'view', view: this.currentView });
        this.post({ type: 'graph', graph: null, reason: 'open' });
        break;
      case 'atlas':
        this.post({ type: 'view', view: this.currentView });
        this.postAtlas();
        this.setTitle('Construction atlas');
        break;
      case 'graph':
        await this.showGraph(this.currentView.key, 'update');
        break;
      case 'prototype':
        this.postPrototype(this.currentView.id, this.currentView.kindFilter);
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
        this.setTitle(this.currentView.payload.title);
        break;
      case 'about':
        this.post({ type: 'view', view: this.currentView });
        this.setTitle('About');
        break;
      default:
        break;
    }
  }

  private async showGraph(
    key: string,
    reason: 'open' | 'update' | 'created',
  ): Promise<void> {
    if (!this.ready) {
      this.currentView = { kind: 'graph', key };
      return;
    }
    const graph = await this.getGraphForDisplay(key);
    if (!graph) {
      this.post({
        type: 'graphMissing',
        key,
        message: 'This construction graph is no longer present in the workspace.',
      });
      return;
    }

    this.currentKey = key;
    this.currentView = { kind: 'graph', key };
    this.setTitle(graph.id);
    const readOnly = !vscode.workspace.isTrusted;
    const view: GraphView = { ...graph, readOnly };
    this.post({ type: 'view', view: this.currentView });
    this.post({ type: 'graph', graph: view, reason });
    this.post({
      type: 'layout',
      key,
      layout: this.layouts.get(key) ?? null,
    });
  }

  private postPrototype(id: string, kind?: string): void {
    const view = this.index.getPrototypeView(id, kind);
    this.currentView = { kind: 'prototype', id, kindFilter: kind };
    this.currentKey = undefined;
    this.post({ type: 'view', view: this.currentView });
    this.postPrototypes();
    if (!view) {
      this.post({
        type: 'prototype',
        view: null,
        message: `Prototype "${id}" was not found. It may have been renamed or removed.`,
      });
      this.setTitle(id);
      return;
    }
    this.post({ type: 'prototype', view });
    this.setTitle(view.summary.id);
  }

  private async postRsi(path: string): Promise<void> {
    const loaded = await this.readRsi(path);
    this.currentView = { kind: 'rsi', path };
    this.currentKey = undefined;
    this.post({ type: 'view', view: this.currentView });
    if (!loaded) {
      this.post({
        type: 'rsi',
        view: null,
        message: `Could not find an RSI at "${path}".`,
      });
      this.setTitle();
      return;
    }
    this.post({ type: 'rsi', view: loaded.view });
    this.setTitle(basename(loaded.dir.fsPath));
  }

  private async postXaml(path: string): Promise<void> {
    const uri = await this.fileUri(path);
    if (!uri) {
      this.post({ type: 'xaml', view: null, message: `Could not resolve "${path}".` });
      return;
    }
    const view = await this.readXaml(uri);
    this.currentView = { kind: 'xaml', path: uri.fsPath };
    this.currentKey = undefined;
    this.post({ type: 'view', view: this.currentView });
    if (!view) {
      this.post({
        type: 'xaml',
        view: null,
        message: `Could not read ${basename(uri.fsPath)}.`,
      });
      this.setTitle();
      return;
    }
    this.post({ type: 'xaml', view });
    this.setTitle(basename(uri.fsPath));
  }

  private async postCSharp(path: string): Promise<void> {
    const uri = await this.fileUri(path);
    if (!uri) {
      this.post({ type: 'csharp', view: null, message: `Could not resolve "${path}".` });
      return;
    }
    const view = await this.index.getCSharpView(uri);
    this.currentView = { kind: 'csharp', path: uri.fsPath };
    this.currentKey = undefined;
    this.post({ type: 'view', view: this.currentView });
    if (!view) {
      this.post({
        type: 'csharp',
        view: null,
        message: `Could not read ${basename(uri.fsPath)}.`,
      });
      this.setTitle();
      return;
    }
    this.post({ type: 'csharp', view });
    this.setTitle(basename(uri.fsPath));
  }

  private async getGraphForDisplay(key: string): Promise<ConstructionGraph | undefined> {
    const indexed = this.index.getGraph(key);
    if (!indexed) return undefined;
    const uri = vscode.Uri.parse(indexed.filePath);
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === uri.toString(),
    );
    if (!document) return indexed;
    const parsed = this.index.parseText(uri, document.getText());
    const graph =
      parsed.graphs.find((candidate) => candidate.key === key) ??
      parsed.graphs.find((candidate) => candidate.id === indexed.id) ??
      indexed;
    // Live parses have no project-wide prototype index, so fill node icons
    // from the indexed registry before sending the graph to the webview.
    return enrichGraphIcons(graph, {
      hasEntity: (id) => this.index.getPrototypeSummary(id) != null,
      boardTargets: (component) => this.index.getBoardTargets(component),
    });
  }

  private async applyOperation(
    key: string,
    operation: GraphOperation,
  ): Promise<EditResult> {
    const indexed = this.index.getGraph(key);
    if (!indexed) {
      return { ok: false, error: 'This graph no longer exists. Refresh the index.' };
    }

    const uri = vscode.Uri.parse(indexed.filePath);
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      return { ok: false, error: 'Could not open the graph YAML file.' };
    }
    if ((await vscode.workspace.fs.isWritableFileSystem(uri.scheme)) === false) {
      return { ok: false, error: 'The graph YAML file is read-only.' };
    }

    const text = document.getText();
    const bomOffset = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    const parsed = this.index.parseText(uri, text);
    const graph =
      parsed.graphs.find((candidate) => candidate.key === key) ??
      parsed.graphs.find((candidate) => candidate.id === indexed.id);
    if (!graph) {
      return {
        ok: false,
        error: 'Could not find this graph in the current YAML. It may have been renamed.',
      };
    }

    let result;
    try {
      result = applyGraphOperation(graph, operation);
    } catch (error) {
      const message =
        error instanceof EditFailure || error instanceof Error
          ? error.message
          : String(error);
      return { ok: false, error: message };
    }

    if (result.edits.length === 0) {
      return { ok: true, message: result.message };
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const change of result.edits) {
      const start = document.positionAt(change.start + bomOffset);
      const end = document.positionAt(change.end + bomOffset);
      workspaceEdit.replace(uri, new vscode.Range(start, end), change.text);
    }

    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (!applied) {
      return { ok: false, error: 'VS Code rejected the workspace edit.' };
    }

    const updatedText = document.getText();
    const updatedParsed = this.index.parseText(uri, updatedText);
    const updatedGraph =
      updatedParsed.graphs.find((candidate) => candidate.key === key) ??
      updatedParsed.graphs.find((candidate) => candidate.id === indexed.id);
    if (updatedGraph) {
      this.currentKey = updatedGraph.key;
      this.currentView = { kind: 'graph', key: updatedGraph.key };
      this.setTitle(updatedGraph.id);
      this.post({
        type: 'graph',
        graph: { ...updatedGraph, readOnly: !vscode.workspace.isTrusted },
        reason: 'update',
      });
      this.post({
        type: 'layout',
        key: updatedGraph.key,
        layout: this.layouts.get(updatedGraph.key) ?? null,
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
    const uri = await this.fileUri(filePath);
    if (!uri) return { ok: false, error: 'Could not resolve the prototype file.' };
    if ((await vscode.workspace.fs.isWritableFileSystem(uri.scheme)) === false) {
      return { ok: false, error: 'This prototype file is read-only.' };
    }

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      return { ok: false, error: 'Could not open the prototype YAML file.' };
    }

    const text = document.getText();
    const result = applyPrototypeOperation(text, operation);
    if (operation.kind === 'extractPartial') {
      const partial = await vscode.workspace.openTextDocument({
        content: result.message,
        language: 'yaml',
      });
      await vscode.window.showTextDocument(partial, { preview: false });
      return {
        ok: true,
        message: 'Generated a YAML partial in a new untitled document. Save it under a declared partial directory.',
      };
    }
    if (result.edits.length === 0) {
      return { ok: true, message: result.message };
    }

    const bomOffset = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const change of result.edits) {
      const start = document.positionAt(change.start + bomOffset);
      const end = document.positionAt(change.end + bomOffset);
      workspaceEdit.replace(uri, new vscode.Range(start, end), change.text);
    }
    if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
      return { ok: false, error: 'VS Code rejected the workspace edit.' };
    }

    const updated = document.getText();
    const view = this.index.getPrototypeViewForSource(uri, updated);
    if (view) {
      this.currentView = {
        kind: 'prototype',
        id: view.summary.id,
        kindFilter: view.summary.kind,
      };
      this.post({ type: 'view', view: this.currentView });
      this.post({ type: 'prototype', view });
      this.setTitle(view.summary.id);
    }
    return { ok: true, message: result.message };
  }

  private async applyRsiOperation(path: string, operation: RsiOperation): Promise<EditResult> {
    const dir = await this.resolveRsiDir(path);
    if (!dir) return { ok: false, error: `Could not find an RSI at "${path}".` };
    const metaUri = vscode.Uri.joinPath(dir, 'meta.json');
    let meta: RsiMeta;
    try {
      const parsed = parseRsiMeta(decoder.decode(await vscode.workspace.fs.readFile(metaUri)), metaUri.toString());
      meta = parsed.meta;
    } catch {
      return { ok: false, error: 'Could not read meta.json.' };
    }

    const result = applyRsiOperation(meta, operation);
    const notes = [...result.notes];

    if (result.changed) {
      const config = readStudioConfig();
      await vscode.workspace.fs.writeFile(
        metaUri,
        new TextEncoder().encode(
          serializeRsiMeta(result.meta, {
            indent: config.rsiMetaIndent,
            finalNewline: config.rsiMetaFinalNewline,
          }),
        ),
      );

      if (operation.kind === 'renameState' && operation.name !== operation.state) {
        const from = vscode.Uri.joinPath(dir, `${operation.state}.png`);
        const to = vscode.Uri.joinPath(dir, `${operation.name}.png`);
        try {
          await vscode.workspace.fs.rename(from, to, { overwrite: false });
        } catch {
          notes.push(`Could not rename ${operation.state}.png; rename the sheet manually.`);
        }
      }

      if (operation.kind === 'removeState') {
        try {
          await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, `${operation.state}.png`));
        } catch {
          // The sheet may already be gone.
        }
      }

      if (operation.kind === 'addState') {
        const state = result.meta.states.find((candidate) => candidate.name === operation.state.name);
        if (state) {
          const size = result.meta.size ?? { x: 32, y: 32 };
          const directions = [1, 4, 8].includes(state.directions) ? state.directions : 1;
          const sheet = createTransparentPng(size.x * directions, size.y);
          const pngUri = vscode.Uri.joinPath(dir, `${state.name}.png`);
          try {
            await vscode.workspace.fs.stat(pngUri);
          } catch {
            await vscode.workspace.fs.writeFile(pngUri, sheet);
            notes.push(`Created an empty ${state.name}.png sheet.`);
          }
        }
      }

      if (operation.kind === 'cleanup') {
        try {
          const entries = await vscode.workspace.fs.readDirectory(dir);
          const orphans = findOrphanImages(
            result.meta,
            entries.map(([name]) => name),
          );
          for (const orphan of orphans) {
            await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, orphan));
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
      this.currentView = { kind: 'rsi', path: dir.fsPath };
      this.post({ type: 'view', view: this.currentView });
      this.post({ type: 'rsi', view: loaded });
      this.setTitle(basename(dir.fsPath));
    }

    return {
      ok: true,
      message: [result.message, ...notes].filter(Boolean).join(' '),
    };
  }

  private async saveRsiPng(path: string, state: string, dataUrl: string): Promise<EditResult> {
    const dir = await this.resolveRsiDir(path);
    if (!dir) return { ok: false, error: 'Could not find the RSI directory.' };
    const data = decodeDataUrl(dataUrl);
    if (!data) return { ok: false, error: 'The pixel editor did not produce a PNG.' };
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(dir, `${state}.png`),
      data,
    );
    const loaded = await this.readRsiFromDir(dir);
    if (loaded) {
      this.currentView = { kind: 'rsi', path: dir.fsPath };
      this.post({ type: 'view', view: this.currentView });
      this.post({ type: 'rsi', view: loaded });
    }
    return { ok: true, message: `Saved ${state}.png.` };
  }

  private async importRsiFrames(path: string, state: string): Promise<EditResult> {
    const dir = await this.resolveRsiDir(path);
    if (!dir) return { ok: false, error: 'Could not find the RSI directory.' };
    const picked = await vscode.window.showOpenDialog({
      title: `Import ${state}.png`,
      canSelectMany: false,
      openLabel: 'Replace state sheet',
      filters: { PNG: ['png'] },
    });
    if (!picked?.[0]) return { ok: true, message: 'No image selected.' };
    const bytes = await vscode.workspace.fs.readFile(picked[0]);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, `${state}.png`), bytes);
    const loaded = await this.readRsiFromDir(dir);
    if (loaded) {
      this.currentView = { kind: 'rsi', path: dir.fsPath };
      this.post({ type: 'view', view: this.currentView });
      this.post({ type: 'rsi', view: loaded });
    }
    return { ok: true, message: `Replaced ${state}.png.` };
  }

  private async deleteRsiImage(path: string, state: string): Promise<EditResult> {
    const dir = await this.resolveRsiDir(path);
    if (!dir) return { ok: false, error: 'Could not find the RSI directory.' };
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, `${state}.png`));
    } catch {
      return { ok: false, error: `${state}.png does not exist.` };
    }
    const loaded = await this.readRsiFromDir(dir);
    if (loaded) {
      this.currentView = { kind: 'rsi', path: dir.fsPath };
      this.post({ type: 'view', view: this.currentView });
      this.post({ type: 'rsi', view: loaded });
    }
    return { ok: true, message: `Deleted ${state}.png.` };
  }

  async applyXamlOperation(filePath: string, operation: XamlOperation): Promise<EditResult> {
    const uri = await this.fileUri(filePath);
    if (!uri) return { ok: false, error: 'Could not resolve the XAML file.' };
    if ((await vscode.workspace.fs.isWritableFileSystem(uri.scheme)) === false) {
      return { ok: false, error: 'This XAML file is read-only.' };
    }
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      return { ok: false, error: 'Could not open the XAML file.' };
    }
    const before = document.getText();
    const result = applyXamlOperation(before, operation, this.index.relativePath(uri), {
      indentSize: readStudioConfig().xamlIndentSize,
    });
    if (result.text === before) {
      return { ok: true, message: result.message };
    }

    const edit = new vscode.WorkspaceEdit();
    const start = document.positionAt(0);
    const end = document.positionAt(before.length);
    edit.replace(uri, new vscode.Range(start, end), result.text);
    if (!(await vscode.workspace.applyEdit(edit))) {
      return { ok: false, error: 'VS Code rejected the workspace edit.' };
    }

    const after = document.getText();
    const view = await this.readXamlText(uri, after);
    if (view) {
      this.currentView = { kind: 'xaml', path: uri.fsPath };
      this.post({ type: 'view', view: this.currentView });
      this.post({ type: 'xaml', view });
    }

    const payload = diffText({
      oldText: before,
      newText: after,
      title: `${basename(uri.fsPath)} · ${operation.kind}`,
      oldLabel: 'Before',
      newLabel: 'After',
    });
    await this.showDiff(payload);

    return { ok: true, message: result.message };
  }

  private async createGraph(options: CreateGraphOptions): Promise<EditResult> {
    const id = options.id.trim();
    const start = options.start.trim() || 'start';
    if (!id) return { ok: false, error: 'A graph id is required.' };
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
      return {
        ok: false,
        error: 'Graph ids may contain letters, numbers, underscores, dots and dashes.',
      };
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(start)) {
      return {
        ok: false,
        error: 'Start node names may contain letters, numbers, underscores, dots and dashes.',
      };
    }

    const root = this.index.getRoots()[0] ?? vscode.workspace.workspaceFolders?.[0];
    if (!root) return { ok: false, error: 'Open an SS14 workspace first.' };

    const rootPath = 'path' in root ? root.path : root.uri.fsPath;
    let targetPath = options.path.trim();
    if (!targetPath) {
      targetPath = `Resources/Prototypes/Recipes/Construction/Graphs/${id}.yml`;
    }
    if (!targetPath.endsWith('.yml') && !targetPath.endsWith('.yaml')) {
      targetPath += '.yml';
    }
    const absolute = isAbsolute(targetPath)
      ? resolve(targetPath)
      : resolve(rootPath, targetPath);

    const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(
      (folder) => folder.uri.fsPath,
    );
    if (!workspaceRoots.some((folder) => isInside(folder, absolute))) {
      return { ok: false, error: 'The new graph must be inside the workspace.' };
    }

    const uri = vscode.Uri.file(absolute);
    try {
      await vscode.workspace.fs.stat(uri);
      return { ok: false, error: `A file already exists at ${targetPath}.` };
    } catch {
      // Expected: the file should not exist yet.
    }

    const content = renderGraphTemplate({
      id,
      start,
      entity: options.entity?.trim() || undefined,
    });

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(absolute)));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    await vscode.workspace.openTextDocument(uri);
    await this.index.refresh();

    const payload = this.index.getPayload();
    const created =
      payload.summaries.find(
        (summary) =>
          summary.id === id &&
          vscode.Uri.parse(summary.filePath).fsPath === absolute,
      ) ?? payload.summaries.find((summary) => summary.id === id);

    if (created) {
      await this.openGraph(created.key);
    }

    this.toast('success', `Created construction graph "${id}".`);
    return { ok: true, message: `Created ${targetPath}.` };
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
      const nodeModel = graph.nodes.find((candidate) => candidate.name === node);
      if (nodeModel) {
        targetLine =
          edgeIndex != null
            ? (nodeModel.edges[edgeIndex]?.line ?? nodeModel.line)
            : nodeModel.line;
      }
    }

    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(graph.filePath),
    );
    const safeLine = Math.max(0, Math.min(targetLine - 1, document.lineCount - 1));
    const range = new vscode.Range(
      safeLine,
      0,
      safeLine,
      document.lineAt(safeLine).text.length,
    );
    await vscode.window.showTextDocument(document, {
      selection: range,
      preview: false,
      preserveFocus: true,
    });
  }

  private async openFile(uriString: string): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.parse(uriString),
      );
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      this.toast('error', `Could not open file: ${String(error)}`);
    }
  }

  private async openPath(path: string, line?: number): Promise<void> {
    if (/^https?:\/\//i.test(path)) {
      await vscode.env.openExternal(vscode.Uri.parse(path));
      return;
    }
    const uri = await this.fileUri(path);
    if (!uri) {
      this.toast('error', `Could not resolve "${path}".`);
      return;
    }
    if (line != null) {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        const safeLine = Math.max(0, Math.min(line - 1, document.lineCount - 1));
        await vscode.window.showTextDocument(document, {
          preview: false,
          selection: new vscode.Range(safeLine, 0, safeLine, 0),
        });
        return;
      } catch {
        // Fall through to the generic opener.
      }
    }
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch {
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  }

  private async pickRsi(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      title: 'Open an RSI sprite folder',
      canSelectFolders: true,
      canSelectFiles: true,
      canSelectMany: false,
      openLabel: 'Open RSI',
      filters: { 'RSI metadata': ['json'] },
    });
    if (!picked?.[0]) return;
    await this.openRsi(picked[0].fsPath);
  }

  private async pickXaml(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      title: 'Open a RobustToolbox XAML file',
      canSelectFiles: true,
      canSelectMany: false,
      openLabel: 'Open XAML',
      filters: { XAML: ['xaml'] },
    });
    if (!picked?.[0]) return;
    await this.openXaml(picked[0].fsPath);
  }

  private async pickCSharp(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      title: 'Open a C# file in SS14 Studio',
      canSelectFiles: true,
      canSelectMany: false,
      openLabel: 'Open C#',
      filters: { 'C# files': ['cs'] },
    });
    if (!picked?.[0]) return;
    await this.openCSharp(picked[0].fsPath);
  }

  private async openDocs(): Promise<void> {
    try {
      await vscode.commands.executeCommand(
        'markdown.showPreview',
        vscode.Uri.joinPath(this.context.extensionUri, 'README.md'),
      );
    } catch {
      await vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/ss14studio/ss14-studio'),
      );
    }
  }

  private onIndexChanged(): void {
    this.iconCache.clear();
    if (!this.panel || !this.ready) return;
    this.postIndex();
    if (this.currentView.kind === 'graph') {
      if (!this.index.getGraph(this.currentView.key)) {
        this.post({
          type: 'graphMissing',
          key: this.currentView.key,
          message: 'This construction graph was removed or renamed.',
        });
        return;
      }
      void this.showGraph(this.currentView.key, 'update');
    } else if (this.currentView.kind === 'atlas') {
      this.postAtlas();
    }
  }

  private onPrototypesChanged(): void {
    this.iconCache.clear();
    if (!this.panel || !this.ready) return;
    this.postPrototypes();
    if (this.currentView.kind === 'prototype') {
      const view = this.index.getPrototypeView(
        this.currentView.id,
        this.currentView.kindFilter,
      );
      if (view) this.post({ type: 'prototype', view });
    } else if (this.currentView.kind === 'atlas') {
      this.postAtlas();
    }
  }

  private postIndex(): void {
    this.post({ type: 'index', payload: this.index.getPayload() });
  }

  private postPrototypes(): void {
    this.post({ type: 'prototypes', payload: this.index.getPrototypePayload() });
  }

  private postAtlas(): void {
    this.post({ type: 'atlas', atlas: this.index.getAtlas() });
  }

  private postReadyState(): void {
    this.post({
      type: 'readyState',
      readOnly: !vscode.workspace.isTrusted,
      config: readStudioConfig(),
    });
  }

  private postTheme(): void {
    if (!this.panel) return;
    const kind = vscode.window.activeColorTheme.kind;
    const theme =
      kind === vscode.ColorThemeKind.Light
        ? 'light'
        : kind === vscode.ColorThemeKind.HighContrast ||
            kind === vscode.ColorThemeKind.HighContrastLight
          ? 'high-contrast'
          : 'dark';
    this.post({ type: 'theme', kind: theme });
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
      const textureUri = this.index.resolveResourceUri(layer.texture);
      if (!textureUri) return null;
      try {
        const bytes = await vscode.workspace.fs.readFile(textureUri);
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
        decoder.decode(
          await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, 'meta.json')),
        ),
      ).meta;
      size = meta.size ?? size;
    } catch {
      // Defaults are fine when metadata is unavailable.
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(dir, `${stateName}.png`),
      );
      const dimensions = pngDimensions(bytes);
      if (!dimensions) return null;
      const columns = Math.max(1, Math.floor(dimensions.width / Math.max(1, size.x)));
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

  private async buildEntityIcon(sprite: SpriteInfo | null): Promise<IconResult> {
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

  private async readRsi(path: string): Promise<{ dir: vscode.Uri; view: RsiView } | null> {
    const dir = await this.resolveRsiDir(path);
    if (!dir) return null;
    const view = await this.readRsiFromDir(dir);
    return view ? { dir, view } : null;
  }

  private async readRsiFromDir(dir: vscode.Uri): Promise<RsiView | null> {
    const metaUri = vscode.Uri.joinPath(dir, 'meta.json');
    let meta: RsiMeta;
    let diagnostics;
    try {
      const parsed = parseRsiMeta(
        decoder.decode(await vscode.workspace.fs.readFile(metaUri)),
        metaUri.toString(),
      );
      meta = parsed.meta;
      diagnostics = parsed.diagnostics;
    } catch {
      return null;
    }

    let files: string[] = [];
    try {
      files = (await vscode.workspace.fs.readDirectory(dir)).map(([name]) => name);
    } catch {
      files = [];
    }

    const images: Record<string, RsiImageInfo> = {};
    for (const state of meta.states) {
      const imagePath = `${state.name}.png`;
      try {
        const bytes = await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(dir, imagePath),
        );
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
      dirPath: dir.fsPath,
      relativePath: this.index.relativePath(dir),
      metaPath: metaUri.fsPath,
      meta,
      images,
      diagnostics,
      orphanImages: findOrphanImages(meta, files),
    });
  }

  private async resolveRsiDir(path: string): Promise<vscode.Uri | null> {
    const trimmed = path.trim().replace(/\\/g, '/');
    if (!trimmed) return null;
    let candidate: vscode.Uri | undefined;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^[a-zA-Z]:\//.test(trimmed)) {
      candidate = vscode.Uri.parse(trimmed);
    } else if (isAbsolute(trimmed)) {
      candidate = vscode.Uri.file(trimmed);
    } else {
      const clean = trimmed.replace(/^\/+/, '');
      const resource = clean.replace(/^Resources\//, '');
      candidate =
        this.index.resolveResourceUri(resource) ??
        this.index.resolveWorkspaceUri(clean) ??
        undefined;
    }
    if (!candidate) return null;
    if (/meta\.json$/i.test(candidate.fsPath)) {
      return vscode.Uri.file(dirname(candidate.fsPath));
    }
    if (await isDirectory(candidate)) return candidate;
    if (!/\.rsi$/i.test(candidate.fsPath) && (await isDirectory(vscode.Uri.file(`${candidate.fsPath}.rsi`)))) {
      return vscode.Uri.file(`${candidate.fsPath}.rsi`);
    }
    return null;
  }

  private async readXaml(uri: vscode.Uri): Promise<XamlView | null> {
    try {
      const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
      return this.readXamlText(uri, text);
    } catch {
      return null;
    }
  }

  private async readXamlText(uri: vscode.Uri, text: string): Promise<XamlView> {
    const codeBehindPath = `${uri.fsPath}.cs`;
    let codeBehindSource: string | null = null;
    try {
      codeBehindSource = decoder.decode(
        await vscode.workspace.fs.readFile(vscode.Uri.file(codeBehindPath)),
      );
    } catch {
      codeBehindSource = null;
    }
    const view = parseXaml(text, {
      filePath: uri.toString(),
      relativePath: this.index.relativePath(uri),
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

    const themes = this.index.getXamlThemes();
    view.themes = await Promise.all(
      themes.map((theme) => this.resolveThemeTextures(theme)),
    );
    const selected =
      view.themes.find((theme) => theme.id === view.theme?.id) ??
      defaultXamlTheme(view.themes);
    view.theme = selected;
    return view;
  }

  /** Turn style-theme nine-slice textures into data URLs for the webview. */
  private async resolveThemeTextures(theme: XamlTheme): Promise<XamlTheme> {
    if (!theme.texturePaths) return theme;
    const textures: Record<string, string> = {};
    for (const [key, path] of Object.entries(theme.texturePaths)) {
      const uri = this.index.resolveResourceUri(path);
      if (!uri) continue;
      try {
        textures[key] = dataUrl(await vscode.workspace.fs.readFile(uri));
      } catch {
        // Missing optional theme art should not hide the palette.
      }
    }
    return { ...theme, textures };
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

    const textureUri = this.index.resolveResourceUri(texture);
    if (!textureUri) return null;
    try {
      const bytes = await vscode.workspace.fs.readFile(textureUri);
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

  private async fileUri(path: string): Promise<vscode.Uri | null> {
    const trimmed = path.trim();
    if (!trimmed) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^[a-zA-Z]:[\\/]/.test(trimmed)) {
      return vscode.Uri.parse(trimmed);
    }
    if (isAbsolute(trimmed)) return vscode.Uri.file(trimmed);
    return this.index.resolveWorkspaceUri(trimmed) ?? null;
  }

  private toast(
    level: 'info' | 'warn' | 'error' | 'success',
    message: string,
  ): void {
    this.post({ type: 'toast', level, message });
  }

  private setTitle(id?: string): void {
    if (!this.panel) return;
    this.panel.title = id ? `SS14 Studio — ${id}` : 'SS14 Studio';
  }

  private post(message: HostMessage): void {
    if (!this.panel) return;
    void this.panel.webview.postMessage(message);
  }

  dispose(): void {
    for (const disposable of this.panelDisposables) disposable.dispose();
    this.panelDisposables = [];
    for (const disposable of this.disposables) disposable.dispose();
    this.panel?.dispose();
    this.panel = undefined;
  }
}

export function readStudioConfig(): StudioConfig {
  const config = vscode.workspace.getConfiguration('ss14Studio');
  return {
    entityIcons: config.get<boolean>('graphSprites', true),
    showGrid: config.get<boolean>('graphGrid', true),
    animations: config.get<boolean>('animations', true),
    blueprintIntensity: config.get<'subtle' | 'balanced' | 'bold'>(
      'blueprintIntensity',
      'balanced',
    ),
    graphSprites: config.get<boolean>('graphSprites', true),
    graphEntityIds: config.get<boolean>('graphEntityIds', true),
    graphStats: config.get<boolean>('graphStats', true),
    graphEdgeSteps: config.get<boolean>('graphEdgeSteps', true),
    graphMinimap: config.get<boolean>('graphMinimap', true),
    graphLegend: config.get<boolean>('graphLegend', true),
    graphControls: config.get<boolean>('graphControls', true),
    graphPathHighlight: config.get<boolean>('graphPathHighlight', true),
    graphCompact: config.get<boolean>('graphCompact', false),
    graphEdgeStyle: config.get<'bezier' | 'step' | 'straight'>('graphEdgeStyle', 'bezier'),
    graphNodeAccent: config.get<'hash' | 'kind' | 'mono'>('graphNodeAccent', 'hash'),
    prototypeCompact: config.get<boolean>('prototypeCompact', false),
    prototypeShowResolved: config.get<boolean>('prototypeShowResolved', true),
    autoSidePreview: config.get<boolean>('autoSidePreview', false),
    defaultGraphEditor: config.get<boolean>('defaultGraphEditor', false),
    xamlIndentSize: config.get<number>('xamlIndentSize', 4),
    rsiMetaIndent: config.get<number>('rsiMetaIndent', 2),
    rsiMetaFinalNewline: config.get<boolean>('rsiMetaFinalNewline', true),
  };
}

function isInside(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  return (
    resolvedChild === resolvedParent ||
    resolvedChild.startsWith(resolvedParent.endsWith(sep) ? resolvedParent : resolvedParent + sep)
  );
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
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

function dataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

function decodeDataUrl(value: string): Uint8Array | null {
  const match = /^data:image\/png;base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) return null;
  try {
    return Buffer.from(match[1]!.replace(/\s+/g, ''), 'base64');
  } catch {
    return null;
  }
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const buffer = Buffer.from(bytes);
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

/* ------------------------------------------------------------------ */
/* Minimal transparent PNG writer used when a new RSI state is added.  */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createTransparentPng(width: number, height: number): Uint8Array {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(safeWidth, 0);
  header.writeUInt32BE(safeHeight, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const row = Buffer.alloc(1 + safeWidth * 4);
  const raw = Buffer.concat(Array.from({ length: safeHeight }, () => row));
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
