/**
 * Workspace-wide construction atlas.
 *
 * The normal graph view renders one construction graph at a time. The atlas
 * arranges every graph in the repository into folder clusters so a developer
 * can see the whole construction economy at a glance, including links between
 * recipes and the graphs that build their target entity.
 */
import type {
  AtlasCluster,
  AtlasEdge,
  AtlasNode,
  ConstructionGraph,
  GraphAtlas,
} from './model.js';

export const ATLAS_NODE_WIDTH = 158;
export const ATLAS_NODE_HEIGHT = 48;
export const ATLAS_NODE_GAP_X = 28;
export const ATLAS_NODE_GAP_Y = 20;
export const ATLAS_GRAPH_PAD = 22;
export const ATLAS_GRAPH_GAP = 38;
export const ATLAS_CLUSTER_PAD = 26;
export const ATLAS_CLUSTER_HEADER = 34;
export const ATLAS_CLUSTER_GAP = 46;
export const ATLAS_MAX_ROW_WIDTH = 1900;
export const ATLAS_MAX_GRAPH_ROWS = 10;

export interface AtlasConstructionLink {
  /** Graph that contains the construction recipe's target node. */
  graphId: string;
  /** Exact graph key when graph ids are duplicated. */
  graphKey?: string;
  targetNode: string;
  /** Entity/prototype produced by the recipe. */
  entity: string;
}

export interface GraphAtlasOptions {
  /** Links from construction recipes to the graph that builds their entity. */
  constructionLinks?: readonly AtlasConstructionLink[];
}

