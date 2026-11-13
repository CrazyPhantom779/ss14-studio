import { useMemo, useState } from 'react';
import type {
  GraphSummary,
  ProjectInfo,
  PrototypeIndexPayload,
  PrototypeSummary,
  WorkspaceView,
} from '@ss14-studio/core';
import {
  BookOpen,
  Boxes,
  Braces,
  CircleAlert,
  GitBranch,
  Image as ImageIcon,
  Info,
  Layers,
  Plus,
  Search,
  Settings2,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { Badge, Button } from './ui';

type FilterMode = 'all' | 'issues' | 'recent';
type BrowserMode = 'graphs' | 'prototypes';

interface SidebarProps {
  summaries: GraphSummary[];
  prototypes: PrototypeIndexPayload | null;
  project: ProjectInfo | null;
  currentKey: string | null;
  view: WorkspaceView;
  recent: string[];
  onOpen: (key: string) => void;
  onOpenPrototype: (id: string, kind?: string) => void;
  onCreate: () => void;
  onDocs: () => void;
  onPickRsi: () => void;
  onPickXaml: () => void;
  onAbout: () => void;
  onSettings: () => void;
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

function prototypePath(summary: PrototypeSummary): string {
  return `${summary.kind}:${summary.id}`;
}


export function Sidebar({
  summaries,
  prototypes,
  project,
  currentKey,
  view,
  recent,
  onOpen,
  onOpenPrototype,
  onCreate,
  onDocs,
  onPickRsi,
  onPickXaml,
  onAbout,
  onSettings,
}: SidebarProps) {
  const [mode, setMode] = useState<BrowserMode>(view.kind === 'prototype' ? 'prototypes' : 'graphs');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [kind, setKind] = useState('all');

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
    let list = filter === 'recent' ? recentSummaries : summaries;
    if (filter === 'issues') {
      list = list.filter((summary) => summary.errors > 0 || summary.warnings > 0);
    }
    if (needle) {
      list = list.filter((summary) =>
        `${summary.id} ${summary.folder} ${summary.relativePath}`.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [filter, query, recentSummaries, summaries]);

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

  const filteredPrototypes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (prototypes?.summaries ?? []).filter((summary) => {
      if (kind !== 'all' && summary.kind !== kind) return false;
      if (!needle) return true;
      return `${summary.id} ${summary.name} ${summary.description ?? ''} ${summary.relativePath}`
        .toLowerCase()
        .includes(needle);
    });
  }, [kind, prototypes?.summaries, query]);

  const loading = !project && summaries.length === 0;
  const activePrototype = view.kind === 'prototype' ? view.id : null;

  return (
    <aside className="studio-sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title-row">
          <div>
            <div className="section-eyebrow">Workspace</div>
            <h2>{mode === 'graphs' ? 'Graph browser' : 'Prototype atlas'}</h2>
          </div>
          {mode === 'graphs' ? (
            <Button variant="primary" size="sm" icon={Plus} onClick={onCreate} title="Create a construction graph">
              New
            </Button>
          ) : (
            <Badge tone="muted">{prototypes?.total ?? 0}</Badge>
          )}
        </div>

        <div className="sidebar-mode-tabs" role="tablist" aria-label="Browser">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'graphs'}
            className={mode === 'graphs' ? 'active' : ''}
            onClick={() => setMode('graphs')}
          >
            <GitBranch size={12} aria-hidden /> Graphs
            <span>{summaries.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'prototypes'}
            className={mode === 'prototypes' ? 'active' : ''}
            onClick={() => setMode('prototypes')}
          >
            <Layers size={12} aria-hidden /> Prototypes
            <span>{prototypes?.total ?? 0}</span>
          </button>
        </div>

        <label className="studio-search">
          <Search size={14} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === 'graphs' ? 'Search graphs, folders…' : 'Search prototypes…'}
            aria-label={mode === 'graphs' ? 'Search construction graphs' : 'Search prototypes'}
            spellCheck={false}
          />
          {query ? (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          ) : null}
        </label>

        {mode === 'graphs' ? (
          <div className="sidebar-filters" role="tablist" aria-label="Graph filters">
            <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              All <span>{summaries.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={filter === 'issues'} className={filter === 'issues' ? 'active' : ''} onClick={() => setFilter('issues')}>
              Issues <span>{issueCount}</span>
            </button>
            <button type="button" role="tab" aria-selected={filter === 'recent'} className={filter === 'recent' ? 'active' : ''} onClick={() => setFilter('recent')}>
              Recent
            </button>
          </div>
        ) : (
          <label className="studio-select sidebar-kind-select">
            <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Filter prototypes by kind">
              <option value="all">All prototype kinds</option>
              {(prototypes?.kinds ?? []).map((stat) => (
                <option key={stat.kind} value={stat.kind}>
                  {stat.kind} ({stat.count})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="sidebar-scroll">
        {mode === 'graphs' ? (
          loading ? (
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
              <strong>{query ? 'No matching graphs' : filter === 'recent' ? 'Nothing opened yet' : 'No graphs here'}</strong>
              <span>
                {query
                  ? 'Try a shorter search or another filter.'
                  : filter === 'recent'
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
          )
        ) : !prototypes ? (
          <div className="sidebar-scanning">
            <Sparkles size={14} aria-hidden />
            Indexing prototypes…
          </div>
        ) : filteredPrototypes.length === 0 ? (
          <div className="sidebar-empty">
            <Layers size={22} aria-hidden />
            <strong>No matching prototypes</strong>
            <span>Try a different search or prototype kind.</span>
          </div>
        ) : (
          <div className="prototype-sidebar-list">
            {filteredPrototypes.slice(0, 220).map((summary) => (
              <button
                type="button"
                key={summary.key}
                className={`prototype-sidebar-row ${activePrototype === summary.id ? 'active' : ''}`}
                onClick={() => onOpenPrototype(summary.id, summary.kind)}
                title={`${summary.relativePath}:${summary.line}`}
              >
                <span className="prototype-sidebar-kind">{summary.kind}</span>
                <span className="prototype-sidebar-main">
                  <strong>{summary.name || summary.id}</strong>
                  <em>{summary.id}</em>
                </span>
                {summary.abstract ? <span className="prototype-sidebar-flag">A</span> : null}
                {summary.partial ? <span className="prototype-sidebar-flag partial">P</span> : null}
              </button>
            ))}
            {filteredPrototypes.length > 220 ? (
              <div className="sidebar-note">Showing the first 220 of {filteredPrototypes.length}.</div>
            ) : null}
          </div>
        )}
      </div>

      <div className="sidebar-tools">
        <button type="button" onClick={onPickRsi} title="Open an RSI sprite folder">
          <ImageIcon size={13} aria-hidden /> RSI studio
        </button>
        <button type="button" onClick={onPickXaml} title="Open a RobustToolbox XAML file">
          <Braces size={13} aria-hidden /> XAML studio
        </button>
        <button type="button" onClick={onAbout} title="About SS14 Studio and AI disclosure">
          <Info size={13} aria-hidden /> About
        </button>
      </div>

      <footer className="sidebar-footer">
        <div className="sidebar-project">
          <span className="project-pulse" aria-hidden />
          <div>
            <strong>{projectName(project)}</strong>
            <span>
              {project
                ? `${project.totalGraphs.toLocaleString()} graphs · ${(prototypes?.total ?? 0).toLocaleString()} prototypes`
                : 'Scanning workspace…'}
            </span>
          </div>
        </div>
        <div className="sidebar-footer-links">
          <button type="button" onClick={onDocs}>
            <BookOpen size={13} aria-hidden />
            Docs
          </button>
          <button type="button" onClick={onSettings} title="Display settings">
            <Settings2 size={13} aria-hidden />
            Visuals
          </button>
          <span>v0.2.0</span>
        </div>
      </footer>
    </aside>
  );
}
