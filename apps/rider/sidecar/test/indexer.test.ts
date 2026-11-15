import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProjectIndex, type IndexProgress, type StudioStatus } from '../src/indexer.js';

const fixture = fileURLToPath(new URL('../../fixtures/sample-project', import.meta.url));

let index: ProjectIndex | undefined;

afterEach(() => {
  index?.dispose();
  index = undefined;
});

describe('Rider project index', () => {
  it('indexes graphs, prototypes, locales and partial manifests', async () => {
    const progress: IndexProgress[] = [];
    const statuses: StudioStatus[] = [];
    let indexedGraphs = 0;
    let indexedPrototypes = 0;
    index = new ProjectIndex([fixture], {
      onProgress: (update) => progress.push(update),
      onStatus: (status) => statuses.push(status),
      onIndex: (payload) => {
        indexedGraphs = payload.project.totalGraphs;
      },
      onPrototypes: (payload) => {
        indexedPrototypes = payload.total;
      },
    });
    await index.refresh();

    const payload = index.getPayload();
    expect(payload.project.totalGraphs).toBe(1);
    expect(payload.project.totalNodes).toBe(2);
    expect(payload.project.totalEdges).toBe(2);
    expect(payload.project.errors).toBe(0);
    expect(payload.project.roots[0]?.name).toBe('sample-project');
    expect(payload.summaries[0]).toMatchObject({ id: 'Chair', nodes: 2, edges: 2 });
    expect(payload.knownTags.some((tag) => tag.type === 'EntityAnchored')).toBe(true);
    expect(indexedGraphs).toBe(1);

    const prototypes = index.getPrototypePayload();
    expect(prototypes.total).toBe(3);
    expect(prototypes.kinds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'entity', count: 2, abstract: 1 }),
        expect.objectContaining({ kind: 'constructionGraph', count: 1 }),
      ]),
    );
    expect(prototypes.localizationCount).toBe(4);
    expect(prototypes.partialFiles).toEqual(['Resources/Prototypes/_Test/Partials (0)']);
    expect(indexedPrototypes).toBe(3);

    expect(statuses.some((status) => status.indexing)).toBe(true);
    expect(statuses.some((status) => !status.indexing && status.graphs === 1)).toBe(true);
    expect(progress.some((update) => update.total >= 1)).toBe(true);
  });

  it('looks up graphs and maps source files', async () => {
    index = new ProjectIndex([fixture]);
    await index.refresh();
    const summary = index.getSummaries()[0]!;
    const graph = index.getGraph(summary.key);
    expect(graph?.id).toBe('Chair');
    expect(index.getGraph('missing')).toBeUndefined();
    expect(index.getGraphsForFile(graph!.filePath)).toEqual([summary.key]);
    expect(index.getGraphsForFile('/missing.yml')).toEqual([]);
    expect(index.getRootPaths()).toEqual([fixture]);
    expect(index.getRoots()).toEqual([{ name: 'sample-project', path: fixture }]);
    expect(index.relativePath(graph!.filePath)).toBe(
      'Resources/Prototypes/Recipes/Construction/Graphs/furniture/chair.yml',
    );
  });

  it('resolves prototype views, partials, localization and sprites', async () => {
    index = new ProjectIndex([fixture]);
    await index.refresh();
    const view = index.getPrototypeView('ChairWood');
    expect(view).not.toBeNull();
    expect(view!.summary.name).toBe('partial wooden chair');
    expect(view!.resolved.name).toBe('partial wooden chair');
    expect(view!.resolved.components.find((component) => component.type === 'Item')?.fields.size).toBe(
      'Small',
    );
    expect(view!.partials[0]).toMatchObject({
      relativePath: 'Resources/Prototypes/_Test/Partials/chair.yml',
      only: false,
      index: 0,
    });
    expect(index.getPrototypeSummary('ChairWood')?.name).toBe('partial wooden chair');
    expect(index.getPrototypeView('Missing')).toBeNull();

    expect(index.getEntitySprite('ChairWood')).toMatchObject({
      rsi: 'Textures/Objects/Furniture/chair.rsi',
      state: 'icon',
    });
    expect(index.getEntitySprite('Missing')).toBeNull();
  });

  it('parses editor text against the rest of the index', async () => {
    index = new ProjectIndex([fixture]);
    await index.refresh();
    const source = `- type: entity
  id: EditedChair
  parent: BaseChair
  name: edited-chair
`;
    const view = index.getPrototypeViewForSource(
      '/virtual/edited-chair.yml',
      source,
      'EditedChair',
      'entity',
    );
    expect(view?.resolved.name).toBe('edited-chair');
    expect(view?.resolved.components.some((component) => component.type === 'Sprite')).toBe(true);

    const first = index.getPrototypeViewForSource('/virtual/file.yml', source);
    expect(first?.summary.id).toBe('EditedChair');
    expect(index.getPrototypeViewForSource('/virtual/file.yml', '- type: entity\n  id: Empty\n')).not.toBeNull();
  });

  it('parses graph text and exposes resource paths', async () => {
    index = new ProjectIndex([fixture]);
    await index.refresh();
    const graph = index.parseText(
      join(fixture, 'Resources/Prototypes/Recipes/Construction/Graphs/furniture/chair.yml'),
      `- type: constructionGraph
  id: Edited
  start: start
  graph:
  - node: start
`,
    );
    expect(graph.graphs[0]?.id).toBe('Edited');
    expect(index.resolveResourcePath('Textures/Objects/Furniture/chair.rsi')).toBe(
      join(fixture, 'Resources', 'Textures', 'Objects', 'Furniture', 'chair.rsi'),
    );
    expect(index.resolveResourcePath('/Resources/Textures/x.png')).toBe(
      join(fixture, 'Resources', 'Textures', 'x.png'),
    );
    expect(index.resolveWorkspacePath('Resources/Prototypes')).toBe(
      join(fixture, 'Resources', 'Prototypes'),
    );
  });
});
