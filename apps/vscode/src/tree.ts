import * as vscode from 'vscode';
import type { GraphSummary, IndexPayload } from '@ss14-studio/core';
import type { GraphIndex } from './indexer.js';

interface FolderEntry {
  kind: 'folder';
  label: string;
  folder: string;
  graphs: GraphEntry[];
}

interface GraphEntry {
  kind: 'graph';
  summary: GraphSummary;
}

interface InfoEntry {
  kind: 'info';
  label: string;
}

type Entry = FolderEntry | GraphEntry | InfoEntry;

export class GraphTreeProvider
  implements vscode.TreeDataProvider<Entry>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<Entry | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private folders: FolderEntry[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private indexing = false;

  constructor(private readonly index: GraphIndex) {
    this.disposables.push(
      index.onDidChange((payload) => this.apply(payload)),
    );
    this.apply(index.getPayload());
  }

  private apply(payload: IndexPayload): void {
    const byFolder = new Map<string, GraphEntry[]>();
    for (const summary of payload.summaries) {
      const list = byFolder.get(summary.folder) ?? [];
      list.push({ kind: 'graph', summary });
      byFolder.set(summary.folder, list);
    }

    this.folders = [...byFolder.entries()]
      .map(([folder, graphs]) => ({
        kind: 'folder' as const,
        folder,
        label: folder.replaceAll('/', ' / '),
        graphs: graphs.sort((a, b) => a.summary.id.localeCompare(b.summary.id)),
      }))
      .sort((a, b) => a.folder.localeCompare(b.folder));

    this.changeEmitter.fire(undefined);
  }

  refresh(): void {
    this.apply(this.index.getPayload());
  }

  setIndexing(indexing: boolean): void {
    this.indexing = indexing;
    this.changeEmitter.fire(undefined);
  }

  getChildren(element?: Entry): Entry[] {
    if (!element) {
      if (this.folders.length === 0 && this.indexing) {
        return [{ kind: 'info', label: 'Indexing construction graphs…' }];
      }
      return this.folders;
    }
    if (element.kind === 'folder') return element.graphs;
    return [];
  }

  getParent(element: Entry): Entry | undefined {
    if (element.kind === 'graph') {
      return this.folders.find((folder) =>
        folder.graphs.some((graph) => graph.summary.key === element.summary.key),
      );
    }
    return undefined;
  }

  getTreeItem(element: Entry): vscode.TreeItem {
    if (element.kind === 'info') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon('sync~spin');
      return item;
    }

    if (element.kind === 'folder') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.description = `${element.graphs.length}`;
      item.tooltip = `${element.graphs.length} construction graph${
        element.graphs.length === 1 ? '' : 's'
      }`;
      item.iconPath = new vscode.ThemeIcon('folder-library');
      item.contextValue = 'folder';
      item.id = `folder:${element.folder}`;
      return item;
    }

    const summary = element.summary;
    const item = new vscode.TreeItem(
      summary.id,
      vscode.TreeItemCollapsibleState.None,
    );
    const parts = [`${summary.nodes} nodes`, `${summary.edges} edges`];
    if (summary.errors > 0) parts.push(`${summary.errors} error${summary.errors === 1 ? '' : 's'}`);
    if (summary.warnings > 0)
      parts.push(`${summary.warnings} warning${summary.warnings === 1 ? '' : 's'}`);
    item.description = parts.join(' · ');
    item.tooltip = new vscode.MarkdownString(
      [
        `**${summary.id}**`,
        '',
        `\`${summary.relativePath}\``,
        '',
        `${summary.nodes} nodes · ${summary.edges} edges`,
        summary.errors > 0 ? `$(error) ${summary.errors} error(s)` : '',
        summary.warnings > 0 ? `$(warning) ${summary.warnings} warning(s)` : '',
        '',
        'Click to open the visual editor.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    item.tooltip.supportThemeIcons = true;
    item.id = `graph:${summary.key}`;
    item.contextValue = 'graph';
    item.resourceUri = vscode.Uri.parse(summary.filePath);
    item.command = {
      command: 'ss14Studio.openGraph',
      title: 'Open Construction Graph',
      arguments: [summary.key],
    };
    item.iconPath = new vscode.ThemeIcon(
      summary.errors > 0
        ? 'error'
        : summary.warnings > 0
          ? 'warning'
          : 'type-hierarchy',
      new vscode.ThemeColor(
        summary.errors > 0
          ? 'errorForeground'
          : summary.warnings > 0
            ? 'editorWarning.foreground'
            : 'charts.blue',
      ),
    );
    return item;
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.changeEmitter.dispose();
  }
}
