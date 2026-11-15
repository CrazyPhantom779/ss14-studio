import { describe, expect, it } from 'vitest';
import {
  parseGraphFile,
  validateGraph,
  type ConstructionGraph,
} from '../src/index.js';

function parse(source: string) {
  return parseGraphFile(source, {
    filePath: '/repo/Resources/Prototypes/Recipes/Construction/Graphs/validate.yml',
    relativePath: 'Resources/Prototypes/Recipes/Construction/Graphs/validate.yml',
    fileKey: 'validate.yml',
  }).graphs[0]!;
}

function codes(graph: ConstructionGraph, options = {}) {
  return validateGraph(graph, options).map((diagnostic) => diagnostic.code);
}

describe('construction graph validation', () => {
  it('reports missing graph identity and empty graphs', () => {
    const graph = parse(`- type: constructionGraph
  id: Valid
  start: start
  graph:
  - node: start
`);
    const broken: ConstructionGraph = { ...graph, id: '', start: '', nodes: [] };
    const diagnostics = validateGraph(broken);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['graph.id.empty', 'graph.start.empty', 'graph.empty']),
    );
    expect(diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  it('reports duplicate nodes, missing starts and missing targets', () => {
    const graph = parse(`- type: constructionGraph
  id: Broken
  start: nowhere
  graph:
  - node: start
    edges:
    - to: missing
      steps:
      - material: Steel
  - node: start
    edges: []
`);
    expect(codes(graph)).toEqual(
      expect.arrayContaining(['node.duplicate', 'graph.start.missing', 'edge.target.missing']),
    );
    const duplicate = validateGraph(graph).find((diagnostic) => diagnostic.code === 'node.duplicate');
    expect(duplicate?.line).toBeGreaterThan(0);
    expect(duplicate?.span).toBeDefined();
  });

  it('distinguishes self edges, empty steps and unknown steps', () => {
    const graph = parse(`- type: constructionGraph
  id: EdgeIssues
  start: start
  graph:
  - node: start
    edges:
    - to: start
      steps:
      - mysteryField: value
    - to: empty
      steps: []
  - node: empty
    edges: []
`);
    const diagnostics = validateGraph(graph);
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'edge.self')?.severity).toBe('info');
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'edge.steps.empty')?.severity).toBe(
      'warning',
    );
    const unknown = diagnostics.find((diagnostic) => diagnostic.code === 'step.unknown');
    expect(unknown?.severity).toBe('warning');
    expect(unknown?.stepIndex).toBe(0);
    expect(unknown?.edge).toEqual({ from: 'start', to: 'start', index: 0 });
  });

  it('warns about duplicate edges and untyped tagged entries', () => {
    const graph = parse(`- type: constructionGraph
  id: Duplicates
  start: start
  graph:
  - node: start
    actions:
    - plainAction: true
    edges:
    - to: target
      steps:
      - material: Steel
    - to: target
      steps:
      - material: Steel
    - to: other
      conditions:
      - plainCondition: true
      steps:
      - material: Steel
  - node: target
    edges: []
  - node: other
    edges: []
`);
    const diagnostics = validateGraph(graph);
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'edge.duplicate')).toHaveLength(1);
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'action.untyped')).toHaveLength(1);
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'condition.untyped')).toHaveLength(
      1,
    );
  });

  it('reports isolated and unreachable nodes unless they are entry points', () => {
    const graph = parse(`- type: constructionGraph
  id: EntryPoints
  start: start
  graph:
  - node: start
    edges:
    - to: built
      steps:
      - material: Steel
  - node: built
    edges: []
  - node: external
    entity: External
    edges: []
  - node: island
    entity: Island
    edges: []
`);
    const withoutEntries = validateGraph(graph);
    expect(withoutEntries.some((diagnostic) => diagnostic.code === 'node.unreachable')).toBe(true);
    expect(withoutEntries.some((diagnostic) => diagnostic.code === 'node.isolated')).toBe(true);

    const withEntries = validateGraph(graph, { entryNodes: ['external'] });
    expect(
      withEntries.some(
        (diagnostic) => diagnostic.code === 'node.unreachable' && diagnostic.node === 'external',
      ),
    ).toBe(false);
    expect(
      withEntries.some(
        (diagnostic) => diagnostic.code === 'node.isolated' && diagnostic.node === 'external',
      ),
    ).toBe(false);
    expect(
      withEntries.some(
        (diagnostic) => diagnostic.code === 'node.unreachable' && diagnostic.node === 'island',
      ),
    ).toBe(true);
  });

  it('keeps graph diagnostics non-fatal for alternate entries referenced by prototypes', () => {
    const graph = parse(`- type: constructionGraph
  id: Alternate
  start: start
  graph:
  - node: start
    edges:
    - to: closed
      steps:
      - material: Steel
  - node: closed
    entity: Closed
    edges:
    - to: start
      steps:
      - tool: Prying
  - node: open
    entity: Open
    edges:
    - to: start
      steps:
      - tool: Prying
`);
    expect(codes(graph, { entryNodes: ['open'] })).not.toContain('node.unreachable');
  });
});
