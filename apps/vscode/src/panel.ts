import * as vscode from 'vscode';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import {
  applyGraphOperation,
  EditFailure,
  renderGraphTemplate,
  type ConstructionGraph,
  type CreateGraphOptions,
  type EditResult,
  type GraphOperation,
  type GraphView,
  type HostMessage,
  type PersistedLayout,
  type StudioConfig,
  type WebviewMessage,
} from '@ss14-studio/core';
import { getWebviewHtml } from './html.js';
import type { GraphIndex } from './indexer.js';
import type { LayoutStore } from './layoutStore.js';

const VIEW_TYPE = 'ss14Studio.graphEditor';

export class GraphEditorPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelPromise: Promise<void> | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private currentKey: string | undefined;
  private pendingKey: string | undefined;
  private pendingDashboard = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly index: GraphIndex,
    private readonly layouts: LayoutStore,
  ) {
    this.disposables.push(
      index.onDidChange(() => this.onIndexChanged()),
      vscode.window.onDidChangeActiveColorTheme(() => this.postTheme()),
    );
  }

  async openDashboard(): Promise<void> {
    await this.ensurePanel();
    this.pendingKey = undefined;
    this.pendingDashboard = true;
    if (this.ready) {
      this.currentKey = undefined;
      this.pendingDashboard = false;
      this.setTitle();
      this.post({ type: 'graph', graph: null, reason: 'open' });
      this.postIndex();
    }
  }

  async openGraph(key: string): Promise<void> {
    await this.ensurePanel();
    if (!this.ready) {
      this.pendingKey = key;
      this.pendingDashboard = false;
      return;
    }
    this.pendingKey = undefined;
    this.pendingDashboard = false;
    await this.showGraph(key, 'open');
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
  }

  private async ensurePanel(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(undefined, false);
      return;
    }
    if (!this.panelPromise) {
      this.panelPromise = this.createPanel().finally(() => {
        this.panelPromise = undefined;
      });
    }
    await this.panelPromise;
  }

  private async createPanel(): Promise<void> {
    const localRoots = [
      vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
    ];

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'SS14 Studio',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
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
          this.pendingKey = undefined;
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
        case 'ready': {
          this.ready = true;
          this.postReadyState();
          this.postIndex();
          this.postTheme();
          if (this.pendingKey) {
            const key = this.pendingKey;
            this.pendingKey = undefined;
            await this.showGraph(key, 'open');
          } else if (this.pendingDashboard) {
            this.pendingDashboard = false;
            this.currentKey = undefined;
            this.setTitle();
            this.post({ type: 'graph', graph: null, reason: 'open' });
          } else if (this.currentKey) {
            await this.showGraph(this.currentKey, 'update');
          }
          break;
        }
        case 'requestIndex':
          this.postIndex();
          break;
        case 'openGraph':
          await this.showGraph(message.key, 'open');
          break;
        case 'openDashboard':
          this.currentKey = undefined;
          this.setTitle();
          this.post({ type: 'graph', graph: null, reason: 'open' });
          break;
        case 'openSource':
          await this.openSource(message.key, message.line, message.node, message.edgeIndex);
          break;
        case 'openFile':
          await this.openFile(message.uri);
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
          this.postIndex();
          this.toast('success', 'Construction graph index refreshed.');
          break;
        case 'requestEntityIcon':
          this.post({ type: 'entityIcon', entityId: message.entityId, uri: null });
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
        default:
          break;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.toast('error', text);
    }
  }

  private async showGraph(
    key: string,
    reason: 'open' | 'update' | 'created',
  ): Promise<void> {
    if (!this.ready) {
      this.pendingKey = key;
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
    this.setTitle(graph.id);
    const readOnly = !vscode.workspace.isTrusted;
    const view: GraphView = { ...graph, readOnly };
    this.post({ type: 'graph', graph: view, reason });
    this.post({
      type: 'layout',
      key,
      layout: this.layouts.get(key) ?? null,
    });
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
    return (
      parsed.graphs.find((graph) => graph.key === key) ??
      parsed.graphs.find((graph) => graph.id === indexed.id) ??
      indexed
    );
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
    if (!this.panel || !this.ready) return;
    this.postIndex();
    if (!this.currentKey) return;
    if (!this.index.getGraph(this.currentKey)) {
      this.post({
        type: 'graphMissing',
        key: this.currentKey,
        message: 'This construction graph was removed or renamed.',
      });
      return;
    }
    void this.showGraph(this.currentKey, 'update');
  }

  private postIndex(): void {
    this.post({ type: 'index', payload: this.index.getPayload() });
  }

  private postReadyState(): void {
    const config = vscode.workspace.getConfiguration('ss14Studio');
    const studioConfig: StudioConfig = {
      entityIcons: true,
      showGrid: true,
      animations: config.get<boolean>('animations', true),
      blueprintIntensity: config.get<'subtle' | 'balanced' | 'bold'>(
        'blueprintIntensity',
        'balanced',
      ),
    };
    this.post({
      type: 'readyState',
      readOnly: !vscode.workspace.isTrusted,
      config: studioConfig,
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

function isInside(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  return (
    resolvedChild === resolvedParent ||
    resolvedChild.startsWith(resolvedParent.endsWith(sep) ? resolvedParent : resolvedParent + sep)
  );
}
