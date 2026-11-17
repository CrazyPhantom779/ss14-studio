import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type {
  AtlasCluster,
  AtlasEdge,
  AtlasNode,
  GraphAtlas,
} from '@ss14-studio/core';
import {
  ArrowLeft,
  Focus,
  Network,
  Search,
  Waypoints,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { formatNumber } from '../lib/graph';
import { Badge, Button, IconButton } from './ui';

interface GraphAtlasViewProps {
  atlas: GraphAtlas | null;
  onOpenGraph: (key: string) => void;
  onBack: () => void;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.04;
const MAX_SCALE = 2.4;

function clusterBounds(cluster: AtlasCluster) {
  return {
    x: cluster.x,
    y: cluster.y,
    width: cluster.width,
    height: cluster.height,
  };
}

function atlasBounds(atlas: GraphAtlas) {
  let minX = 0;
  let minY = 0;
  let maxX = 1;
  let maxY = 1;
  for (const cluster of atlas.clusters) {
    minX = Math.min(minX, cluster.x);
    minY = Math.min(minY, cluster.y);
    maxX = Math.max(maxX, cluster.x + cluster.width);
    maxY = Math.max(maxY, cluster.y + cluster.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function nodeLabel(node: AtlasNode): string {
  const label = node.entity ?? node.name;
  return label.length > 26 ? `${label.slice(0, 24)}…` : label;
}

function edgePath(source: AtlasNode, target: AtlasNode, kind: AtlasEdge['kind']): string {
  const x1 = source.x + source.width;
  const y1 = source.y + source.height / 2;
  const x2 = target.x;
  const y2 = target.y + target.height / 2;
  if (kind === 'construction') {
    const lift = Math.max(90, Math.abs(x2 - x1) * 0.25);
    return `M ${x1} ${y1} C ${x1 + lift} ${y1 - lift}, ${x2 - lift} ${y2 - lift}, ${x2} ${y2}`;
  }
  const curve = Math.max(24, Math.abs(x2 - x1) * 0.42);
  return `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
}

export function GraphAtlasView({ atlas, onOpenGraph, onBack }: GraphAtlasViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 24, y: 24, scale: 0.4 });
  const [query, setQuery] = useState('');
  const [activeCluster, setActiveCluster] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const fittedRef = useRef<string | null>(null);

  const nodeById = useMemo(() => {
    const map = new Map<string, AtlasNode>();
    for (const node of atlas?.nodes ?? []) map.set(node.id, node);
    return map;
  }, [atlas]);

  const bounds = useMemo(
    () => (atlas ? atlasBounds(atlas) : { x: 0, y: 0, width: 1, height: 1 }),
    [atlas],
  );

  const fit = useCallback(
    (area = bounds) => {
      const pad = 42;
      const scale = Math.min(
        MAX_SCALE,
        Math.max(
          MIN_SCALE,
          Math.min(
            (size.width - pad * 2) / Math.max(1, area.width),
            (size.height - pad * 2) / Math.max(1, area.height),
          ),
        ),
      );
      setTransform({
        scale,
        x: pad - area.x * scale + Math.max(0, (size.width - pad * 2 - area.width * scale) / 2),
        y: pad - area.y * scale + Math.max(0, (size.height - pad * 2 - area.height * scale) / 2),
      });
    },
    [bounds, size.height, size.width],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!atlas) return;
    const token = `${atlas.stats.graphs}:${atlas.stats.nodes}:${size.width}:${size.height}`;
    if (fittedRef.current === token) return;
    fittedRef.current = token;
    fit();
  }, [atlas, fit, size.height, size.width]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const set = new Set<string>();
    for (const node of atlas?.nodes ?? []) {
      const haystack = `${node.name} ${node.entity ?? ''} ${node.graphId} ${node.graphFolder}`.toLowerCase();
      if (haystack.includes(needle)) set.add(node.id);
    }
    return set;
  }, [atlas, query]);

  const focusCluster = useCallback(
    (cluster: AtlasCluster) => {
      setActiveCluster(cluster.id);
      fit(clusterBounds(cluster));
    },
    [fit],
  );

  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    setTransform((current) => {
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
      const ratio = scale / current.scale;
      return {
        scale,
        x: cursorX - (cursorX - current.x) * ratio,
        y: cursorY - (cursorY - current.y) * ratio,
      };
    });
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as Element;
      if (target.closest('[data-atlas-node]')) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        tx: transform.x,
        ty: transform.y,
      };
    },
    [transform.x, transform.y],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setTransform((current) => ({
      ...current,
      x: drag.tx + event.clientX - drag.x,
      y: drag.ty + event.clientY - drag.y,
    }));
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (!atlas) {
    return (
      <div className="atlas-empty">
        <Network size={30} aria-hidden />
        <h2>Building the atlas…</h2>
        <p>Every construction graph is being clustered by prototype folder.</p>
      </div>
    );
  }

  const edges = atlas.edges
    .map((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      return source && target ? { edge, source, target } : null;
    })
    .filter((entry): entry is { edge: AtlasEdge; source: AtlasNode; target: AtlasNode } => entry != null);

  return (
    <div className="atlas-view">
      <aside className="atlas-rail">
        <div className="atlas-rail-head">
          <button type="button" className="atlas-back" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden />
            Dashboard
          </button>
          <div className="atlas-title">
            <span className="section-eyebrow">Workspace blueprint</span>
            <h1>Construction atlas</h1>
          </div>
          <div className="atlas-stats">
            <span>
              <Network size={13} aria-hidden />
              {formatNumber(atlas.stats.graphs)} graphs
            </span>
            <span>
              <Waypoints size={13} aria-hidden />
              {formatNumber(atlas.stats.nodes)} nodes
            </span>
            <span>{formatNumber(atlas.stats.edges)} links</span>
            {atlas.stats.crossGraphEdges > 0 ? (
              <span className="atlas-cross">{atlas.stats.crossGraphEdges} recipe links</span>
            ) : null}
          </div>
        </div>

        <label className="studio-search atlas-search">
          <Search size={14} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a node or entity…"
            spellCheck={false}
            aria-label="Find a construction node"
          />
          {query ? (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          ) : null}
        </label>

        <div className="atlas-clusters">
          {atlas.clusters.map((cluster) => (
            <button
              type="button"
              key={cluster.id}
              className={`atlas-cluster-row ${activeCluster === cluster.id ? 'is-active' : ''}`}
              onClick={() => focusCluster(cluster)}
              title={cluster.folder}
            >
              <span className="atlas-cluster-name">{cluster.label.split('/').slice(-2).join('/')}</span>
              <span className="atlas-cluster-counts">
                <Badge tone="muted">{cluster.graphs}</Badge>
                <em>{formatNumber(cluster.nodes)}</em>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div
        ref={containerRef}
        className={`atlas-canvas ${dragRef.current ? 'is-dragging' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="atlas-toolbar">
          <IconButton icon={ZoomIn} label="Zoom in" onClick={() => setTransform((current) => ({ ...current, scale: Math.min(MAX_SCALE, current.scale * 1.25) }))} />
          <IconButton icon={ZoomOut} label="Zoom out" onClick={() => setTransform((current) => ({ ...current, scale: Math.max(MIN_SCALE, current.scale / 1.25) }))} />
          <IconButton icon={Focus} label="Fit atlas" onClick={() => fit()} />
          <span className="atlas-zoom">{Math.round(transform.scale * 100)}%</span>
          {matches ? <span className="atlas-match-count">{matches.size} matches</span> : null}
        </div>

        <svg className="atlas-svg" width={size.width} height={size.height} role="img" aria-label="Construction graph atlas">
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
            {atlas.clusters.map((cluster) => (
              <g key={cluster.id} className={`atlas-cluster ${activeCluster === cluster.id ? 'is-active' : ''}`}>
                <rect
                  x={cluster.x}
                  y={cluster.y}
                  width={cluster.width}
                  height={cluster.height}
                  rx={14}
                />
                <text x={cluster.x + 16} y={cluster.y + 22} className="atlas-cluster-label">
                  {cluster.label}
                </text>
              </g>
            ))}

            <g className="atlas-edges">
              {edges.map(({ edge, source, target }) => (
                <path
                  key={edge.id}
                  d={edgePath(source, target, edge.kind)}
                  className={`atlas-edge ${edge.kind}`}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>

            <g className="atlas-nodes">
              {atlas.nodes.map((node) => {
                const dimmed = matches ? !matches.has(node.id) : false;
                return (
                  <g
                    key={node.id}
                    data-atlas-node
                    className={`atlas-node ${node.isStart ? 'is-start' : ''} ${node.incoming === 0 ? 'is-root' : ''} ${dimmed ? 'is-dimmed' : ''}`}
                    transform={`translate(${node.x} ${node.y})`}
                    onClick={() => onOpenGraph(node.graphKey)}
                  >
                    <title>{`${node.graphId} · ${node.name}${node.entity ? ` → ${node.entity}` : ''}`}</title>
                    <rect width={node.width} height={node.height} rx={7} />
                    <rect className="atlas-node-accent" width={4} height={node.height} rx={2} />
                    <text x={12} y={19} className="atlas-node-name">
                      {nodeLabel(node)}
                    </text>
                    <text x={12} y={35} className="atlas-node-graph">
                      {node.graphId}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        <div className="atlas-legend">
          <span><i className="atlas-dot step" /> construction step</span>
          <span><i className="atlas-dot recipe" /> recipe link</span>
          <span><i className="atlas-dot start" /> graph start</span>
          <Button variant="ghost" onClick={() => { setQuery(''); setActiveCluster(null); fit(); }}>
            Reset view
          </Button>
        </div>
      </div>
    </div>
  );
}
