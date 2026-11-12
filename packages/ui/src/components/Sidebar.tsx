import { useMemo, useState } from 'react';
import type { GraphSummary, ProjectInfo } from '@ss14-studio/core';
import {
  BookOpen,
  Boxes,
  CircleAlert,
  Plus,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { Button } from './ui';

type FilterMode = 'all' | 'issues' | 'recent';

interface SidebarProps {
  summaries: GraphSummary[];
  project: ProjectInfo | null;
  currentKey: string | null;
  recent: string[];
  onOpen: (key: string) => void;
  onCreate: () => void;
  onDocs: () => void;
}

const GRAPH_PREFIX = 'Resources/Prototypes/Recipes/Construction/Graphs';

function folderOf(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  const slash = normalized.lastIndexOf('/');
  let folder = slash >= 0 ? normalized.slice(0, slash) : '';
  if (folder.startsWith(`${GRAPH_PREFIX}/`)) folder = folder.slice(GRAPH_PREFIX.length + 1);
  return folder || 'graphs';
}

function statusOf(summary: GraphSummary): 'error' | 'warning' | 'ok' {
  if (summary.errors > 0) return 'error';
  if (summary.warnings > 0) return 'warning';
  return 'ok';
}

function projectName(project: ProjectInfo | null): string {
  const root = project?.roots[0]?.name;
  return root?.replace(/[_-]+/g, ' ') || 'SS14 workspace';
}

export function Sidebar({
  summaries,
  project,
  currentKey,
  recent,
  onOpen,
  onCreate,
  onDocs,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<FilterMode>('all');

  const issueCount = useMemo(
    () => summaries.filter((summary) => summary.errors > 0 || summary.warnings > 0).length,
    [summaries],
  );

  const recentSummaries = useMemo(() => {
    const byKey = new Map(summaries.map((summary) => [summary.key, summary]));
    return recent
      .map((key) => byKey.get(key))
      .filter((summary): summary is GraphSummary => summary != null);
  }, [recent, summaries]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = mode === 'recent' ? recentSummaries : summaries;
    if (mode === 'issues') {
      list = list.filter((summary) => summary.errors > 0 || summary.warnings > 0);
    }
    if (needle) {
      list = list.filter((summary) =>
        `${summary.id} ${summary.folder} ${summary.relativePath}`.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [mode, query, recentSummaries, summaries]);

  const groups = useMemo(() => {
    const map = new Map<string, GraphSummary[]>();
    for (const summary of filtered) {
      const folder = folderOf(summary.relativePath);
      const list = map.get(folder) ?? [];
      list.push(summary);
      map.set(folder, list);
    }
    return [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([folder, list]) => ({
        folder,
        list: [...list].sort((left, right) => left.id.localeCompare(right.id)),
      }));
  }, [filtered]);

  const loading = !project && summaries.length === 0;

  return (
    <aside className="studio-sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title-row">
          <div>
            <div className="section-eyebrow">Workspace</div>
            <h2>Graph browser</h2>
          </div>
          <Button variant="primary" size="sm" icon={Plus} onClick={onCreate} title="Create a construction graph">
            New
          </Button>
        </div>
        <label className="studio-search">
          <Search size={14} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search graphs, folders…"
            aria-label="Search construction graphs"
            spellCheck={false}
          />
          {query ? (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          ) : null}
        </label>
        <div className="sidebar-filters" role="tablist" aria-label="Graph filters">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'all'}
            className={mode === 'all' ? 'active' : ''}
            onClick={() => setMode('all')}
          >
            All <span>{summaries.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'issues'}
            className={mode === 'issues' ? 'active' : ''}
            onClick={() => setMode('issues')}
          >
            Issues <span>{issueCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'recent'}
            className={mode === 'recent' ? 'active' : ''}
            onClick={() => setMode('recent')}
          >
            Recent
          </button>
        </div>
      </div>

      <div className="sidebar-scroll">
        {loading ? (
          <div className="sidebar-skeleton" aria-label="Indexing construction graphs">
            {Array.from({ length: 8 }, (_, index) => (
              <div className="skeleton-row" key={index}>
                <span className="skeleton-dot" />
                <span className="skeleton-lines">
                  <span />
                  <span />
                </span>
              </div>
            ))}
            <div className="sidebar-scanning">
              <Sparkles size={14} aria-hidden />
              Indexing construction graphs…
            </div>
          </div>
        ) : groups.length === 0 ? (
          <div className="sidebar-empty">
            <Boxes size={22} aria-hidden />
            <strong>{query ? 'No matching graphs' : mode === 'recent' ? 'Nothing opened yet' : 'No graphs here'}</strong>
            <span>
              {query
                ? 'Try a shorter search or another filter.'
                : mode === 'recent'
                  ? 'Graphs you open will show up in this list.'
                  : 'Point SS14 Studio at a workspace that contains construction graphs.'}
            </span>
          </div>
        ) : (
          <div className="graph-groups">
            {groups.map((group) => (
              <section className="graph-group" key={group.folder}>
                <header className="graph-group-head">
                  <span title={group.folder}>{group.folder}</span>
                  <span className="graph-group-count">{group.list.length}</span>
                </header>
                <div className="graph-group-list">
                  {group.list.map((summary) => {
                    const status = statusOf(summary);
                    const active = summary.key === currentKey;
                    return (
                      <button
                        type="button"
                        key={summary.key}
                        className={`graph-item ${active ? 'active' : ''} ${status}`.trim()}
                        onClick={() => onOpen(summary.key)}
                        title={`${summary.relativePath}:${summary.line}`}
                      >
                        <span className={`graph-status-dot ${status}`} aria-hidden />
                        <span className="graph-item-main">
                          <span className="graph-item-name">{summary.id}</span>
                          <span className="graph-item-meta">
                            {summary.nodes} nodes
                            <span className="meta-dot" />
                            {summary.edges} edges
                          </span>
                        </span>
                        {summary.errors > 0 ? (
                          <span className="graph-item-issue error" title={`${summary.errors} errors`}>
                            <CircleAlert size={11} aria-hidden />
                            {summary.errors}
                          </span>
                        ) : summary.warnings > 0 ? (
                          <span className="graph-item-issue warning" title={`${summary.warnings} warnings`}>
                            <TriangleAlert size={11} aria-hidden />
                            {summary.warnings}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <footer className="sidebar-footer">
        <div className="sidebar-project">
          <span className="project-pulse" aria-hidden />
          <div>
            <strong>{projectName(project)}</strong>
            <span>
              {project
                ? `${project.totalGraphs.toLocaleString()} graphs · ${project.totalNodes.toLocaleString()} nodes`
                : 'Scanning workspace…'}
            </span>
          </div>
        </div>
        <div className="sidebar-footer-links">
          <button type="button" onClick={onDocs}>
            <BookOpen size={13} aria-hidden />
            Docs
          </button>
          <span>v0.1.1</span>
        </div>
      </footer>
    </aside>
  );
}
