import { describe, expect, it } from 'vitest';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  autoLayout,
  centerOf,
  ensurePositions,
} from '../src/lib/layout.js';
import { parseGraphFile, type ConstructionGraph } from '@ss14-studio/core';

function graphFrom(source: string): ConstructionGraph {
  return parseGraphFile(source, {
    filePath: '/repo/Resources/Prototypes/Recipes/Construction/Graphs/layout.yml',
    relativePath: 'Resources/Prototypes/Recipes/Construction/Graphs/layout.yml',
    fileKey: 'layout.yml',
  }).graphs[0]!;
}

const graph = graphFrom(`- type: constructionGraph
  id: LayoutGraph
  start: start
  graph:
  - node: start
    edges:
    - to: frame
      steps:
      - material: Steel
    - to: frame
      conditions:
      - !type:EntityAnchored {}
      steps:
      - material: Glass
  - node: frame
    edges:
    - to: done
      steps:
      - tool: Screwing
  - node: done
    edges:
    - to: start
      steps:
      - tool: Prying
`);

describe('graph layout', () => {
  it('places every node on a finite, distinct canvas position', () => {
    const positions = autoLayout(graph);
    expect(Object.keys(positions).sort()).toEqual(['done', 'frame', 'start']);
    for (const position of Object.values(positions)) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
    const serialized = new Set(Object.values(positions).map((position) => `${position.x}:${position.y}`));
    expect(serialized.size).toBe(3);
    expect(positions.start!.x).toBeLessThan(positions.frame!.x);
    expect(positions.frame!.x).toBeLessThan(positions.done!.x);
  });

  it('preserves existing positions and places only new nodes', () => {
    const existing = {
      start: { x: 10, y: 20 },
      stale: { x: 999, y: 999 },
    };
    const positions = ensurePositions(graph, existing);
    expect(positions.start).toEqual({ x: 10, y: 20 });
    expect(positions.stale).toBeUndefined();
    expect(positions.frame).toBeDefined();
    expect(positions.done).toBeDefined();
  });

  it('cleans stale positions when every node is already placed', () => {
    const existing = {
      start: { x: 0, y: 0 },
      frame: { x: 300, y: 0 },
      done: { x: 600, y: 0 },
      stale: { x: 900, y: 0 },
    };
    expect(ensurePositions(graph, existing)).toEqual({
      start: { x: 0, y: 0 },
      frame: { x: 300, y: 0 },
      done: { x: 600, y: 0 },
    });
  });

  it('calculates node centers from top-left positions', () => {
    expect(centerOf({ x: 0, y: 0 })).toEqual({ x: NODE_WIDTH / 2, y: NODE_HEIGHT / 2 });
    expect(centerOf({ x: 10, y: 20 })).toEqual({
      x: 10 + NODE_WIDTH / 2,
      y: 20 + NODE_HEIGHT / 2,
    });
  });
});
