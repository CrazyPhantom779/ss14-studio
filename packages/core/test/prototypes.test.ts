import { describe, expect, it } from 'vitest';
import {
  PrototypeRegistry,
  applyPrototypeOperation,
  applyTextEdits,
  buildPrototypeIndex,
  extractSprite,
  locatePrototype,
  parseFluent,
  parsePrototypeFile,
  type PrototypeOperation,
} from '../src/index.js';

const source = `- type: entity
  id: BaseItem
  abstract: true
  name: base-item
  description: base-desc
  components:
  - type: Sprite
    sprite: /Textures/Objects/base.rsi
    state: icon
  - type: Item
    size: Small

- type: entity
  id: ChildItem
  parent: BaseItem
  name: child-item
  components:
  - type: Item
    size: Normal
  - type: Tool
    speed: 2
`;

function parse(text = source, name = 'items.yml') {
  return parsePrototypeFile(text, {
    filePath: `/repo/Resources/Prototypes/${name}`,
    relativePath: `Resources/Prototypes/${name}`,
    fileKey: `Resources/Prototypes/${name}`,
  });
}

function apply(text: string, operation: PrototypeOperation): string {
  const result = applyPrototypeOperation(text, operation);
  return applyTextEdits(text, result.edits);
}

describe('prototype registry', () => {
  it('builds an index with kinds, localization and duplicate counts', () => {
    const parsed = parse(`${source}
- type: entity
  id: ChildItem
  parent: BaseItem
`);
    const localization = new Map([
      ['base-item', 'Base item'],
      ['child-item', 'Child item'],
    ]);
    const { registry, payload } = buildPrototypeIndex(
      parsed.prototypes,
      localization,
      ['Resources/Prototypes/_Test/Partials'],
      12,
    );
    expect(registry.size).toBe(2);
    expect(registry.duplicateCount).toBe(1);
    expect(payload.total).toBe(2);
    expect(payload.duplicates).toBe(1);
    expect(payload.localizationCount).toBe(2);
    expect(payload.partialFiles).toEqual(['Resources/Prototypes/_Test/Partials']);
    expect(payload.scanDurationMs).toBe(12);
    expect(payload.kinds).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'entity', count: 2, abstract: 1 })]),
    );
    expect(registry.summary('ChildItem')?.name).toBe('Child item');
  });

  it('returns inheritance trees, children and resolved provenance', () => {
    const parsed = parse();
    const registry = new PrototypeRegistry(parsed.prototypes);
    const view = registry.view('ChildItem');
    expect(view).not.toBeNull();
    expect(view!.summary.parents).toEqual(['BaseItem']);
    expect(view!.inheritance.parents[0]?.id).toBe('BaseItem');
    expect(view!.children).toEqual([]);
    expect(registry.view('BaseItem')!.children.map((child) => child.id)).toEqual(['ChildItem']);
    expect(view!.resolved.components.find((component) => component.type === 'Item')?.fields.size).toBe(
      'Normal',
    );
    expect(
      view!.resolved.components.find((component) => component.type === 'Item')?.contributors,
    ).toEqual(expect.arrayContaining(['BaseItem', 'ChildItem']));
    expect(view!.resolved.resolvedFields.find((field) => field.key === 'name')?.inherited).toBe(
      false,
    );
    expect(registry.view('Nope')).toBeNull();
  });

  it('extracts sprites from plain components, layers and textures', () => {
    const parsed = parse();
    const resolved = new PrototypeRegistry(parsed.prototypes).resolve('ChildItem')!;
    expect(extractSprite(resolved.components, resolved.fields)).toMatchObject({
      rsi: 'Textures/Objects/base.rsi',
      state: 'icon',
      component: 'Sprite',
      texture: null,
    });

    expect(
      extractSprite(
        [
          {
            type: 'Sprite',
            fields: { layers: [{ state: 'equipped' }] },
            sourceId: 'Layered',
            sourceFile: 'layered.yml',
            contributors: ['Layered'],
            fieldOrigins: {},
            tags: [],
            ownFields: [],
            inherited: false,
          },
        ],
        {},
      ),
    ).toMatchObject({ rsi: null, state: 'equipped', layerState: 'equipped' });

    expect(
      extractSprite(
        [
          {
            type: 'Icon',
            fields: { sprite: 'Textures/Objects/tool.png' },
            sourceId: 'Texture',
            sourceFile: 'texture.yml',
            contributors: ['Texture'],
            fieldOrigins: {},
            tags: [],
            ownFields: [],
            inherited: false,
          },
        ],
        {},
      ),
    ).toMatchObject({
      rsi: 'Textures/Objects/tool.png',
      texture: 'Textures/Objects/tool.png',
      component: 'Icon',
    });
    expect(extractSprite([], {})).toBeNull();
  });

  it('reports missing parents and cycles without hanging', () => {
    const parsed = parse(`- type: entity
  id: Missing
  parent: Nope
- type: entity
  id: A
  parent: A
`);
    const registry = new PrototypeRegistry(parsed.prototypes);
    expect(registry.resolve('Missing')?.diagnostics[0]?.code).toBe('prototype.parent.missing');
    expect(
      registry.resolve('A')?.diagnostics.some((diagnostic) => diagnostic.code === 'prototype.parent.cycle'),
    ).toBe(true);
  });
});

