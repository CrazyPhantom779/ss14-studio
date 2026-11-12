import type {
  ConstructionEdge,
  ConstructionGraph,
  ConstructionNode,
  ConstructionStep,
  Diagnostic,
  MaterialUse,
} from '@ss14-studio/core';

export function edgeId(from: string, index: number): string {
  return `${from}::${index}`;
}

export interface DiagnosticMaps {
  node: Map<string, Diagnostic[]>;
  edge: Map<string, Diagnostic[]>;
  graph: Diagnostic[];
}

export function diagnosticMaps(graph: ConstructionGraph): DiagnosticMaps {
  const node = new Map<string, Diagnostic[]>();
  const edge = new Map<string, Diagnostic[]>();
  const graphLevel: Diagnostic[] = [];

  for (const diagnostic of graph.diagnostics) {
    if (diagnostic.edge) {
      const key = edgeId(diagnostic.edge.from, diagnostic.edge.index);
      const list = edge.get(key) ?? [];
      list.push(diagnostic);
      edge.set(key, list);
      continue;
    }
    if (diagnostic.node) {
      const list = node.get(diagnostic.node) ?? [];
      list.push(diagnostic);
      node.set(diagnostic.node, list);
      continue;
    }
    graphLevel.push(diagnostic);
  }

  return { node, edge, graph: graphLevel };
}

export function highestSeverity(diagnostics: Diagnostic[] | undefined): Diagnostic['severity'] | null {
  if (!diagnostics || diagnostics.length === 0) return null;
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'error';
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) return 'warning';
  return 'info';
}

