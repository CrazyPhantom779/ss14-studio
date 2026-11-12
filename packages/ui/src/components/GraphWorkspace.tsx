import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { GraphView, LayoutMap, StudioConfig } from '@ss14-studio/core';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import {
  ArrowLeft,
  Boxes,
  FileCode2,
  FileDown,
  Flag,
  GitBranch,
  ListChecks,
  PanelRight,
  Plus,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { diagnosticMaps, edgeId, pathFor } from '../lib/graph';
import type { DialogState } from '../lib/dialogs';
import type { StudioSelection } from '../lib/selection';
import type { ThemeKind } from '../lib/host';
import { GraphNode, type StudioGraphNode } from './GraphNode';
import { StepEdge, type StudioGraphEdge } from './StepEdge';
import { Badge, Button, IconButton } from './ui';
import { ValidationTray } from './ValidationTray';

const nodeTypes = { studio: GraphNode } as unknown as NodeTypes;
const edgeTypes = { studio: StepEdge } as unknown as EdgeTypes;

interface GraphWorkspaceProps {
  graph: GraphView;
  positions: LayoutMap;
  readOnly: boolean;
  config: StudioConfig;
  theme: ThemeKind;
  selection: StudioSelection | null;
  inspectorOpen: boolean;
  fitSignal: number;
  children?: ReactNode;
  onSelect: (selection: StudioSelection | null) => void;
  onPositionsChange: (positions: LayoutMap) => void;
  onZoomChange: (zoom: number) => void;
  onToggleInspector: () => void;
  onOpenDialog: (dialog: DialogState) => void;
  onOpenSource: (line?: number, node?: string, edgeIndex?: number) => void;
  onOpenDashboard: () => void;
  onAutoLayout: () => void;
}

function FlowCanvas({
  graph,
  positions,
  readOnly,
  config,
  theme,
  selection,
  fitSignal,
  onSelect,
  onPositionsChange,
  onZoomChange,
  onOpenDialog,
  onOpenSource,
}: Pick<
  GraphWorkspaceProps,
  | 'graph'
  | 'positions'
  | 'readOnly'
  | 'config'
  | 'theme'
  | 'selection'
  | 'fitSignal'
  | 'onSelect'
  | 'onPositionsChange'
  | 'onZoomChange'
  | 'onOpenDialog'
  | 'onOpenSource'
>) {
  const { fitView } = useReactFlow();

  const maps = useMemo(() => diagnosticMaps(graph), [graph]);

  const incomingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes) {
      for (const edge of node.edges) {
        counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
      }
    }
    return counts;
  }, [graph]);

  const path = useMemo(
    () =>
      pathFor(
        graph,
        selection?.kind === 'node' ? selection.node : null,
        selection?.kind === 'edge'
          ? { from: selection.from, to: selection.to, index: selection.index }
          : null,
      ),
    [graph, selection],
  );
  const hasPath = path.nodes.size > 0;

  const desiredNodes = useMemo<StudioGraphNode[]>(
    () =>
      graph.nodes.map((node) => {
        const diagnostics = maps.node.get(node.name) ?? [];
        let steps = 0;
        let conditions = 0;
        for (const edge of node.edges) {
          steps += edge.steps.length;
          conditions += edge.conditions.length;
        }
        return {
          id: node.name,
          type: 'studio',
          className: node.name === graph.start ? 'is-start' : '',
          position: positions[node.name] ?? { x: 0, y: 0 },
          selected: selection?.kind === 'node' && selection.node === node.name,
          draggable: !readOnly,
          connectable: false,
          deletable: false,
          data: {
            model: node,
            isStart: node.name === graph.start,
            diagnostics,
            incoming: incomingCounts.get(node.name) ?? 0,
            steps,
            conditions,
            dimmed: hasPath && !path.nodes.has(node.name),
            highlighted: hasPath && path.nodes.has(node.name),
          },
          ariaLabel: `Construction node ${node.name}`,
        };
      }),
    [
      graph.nodes,
      graph.start,
      hasPath,
      incomingCounts,
      maps.node,
      path.nodes,
      positions,
      readOnly,
      selection,
    ],
  );

  const desiredEdges = useMemo<StudioGraphEdge[]>(() => {
    const edges: StudioGraphEdge[] = [];
    for (const node of graph.nodes) {
      node.edges.forEach((edge, index) => {
        if (!graph.nodes.some((candidate) => candidate.name === edge.target)) return;
        const id = edgeId(node.name, index);
        const highlighted =
          hasPath &&
          path.edges.has(id) &&
          !(selection?.kind === 'edge' && selection.index !== index);
        const edgeDiagnostics = maps.edge.get(id) ?? [];
        edges.push({
          id,
          type: 'studio',
          source: node.name,
          target: edge.target,
          selected:
            selection?.kind === 'edge' &&
            selection.from === node.name &&
            selection.index === index,
          deletable: false,
          data: {
            edge,
            from: node.name,
            index,
            diagnostics: edgeDiagnostics,
            dimmed: hasPath && !path.edges.has(id),
            highlighted,
            onSelect: () =>
              onSelect({
                kind: 'edge',
                from: node.name,
                to: edge.target,
                index,
              }),
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 15,
            height: 15,
            color: 'var(--studio-edge-arrow)',
          },
        });
      });
    }
    return edges;
  }, [graph, hasPath, maps.edge, onSelect, path.edges, selection]);

  const [nodes, setNodes, onNodesChange] = useNodesState<StudioGraphNode>(desiredNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<StudioGraphEdge>(desiredEdges);

  useEffect(() => {
    setNodes(desiredNodes);
  }, [desiredNodes, setNodes]);

  useEffect(() => {
    setEdges(desiredEdges);
  }, [desiredEdges, setEdges]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({
        padding: 0.18,
        duration: config.animations ? 420 : 0,
        maxZoom: 1.15,
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [config.animations, fitSignal, fitView, graph.key]);

  return (
    <ReactFlow<StudioGraphNode, StudioGraphEdge>
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_event, node) => onSelect({ kind: 'node', node: node.id })}
      onEdgeClick={(_event, edge) => {
        if (!edge.data) return;
        onSelect({
          kind: 'edge',
          from: edge.data.from,
          to: edge.data.edge.target,
          index: edge.data.index,
        });
      }}
      onPaneClick={() => onSelect(null)}
      onNodeDragStop={(_event, node) => {
        const next: LayoutMap = { ...positions };
        for (const current of nodes) next[current.id] = current.position;
        next[node.id] = node.position;
        onPositionsChange(next);
      }}
      onMoveEnd={(_event, viewport) => onZoomChange(viewport.zoom)}
      nodesDraggable={!readOnly}
      nodesConnectable={false}
      elementsSelectable
      deleteKeyCode={null}
      multiSelectionKeyCode={null}
      minZoom={0.12}
      maxZoom={2.4}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1.15 }}
      proOptions={{ hideAttribution: true }}
      colorMode={theme === 'light' ? 'light' : 'dark'}
      className={`studio-flow blueprint-${config.blueprintIntensity}`}
    >
      {config.showGrid ? (
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.15}
          color="var(--studio-grid-dot)"
        />
      ) : null}
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        nodeColor={(node) => {
          return node.id === graph.start
            ? 'var(--studio-accent)'
            : 'var(--studio-minimap-node)';
        }}
        maskColor="var(--studio-minimap-mask)"
        className="studio-minimap"
      />
      <Panel position="top-left" className="canvas-legend">
        <span>
          <i className="legend-node" /> node
        </span>
        <span>
          <i className="legend-edge" /> step path
        </span>
        <span>
          <i className="legend-edge condition" /> conditional
        </span>
        {readOnly ? <Badge tone="warning">Read-only</Badge> : null}
      </Panel>
      {graph.nodes.length === 0 ? (
        <Panel position="top-center" className="canvas-empty">
          <span className="canvas-empty-icon">
            <Sparkles size={22} aria-hidden />
          </span>
          <h2>This graph is a blank blueprint</h2>
          <p>Add the first node and start wiring construction steps.</p>
          <Button variant="primary" icon={Plus} onClick={() => onOpenDialog({ kind: 'addNode' })} disabled={readOnly}>
            Add first node
          </Button>
        </Panel>
      ) : null}
    </ReactFlow>
  );
}

