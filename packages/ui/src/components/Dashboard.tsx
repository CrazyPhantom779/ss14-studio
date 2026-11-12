import { useEffect, useMemo, useState } from 'react';
import type { GraphSummary, IndexPayload } from '@ss14-studio/core';
import {
  ArrowRight,
  Boxes,
  CircleAlert,
  CircleCheck,
  FolderTree,
  GitBranch,
  Layers,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Waypoints,
} from 'lucide-react';
import { formatNumber, hashString, nodeAccent } from '../lib/graph';
import { Badge, Button } from './ui';

interface DashboardProps {
  index: IndexPayload | null;
  recent: string[];
  onOpen: (key: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
}

const GRAPH_PREFIX = 'Resources/Prototypes/Recipes/Construction/Graphs';

function folderOf(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  const slash = normalized.lastIndexOf('/');
  let folder = slash >= 0 ? normalized.slice(0, slash) : '';
  if (folder.startsWith(`${GRAPH_PREFIX}/`)) folder = folder.slice(GRAPH_PREFIX.length + 1);
  return folder || 'graphs';
}

function totalIssues(summary: GraphSummary): number {
  return summary.errors + summary.warnings;
}

function GraphThumb({ seed }: { seed: string }) {
  const accent = nodeAccent(seed, true);
  let state = hashString(seed) || 1;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const points = Array.from({ length: 8 }, (_, index) => ({
    x: 12 + (index % 4) * 43 + random() * 16,
    y: 14 + Math.floor(index / 4) * 31 + random() * 9,
  }));
  const links = points.slice(1).map((_, index) => {
    const target = index + 1;
    const source = Math.min(target - 1, Math.floor(random() * target));
    return [source, target] as const;
  });

  return (
    <svg className="graph-thumb" viewBox="0 0 190 70" role="presentation" style={{ color: accent.color }}>
      <g className="thumb-lines">
        {links.map(([source, target], index) => (
          <line
            key={index}
            x1={points[source]!.x}
            y1={points[source]!.y}
            x2={points[target]!.x}
            y2={points[target]!.y}
          />
        ))}
      </g>
      {points.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r={index === 0 ? 4.6 : 3.1}
          className={index === 0 ? 'thumb-node start' : 'thumb-node'}
        />
      ))}
    </svg>
  );
}

function GraphCard({
  summary,
  onOpen,
}: {
  summary: GraphSummary;
  onOpen: (key: string) => void;
}) {
  const issues = totalIssues(summary);
  return (
    <button type="button" className="graph-card" onClick={() => onOpen(summary.key)}>
      <div className="graph-card-top">
        <div className="graph-card-title">
          <span className="graph-card-folder">{folderOf(summary.relativePath)}</span>
          <strong>{summary.id}</strong>
        </div>
        <span className="graph-card-arrow">
          <ArrowRight size={15} aria-hidden />
        </span>
      </div>
      <GraphThumb seed={summary.key || summary.id} />
      <div className="graph-card-bottom">
        <span>
          <Network size={12} aria-hidden />
          {summary.nodes} nodes
        </span>
        <span>
          <GitBranch size={12} aria-hidden />
          {summary.edges} edges
        </span>
        {summary.errors > 0 ? (
          <span className="card-issue error">
            <CircleAlert size={12} aria-hidden />
            {summary.errors}
          </span>
        ) : summary.warnings > 0 ? (
          <span className="card-issue warning">
            <TriangleAlert size={12} aria-hidden />
            {summary.warnings}
          </span>
        ) : issues === 0 ? (
          <span className="card-issue ok">
            <CircleCheck size={12} aria-hidden />
          </span>
        ) : null}
      </div>
    </button>
  );
}