interface GraphBox {
  graph: ConstructionGraph;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ClusterBox {
  id: string;
  label: string;
  folder: string;
  graphs: GraphBox[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Folder used for clustering, relative to `Resources/Prototypes`. */
export function atlasFolder(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prototypeIndex = normalized.toLowerCase().indexOf('resources/prototypes/');
  const relative =
    prototypeIndex >= 0
      ? normalized.slice(prototypeIndex + 'resources/prototypes/'.length)
      : normalized;
  const slash = relative.lastIndexOf('/');
  if (slash < 0) return 'Prototypes';
  const folder = relative.slice(0, slash);
  return folder || 'Prototypes';
}

function graphNodeId(graph: ConstructionGraph, name: string): string {
  return `${graph.key}::${name}`;
}

function depthMap(graph: ConstructionGraph): Map<string, number> {
  const depths = new Map<string, number>();
  const names = new Set(graph.nodes.map((node) => node.name));
  if (!graph.start || !names.has(graph.start)) {
    for (const node of graph.nodes) depths.set(node.name, 0);
    return depths;
  }
  depths.set(graph.start, 0);
  const queue = [graph.start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const depth = depths.get(current) ?? 0;
    const node = graph.nodes.find((candidate) => candidate.name === current);
    if (!node) continue;
    for (const edge of node.edges) {
      if (!names.has(edge.target)) continue;
      const next = depth + 1;
      const existing = depths.get(edge.target);
      // Breadth-first depth is enough for a readable atlas; don't relax cycles
      // forever. Longest-path ordering would push cyclic graphs to infinity.
      if (existing == null || next < existing) {
        depths.set(edge.target, next);
        queue.push(edge.target);
      }
    }
  }
  for (const node of graph.nodes) {
    if (!depths.has(node.name)) depths.set(node.name, 0);
  }
  return depths;
}

/**
 * Place a graph's nodes on a compact left-to-right grid.
 * Returns positions relative to the graph origin plus its size.
 */
function layoutGraph(graph: ConstructionGraph): {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
} {
  const depths = depthMap(graph);
  const columns: ConstructionGraph['nodes'][] = [];
  const byDepth = new Map<number, ConstructionGraph['nodes']>();
  for (const node of graph.nodes) {
    const depth = depths.get(node.name) ?? 0;
    const list = byDepth.get(depth) ?? [];
    list.push(node);
    byDepth.set(depth, list);
  }
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const nodes = (byDepth.get(depth) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (let index = 0; index < nodes.length; index += ATLAS_MAX_GRAPH_ROWS) {
      columns.push(nodes.slice(index, index + ATLAS_MAX_GRAPH_ROWS));
    }
  }
  if (columns.length === 0) columns.push([]);

  const positions = new Map<string, { x: number; y: number }>();
  let maxRows = 0;
  columns.forEach((nodes, column) => {
    maxRows = Math.max(maxRows, nodes.length);
    nodes.forEach((node, row) => {
      positions.set(node.name, {
        x: column * (ATLAS_NODE_WIDTH + ATLAS_NODE_GAP_X),
        y: row * (ATLAS_NODE_HEIGHT + ATLAS_NODE_GAP_Y),
      });
    });
  });
  return {
    positions,
    width: Math.max(
      ATLAS_NODE_WIDTH,
      columns.length * (ATLAS_NODE_WIDTH + ATLAS_NODE_GAP_X) - ATLAS_NODE_GAP_X,
    ),
    height: Math.max(
      ATLAS_NODE_HEIGHT,
      maxRows * (ATLAS_NODE_HEIGHT + ATLAS_NODE_GAP_Y) - ATLAS_NODE_GAP_Y,
    ),
  };
}

function clusterGraphs(graphs: ConstructionGraph[]): ClusterBox[] {
  const folders = new Map<string, ConstructionGraph[]>();
  for (const graph of graphs) {
    const folder = atlasFolder(graph.relativePath);
    const list = folders.get(folder) ?? [];
    list.push(graph);
    folders.set(folder, list);
  }

  const clusters: ClusterBox[] = [];
  for (const [folder, list] of [...folders.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const boxes: GraphBox[] = [];
    let cursorX = ATLAS_CLUSTER_PAD;
    let cursorY = ATLAS_CLUSTER_HEADER + ATLAS_CLUSTER_PAD;
    let rowHeight = 0;
    for (const graph of list.sort((a, b) => a.id.localeCompare(b.id))) {
      const layout = layoutGraph(graph);
      const boxWidth = layout.width + ATLAS_GRAPH_PAD * 2;
      const boxHeight = layout.height + ATLAS_GRAPH_PAD * 2;
      if (
        cursorX > ATLAS_CLUSTER_PAD &&
        cursorX + boxWidth > ATLAS_MAX_ROW_WIDTH
      ) {
        cursorX = ATLAS_CLUSTER_PAD;
        cursorY += rowHeight + ATLAS_GRAPH_GAP;
        rowHeight = 0;
      }
      boxes.push({
        graph,
        x: cursorX,
        y: cursorY,
        width: boxWidth,
        height: boxHeight,
      });
      cursorX += boxWidth + ATLAS_GRAPH_GAP;
      rowHeight = Math.max(rowHeight, boxHeight);
    }
    const width =
      Math.max(
        ATLAS_CLUSTER_PAD * 2 + ATLAS_NODE_WIDTH,
        ...boxes.map((box) => box.x + box.width + ATLAS_CLUSTER_PAD),
      );
    const height = Math.max(
      ATLAS_CLUSTER_HEADER + ATLAS_CLUSTER_PAD * 2 + ATLAS_NODE_HEIGHT,
      ...boxes.map((box) => box.y + box.height + ATLAS_CLUSTER_PAD),
    );
    clusters.push({
      id: folder.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase(),
      label: folder,
      folder,
      graphs: boxes,
      x: 0,
      y: 0,
      width,
      height,
    });
  }

  // Pack clusters into a wide page, preserving folder order.
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const cluster of clusters) {
    if (cursorX > 0 && cursorX + cluster.width > ATLAS_MAX_ROW_WIDTH + 500) {
      cursorX = 0;
      cursorY += rowHeight + ATLAS_CLUSTER_GAP;
      rowHeight = 0;
    }
    cluster.x = cursorX;
    cluster.y = cursorY;
    cursorX += cluster.width + ATLAS_CLUSTER_GAP;
    rowHeight = Math.max(rowHeight, cluster.height);
  }
  return clusters;
}

/** Build a complete, positioned atlas payload from enriched graphs. */
export function buildGraphAtlas(
  graphs: readonly ConstructionGraph[],
  options: GraphAtlasOptions = {},
): GraphAtlas {
  const clusters = clusterGraphs([...graphs]);
  const nodes: AtlasNode[] = [];
  const edges: AtlasEdge[] = [];
  const nodeIds = new Set<string>();
  const graphById = new Map<string, ConstructionGraph>();
  const graphByEntity = new Map<string, ConstructionGraph>();
  const graphByKey = new Map<string, ConstructionGraph>();

  for (const cluster of clusters) {
    for (const box of cluster.graphs) {
      const graph = box.graph;
      graphById.set(graph.id, graph);
      graphByKey.set(graph.key, graph);
      for (const node of graph.nodes) {
        if (node.entity && !graphByEntity.has(node.entity)) {
          graphByEntity.set(node.entity, graph);
        }
      }
      const layout = layoutGraph(graph);
      for (const node of graph.nodes) {
        const relative = layout.positions.get(node.name) ?? { x: 0, y: 0 };
        const id = graphNodeId(graph, node.name);
        nodeIds.add(id);
        nodes.push({
          id,
          graphKey: graph.key,
          graphId: graph.id,
          graphFolder: cluster.folder,
          name: node.name,
          entity: node.entity,
          iconEntities: node.iconEntities ?? [],
          x: cluster.x + box.x + ATLAS_GRAPH_PAD + relative.x,
          y: cluster.y + box.y + ATLAS_GRAPH_PAD + relative.y,
          width: ATLAS_NODE_WIDTH,
          height: ATLAS_NODE_HEIGHT,
          cluster: cluster.id,
          incoming: 0,
          outgoing: node.edges.length,
          isStart: node.name === graph.start,
        });
      }
      for (const node of graph.nodes) {
        node.edges.forEach((edge, index) => {
          const target = graphNodeId(graph, edge.target);
          if (!nodeIds.has(target)) return;
          const source = graphNodeId(graph, node.name);
          edges.push({
            id: `${graph.key}:${node.name}:${index}`,
            source,
            target,
            kind: 'step',
            label: edge.steps.length > 0
              ? edge.steps.map((step) => step.kind).join(' · ')
              : null,
          });
        });
      }
    }
  }

  // Add recipe → graph links after every node id is known.
  for (const link of options.constructionLinks ?? []) {
    const targetGraph =
      graphByEntity.get(link.entity) ?? graphById.get(link.entity);
    if (!targetGraph) continue;
    const targetGraphBox = clusters
      .flatMap((cluster) => cluster.graphs)
      .find((box) => box.graph === targetGraph);
    if (!targetGraphBox) continue;
    const start = targetGraph.start;
    if (!start) continue;
    const sourceGraph =
      (link.graphKey ? graphByKey.get(link.graphKey) : undefined) ??
      [...graphById.values()].find((graph) => graph.id === link.graphId);
    if (!sourceGraph || sourceGraph === targetGraph) continue;
    const source = graphNodeId(sourceGraph, link.targetNode);
    const target = graphNodeId(targetGraph, start);
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    edges.push({
      id: `construction:${link.graphId}:${link.targetNode}->${link.entity}`,
      source,
      target,
      kind: 'construction',
      label: 'builds',
    });
  }

  const incoming = new Map<string, number>();
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  for (const node of nodes) {
    node.incoming = incoming.get(node.id) ?? 0;
  }

  return {
    nodes,
    edges,
    clusters: clusters.map((cluster) => ({
      id: cluster.id,
      label: cluster.label,
      folder: cluster.folder,
      x: cluster.x,
      y: cluster.y,
      width: cluster.width,
      height: cluster.height,
      graphs: cluster.graphs.length,
      nodes: cluster.graphs.reduce(
        (sum, box) => sum + box.graph.nodes.length,
        0,
      ),
    })),
    stats: {
      graphs: graphs.length,
      nodes: nodes.length,
      edges: edges.length,
      crossGraphEdges: edges.filter((edge) => edge.kind === 'construction').length,
      clusters: clusters.length,
    },
  };
}
