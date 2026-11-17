import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  constructionDisplayEntity,
  enrichGraphIcons,
  parseGraphFile,
  type GraphIconResolver,
} from '../src/index.js';

const computer = readFileSync('test/fixtures/computer.yml', 'utf8').replace(/^\uFEFF/, '');

function parseComputer() {
  return parseGraphFile(computer, {
    filePath: 'C:/repo/Resources/Prototypes/Recipes/Construction/Graphs/machines/computer.yml',
    relativePath: 'Resources/Prototypes/Recipes/Construction/Graphs/machines/computer.yml',
    fileKey: 'file:///C:/repo/computer.yml',
  }).graphs[0]!;
}

function resolver(
  entities: string[] = [],
  boards: { board: string; entity: string }[] = [],
): GraphIconResolver {
  return {
    hasEntity: (id) => entities.includes(id),
    boardTargets: (component) =>
      component === 'ComputerBoard' ? boards : [],
  };
}

describe('construction graph icons', () => {
  it('fills entity icons and expands board variants', () => {
    const graph = parseComputer();
    enrichGraphIcons(
      graph,
      resolver([], [
        { board: 'ComputerBoard', entity: 'Computer' },
        { board: 'ComputerBoard', entity: 'ComputerBroken' },
      ]),
    );

    const frame = graph.nodes.find((node) => node.name === 'frameUnsecured')!;
    expect(frame.iconEntities).toEqual(['ComputerFrame']);

    const node = graph.nodes.find((candidate) => candidate.name === 'computer')!;
    expect(node.entityType).toBe('BoardNodeEntity');
    expect(node.iconEntities).toEqual(['Computer', 'ComputerBroken']);

    expect(
      constructionDisplayEntity(
        graph,
        'computer',
        resolver([], [{ board: 'ComputerBoard', entity: 'Computer' }]),
      ),
    ).toBe('Computer');
  });

  it('falls back to the node name when it is a real entity', () => {
    const graph = parseComputer();
    enrichGraphIcons(graph, resolver(['missingWires']));
    const node = graph.nodes.find((candidate) => candidate.name === 'missingWires')!;
    expect(node.iconEntities).toEqual(['missingWires']);
  });

  it('shows board prototypes when the final entity is unknown', () => {
    const graph = parseComputer();
    enrichGraphIcons(
      graph,
      resolver([], [{ board: 'ComputerBoard', entity: 'Computer' }]),
    );
    const board = graph.nodes.find((candidate) => candidate.name === 'boardUnsecured')!;
    expect(board.iconEntities).toEqual(['ComputerBoard']);

    const start = graph.nodes.find((candidate) => candidate.name === 'start')!;
    expect(start.iconEntities).toBeUndefined();

    const boardStep = graph.nodes
      .find((candidate) => candidate.name === 'frameUnsecured')!
      .edges.find((edge) => edge.target === 'boardUnsecured')!;
    expect(boardStep.steps[0]?.fields.component).toBe('ComputerBoard');
  });
});