function HeroSchematic() {
  return (
    <div className="hero-schematic" aria-hidden="true">
      <svg viewBox="0 0 380 240" fill="none">
        <g className="schematic-grid">
          {Array.from({ length: 8 }, (_, index) => (
            <line key={`v${index}`} x1={20 + index * 48} y1="12" x2={20 + index * 48} y2="228" />
          ))}
          {Array.from({ length: 5 }, (_, index) => (
            <line key={`h${index}`} x1="12" y1={24 + index * 48} x2="368" y2={24 + index * 48} />
          ))}
        </g>
        <g className="schematic-links">
          <path d="M62 158 148 102 238 140 314 76" />
          <path d="M148 102 190 42" />
          <path d="M238 140 268 196" />
          <path d="M148 102 128 200" />
        </g>
        <g className="schematic-nodes">
          <circle cx="62" cy="158" r="13" className="schematic-start" />
          <circle cx="148" cy="102" r="9" />
          <circle cx="238" cy="140" r="9" />
          <circle cx="314" cy="76" r="7" />
          <circle cx="190" cy="42" r="6" />
          <circle cx="268" cy="196" r="6" />
          <circle cx="128" cy="200" r="6" />
        </g>
        <g className="schematic-rings">
          <circle cx="62" cy="158" r="22" />
          <circle cx="62" cy="158" r="32" />
          <circle cx="314" cy="76" r="16" />
        </g>
        <g className="schematic-labels">
          <text x="44" y="192">START</text>
          <text x="292" y="58">TARGET</text>
        </g>
      </svg>
      <div className="hero-blueprint-map">
        <span>CONSTRUCTION BLUEPRINT</span>
        <strong>GRAPH ATLAS / 01</strong>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dashboard">
      <div className="dashboard-inner">
        <div className="dash-hero skeleton-hero">
          <div className="skeleton-block w-30" />
          <div className="skeleton-block h-56 w-70" />
          <div className="skeleton-block h-16 w-52" />
        </div>
        <div className="dash-kpis">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="dash-kpi skeleton-card" key={index}>
              <div className="skeleton-block h-28 w-30" />
              <div className="skeleton-block h-14 w-70" />
            </div>
          ))}
        </div>
        <div className="skeleton-card tall">
          <div className="skeleton-block w-40" />
          <div className="skeleton-block h-14 w-90" />
          <div className="skeleton-block h-14 w-80" />
        </div>
      </div>
    </div>
  );
}

