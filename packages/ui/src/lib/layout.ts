import dagre from '@dagrejs/dagre';
import type { ConstructionGraph, LayoutMap } from '@ss14-studio/core';

export const NODE_WIDTH = 272;
export const NODE_HEIGHT = 132;

export function autoLayout(graph: ConstructionGraph): LayoutMap {
  const layout = new dagre.graphlib.Graph({ multigraph: true });
  layout.setGraph({
    rankdir: 'LR',
    nodesep: 44,
    ranksep: 118,
    marginx: 56,
    marginy: 56,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
  });
  layout.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    layout.setNode(node.name, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const node of graph.nodes) {
    node.edges.forEach((edge, index) => {
      if (edge.target === node.name) return;
      if (!layout.hasNode(edge.target)) return;
      layout.setEdge(
        node.name,
        edge.target,
        { width: 0, height: 0, weight: edge.conditions.length > 0 ? 1 : 2 },
        `${node.name}->${edge.target}#${index}`,
      );
    });
  }

  dagre.layout(layout);

  const positions: LayoutMap = {};
  for (const node of graph.nodes) {
    const placed = layout.node(node.name) as
      | { x: number; y: number; width: number; height: number }
      | undefined;
    positions[node.name] = placed
      ? {
          x: Math.round(placed.x - placed.width / 2),
          y: Math.round(placed.y - placed.height / 2),
        }
      : { x: 0, y: 0 };
  }
  return positions;
}

/**
 * Keep the layout the user already arranged, and place only nodes that are new
 * to the graph. Auto-layout computes a sensible slot for every node, so new
 * nodes inherit a slot without disturbing existing work.
 */
export function ensurePositions(
  graph: ConstructionGraph,
  existing: LayoutMap,
): LayoutMap {
  const missing = graph.nodes.filter((node) => !existing[node.name]);
  if (missing.length === 0) {
    const known = new Set(graph.nodes.map((node) => node.name));
    const cleaned: LayoutMap = {};
    for (const [name, position] of Object.entries(existing)) {
      if (known.has(name)) cleaned[name] = position;
    }
    return cleaned;
  }

  const auto = autoLayout(graph);
  const next: LayoutMap = {};
  for (const node of graph.nodes) {
    next[node.name] = existing[node.name] ?? auto[node.name] ?? { x: 0, y: 0 };
  }
  return next;
}

export function centerOf(position: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return {
    x: position.x + NODE_WIDTH / 2,
    y: position.y + NODE_HEIGHT / 2,
  };
}
