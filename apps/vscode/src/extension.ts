import * as vscode from 'vscode';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type {
  GraphSummary,
  IndexPayload,
  PrototypeSummary,
  PrototypeView,
} from '@ss14-studio/core';
import { GraphIndex } from './indexer.js';
import { LayoutStore } from './layoutStore.js';
import { GraphEditorPanel, readStudioConfig } from './panel.js';
import { GraphTreeProvider, PrototypeTreeProvider } from './tree.js';
import { StudioCodeLensProvider } from './lenses.js';

interface GraphPick extends vscode.QuickPickItem {
  key: string;
}

interface PrototypePick extends vscode.QuickPickItem {
  id: string;
  prototypeKind: string;
}

interface PrototypeArgument {
  id: string;
  kind?: string;
}

const decoder = new TextDecoder('utf-8');

export async function activate(
  context: vscode.ExtensionContext,
): Promise<{ index: GraphIndex; panel: GraphEditorPanel }> {
  const index = new GraphIndex(context);
  const layouts = new LayoutStore(context);
  const panel = new GraphEditorPanel(context, index, layouts);
  const tree = new GraphTreeProvider(index);
  const prototypeTree = new PrototypeTreeProvider(index);
  const lenses = new StudioCodeLensProvider(index);

  const treeView = vscode.window.createTreeView('ss14Studio.graphs', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  const prototypeView = vscode.window.createTreeView('ss14Studio.prototypes', {
    treeDataProvider: prototypeTree,
    showCollapseAll: true,
  });

  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  status.name = 'SS14 Studio';
  status.command = {
    command: 'ss14Studio.openDashboard',
    title: 'Open SS14 Studio',
  };
  status.show();

  context.subscriptions.push(
    index,
    panel,
    tree,
    prototypeTree,
    lenses,
    treeView,
    prototypeView,
    status,
  );

  const setIndexing = (value: boolean) => {
    void vscode.commands.executeCommand(
      'setContext',
      'ss14Studio.indexing',
      value,
    );
    tree.setIndexing(value);
    prototypeTree.setIndexing(value);
    if (value) {
      status.text = '$(sync~spin) Indexing SS14 graphs…';
      status.tooltip = 'SS14 Studio is scanning construction graphs and prototypes.';
    }
  };

  const updateStatus = (payload: IndexPayload) => {
    const project = payload.project;
    const prototypes = index.getPrototypePayload();
    if (project.totalGraphs === 0 && prototypes.total === 0) {
      status.text = '$(type-hierarchy) SS14 Studio';
      status.tooltip = new vscode.MarkdownString(
        vscode.workspace.workspaceFolders?.length
          ? 'No construction graphs indexed yet.\n\nClick to open the SS14 Studio dashboard.'
          : 'Open an SS14 workspace to get started.',
      );
      return;
    }

    const issues: string[] = [];
    if (project.errors > 0) issues.push(`$(error) ${project.errors}`);
    if (project.warnings > 0) issues.push(`$(warning) ${project.warnings}`);
    status.text = [
      `$(type-hierarchy) ${project.totalGraphs} graphs`,
      ...issues,
    ].join('  ');

    const tooltip = new vscode.MarkdownString(
      [
        `**SS14 Studio**`,
        '',
        `${project.totalGraphs} construction graphs · ${project.totalNodes} nodes · ${project.totalEdges} edges`,
        `${prototypes.total} prototypes · ${prototypes.kinds.length} kinds`,
        project.errors > 0 ? `$(error) ${project.errors} errors` : '',
        project.warnings > 0 ? `$(warning) ${project.warnings} warnings` : '',
        '',
        `Scanned ${project.scannedFiles} prototype files in ${project.scanDurationMs} ms`,
        '',
        'Click to open the dashboard.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    tooltip.supportThemeIcons = true;
    status.tooltip = tooltip;
  };

  index.onDidChange((payload) => {
    updateStatus(payload);
    void vscode.commands.executeCommand(
      'setContext',
      'ss14Studio.hasGraphs',
      payload.project.totalGraphs > 0,
    );
  });

  index.onDidPrototypesChange(() => {
    void vscode.commands.executeCommand(
      'setContext',
      'ss14Studio.hasPrototypes',
      index.getPrototypePayload().total > 0,
    );
    updateStatus(index.getPayload());
  });

  index.onProgress((progress) => {
    status.text = `$(sync~spin) ${progress.done}/${progress.total}`;
    status.tooltip = progress.message;
  });

  const refresh = async (interactive: boolean) => {
    setIndexing(true);
    try {
      await index.refresh(interactive);
      updateStatus(index.getPayload());
    } finally {
      setIndexing(false);
      if (interactive) {
        const project = index.getPayload().project;
        const prototypes = index.getPrototypePayload();
        vscode.window.showInformationMessage(
          `SS14 Studio: indexed ${project.totalGraphs} construction graphs and ${prototypes.total} prototypes from ${project.scannedFiles} files in ${project.scanDurationMs} ms.`,
        );
      }
    }
  };

  const pickGraph = async (): Promise<string | undefined> => {
    const summaries = index.getSummaries();
    if (summaries.length === 0) {
      const choice = await vscode.window.showInformationMessage(
        'No construction graphs are indexed yet.',
        'Refresh Index',
        'Create Graph',
      );
      if (choice === 'Refresh Index') await refresh(true);
      if (choice === 'Create Graph') await panel.createGraphInteractive();
      return undefined;
    }

    const items: (GraphPick | vscode.QuickPickItem)[] = [];
    let folder = '';
    for (const summary of summaries) {
      if (summary.folder !== folder) {
        folder = summary.folder;
        items.push({
          label: folder.replaceAll('/', ' / '),
          kind: vscode.QuickPickItemKind.Separator,
        });
      }
      items.push(toPick(summary));
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Open Construction Graph',
      placeHolder: 'Search by graph id, folder or file path',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    return picked && 'key' in picked ? picked.key : undefined;
  };

  const pickPrototype = async (): Promise<PrototypeArgument | undefined> => {
    const summaries = index.getPrototypePayload().summaries;
    if (summaries.length === 0) {
      const choice = await vscode.window.showInformationMessage(
        'No prototypes are indexed yet.',
        'Refresh Index',
      );
      if (choice === 'Refresh Index') await refresh(true);
      return undefined;
    }

    const items: (PrototypePick | vscode.QuickPickItem)[] = [];
    let kind = '';
    for (const summary of summaries) {
      if (summary.kind !== kind) {
        kind = summary.kind;
        items.push({
          label: kind,
          kind: vscode.QuickPickItemKind.Separator,
        });
      }
      items.push(toPrototypePick(summary));
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Open Prototype',
      placeHolder: 'Search by prototype id, kind, parent or file',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    return picked && 'id' in picked
      ? { id: picked.id, kind: picked.prototypeKind }
      : undefined;
  };

  const pickGraphInFile = async (
    graphs: { key: string; id: string; line: number }[],
  ): Promise<string | undefined> => {
    if (graphs.length === 1) return graphs[0]!.key;
    const picked = await vscode.window.showQuickPick(
      graphs.map((graph) => ({
        label: graph.id,
        description: `line ${graph.line}`,
        key: graph.key,
      })),
      { title: 'Open Construction Graph', placeHolder: 'This file contains multiple graphs' },
    );
    return picked?.key;
  };

  const readText = async (uri: vscode.Uri): Promise<string> => {
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    if (open) return open.getText();
    try {
      return decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return '';
    }
  };

  const prototypeViewFor = async (
    uri: vscode.Uri,
    text: string,
    argument?: PrototypeArgument,
  ): Promise<PrototypeView | null> => {
    if (argument?.id) {
      return index.getPrototypeViewForSource(uri, text, argument.id, argument.kind);
    }
    return index.getPrototypeViewForSource(uri, text);
  };

  const openPrototypeFile = async (
    uri: vscode.Uri,
    text?: string,
    preferred?: PrototypeArgument,
  ): Promise<void> => {
    const source = text ?? (await readText(uri));
    let argument = preferred;
    if (!argument) {
      const prototypes = index
        .parsePrototypeText(uri, source)
        .prototypes.filter((prototype) => !prototype.abstract);
      if (prototypes.length > 1) {
        const line = vscode.window.activeTextEditor?.selection.active.line ?? 0;
        const nearest =
          [...prototypes].reverse().find((prototype) => prototype.line - 1 <= line) ??
          prototypes[0];
        const picked = await vscode.window.showQuickPick(
          prototypes.map((prototype) => ({
            label: prototype.id,
            description: `${prototype.kind} · line ${prototype.line}`,
            id: prototype.id,
            prototypeKind: prototype.kind,
            picked: prototype === nearest,
          })),
          {
            title: `Open prototype from ${basename(uri.fsPath)}`,
            placeHolder: 'Choose a prototype',
          },
        );
        if (!picked) return;
        argument = { id: picked.id, kind: picked.prototypeKind };
      } else if (prototypes.length === 1) {
        argument = { id: prototypes[0]!.id, kind: prototypes[0]!.kind };
      }
    }
    const view = await prototypeViewFor(uri, source, argument);
    if (!view) {
      vscode.window.showInformationMessage(
        'SS14 Studio: no prototype could be resolved in this file.',
      );
      return;
    }
    await panel.openPrototypeView(view);
  };

  const openXamlFile = async (uri: vscode.Uri): Promise<void> => {
    await panel.openXaml(uri.fsPath);
  };

  const openCSharpFile = async (uri: vscode.Uri): Promise<void> => {
    await panel.openCSharp(uri.fsPath);
  };

  const openRsiFile = async (uri: vscode.Uri): Promise<void> => {
    const dir = await rsiDirectory(uri);
    if (!dir) {
      vscode.window.showInformationMessage(
        'SS14 Studio: this file is not inside an .rsi sprite folder.',
      );
      return;
    }
    await panel.openRsi(dir);
  };

  const openForFile = async (argument?: unknown): Promise<void> => {
    const uri =
      uriFromArgument(argument) ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      await panel.openDashboard();
      return;
    }
    const path = uri.fsPath.replaceAll('\\', '/');
    if (/\.xaml\.cs$/i.test(path)) {
      await openXamlFile(vscode.Uri.file(uri.fsPath.replace(/\.cs$/i, '')));
      return;
    }
    if (/\.xaml$/i.test(path)) {
      await openXamlFile(uri);
      return;
    }
    if (/\.cs$/i.test(path)) {
      await openCSharpFile(uri);
      return;
    }
    if (/\.rsi\/meta\.json$/i.test(path) || /\.rsi\/.*\.png$/i.test(path)) {
      await openRsiFile(uri);
      return;
    }
    if (/\.ya?ml$/i.test(path)) {
      const text = await readText(uri);
      const graphs = index.parseText(uri, text).graphs;
      if (graphs.length > 0) {
        const key = await pickGraphInFile(graphs);
        if (key) await panel.openGraph(key);
        return;
      }
      const prototypes = index.parsePrototypeText(uri, text).prototypes;
      if (prototypes.length > 0) {
        await openPrototypeFile(uri, text);
        return;
      }
      vscode.window.showInformationMessage(
        'SS14 Studio: no construction graph or prototype was found in this file.',
      );
      return;
    }
    if (await isDirectory(uri)) {
      if (uri.fsPath.toLowerCase().endsWith('.rsi')) {
        await openRsiFile(uri);
        return;
      }
    }
    vscode.window.showInformationMessage(
      'SS14 Studio: open a graph/prototype YAML, XAML, XAML.cs or RSI file.',
    );
  };

  const formatXamlCommand = async (
    operation: 'format' | 'cleanup' | 'markAutoGenerated' | 'removeAutoGenerated',
  ) => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || !/\.xaml$/i.test(uri.fsPath)) {
      vscode.window.showInformationMessage(
        'SS14 Studio: open a .xaml file first.',
      );
      return;
    }
    const result = await panel.applyXamlOperation(uri.fsPath, { kind: operation });
    if (result.ok) {
      vscode.window.setStatusBarMessage(`SS14 Studio: ${result.message}`, 4000);
    } else {
      vscode.window.showErrorMessage(`SS14 Studio: ${result.error}`);
    }
  };

  const revealPrototype = async (argument?: unknown) => {
    let id: string | undefined;
    let kind: string | undefined;
    const parsed = prototypeArgument(argument);
    if (parsed) {
      id = parsed.id;
      kind = parsed.kind;
    } else if (typeof argument === 'string') {
      id = argument;
    }
    if (!id) {
      const editor = vscode.window.activeTextEditor;
      if (editor && /\.ya?ml$/i.test(editor.document.uri.fsPath)) {
        const prototypes = index
          .parsePrototypeText(editor.document.uri, editor.document.getText())
          .prototypes.filter((prototype) => !prototype.abstract);
        const line = editor.selection.active.line;
        const nearest =
          [...prototypes].reverse().find((prototype) => prototype.line - 1 <= line) ??
          prototypes[0];
        if (nearest) {
          id = nearest.id;
          kind = nearest.kind;
        }
      }
    }
    if (!id) {
      const picked = await pickPrototype();
      if (!picked) return;
      id = picked.id;
      kind = picked.kind;
    }
    const summary = index.getPrototypeSummary(id, kind);
    if (!summary) {
      vscode.window.showInformationMessage(
        `SS14 Studio: prototype "${id}" is not indexed.`,
      );
      return;
    }
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(summary.filePath),
    );
    const safeLine = Math.max(0, Math.min(summary.line - 1, document.lineCount - 1));
    await vscode.window.showTextDocument(document, {
      preview: false,
      selection: new vscode.Range(safeLine, 0, safeLine, 0),
    });
  };

  /* ------------------------------------------------------------------ */
  /* Automatic side preview / default graph editor                       */
  /* ------------------------------------------------------------------ */

  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPreviewUri: string | undefined;
  let lastPreviewVersion = -1;

  const cancelPreview = () => {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = undefined;
    }
  };

  const previewDocument = async (
    document: vscode.TextDocument,
    initial: boolean,
  ): Promise<void> => {
    const config = readStudioConfig();
    if (!config.autoSidePreview && !config.defaultGraphEditor) return;
    if (document.uri.scheme !== 'file') return;
    const path = document.uri.fsPath.replaceAll('\\', '/');
    const beside = !config.defaultGraphEditor || !initial;

    if (/\.ya?ml$/i.test(path)) {
      const text = document.getText();
      const graphs = index.parseText(document.uri, text).graphs;
      if (graphs.length > 0) {
        const line = initial
          ? vscode.window.activeTextEditor?.selection.active.line ?? 0
          : 0;
        const nearest =
          [...graphs].reverse().find((graph) => graph.line - 1 <= line) ?? graphs[0];
        const useDefault = config.defaultGraphEditor && initial && graphs.length === 1;
        await panel.openGraph(nearest!.key, {
          beside: !useDefault,
          preserveFocus: !useDefault,
        });
        return;
      }
      if (!config.autoSidePreview) return;
      const view = index.getPrototypeViewForSource(document.uri, text);
      if (view) {
        await panel.openPrototypeView(view, {
          beside: true,
          preserveFocus: true,
        });
      }
      return;
    }

    if (!config.autoSidePreview) return;
    if (/\.xaml$/i.test(path)) {
      await panel.openXaml(document.uri.fsPath, {
        beside,
        preserveFocus: true,
      });
      return;
    }
    if (/\.cs$/i.test(path) && !/\.xaml\.cs$/i.test(path)) {
      await panel.openCSharp(document.uri.fsPath, {
        beside: true,
        preserveFocus: true,
      });
      return;
    }
    if (/\.rsi\/meta\.json$/i.test(path)) {
      await panel.openRsi(dirname(document.uri.fsPath), {
        beside: true,
        preserveFocus: true,
      });
    }
  };

  const schedulePreview = (document: vscode.TextDocument, initial: boolean) => {
    cancelPreview();
    const version = document.version;
    previewTimer = setTimeout(() => {
      previewTimer = undefined;
      if (!vscode.window.activeTextEditor) return;
      const active = vscode.window.activeTextEditor.document;
      if (active.uri.toString() !== document.uri.toString()) return;
      if (!initial && active.version === lastPreviewVersion) return;
      lastPreviewVersion = version;
      void previewDocument(active, initial).catch(() => {
        // Automatic preview must never interrupt editing with an error dialog.
      });
    }, initial ? 250 : 600);
  };

  const onActiveEditor = (editor: vscode.TextEditor | undefined) => {
    if (!editor) return;
    const key = editor.document.uri.toString();
    if (key === lastPreviewUri) return;
    lastPreviewUri = key;
    lastPreviewVersion = -1;
    schedulePreview(editor.document, true);
  };

  /* ------------------------------------------------------------------ */
  /* Command registration                                                */
  /* ------------------------------------------------------------------ */

  context.subscriptions.push(
    vscode.commands.registerCommand('ss14Studio.openDashboard', async () => {
      await panel.openDashboard();
    }),

    vscode.commands.registerCommand(
      'ss14Studio.openGraph',
      async (argument?: unknown) => {
        let key = keyFromArgument(argument);
        if (!key) key = await pickGraph();
        if (key) await panel.openGraph(key);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openGraphForFile',
      async (argument?: unknown) => {
        const uri =
          uriFromArgument(argument) ??
          vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
          await panel.openDashboard();
          return;
        }
        const text = await readText(uri);
        const graphs = index.parseText(uri, text).graphs;
        if (graphs.length === 0) {
          const prototypes = index.parsePrototypeText(uri, text).prototypes;
          if (prototypes.length > 0) {
            await openPrototypeFile(uri, text);
            return;
          }
          vscode.window.showInformationMessage(
            'SS14 Studio: no construction graph was found in this file.',
          );
          return;
        }
        const key = await pickGraphInFile(graphs);
        if (key) await panel.openGraph(key);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openPrototype',
      async (id?: unknown, kind?: unknown) => {
        let argument: PrototypeArgument | undefined;
        if (typeof id === 'string') {
          argument = { id, kind: typeof kind === 'string' ? kind : undefined };
        } else {
          argument = prototypeArgument(id);
        }
        if (!argument) {
          const editor = vscode.window.activeTextEditor;
          if (editor && /\.ya?ml$/i.test(editor.document.uri.fsPath)) {
            const prototypes = index
              .parsePrototypeText(editor.document.uri, editor.document.getText())
              .prototypes.filter((prototype) => !prototype.abstract);
            if (prototypes.length > 0) {
              const line = editor.selection.active.line;
              const nearest =
                [...prototypes]
                  .reverse()
                  .find((prototype) => prototype.line - 1 <= line) ??
                prototypes[0]!;
              argument = { id: nearest.id, kind: nearest.kind };
            }
          }
        }
        if (!argument) argument = await pickPrototype();
        if (argument) await panel.openPrototype(argument.id, argument.kind);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openPrototypeForFile',
      async (argument?: unknown) => {
        const uri =
          uriFromArgument(argument) ??
          vscode.window.activeTextEditor?.document.uri;
        if (!uri) return;
        await openPrototypeFile(uri);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openRsi',
      async (argument?: unknown) => {
        const uri = uriFromArgument(argument);
        if (uri) {
          await openRsiFile(uri);
          return;
        }
        const picked = await vscode.window.showOpenDialog({
          title: 'Open an RSI sprite folder',
          canSelectFolders: true,
          canSelectFiles: true,
          canSelectMany: false,
          openLabel: 'Open RSI',
          filters: { 'RSI metadata': ['json'] },
        });
        if (picked?.[0]) await openRsiFile(picked[0]);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openRsiForFile',
      async (argument?: unknown) => {
        const uri =
          uriFromArgument(argument) ??
          vscode.window.activeTextEditor?.document.uri;
        if (!uri) return;
        await openRsiFile(uri);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openXaml',
      async (argument?: unknown) => {
        const uri = uriFromArgument(argument);
        if (uri) {
          await openXamlFile(uri);
          return;
        }
        const picked = await vscode.window.showOpenDialog({
          title: 'Open a RobustToolbox XAML file',
          canSelectFiles: true,
          canSelectMany: false,
          openLabel: 'Open XAML',
          filters: { XAML: ['xaml'] },
        });
        if (picked?.[0]) await openXamlFile(picked[0]);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openXamlForFile',
      async (argument?: unknown) => {
        const uri =
          uriFromArgument(argument) ??
          vscode.window.activeTextEditor?.document.uri;
        if (!uri) return;
        await openXamlFile(uri);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openXamlPath',
      async (path?: unknown) => {
        if (typeof path !== 'string' || !path.trim()) return;
        const uri = isAbsolute(path)
          ? vscode.Uri.file(path)
          : (index.resolveWorkspaceUri(path) ?? vscode.Uri.file(resolve(path)));
        await openXamlFile(uri);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openCSharp',
      async (argument?: unknown) => {
        const uri = uriFromArgument(argument);
        if (uri) {
          await openCSharpFile(uri);
          return;
        }
        const picked = await vscode.window.showOpenDialog({
          title: 'Open a C# file in SS14 Studio',
          canSelectFiles: true,
          canSelectMany: false,
          openLabel: 'Open C#',
          filters: { 'C# files': ['cs'] },
        });
        if (picked?.[0]) await openCSharpFile(picked[0]);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openCSharpForFile',
      async (argument?: unknown) => {
        const uri =
          uriFromArgument(argument) ??
          vscode.window.activeTextEditor?.document.uri;
        if (!uri) return;
        await openCSharpFile(uri);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.openForFile',
      async (argument?: unknown) => {
        await openForFile(argument);
      },
    ),

    vscode.commands.registerCommand('ss14Studio.openAbout', async () => {
      await panel.openAbout();
    }),

    vscode.commands.registerCommand('ss14Studio.openSettings', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'ss14Studio',
      );
    }),

    vscode.commands.registerCommand('ss14Studio.refreshIndex', async () => {
      await refresh(true);
    }),

    vscode.commands.registerCommand('ss14Studio.createGraph', async () => {
      await panel.createGraphInteractive();
    }),

    vscode.commands.registerCommand(
      'ss14Studio.revealGraphFile',
      async (argument?: unknown) => {
        let key = keyFromArgument(argument);
        if (!key) key = await pickGraph();
        if (!key) return;
        await panel.openSource(key);
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.revealPrototypeFile',
      async (argument?: unknown) => {
        await revealPrototype(argument);
      },
    ),

    vscode.commands.registerCommand('ss14Studio.formatXaml', async () => {
      await formatXamlCommand('format');
    }),

    vscode.commands.registerCommand('ss14Studio.cleanupXaml', async () => {
      await formatXamlCommand('cleanup');
    }),

    vscode.commands.registerCommand(
      'ss14Studio.markXamlAutoGenerated',
      async () => {
        await formatXamlCommand('markAutoGenerated');
      },
    ),

    vscode.commands.registerCommand(
      'ss14Studio.removeXamlAutoGenerated',
      async () => {
        await formatXamlCommand('removeAutoGenerated');
      },
    ),

    vscode.languages.registerCodeLensProvider(
      [
        { language: 'yaml', scheme: 'file' },
        { pattern: '**/*.xaml', scheme: 'file' },
        { pattern: '**/*.xaml.cs', scheme: 'file' },
        { pattern: '**/meta.json', scheme: 'file' },
      ],
      lenses,
    ),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      onActiveEditor(editor);
    }),

    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== vscode.window.activeTextEditor?.document) return;
      if (event.document.uri.toString() !== lastPreviewUri) return;
      schedulePreview(event.document, false);
    }),

    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('ss14Studio.graphGlobs')) {
        await refresh(false);
      }
      if (event.affectsConfiguration('ss14Studio.codeLenses')) {
        lenses.refresh();
      }
      if (
        event.affectsConfiguration('ss14Studio.animations') ||
        event.affectsConfiguration('ss14Studio.blueprintIntensity') ||
        event.affectsConfiguration('ss14Studio.graphSprites') ||
        event.affectsConfiguration('ss14Studio.graphGrid') ||
        event.affectsConfiguration('ss14Studio.graphEntityIds') ||
        event.affectsConfiguration('ss14Studio.graphStats') ||
        event.affectsConfiguration('ss14Studio.graphEdgeSteps') ||
        event.affectsConfiguration('ss14Studio.graphMinimap') ||
        event.affectsConfiguration('ss14Studio.graphLegend') ||
        event.affectsConfiguration('ss14Studio.graphControls') ||
        event.affectsConfiguration('ss14Studio.graphPathHighlight') ||
        event.affectsConfiguration('ss14Studio.graphCompact') ||
        event.affectsConfiguration('ss14Studio.graphEdgeStyle') ||
        event.affectsConfiguration('ss14Studio.graphNodeAccent') ||
        event.affectsConfiguration('ss14Studio.prototypeCompact') ||
        event.affectsConfiguration('ss14Studio.prototypeShowResolved') ||
        event.affectsConfiguration('ss14Studio.xamlIndentSize') ||
        event.affectsConfiguration('ss14Studio.rsiMetaIndent') ||
        event.affectsConfiguration('ss14Studio.rsiMetaFinalNewline')
      ) {
        panel.notifyConfigChanged();
      }
    }),

    { dispose: cancelPreview },
  );

  setIndexing(true);
  try {
    await index.refresh();
  } finally {
    setIndexing(false);
  }
  updateStatus(index.getPayload());
  void vscode.commands.executeCommand(
    'setContext',
    'ss14Studio.hasPrototypes',
    index.getPrototypePayload().total > 0,
  );

  if (vscode.window.activeTextEditor) {
    onActiveEditor(vscode.window.activeTextEditor);
  }

  return { index, panel };
}

function toPick(summary: GraphSummary): GraphPick {
  const issues =
    summary.errors > 0
      ? ` · ${summary.errors} error${summary.errors === 1 ? '' : 's'}`
      : summary.warnings > 0
        ? ` · ${summary.warnings} warning${summary.warnings === 1 ? '' : 's'}`
        : '';
  return {
    label: summary.id,
    description: `${summary.folder} · ${summary.nodes} nodes${issues}`,
    detail: summary.relativePath,
    key: summary.key,
  };
}

function toPrototypePick(summary: PrototypeSummary): PrototypePick {
  const flags: string[] = [];
  if (summary.partial) flags.push('partial');
  if (summary.abstract) flags.push('abstract');
  if (summary.parents.length > 0) flags.push(`← ${summary.parents.join(', ')}`);
  if (summary.children > 0) flags.push(`${summary.children} children`);
  return {
    label: summary.id,
    description: flags.join(' · ') || `${summary.componentCount} components`,
    detail: `${summary.relativePath} · line ${summary.line}`,
    id: summary.id,
    prototypeKind: summary.kind,
  };
}

function keyFromArgument(argument: unknown): string | undefined {
  if (typeof argument === 'string') return argument;
  if (!argument || typeof argument !== 'object') return undefined;
  if ('key' in argument && typeof (argument as { key?: unknown }).key === 'string') {
    return (argument as { key: string }).key;
  }
  if ('summary' in argument) {
    const summary = (argument as { summary?: { key?: unknown } }).summary;
    if (summary && typeof summary.key === 'string') return summary.key;
  }
  return undefined;
}

function prototypeArgument(argument: unknown): PrototypeArgument | undefined {
  if (!argument || typeof argument !== 'object') return undefined;
  if ('id' in argument && typeof (argument as { id?: unknown }).id === 'string') {
    const kind = (argument as { kind?: unknown }).kind;
    return {
      id: (argument as { id: string }).id,
      kind: typeof kind === 'string' ? kind : undefined,
    };
  }
  if ('summary' in argument) {
    return prototypeArgument((argument as { summary?: unknown }).summary);
  }
  return undefined;
}

function uriFromArgument(argument: unknown): vscode.Uri | undefined {
  if (argument instanceof vscode.Uri) return argument;
  if (typeof argument === 'string') {
    if (/^file:/i.test(argument)) return vscode.Uri.parse(argument);
    return undefined;
  }
  if (!argument || typeof argument !== 'object') return undefined;
  if (
    'resourceUri' in argument &&
    (argument as { resourceUri?: unknown }).resourceUri instanceof vscode.Uri
  ) {
    return (argument as { resourceUri: vscode.Uri }).resourceUri;
  }
  if (
    'uri' in argument &&
    (argument as { uri?: unknown }).uri instanceof vscode.Uri
  ) {
    return (argument as { uri: vscode.Uri }).uri;
  }
  if ('path' in argument && typeof (argument as { path?: unknown }).path === 'string') {
    return vscode.Uri.file((argument as { path: string }).path);
  }
  return undefined;
}

async function rsiDirectory(uri: vscode.Uri): Promise<string | null> {
  let current = uri.fsPath;
  if (/meta\.json$/i.test(current) || !(await isDirectory(uri))) {
    current = dirname(current);
  }
  for (let depth = 0; depth < 8; depth++) {
    if (current.toLowerCase().endsWith('.rsi')) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

export function deactivate(): void {
  // All subscriptions are disposed by VS Code.
}