export function Dashboard({ index, recent, onOpen, onCreate, onRefresh }: DashboardProps) {
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('all');
  const [sort, setSort] = useState<'name' | 'nodes' | 'issues' | 'folder'>('folder');
  const [limit, setLimit] = useState(48);

  const summaries = index?.summaries ?? [];
  const project = index?.project ?? null;

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const summary of summaries) set.add(folderOf(summary.relativePath));
    return [...set].sort((left, right) => left.localeCompare(right));
  }, [summaries]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = summaries.filter((summary) => {
      if (folder !== 'all' && folderOf(summary.relativePath) !== folder) return false;
      if (!needle) return true;
      return `${summary.id} ${summary.folder} ${summary.relativePath}`.toLowerCase().includes(needle);
    });
    return list.sort((left, right) => {
      if (sort === 'nodes') return right.nodes - left.nodes;
      if (sort === 'issues') return totalIssues(right) - totalIssues(left) || left.id.localeCompare(right.id);
      if (sort === 'folder') {
        const folderOrder = folderOf(left.relativePath).localeCompare(folderOf(right.relativePath));
        return folderOrder || left.id.localeCompare(right.id);
      }
      return left.id.localeCompare(right.id);
    });
  }, [folder, query, sort, summaries]);

  useEffect(() => {
    setLimit(48);
  }, [query, folder, sort]);

  const recentSummaries = useMemo(() => {
    const byKey = new Map(summaries.map((summary) => [summary.key, summary]));
    return recent
      .map((key) => byKey.get(key))
      .filter((summary): summary is GraphSummary => summary != null)
      .slice(0, 5);
  }, [recent, summaries]);

  const issueSummaries = useMemo(
    () =>
      summaries
        .filter((summary) => totalIssues(summary) > 0)
        .sort((left, right) => totalIssues(right) - totalIssues(left)),
    [summaries],
  );
  const visibleIssueSummaries = issueSummaries.slice(0, 5);

  if (!index) return <DashboardSkeleton />;

  const errors = summaries.reduce((sum, summary) => sum + summary.errors, 0);
  const warnings = summaries.reduce((sum, summary) => sum + summary.warnings, 0);
  const healthy = errors + warnings === 0;
  const visible = filtered.slice(0, limit);

  return (
    <div className="dashboard">
      <div className="dashboard-inner">
        <section className="dash-hero">
          <div className="dash-hero-copy">
            <div className="hero-eyebrow">
              <span className="hero-eyebrow-line" />
              Station engineering suite
            </div>
            <h1>
              Build stations,
              <br />
              <span>one graph at a time.</span>
            </h1>
            <p>
              Inspect every construction graph in your workspace, trace material paths,
              and edit prototype YAML without leaving the blueprint.
            </p>
            <div className="hero-actions">
              <Button variant="primary" icon={Plus} onClick={onCreate}>
                New construction graph
              </Button>
              <Button variant="secondary" icon={RefreshCw} onClick={onRefresh}>
                Refresh index
              </Button>
            </div>
            <div className="hero-meta">
              <span>
                <Sparkles size={13} aria-hidden />
                {project?.scannedFiles.toLocaleString() ?? 0} prototype files scanned
              </span>
              {project && project.scanDurationMs > 0 ? (
                <span>Indexed in {Math.round(project.scanDurationMs)} ms</span>
              ) : null}
              {project?.skipped ? <span className="hero-warn">Index skipped</span> : null}
            </div>
          </div>
          <HeroSchematic />
        </section>

        <section className="dash-kpis" aria-label="Workspace totals">
          <div className="dash-kpi">
            <span className="kpi-icon cyan">
              <Network size={18} aria-hidden />
            </span>
            <div>
              <strong>{formatNumber(project?.totalGraphs ?? summaries.length)}</strong>
              <span>Construction graphs</span>
            </div>
            <em>indexed</em>
          </div>
          <div className="dash-kpi">
            <span className="kpi-icon violet">
              <Boxes size={18} aria-hidden />
            </span>
            <div>
              <strong>{formatNumber(project?.totalNodes ?? 0)}</strong>
              <span>Graph nodes</span>
            </div>
            <em>in atlas</em>
          </div>
          <div className="dash-kpi">
            <span className="kpi-icon amber">
              <Waypoints size={18} aria-hidden />
            </span>
            <div>
              <strong>{formatNumber(project?.totalEdges ?? 0)}</strong>
              <span>Directed edges</span>
            </div>
            <em>traced</em>
          </div>
          <div className={`dash-kpi ${healthy ? 'is-healthy' : 'has-issues'}`}>
            <span className={`kpi-icon ${healthy ? 'emerald' : 'rose'}`}>
              {healthy ? <ShieldCheck size={18} aria-hidden /> : <CircleAlert size={18} aria-hidden />}
            </span>
            <div>
              <strong>{formatNumber(errors + warnings)}</strong>
              <span>{healthy ? 'No diagnostics' : 'Diagnostics'}</span>
            </div>
            <em>{healthy ? 'all clear' : `${errors}E · ${warnings}W`}</em>
          </div>
        </section>

        <div className="dash-split">
          <section className="dash-panel recent-panel">
            <header className="dash-panel-head">
              <div>
                <div className="section-eyebrow">Continue where you left off</div>
                <h2>Recently inspected</h2>
              </div>
              <Badge tone="muted">{recentSummaries.length}</Badge>
            </header>
            {recentSummaries.length === 0 ? (
              <div className="dash-empty-compact">
                <Layers size={21} aria-hidden />
                <div>
                  <strong>No graphs opened yet</strong>
                  <span>Pick a graph below and it will appear here next time.</span>
                </div>
              </div>
            ) : (
              <div className="recent-list">
                {recentSummaries.map((summary) => (
                  <button
                    type="button"
                    className="recent-item"
                    key={summary.key}
                    onClick={() => onOpen(summary.key)}
                  >
                    <span className="recent-thumb">
                      <GraphThumb seed={summary.key || summary.id} />
                    </span>
                    <span className="recent-main">
                      <strong>{summary.id}</strong>
                      <span>
                        {folderOf(summary.relativePath)} · {summary.nodes} nodes
                      </span>
                    </span>
                    {summary.errors > 0 ? (
                      <span className="card-issue error">
                        <CircleAlert size={12} aria-hidden />
                        {summary.errors}
                      </span>
                    ) : summary.warnings > 0 ? (
                      <span className="card-issue warning">
                        <TriangleAlert size={12} aria-hidden />
                        {summary.warnings}
                      </span>
                    ) : (
                      <CircleCheck size={14} className="recent-ok" aria-hidden />
                    )}
                    <ArrowRight size={14} className="recent-arrow" aria-hidden />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="dash-panel health-panel">
            <header className="dash-panel-head">
              <div>
                <div className="section-eyebrow">Prototype health</div>
                <h2>Workspace diagnostics</h2>
              </div>
              <span className={`health-orb ${healthy ? 'ok' : 'issues'}`}>
                {healthy ? <CircleCheck size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
              </span>
            </header>
            <div className="health-summary">
              <div className="health-meter">
                <span className="health-meter-error" style={{ width: `${(errors / Math.max(1, errors + warnings)) * 100}%` }} />
              </div>
              <div className="health-counts">
                <span className="error">
                  <i />
                  {errors} errors
                </span>
                <span className="warning">
                  <i />
                  {warnings} warnings
                </span>
                <span className="ok">
                  <i />
                  {Math.max(0, summaries.length - issueSummaries.length)} clean
                </span>
              </div>
            </div>
            {issueSummaries.length === 0 ? (
              <div className="health-clear">
                <CircleCheck size={28} aria-hidden />
                <strong>Every construction graph parses cleanly.</strong>
                <span>No missing targets, isolated nodes or untyped entries.</span>
              </div>
            ) : (
              <div className="issue-list">
                {visibleIssueSummaries.map((summary) => (
                  <button type="button" key={summary.key} onClick={() => onOpen(summary.key)}>
                    <span className={`issue-dot ${summary.errors > 0 ? 'error' : 'warning'}`} />
                    <span className="issue-name">{summary.id}</span>
                    <span className="issue-counts">
                      {summary.errors > 0 ? <em className="error">{summary.errors}E</em> : null}
                      {summary.warnings > 0 ? <em className="warning">{summary.warnings}W</em> : null}
                    </span>
                    <ArrowRight size={13} aria-hidden />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="graph-library">
          <header className="library-head">
            <div>
              <div className="section-eyebrow">The atlas</div>
              <h2>
                Construction graph library
                <span className="library-count">{filtered.length}</span>
              </h2>
            </div>
            <div className="library-controls">
              <label className="studio-search library-search">
                <Search size={14} aria-hidden />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter library…"
                  aria-label="Filter construction graph library"
                  spellCheck={false}
                />
                {query ? (
                  <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear filter">
                    ×
                  </button>
                ) : null}
              </label>
              <label className="studio-select">
                <FolderTree size={13} aria-hidden />
                <select value={folder} onChange={(event) => setFolder(event.target.value)} aria-label="Filter by folder">
                  <option value="all">All folders</option>
                  {folders.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="studio-select">
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as typeof sort)}
                  aria-label="Sort graphs"
                >
                  <option value="folder">Folder</option>
                  <option value="name">Name</option>
                  <option value="nodes">Node count</option>
                  <option value="issues">Issues</option>
                </select>
              </label>
            </div>
          </header>

          {summaries.length === 0 ? (
            <div className="library-empty">
              <span className="library-empty-icon">
                <Network size={28} aria-hidden />
              </span>
              <h3>No construction graphs found</h3>
              <p>
                Open a Space Station 14 repository with a <code>Resources/Prototypes</code> folder,
                then refresh the index. You can also create your first graph right now.
              </p>
              <div className="hero-actions">
                <Button variant="primary" icon={Plus} onClick={onCreate}>
                  Create construction graph
                </Button>
                <Button icon={RefreshCw} onClick={onRefresh}>
                  Refresh index
                </Button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="library-empty small">
              <Search size={24} aria-hidden />
              <h3>No graphs match those filters</h3>
              <p>Try clearing the search or choosing a different folder.</p>
              <Button
                onClick={() => {
                  setQuery('');
                  setFolder('all');
                }}
              >
                Reset filters
              </Button>
            </div>
          ) : (
            <>
              <div className="graph-grid">
                {visible.map((summary) => (
                  <GraphCard key={summary.key} summary={summary} onOpen={onOpen} />
                ))}
              </div>
              {filtered.length > visible.length ? (
                <div className="library-more">
                  <Button onClick={() => setLimit((current) => current + 72)}>
                    Show more graphs ({filtered.length - visible.length} remaining)
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