export function GraphWorkspace({
  graph,
  positions,
  readOnly,
  config,
  theme,
  selection,
  inspectorOpen,
  fitSignal,
  children,
  onSelect,
  onPositionsChange,
  onZoomChange,
  onToggleInspector,
  onOpenDialog,
  onOpenSource,
  onOpenDashboard,
  onAutoLayout,
}: GraphWorkspaceProps) {
  const diagnostics = graph.diagnostics;
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;

  const totalSteps = graph.nodes.reduce(
    (sum, node) => sum + node.edges.reduce((edgeSum, edge) => edgeSum + edge.steps.length, 0),
    0,
  );

  return (
    <div className={`graph-workspace blueprint-${config.blueprintIntensity}`}>
      <header className="graph-toolbar">
        <div className="graph-toolbar-identity">
          <button
            type="button"
            className="graph-back"
            onClick={onOpenDashboard}
            title="Back to dashboard"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={16} aria-hidden />
          </button>
          <div className="graph-title-block">
            <button
              type="button"
              className="graph-eyebrow"
              onClick={() => onOpenSource()}
              title="Open the graph prototype in YAML"
            >
              {graph.relativePath}:{graph.line}
            </button>
            <div className="graph-title-row">
              <h1>{graph.id}</h1>
              {graph.start && graph.nodes.some((node) => node.name === graph.start) ? (
                <Badge tone="accent" className="start-badge">
                  <Flag size={10} aria-hidden />
                  {graph.start}
                </Badge>
              ) : (
                <Badge tone="danger">Missing start node</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="graph-toolbar-stats">
          <span title="Nodes">
            <Boxes size={12} aria-hidden />
            {graph.nodes.length}
          </span>
          <span title="Edges">
            <GitBranch size={12} aria-hidden />
            {graph.stats.edges}
          </span>
          <span title="Construction steps">
            <ListChecks size={12} aria-hidden />
            {totalSteps}
          </span>
          {errors > 0 ? (
            <span className="toolbar-health error">{errors} errors</span>
          ) : warnings > 0 ? (
            <span className="toolbar-health warning">{warnings} warnings</span>
          ) : (
            <span className="toolbar-health ok">clean</span>
          )}
        </div>

        <div className="graph-toolbar-actions">
          <Button
            variant="primary"
            size="sm"
            icon={Plus}
            disabled={readOnly}
            onClick={() => onOpenDialog({ kind: 'addNode' })}
          >
            Add node
          </Button>
          <Button variant="secondary" size="sm" icon={Wand2} onClick={onAutoLayout}>
            Layout
          </Button>
          <IconButton
            icon={FileDown}
            label="Export as Mermaid diagram"
            onClick={() => onOpenDialog({ kind: 'export' })}
          />
          <IconButton
            icon={FileCode2}
            label="Open graph YAML"
            onClick={() => onOpenSource()}
          />
          <IconButton
            icon={PanelRight}
            label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            active={inspectorOpen}
            onClick={onToggleInspector}
          />
        </div>
      </header>

      <div className="graph-stage">
        <div className="graph-canvas-column">
          <div className="graph-canvas">
            <ReactFlowProvider>
              <FlowCanvas
                graph={graph}
                positions={positions}
                readOnly={readOnly}
                config={config}
                theme={theme}
                selection={selection}
                fitSignal={fitSignal}
                onSelect={onSelect}
                onPositionsChange={onPositionsChange}
                onZoomChange={onZoomChange}
                onOpenDialog={onOpenDialog}
                onOpenSource={onOpenSource}
              />
            </ReactFlowProvider>
          </div>
          <ValidationTray
            diagnostics={diagnostics}
            selection={selection}
            onOpen={(diagnostic) => onOpenSource(diagnostic.line)}
          />
        </div>
        {children}
      </div>
    </div>
  );
}
