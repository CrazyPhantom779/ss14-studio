import * as vscode from 'vscode';
import type {
  GraphSummary,
  IndexPayload,
  PrototypeIndexPayload,
  PrototypeSummary,
} from '@ss14-studio/core';
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
        return [{ kind: 'info', label: 'Indexing construction graphsâ€¦' }];
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
    item.description = parts.join(' Â· ');
    item.tooltip = new vscode.MarkdownString(
      [
        `**${summary.id}**`,
        '',
        `\`${summary.relativePath}\``,
        '',
        `${summary.nodes} nodes Â· ${summary.edges} edges`,
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

interface PrototypeKindEntry {
  kind: 'kind';
  label: string;
  prototypes: PrototypeEntry[];
}

interface PrototypeEntry {
  kind: 'prototype';
  summary: PrototypeSummary;
}

interface PrototypeInfoEntry {
  kind: 'info';
  label: string;
}

type PrototypeNode =
  | PrototypeKindEntry
  | PrototypeEntry
  | PrototypeInfoEntry;

export class PrototypeTreeProvider
  implements vscode.TreeDataProvider<PrototypeNode>, vscode.Disposable
{
  private readonly changeEmitter =
    new vscode.EventEmitter<PrototypeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private kinds: PrototypeKindEntry[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private indexing = false;

  constructor(private readonly index: GraphIndex) {
    this.disposables.push(
      index.onDidPrototypesChange((payload) => this.apply(payload)),
    );
    this.apply(index.getPrototypePayload());
  }

  private apply(payload: PrototypeIndexPayload): void {
    const byKind = new Map<string, PrototypeEntry[]>();
    for (const summary of payload.summaries) {
      const list = byKind.get(summary.kind) ?? [];
      list.push({ kind: 'prototype', summary });
      byKind.set(summary.kind, list);
    }
    this.kinds = [...byKind.entries()]
      .map(([kind, prototypes]) => ({
        kind: 'kind' as const,
        label: kind,
        prototypes: prototypes.sort((a, b) =>
          a.summary.id.localeCompare(b.summary.id),
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    this.changeEmitter.fire(undefined);
  }

  setIndexing(indexing: boolean): void {
    this.indexing = indexing;
    this.changeEmitter.fire(undefined);
  }

  getChildren(element?: PrototypeNode): PrototypeNode[] {
    if (!element) {
      if (this.kinds.length === 0 && this.indexing) {
        return [{ kind: 'info', label: 'Indexing prototypes…' }];
      }
      return this.kinds;
    }
    if (element.kind === 'kind') return element.prototypes;
    return [];
  }

  getParent(element: PrototypeNode): PrototypeNode | undefined {
    if (element.kind === 'prototype') {
      return this.kinds.find((kind) =>
        kind.prototypes.some(
          (prototype) => prototype.summary.key === element.summary.key,
        ),
      );
    }
    return undefined;
  }

  getTreeItem(element: PrototypeNode): vscode.TreeItem {
    if (element.kind === 'info') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon('sync~spin');
      return item;
    }

    if (element.kind === 'kind') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = `${element.prototypes.length}`;
      item.tooltip = `${element.prototypes.length} ${element.label} prototype${
        element.prototypes.length === 1 ? '' : 's'
      }`;
      item.iconPath = new vscode.ThemeIcon('symbol-class');
      item.contextValue = 'prototypeKind';
      item.id = `prototype-kind:${element.label}`;
      return item;
    }

    const summary = element.summary;
    const item = new vscode.TreeItem(
      summary.id,
      vscode.TreeItemCollapsibleState.None,
    );
    const parts: string[] = [];
    if (summary.partial) parts.push('partial');
    if (summary.abstract) parts.push('abstract');
    if (summary.parents.length > 0) {
      parts.push(`? ${summary.parents.join(', ')}`);
    }
    if (summary.children > 0) {
      parts.push(`${summary.children} children`);
    }
    item.description = parts.join(' · ');
    item.tooltip = new vscode.MarkdownString(
      [
        `**${summary.id}**`,
        '',
        `\`${summary.relativePath}\` · line ${summary.line}`,
        '',
        `${summary.kind} · ${summary.componentCount} components`,
        summary.parents.length > 0
          ? `Parents: ${summary.parents.join(', ')}`
          : '',
        summary.partial ? 'Partial prototype overlay' : '',
        '',
        'Click to open the prototype inspector.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    item.id = `prototype:${summary.key}`;
    item.contextValue = 'prototype';
    item.resourceUri = vscode.Uri.parse(summary.filePath);
    item.command = {
      command: 'ss14Studio.openPrototype',
      title: 'Open Prototype',
      arguments: [summary.id, summary.kind],
    };
    item.iconPath = new vscode.ThemeIcon(
      summary.partial
        ? 'layers'
        : summary.abstract
          ? 'symbol-interface'
          : 'symbol-class',
      new vscode.ThemeColor(
        summary.partial ? 'editorWarning.foreground' : 'charts.purple',
      ),
    );
    return item;
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.changeEmitter.dispose();
  }
}
