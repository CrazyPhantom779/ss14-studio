import type {
  ConstructionEdge,
  ConstructionGraph,
  ConstructionNode,
  GraphStats,
  MaterialUse,
} from './model.js';

export function getOutgoing(graph: ConstructionGraph, node: string): ConstructionEdge[] {
  return graph.nodes.find((candidate) => candidate.name === node)?.edges ?? [];
}

export function getIncoming(
  graph: ConstructionGraph,
  node: string,
): { from: ConstructionNode; edge: ConstructionEdge; index: number }[] {
  const incoming: { from: ConstructionNode; edge: ConstructionEdge; index: number }[] = [];
  for (const from of graph.nodes) {
    from.edges.forEach((edge, index) => {
      if (edge.target === node) incoming.push({ from, edge, index });
    });
  }
  return incoming;
}

export function findNode(
  graph: ConstructionGraph,
  name: string,
): ConstructionNode | undefined {
  return graph.nodes.find((node) => node.name === name);
}

/** Breadth-first path from the graph start to a node, inclusive. */
export function findPath(
  graph: ConstructionGraph,
  target: string,
): { nodes: string[]; edges: { from: string; to: string; edgeIndex: number }[] } | null {
  if (target === graph.start) return { nodes: [graph.start], edges: [] };
  const queue: string[] = [graph.start];
  const visited = new Set<string>([graph.start]);
  const cameFrom = new Map<string, { from: string; edgeIndex: number }>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = findNode(graph, current);
    if (!node) continue;
    for (let index = 0; index < node.edges.length; index++) {
      const edge = node.edges[index]!;
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);
      cameFrom.set(edge.target, { from: current, edgeIndex: index });
      if (edge.target === target) {
        const nodes: string[] = [target];
        const edges: { from: string; to: string; edgeIndex: number }[] = [];
        let cursor = target;
        while (cursor !== graph.start) {
          const previous = cameFrom.get(cursor);
          if (!previous) return null;
          edges.unshift({
            from: previous.from,
            to: cursor,
            edgeIndex: previous.edgeIndex,
          });
          nodes.unshift(previous.from);
          cursor = previous.from;
        }
        return { nodes, edges };
      }
      queue.push(edge.target);
    }
  }
  return null;
}

export function reachableNodes(
  graph: ConstructionGraph,
  extraStarts: Iterable<string> = [],
): Set<string> {
  const known = new Set(graph.nodes.map((node) => node.name));
  const reachable = new Set<string>();
  const queue = [graph.start];
  for (const name of extraStarts) {
    if (known.has(name)) queue.push(name);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of getOutgoing(graph, current)) {
      if (!reachable.has(edge.target)) queue.push(edge.target);
    }
  }
  return reachable;
}

/**
 * Longest simple-ish depth from the start. Back edges are ignored once a node
 * has been seen so cycles do not hang the calculation.
 */
export function graphDepth(graph: ConstructionGraph): number {
  const longest = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (name: string): number => {
    if (longest.has(name)) return longest.get(name)!;
    if (visiting.has(name)) return 0;
    visiting.add(name);
    let depth = 0;
    for (const edge of getOutgoing(graph, name)) {
      depth = Math.max(depth, 1 + visit(edge.target));
    }
    visiting.delete(name);
    longest.set(name, depth);
    return depth;
  };

  return visit(graph.start);
}

export function collectMaterials(graph: ConstructionGraph): MaterialUse[] {
  const materials = new Map<string, MaterialUse>();
  for (const node of graph.nodes) {
    for (const edge of node.edges) {
      for (const step of edge.steps) {
        if (step.kind !== 'material') continue;
        const material = String(step.fields.material ?? 'Unknown');
        const amount =
          typeof step.fields.amount === 'number'
            ? step.fields.amount
            : Number(step.fields.amount ?? 1) || 1;
        const existing = materials.get(material);
        if (existing) {
          existing.amount += amount;
          existing.edges++;
        } else {
          materials.set(material, { material, amount, edges: 1 });
        }
      }
    }
  }
  return [...materials.values()].sort((a, b) => b.amount - a.amount);
}

export function computeGraphStats(graph: ConstructionGraph): GraphStats {
  let edges = 0;
  let steps = 0;
  let actions = 0;
  let conditions = 0;
  let totalDoAfter = 0;

  for (const node of graph.nodes) {
    actions += node.actions.length;
    edges += node.edges.length;
    for (const edge of node.edges) {
      conditions += edge.conditions.length;
      actions += edge.completed.length;
      for (const step of edge.steps) {
        steps++;
        actions += step.completed.length;
        totalDoAfter += step.doAfter ?? 0;
      }
    }
  }

  return {
    nodes: graph.nodes.length,
    edges,
    steps,
    actions,
    conditions,
    materials: collectMaterials(graph),
    totalDoAfter: Math.round(totalDoAfter * 100) / 100,
    maxDepth: graphDepth(graph),
  };
}

export function summarizeStep(step: {
  kind: string;
  fields: Record<string, unknown>;
}): string {
  switch (step.kind) {
    case 'material':
      return `${step.fields.amount ?? 1}× ${step.fields.material ?? 'material'}`;
    case 'tool':
      return `${step.fields.tool ?? 'tool'}`;
    case 'tag':
      return `tag: ${step.fields.tag ?? '?'}`;
    case 'multipleTags': {
      const all = Array.isArray(step.fields.allTags) ? step.fields.allTags.join(', ') : '';
      const any = Array.isArray(step.fields.anyTags) ? step.fields.anyTags.join(', ') : '';
      return all ? `all: ${all}` : any ? `any: ${any}` : 'tags';
    }
    case 'component':
      return `component: ${step.fields.component ?? '?'}`;
    case 'temperature': {
      const min = step.fields.minTemperature;
      const max = step.fields.maxTemperature;
      if (min != null && max != null) return `${min}–${max} K`;
      if (min != null) return `≥ ${min} K`;
      if (max != null) return `≤ ${max} K`;
      return 'temperature';
    }
    case 'partAssembly':
      return `assemble: ${step.fields.assemblyId ?? '?'}`;
    default:
      return 'custom step';
  }
}
