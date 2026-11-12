import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyGraphOperation,
  applyTextEdits,
  parseGraphFile,
  renderGraphTemplate,
  validateGraph,
  type ConstructionGraph,
  type GraphOperation,
} from '../src/index.js';

const web = readFileSync('test/fixtures/web.yml', 'utf8').replace(/^\uFEFF/, '');
const computer = readFileSync('test/fixtures/computer.yml', 'utf8').replace(/^\uFEFF/, '');

function parse(source: string, relativePath = 'Resources/Prototypes/Recipes/Construction/Graphs/web.yml') {
  return parseGraphFile(source, {
    filePath: `C:/repo/${relativePath}`,
    relativePath,
    fileKey: `file:///C:/repo/${relativePath}`,
  });
}

function op(source: string, graph: ConstructionGraph, operation: GraphOperation) {
  const result = applyGraphOperation(graph, operation);
  return applyTextEdits(source, result.edits);
}

describe('construction graph parser', () => {
  it('parses a real graph with implicit step types', () => {
    const result = parse(web);
    expect(result.diagnostics).toEqual([]);
    expect(result.graphs).toHaveLength(1);

    const graph = result.graphs[0]!;
    expect(graph.id).toBe('WebStructures');
    expect(graph.start).toBe('start');
    expect(graph.nodes).toHaveLength(7);
    expect(graph.stats.edges).toBe(12);
    expect(graph.diagnostics).toEqual([]);

    const start = graph.nodes.find((node) => node.name === 'start')!;
    expect(start.edges).toHaveLength(6);
    const wallEdge = start.edges.find((edge) => edge.target === 'wall')!;
    expect(wallEdge.steps).toHaveLength(1);
    expect(wallEdge.steps[0]!.kind).toBe('material');
    expect(wallEdge.steps[0]!.fields.material).toBe('WebSilk');
    expect(wallEdge.steps[0]!.fields.amount).toBe(4);
    expect(wallEdge.steps[0]!.doAfter).toBe(3);

    const wall = graph.nodes.find((node) => node.name === 'wall')!;
    expect(wall.entity).toBe('WallWeb');
    expect(wall.edges[0]!.steps[0]!.kind).toBe('tool');
    expect(wall.edges[0]!.steps[0]!.fields.tool).toBe('Cutting');
  });

  it('parses tagged actions, conditions and 4-space indentation', () => {
    const result = parse(
      computer,
      'Resources/Prototypes/Recipes/Construction/Graphs/machines/computer.yml',
    );
    const graph = result.graphs[0]!;
    expect(graph.id).toBe('Computer');
    expect(graph.nodes.length).toBeGreaterThan(4);

    const start = graph.nodes.find((node) => node.name === 'start')!;
    expect(start.edges[0]!.completed[0]!.type).toBe('SetAnchor');
    expect(start.edges[0]!.completed[0]!.fields.value).toBe(false);

    const frame = graph.nodes.find((node) => node.name === 'frameUnsecured')!;
    expect(frame.actions[0]!.type).toBe('AppearanceChange');
    expect(frame.edges[0]!.conditions[0]!.type).toBe('EntityAnchored');
    expect(frame.edges[0]!.steps[0]!.kind).toBe('component');
    expect(frame.edges[0]!.steps[0]!.fields.store).toBe('board');
  });

  it('collects materials and finds paths', () => {
    const graph = parse(web).graphs[0]!;
    expect(graph.stats.materials[0]!.material).toBe('WebSilk');
    expect(graph.stats.materials[0]!.amount).toBeGreaterThan(20);
    expect(graph.stats.maxDepth).toBeGreaterThan(0);
  });
});

