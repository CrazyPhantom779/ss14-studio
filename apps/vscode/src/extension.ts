import * as vscode from 'vscode';
import type { GraphSummary, IndexPayload } from '@ss14-studio/core';
import { GraphIndex } from './indexer.js';
import { LayoutStore } from './layoutStore.js';
import { GraphEditorPanel } from './panel.js';
import { GraphTreeProvider } from './tree.js';

interface GraphPick extends vscode.QuickPickItem {
  key: string;
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<{ index: GraphIndex; panel: GraphEditorPanel }> {
  const index = new GraphIndex(context);
  const layouts = new LayoutStore(context);
  const panel = new GraphEditorPanel(context, index, layouts);
  const tree = new GraphTreeProvider(index);
  const treeView = vscode.window.createTreeView('ss14Studio.graphs', {
    treeDataProvider: tree,
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

  context.subscriptions.push(index, panel, tree, treeView, status);

  const setIndexing = (value: boolean) => {
    void vscode.commands.executeCommand(
      'setContext',
      'ss14Studio.indexing',
      value,
    );
    tree.setIndexing(value);
    if (value) {
      status.text = '$(sync~spin) Indexing SS14 graphs…';
      status.tooltip = 'SS14 Studio is scanning construction graph prototypes.';
    }
  };

  const updateStatus = (payload: IndexPayload) => {
    const project = payload.project;
    if (project.totalGraphs === 0) {
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
        vscode.window.showInformationMessage(
          `SS14 Studio: indexed ${project.totalGraphs} construction graphs from ${project.scannedFiles} files in ${project.scanDurationMs} ms.`,
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

    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('ss14Studio.graphGlobs')) {
        await refresh(false);
      }
      if (
        event.affectsConfiguration('ss14Studio.animations') ||
        event.affectsConfiguration('ss14Studio.blueprintIntensity')
      ) {
        panel.notifyConfigChanged();
      }
    }),
  );

  setIndexing(true);
  try {
    await index.refresh();
  } finally {
    setIndexing(false);
  }
  updateStatus(index.getPayload());

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

export function deactivate(): void {
  // All subscriptions are disposed by VS Code.
}
