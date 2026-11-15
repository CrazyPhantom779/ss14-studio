import { describe, expect, it } from 'vitest';
import {
  diagnosticCount,
  diagnosticMaps,
  edgeId,
  edgeSummary,
  formatSeconds,
  hashString,
  highestSeverity,
  initialsFor,
  mermaidFor,
  nodeAccent,
  outgoingMaterials,
  outgoingStepKinds,
  pathFor,
  stepDuration,
  totalSteps,
} from '../src/lib/graph.js';
import { parseGraphFile, type ConstructionGraph, type Diagnostic } from '@ss14-studio/core';

function graphFrom(source: string): ConstructionGraph {
  return parseGraphFile(source, {
    filePath: '/repo/Resources/Prototypes/Recipes/Construction/Graphs/ui.yml',
    relativePath: 'Resources/Prototypes/Recipes/Construction/Graphs/ui.yml',
    fileKey: 'ui.yml',
  }).graphs[0]!;
}

const source = `- type: constructionGraph
  id: UiGraph
  start: start
  graph:
  - node: start
    edges:
    - to: frame
      conditions:
      - !type:EntityAnchored {}
      steps:
      - material: Steel
        amount: 2
      - material: Steel
        amount: 3
      - tool: Screwing
        doAfter: 1.5
  - node: frame
    entity: Frame
    edges:
    - to: done
      steps:
      - material: Glass
        amount: 1
  - node: done
    entity: Done
`;

describe('graph UI helpers', () => {
  it('creates stable edge ids and groups diagnostics by target', () => {
    expect(edgeId('start', 2)).toBe('start::2');
    const graph = graphFrom(source);
    const diagnostics: Diagnostic[] = [
      { severity: 'error', code: 'graph.error', message: 'graph', line: 1 },
      { severity: 'warning', code: 'node.warning', message: 'node', line: 2, node: 'start' },
      {
        severity: 'info',
        code: 'edge.info',
        message: 'edge',
        line: 3,
        edge: { from: 'start', to: 'frame', index: 0 },
      },
    ];
    const maps = diagnosticMaps({ ...graph, diagnostics });
    expect(maps.graph.map((diagnostic) => diagnostic.code)).toEqual(['graph.error']);
    expect(maps.node.get('start')?.map((diagnostic) => diagnostic.code)).toEqual(['node.warning']);
    expect(maps.edge.get('start::0')?.map((diagnostic) => diagnostic.code)).toEqual(['edge.info']);
    expect(highestSeverity(undefined)).toBeNull();
    expect(highestSeverity([])).toBeNull();
    expect(highestSeverity(diagnostics)).toBe('error');
    expect(highestSeverity([diagnostics[1]!])).toBe('warning');
    expect(highestSeverity([diagnostics[2]!])).toBe('info');
    expect(diagnosticCount(diagnostics)).toBe(3);
    expect(diagnosticCount(diagnostics, 'error')).toBe(1);
  });

  it('aggregates outgoing materials and step kinds', () => {
    const graph = graphFrom(source);
    const start = graph.nodes.find((node) => node.name === 'start')!;
    expect(outgoingMaterials(start)).toEqual([{ material: 'Steel', amount: 5, edges: 2 }]);
    expect(outgoingStepKinds(start)).toEqual(
      new Map([
        ['material', 2],
        ['tool', 1],
      ]),
    );
    expect(totalSteps(start.edges)).toBe(3);
    expect(stepDuration(start.edges[0]!.steps[2]!)).toBe(1.5);
    expect(stepDuration(start.edges[0]!.steps[0]!)).toBe(0);
  });

  it('formats durations and initials for compact cards', () => {
    expect(formatSeconds(0)).toBe('0s');
    expect(formatSeconds(-2)).toBe('0s');
    expect(formatSeconds(Number.NaN)).toBe('0s');
    expect(formatSeconds(0.25)).toBe('250ms');
    expect(formatSeconds(1.24)).toBe('1.2s');
    expect(initialsFor('Wall Web')).toBe('WW');
    expect(initialsFor('Airlock')).toBe('AI');
    expect(initialsFor('X')).toBe('XX');
    expect(initialsFor('---')).toBe('?');
  });

  it('hashes strings deterministically and varies node accents', () => {
    expect(hashString('start')).toBe(hashString('start'));
    expect(hashString('start')).not.toBe(hashString('frame'));
    const start = nodeAccent('start', true);
    expect(start.hue).toBe(188);
    expect(start.color).toContain('hsl(188');
    expect(start.gradient).toContain('linear-gradient');
    const frame = nodeAccent('frame');
    expect(frame.hue).toBeGreaterThanOrEqual(0);
    expect(frame.hue).toBeLessThan(360);
    expect(nodeAccent('frame')).toEqual(frame);
  });

  it('summarizes edges and renders Mermaid source', () => {
    const graph = graphFrom(source);
    const start = graph.nodes.find((node) => node.name === 'start')!;
    expect(edgeSummary(start.edges[0]!)).toContain('Steel');
    expect(edgeSummary(start.edges[0]!)).not.toContain('Screwing');
    expect(edgeSummary(start.edges[0]!)).toContain('2');
    const mermaid = mermaidFor(graph);
    expect(mermaid.startsWith('flowchart LR')).toBe(true);
    expect(mermaid).toContain('n0["start"]');
    expect(mermaid).toContain('n1["frame<br/><small>Frame</small>"]');
    expect(mermaid).toContain('-->|"1.');
  });

  it('highlights the complete path to a node or edge target', () => {
    const graph = graphFrom(source);
    const selectedNode = pathFor(graph, 'done', null);
    expect([...selectedNode.nodes].sort()).toEqual(['done', 'frame', 'start']);
    expect([...selectedNode.edges].sort()).toEqual(['frame::0', 'start::0']);

    const selectedEdge = pathFor(graph, null, { from: 'frame', to: 'done', index: 0 });
    expect([...selectedEdge.nodes].sort()).toEqual(['done', 'frame', 'start']);
    expect(pathFor(null, 'done', null)).toEqual({ nodes: new Set(), edges: new Set() });
    expect(pathFor(graph, null, null)).toEqual({ nodes: new Set(), edges: new Set() });
    expect(pathFor(graph, 'missing', null)).toEqual({ nodes: new Set(), edges: new Set() });
  });
});