export function outgoingMaterials(node: ConstructionNode): MaterialUse[] {
  const map = new Map<string, MaterialUse>();
  for (const edge of node.edges) {
    for (const step of edge.steps) {
      if (step.kind !== 'material') continue;
      const material = String(step.fields.material ?? 'Unknown');
      const amount =
        typeof step.fields.amount === 'number'
          ? step.fields.amount
          : Number(step.fields.amount ?? 1) || 1;
      const existing = map.get(material);
      if (existing) {
        existing.amount += amount;
        existing.edges++;
      } else {
        map.set(material, { material, amount, edges: 1 });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export function outgoingStepKinds(node: ConstructionNode): Map<string, number> {
  const kinds = new Map<string, number>();
  for (const edge of node.edges) {
    for (const step of edge.steps) {
      const key = step.kind;
      kinds.set(key, (kinds.get(key) ?? 0) + 1);
    }
  }
  return kinds;
}

export function totalSteps(edges: ConstructionEdge[]): number {
  return edges.reduce((sum, edge) => sum + edge.steps.length, 0);
}

export function stepDuration(step: ConstructionStep): number {
  return step.doAfter ?? 0;
}

export function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0s';
  if (value < 1) return `${Math.round(value * 1000)}ms`;
  return `${Math.round(value * 10) / 10}s`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

const PALETTE = [
  { hue: 188, name: 'cyan' },
  { hue: 38, name: 'amber' },
  { hue: 262, name: 'violet' },
  { hue: 158, name: 'emerald' },
  { hue: 342, name: 'rose' },
  { hue: 212, name: 'blue' },
  { hue: 24, name: 'orange' },
  { hue: 174, name: 'teal' },
];

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function nodeAccent(seed: string, isStart = false): {
  hue: number;
  color: string;
  soft: string;
  gradient: string;
} {
  const palette = isStart
    ? PALETTE[0]!
    : PALETTE[hashString(seed) % PALETTE.length]!;
  return {
    hue: palette.hue,
    color: `hsl(${palette.hue} 82% 62%)`,
    soft: `hsl(${palette.hue} 82% 62% / 0.14)`,
    gradient: `linear-gradient(135deg, hsl(${palette.hue} 85% 58%) 0%, hsl(${
      (palette.hue + 36) % 360
    } 88% 46%) 100%)`,
  };
}

export function initialsFor(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  if (!cleaned) return '?';
  const words = cleaned.split(/\s+/);
  if (words.length >= 2) {
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
  }
  const word = words[0]!;
  return (word[0]! + (word[1] ?? word[word.length - 1] ?? '')).toUpperCase();
}

export function diagnosticCount(
  diagnostics: Diagnostic[],
  severity?: Diagnostic['severity'],
): number {
  return diagnostics.filter(
    (diagnostic) => severity == null || diagnostic.severity === severity,
  ).length;
}

export function edgeSummary(edge: ConstructionEdge): string {
  if (edge.steps.length === 0) return 'No steps';
  return edge.steps
    .slice(0, 2)
    .map((step) => summarize(step))
    .join(' · ');
}

function summarize(step: ConstructionStep): string {
  switch (step.kind) {
    case 'material':
      return `${step.fields.amount ?? 1}× ${step.fields.material ?? 'material'}`;
    case 'tool':
      return `${step.fields.tool ?? 'tool'}`;
    case 'tag':
      return `tag ${step.fields.tag ?? '?'}`;
    case 'component':
      return `component ${step.fields.component ?? '?'}`;
    case 'temperature': {
      const min = step.fields.minTemperature;
      const max = step.fields.maxTemperature;
      if (min != null && max != null) return `${min}–${max} K`;
      if (min != null) return `≥ ${min} K`;
      if (max != null) return `≤ ${max} K`;
      return 'temperature';
    }
    case 'partAssembly':
      return `assemble ${step.fields.assemblyId ?? '?'}`;
    case 'multipleTags':
      return 'multiple tags';
    default:
      return 'custom step';
  }
}

export function mermaidFor(graph: ConstructionGraph): string {
  const lines = ['flowchart LR', `  %% ${graph.id}`];
  const ids = new Map<string, string>();
  graph.nodes.forEach((node, index) => {
    const id = `n${index}`;
    ids.set(node.name, id);
    const label = node.entity ? `${node.name}<br/><small>${node.entity}</small>` : node.name;
    lines.push(`  ${id}["${label.replaceAll('"', '&quot;')}"]`);
  });
  for (const node of graph.nodes) {
    node.edges.forEach((edge, index) => {
      const from = ids.get(node.name);
      const to = ids.get(edge.target);
      if (!from || !to) return;
      const label = edgeSummary(edge).replaceAll('"', '&quot;');
      lines.push(`  ${from} -->|"${index + 1}. ${label}"| ${to}`);
    });
  }
  return lines.join('\n');
}

export function pathFor(
  graph: ConstructionGraph | null,
  selectedNode: string | null,
  selectedEdge: { from: string; to: string; index: number } | null,
): {
  nodes: Set<string>;
  edges: Set<string>;
} {
  if (!graph) return { nodes: new Set(), edges: new Set() };
  const target = selectedNode ?? selectedEdge?.to ?? null;
  if (!target) return { nodes: new Set(), edges: new Set() };

  // Avoid a core import here so the UI bundle stays small by default.
  const queue = [graph.start];
  const visited = new Set<string>([graph.start]);
  const cameFrom = new Map<string, { from: string; index: number }>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = graph.nodes.find((candidate) => candidate.name === current);
    if (!node) continue;
    node.edges.forEach((edge, index) => {
      if (visited.has(edge.target)) return;
      visited.add(edge.target);
      cameFrom.set(edge.target, { from: current, index });
      queue.push(edge.target);
    });
  }

  const nodes = new Set<string>();
  const edges = new Set<string>();
  let cursor = target;
  nodes.add(cursor);
  while (cursor !== graph.start) {
    const previous = cameFrom.get(cursor);
    if (!previous) return { nodes: new Set(), edges: new Set() };
    nodes.add(previous.from);
    edges.add(edgeId(previous.from, previous.index));
    cursor = previous.from;
  }
  return { nodes, edges };
}
