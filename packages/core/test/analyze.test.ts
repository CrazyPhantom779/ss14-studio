import { describe, expect, it } from 'vitest';
import {
  collectMaterials,
  computeGraphStats,
  findNode,
  findPath,
  getIncoming,
  getOutgoing,
  graphDepth,
  parseGraphFile,
  reachableNodes,
  summarizeStep,
} from '../src/index.js';

function graphFrom(source: string) {
  const parsed = parseGraphFile(source, {
    filePath: '/repo/Resources/Prototypes/Recipes/Construction/Graphs/test.yml',
    relativePath: 'Resources/Prototypes/Recipes/Construction/Graphs/test.yml',
    fileKey: 'test.yml',
  });
  expect(parsed.diagnostics).toEqual([]);
  return parsed.graphs[0]!;
}

const source = `- type: constructionGraph
  id: AnalysisGraph
  start: start
  graph:
  - node: start
    actions:
    - !type:DestroyEntity {}
    edges:
    - to: frame
      conditions:
      - !type:EntityAnchored {}
      steps:
      - material: Steel
        amount: 2
      - tool: Screwing
        doAfter: 1.5
    - to: frame
      steps:
      - material: Steel
        amount: 3
  - node: frame
    entity: Frame
    actions:
    - !type:AppearanceChange {}
    edges:
    - to: done
      completed:
      - !type:SnapToGrid {}
      steps:
      - material: Glass
        amount: 1
        completed:
        - !type:PlaySound {}
  - node: done
    entity: Finished
  - node: island
    entity: Island
`;

describe('graph analysis', () => {
  it('finds outgoing edges, incoming edges and named nodes', () => {
    const graph = graphFrom(source);
    expect(findNode(graph, 'frame')?.entity).toBe('Frame');
    expect(findNode(graph, 'missing')).toBeUndefined();
    expect(getOutgoing(graph, 'start')).toHaveLength(2);
    expect(getOutgoing(graph, 'missing')).toEqual([]);

    const incoming = getIncoming(graph, 'frame');
    expect(incoming).toHaveLength(2);
    expect(incoming.map((entry) => entry.from.name)).toEqual(['start', 'start']);
    expect(incoming.map((entry) => entry.index)).toEqual([0, 1]);
  });

  it('finds the shortest construction path with edge indexes', () => {
    const graph = graphFrom(source);
    const path = findPath(graph, 'done');
    expect(path).not.toBeNull();
    expect(path!.nodes).toEqual(['start', 'frame', 'done']);
    expect(path!.edges).toEqual([
      { from: 'start', to: 'frame', edgeIndex: 0 },
      { from: 'frame', to: 'done', edgeIndex: 0 },
    ]);
    expect(findPath(graph, 'start')).toEqual({ nodes: ['start'], edges: [] });
    expect(findPath(graph, 'island')).toBeNull();
  });

  it('walks reachability from the start and extra entry nodes', () => {
    const graph = graphFrom(source);
    expect([...reachableNodes(graph)].sort()).toEqual(['done', 'frame', 'start']);
    expect([...reachableNodes(graph, ['island'])].sort()).toEqual([
      'done',
      'frame',
      'island',
      'start',
    ]);
    expect([...reachableNodes(graph, ['not-a-node'])]).not.toContain('not-a-node');
  });

  it('computes depth without hanging on cycles', () => {
    const graph = graphFrom(`- type: constructionGraph
  id: CycleGraph
  start: start
  graph:
  - node: start
    edges:
    - to: middle
      steps:
      - material: Steel
  - node: middle
    edges:
    - to: start
      steps:
      - tool: Prying
`);
    expect(graphDepth(graph)).toBe(2);
  });

  it('aggregates materials across every edge', () => {
    const graph = graphFrom(source);
    expect(collectMaterials(graph)).toEqual([
      { material: 'Steel', amount: 5, edges: 2 },
      { material: 'Glass', amount: 1, edges: 1 },
    ]);
  });

  it('computes graph statistics including nested completion actions', () => {
    const graph = graphFrom(source);
    const stats = computeGraphStats(graph);
    expect(stats.nodes).toBe(4);
    expect(stats.edges).toBe(3);
    expect(stats.steps).toBe(4);
    expect(stats.actions).toBe(4);
    expect(stats.conditions).toBe(1);
    expect(stats.totalDoAfter).toBe(1.5);
    expect(stats.maxDepth).toBe(2);
    expect(stats.materials[0]).toEqual({ material: 'Steel', amount: 5, edges: 2 });
  });

  it('summarizes every common construction step', () => {
    expect(summarizeStep({ kind: 'material', fields: { material: 'Steel', amount: 3 } })).toContain(
      '3',
    );
    expect(summarizeStep({ kind: 'material', fields: { material: 'Steel', amount: 3 } })).toContain(
      'Steel',
    );
    expect(summarizeStep({ kind: 'tool', fields: { tool: 'Wrench' } })).toBe('Wrench');
    expect(summarizeStep({ kind: 'tag', fields: { tag: 'Wirecutter' } })).toBe('tag: Wirecutter');
    expect(
      summarizeStep({ kind: 'multipleTags', fields: { allTags: ['A', 'B'], anyTags: ['C'] } }),
    ).toBe('all: A, B');
    expect(summarizeStep({ kind: 'component', fields: { component: 'Anchorable' } })).toBe(
      'component: Anchorable',
    );
    expect(summarizeStep({ kind: 'partAssembly', fields: { assemblyId: 'Clockwork' } })).toBe(
      'assemble: Clockwork',
    );
    expect(summarizeStep({ kind: 'custom', fields: {} })).toBe('custom step');
  });
});