describe('construction graph validation', () => {
  it('resolves shared YAML anchors for steps and edges', () => {
    const source = `- type: constructionGraph
  id: AliasGraph
  start: start
  graph:
    - node: start
      edges:
        - to: frame
          steps: &build
            - material: Steel
              amount: 2
        - to: frameAlt
          steps: *build
    - node: frame
      entity: Frame
      edges: &deconstruct
        - to: start
          steps:
            - tool: Prying
              doAfter: 1
    - node: frameAlt
      entity: FrameAlt
      edges: *deconstruct
`;
    const graph = parse(source).graphs[0]!;
    const start = graph.nodes.find((node) => node.name === 'start')!;
    const frameAlt = graph.nodes.find((node) => node.name === 'frameAlt')!;

    expect(start.edges[1]!.steps).toHaveLength(1);
    expect(start.edges[1]!.steps[0]!.fields.material).toBe('Steel');
    expect(frameAlt.edges).toHaveLength(1);
    expect(frameAlt.edges[0]!.steps[0]!.fields.tool).toBe('Prying');
    expect(graph.diagnostics).toEqual([]);
  });

  it('accepts externally referenced alternate entry nodes', () => {
    const source = `- type: constructionGraph
  id: EntryGraph
  start: start
  graph:
    - node: start
      edges:
        - to: closed
          steps:
            - material: Steel
              amount: 1
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
`;
    const graph = parse(source).graphs[0]!;
    expect(graph.diagnostics.some((diagnostic) => diagnostic.code === 'node.unreachable')).toBe(true);

    const diagnostics = validateGraph(graph, { entryNodes: ['open'] });
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'node.unreachable')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'node.isolated')).toBe(false);
  });

  it('allows multiple differently-built edges to the same target', () => {
    const source = `- type: constructionGraph
  id: BranchGraph
  start: start
  graph:
    - node: start
      edges:
        - to: target
          steps:
            - material: Steel
              amount: 1
        - to: target
          steps:
            - material: Glass
              amount: 1
    - node: target
      edges:
        - to: start
          steps:
            - tool: Prying
`;
    const graph = parse(source).graphs[0]!;
    expect(graph.diagnostics.some((diagnostic) => diagnostic.code === 'edge.duplicate')).toBe(false);
  });

  it('reports in-place edges as info instead of warnings', () => {
    const source = `- type: constructionGraph
  id: SelfGraph
  start: start
  graph:
    - node: start
      edges:
        - to: start
          steps:
            - tool: Screwing
`;
    const graph = parse(source).graphs[0]!;
    const self = graph.diagnostics.find((diagnostic) => diagnostic.code === 'edge.self');
    expect(self?.severity).toBe('info');
    expect(graph.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info')).toEqual([]);
  });
});