describe('prototype editing', () => {
  it('locates prototypes by id and optional kind', () => {
    const located = locatePrototype(source, 'ChildItem');
    expect(located).not.toBeNull();
    expect(located!.kind).toBe('entity');
    expect(located!.line).toBeGreaterThan(1);
    expect(located!.componentSpans.Item).toBeDefined();
    expect(locatePrototype(source, 'ChildItem', 'entity')).not.toBeNull();
    expect(locatePrototype(source, 'ChildItem', 'recipe')).toBeNull();
    expect(locatePrototype(source, 'Nope')).toBeNull();
  });

  it('updates, adds and removes scalar fields without rewriting the file', () => {
    const renamed = apply(source, { kind: 'setField', id: 'ChildItem', field: 'name', value: 'child item' });
    expect(renamed).toContain('name: "child item"');
    expect(renamed).toContain('speed: 2');

    const added = apply(source, { kind: 'setField', id: 'ChildItem', field: 'description', value: 'desc' });
    expect(parse(added).prototypes.find((prototype) => prototype.id === 'ChildItem')?.fields.description).toBe(
      'desc',
    );

    const removed = apply(source, { kind: 'setField', id: 'ChildItem', field: 'name', value: null });
    expect(parse(removed).prototypes.find((prototype) => prototype.id === 'ChildItem')?.fields.name).toBeUndefined();
  });

  it('adds, edits and removes components', () => {
    const added = apply(source, {
      kind: 'addComponent',
      id: 'ChildItem',
      component: 'Anchorable',
      fields: { anchored: true },
    });
    const parsedAdded = parse(added).prototypes.find((prototype) => prototype.id === 'ChildItem')!;
    expect(parsedAdded.components.map((component) => component.type)).toContain('Anchorable');
    expect(parsedAdded.components.find((component) => component.type === 'Anchorable')?.fields.anchored).toBe(
      true,
    );

    const edited = apply(added, {
      kind: 'setComponentField',
      id: 'ChildItem',
      component: 'Tool',
      field: 'speed',
      value: 4,
    });
    expect(parse(edited).prototypes.find((prototype) => prototype.id === 'ChildItem')?.components.find((component) => component.type === 'Tool')?.fields.speed).toBe(4);

    const removed = apply(edited, {
      kind: 'removeComponent',
      id: 'ChildItem',
      component: 'Anchorable',
    });
    expect(
      parse(removed).prototypes.find((prototype) => prototype.id === 'ChildItem')?.components.map(
        (component) => component.type,
      ),
    ).toEqual(['Item', 'Tool']);
  });

  it('returns a useful message when an edit target is absent', () => {
    expect(applyPrototypeOperation(source, { kind: 'setField', id: 'Nope', field: 'name', value: 'x' })).toEqual(
      expect.objectContaining({ edits: [], message: expect.stringContaining('Could not find') }),
    );
    expect(
      applyPrototypeOperation(source, { kind: 'addComponent', id: 'ChildItem', component: 'Item' }).edits,
    ).toEqual([]);
  });
});

describe('Fluent parsing', () => {
  it('joins indented values and resets at comments and blank lines', () => {
    const entries = parseFluent(`# heading
thing = A thing
thing-desc =
    A long
    description.
other = Other

ignored = no
`, 'messages.ftl');
    const values = new Map(entries.map((entry) => [entry.id, entry.value]));
    expect(values.get('thing')).toBe('A thing');
    expect(values.get('thing-desc')).toBe('A long description.');
    expect(values.get('other')).toBe('Other');
    expect(values.get('ignored')).toBe('no');
    expect(entries[0]?.filePath).toBe('messages.ftl');
  });
});
