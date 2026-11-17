import { describe, expect, it } from 'vitest';
import {
  ATLAS_NODE_HEIGHT,
  ATLAS_NODE_WIDTH,
  atlasFolder,
  buildGraphAtlas,
  parseGraphFile,
  type ConstructionGraph,
} from '../src/index.js';

const wallSource = `- type: constructionGraph
  id: WallWeb
  start: start
  graph:
  - node: start
    edges:
    - to: wall
      steps:
      - material: WebSilk
        amount: 4
  - node: wall
    entity: WallWeb
`;

const tableSource = `- type: constructionGraph
  id: Table
  start: start
  graph:
  - node: start
    edges:
    - to: table
      steps:
      - material: Steel
        amount: 2
  - node: table
    entity: Table
`;

function parse(source: string, relativePath: string): ConstructionGraph {
  return parseGraphFile(source, {
    filePath: `C:/repo/${relativePath}`,
    relativePath,
    fileKey: `file:///C:/repo/${relativePath}`,
  }).graphs[0]!;
}

describe('construction graph atlas', () => {
  it('clusters graphs by prototype folder', () => {
    expect(
      atlasFolder('Resources/Prototypes/Recipes/Construction/Graphs/structures/walls.yml'),
    ).toBe('Recipes/Construction/Graphs/structures');
    expect(atlasFolder('Resources/Prototypes/Entities/Objects.yml')).toBe('Entities');
    expect(atlasFolder('Resources/Prototypes/root.yml')).toBe('Prototypes');
  });

  it('lays out every node and links recipes to target graphs', () => {
    const wall = parse(
      wallSource,
      'Resources/Prototypes/Recipes/Construction/Graphs/structures/walls.yml',
    );
    const table = parse(
      tableSource,
      'Resources/Prototypes/Recipes/Construction/Graphs/furniture/tables.yml',
    );
    wall.nodes.find((node) => node.name === 'wall')!.iconEntities = ['WallWeb'];

    const atlas = buildGraphAtlas([wall, table], {
      constructionLinks: [
        { graphId: 'WallWeb', targetNode: 'wall', entity: 'Table' },
      ],
    });

    expect(atlas.stats).toMatchObject({
      graphs: 2,
      nodes: 4,
      edges: 3,
      crossGraphEdges: 1,
      clusters: 2,
    });
    expect(atlas.clusters.map((cluster) => cluster.folder)).toEqual([
      'Recipes/Construction/Graphs/furniture',
      'Recipes/Construction/Graphs/structures',
    ]);
    expect(atlas.clusters.map((cluster) => cluster.graphs)).toEqual([1, 1]);

    const positions = new Set(atlas.nodes.map((node) => `${node.x},${node.y}`));
    expect(positions.size).toBe(atlas.nodes.length);
    for (const node of atlas.nodes) {
      expect(node.width).toBe(ATLAS_NODE_WIDTH);
      expect(node.height).toBe(ATLAS_NODE_HEIGHT);
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }

    const construction = atlas.edges.find((edge) => edge.kind === 'construction')!;
    expect(construction.source).toBe(`${wall.key}::wall`);
    expect(construction.target).toBe(`${table.key}::start`);
    expect(construction.label).toBe('builds');
    expect(
      atlas.nodes.find((node) => node.id === construction.source)?.iconEntities,
    ).toEqual(['WallWeb']);
  });

  it('keeps graphs without a start node usable', () => {
    const wall = parse(
      wallSource,
      'Resources/Prototypes/Recipes/Construction/Graphs/structures/walls.yml',
    );
    wall.start = 'missing';
    const atlas = buildGraphAtlas([wall]);
    expect(atlas.nodes).toHaveLength(2);
    expect(atlas.edges).toHaveLength(1);
    expect(atlas.stats.clusters).toBe(1);
  });
});