describe('construction graph editor', () => {
  it('renames a node and every edge that points at it', () => {
    const graph = parse(web).graphs[0]!;
    const updated = op(web, graph, { kind: 'renameNode', node: 'wall', newName: 'webWall' });
    const reparsed = parse(updated).graphs[0]!;

    expect(reparsed.nodes.some((node) => node.name === 'webWall')).toBe(true);
    expect(reparsed.nodes.some((node) => node.name === 'wall')).toBe(false);
    for (const node of reparsed.nodes) {
      expect(node.edges.some((edge) => edge.target === 'wall')).toBe(false);
    }
  });

  it('renames the start node and updates the graph start pointer', () => {
    const graph = parse(web).graphs[0]!;
    const updated = op(web, graph, { kind: 'renameNode', node: 'start', newName: 'origin' });
    const reparsed = parse(updated).graphs[0]!;
    expect(reparsed.start).toBe('origin');
    expect(reparsed.nodes.some((node) => node.name === 'origin')).toBe(true);
  });

  it('adds a node and an edge in the file style', () => {
    let graph = parse(web).graphs[0]!;
    let updated = op(web, graph, { kind: 'addNode', name: 'ladder', entity: 'LadderSteel' });
    graph = parse(updated).graphs[0]!;
    expect(graph.nodes.some((node) => node.name === 'ladder')).toBe(true);

    updated = op(updated, graph, {
      kind: 'addEdge',
      from: 'start',
      to: 'ladder',
      steps: [{ kind: 'material', fields: { material: 'Steel', amount: 2, doAfter: 1 } }],
    });
    graph = parse(updated).graphs[0]!;
    const start = graph.nodes.find((node) => node.name === 'start')!;
    const edge = start.edges.find((candidate) => candidate.target === 'ladder')!;
    expect(edge.steps[0]!.kind).toBe('material');
    expect(edge.steps[0]!.fields.amount).toBe(2);
  });

  it('inserts nodes with the indentation already used by the file', () => {
    const graph = parse(
      computer,
      'Resources/Prototypes/Recipes/Construction/Graphs/machines/computer.yml',
    ).graphs[0]!;
    const updated = op(computer, graph, { kind: 'addNode', name: 'testNode' });
    expect(updated).toContain('\n    - node: testNode');
    expect(parse(updated, 'Resources/Prototypes/Recipes/Construction/Graphs/machines/computer.yml').graphs).toHaveLength(1);
  });

  it('sets and removes a node entity', () => {
    let graph = parse(web).graphs[0]!;
    let updated = op(web, graph, { kind: 'setNodeEntity', node: 'start', entity: 'SheetSteel1' });
    graph = parse(updated).graphs[0]!;
    expect(graph.nodes.find((node) => node.name === 'start')!.entity).toBe('SheetSteel1');

    updated = op(updated, graph, { kind: 'setNodeEntity', node: 'start', entity: null });
    graph = parse(updated).graphs[0]!;
    expect(graph.nodes.find((node) => node.name === 'start')!.entity).toBeNull();
  });

  it('adds and removes a step', () => {
    let graph = parse(web).graphs[0]!;
    let updated = op(web, graph, {
      kind: 'addStep',
      from: 'start',
      to: 'wall',
      edgeIndex: 0,
      step: { kind: 'tool', fields: { tool: 'Screwing', doAfter: 1 } },
    });
    graph = parse(updated).graphs[0]!;
    let edge = graph.nodes.find((node) => node.name === 'start')!.edges[0]!;
    expect(edge.steps).toHaveLength(2);
    expect(edge.steps[1]!.kind).toBe('tool');

    updated = op(updated, graph, {
      kind: 'setStepField',
      from: 'start',
      to: 'wall',
      edgeIndex: 0,
      stepIndex: 0,
      field: 'amount',
      value: 6,
    });
    graph = parse(updated).graphs[0]!;
    edge = graph.nodes.find((node) => node.name === 'start')!.edges[0]!;
    expect(edge.steps[0]!.fields.amount).toBe(6);

    updated = op(updated, graph, {
      kind: 'removeStep',
      from: 'start',
      to: 'wall',
      edgeIndex: 0,
      stepIndex: 1,
    });
    graph = parse(updated).graphs[0]!;
    edge = graph.nodes.find((node) => node.name === 'start')!.edges[0]!;
    expect(edge.steps).toHaveLength(1);
  });

  it('adds and removes tagged actions', () => {
    let graph = parse(web).graphs[0]!;
    let updated = op(web, graph, {
      kind: 'addTaggedEntry',
      scope: 'nodeActions',
      node: 'start',
      entryType: 'AppearanceChange',
      fields: {},
    });
    graph = parse(updated).graphs[0]!;
    expect(graph.nodes.find((node) => node.name === 'start')!.actions.at(-1)!.type).toBe(
      'AppearanceChange',
    );

    updated = op(updated, graph, {
      kind: 'removeTaggedEntry',
      scope: 'nodeActions',
      node: 'start',
      entryIndex: 1,
    });
    graph = parse(updated).graphs[0]!;
    expect(graph.nodes.find((node) => node.name === 'start')!.actions).toHaveLength(1);
  });

  it('deletes an edge and the incoming edges of a deleted node', () => {
    let graph = parse(web).graphs[0]!;
    let updated = op(web, graph, {
      kind: 'deleteEdge',
      from: 'start',
      to: 'bed',
      edgeIndex: 2,
    });
    graph = parse(updated).graphs[0]!;
    expect(graph.nodes.find((node) => node.name === 'start')!.edges).toHaveLength(5);

    updated = op(updated, graph, { kind: 'deleteNode', node: 'wall' });
    graph = parse(updated).graphs[0]!;
    expect(graph.nodes.some((node) => node.name === 'wall')).toBe(false);
    for (const node of graph.nodes) {
      expect(node.edges.some((edge) => edge.target === 'wall')).toBe(false);
    }
  });

  it('renders a valid new graph file', () => {
    const source = renderGraphTemplate({ id: 'MyGraph', start: 'start', entity: 'SheetSteel1' });
    const result = parse(source, 'Resources/Prototypes/Recipes/Construction/Graphs/my_graph.yml');
    expect(result.diagnostics).toEqual([]);
    expect(result.graphs[0]!.id).toBe('MyGraph');
    expect(result.graphs[0]!.nodes).toHaveLength(1);
    expect(result.graphs[0]!.nodes[0]!.entity).toBe('SheetSteel1');
  });
});
