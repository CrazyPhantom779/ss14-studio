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

describe('prototype helper diagnostics', () => {
  it('warns about component suffixes, PascalCase keys and redundant overrides', () => {
    const parsed = parse(`- type: entity
  id: HelperBase
  components:
  - type: Sprite
    sprite: /Textures/Objects/helper.rsi
    state: icon
  - type: Item
    size: Small
    Shape: [1, 1]

- type: entity
  id: HelperChild
  parent: HelperBase
  InvalidField: true
  components:
  - type: Sprite
    sprite: /Textures/Objects/helper.rsi
    state: icon
  - type: ItemComponent
    size: Small
`);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'prototype.field.case',
        'prototype.component.fieldCase',
        'prototype.component.suffix',
      ]),
    );
    expect(
      parsed.diagnostics.find((diagnostic) => diagnostic.code === 'prototype.component.suffix')
        ?.message,
    ).toContain('Item');
    const resolved = new PrototypeRegistry(parsed.prototypes).resolve('HelperChild')!;
    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'prototype.component.redundant',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('does not flag components that genuinely override an inherited field', () => {
    const parsed = parse();
    const resolved = new PrototypeRegistry(parsed.prototypes).resolve('ChildItem')!;
    expect(
      resolved.diagnostics.some(
        (diagnostic) => diagnostic.code === 'prototype.component.redundant',
      ),
    ).toBe(false);
  });
});

describe('prototype component and storage editing', () => {
  const storageSource = `- type: entity
  id: StorageBox
  components:
  - type: Storage
    maxItemSize: Normal
    grid:
    - 0,0,1,1
    - 1,0,1,1
  - type: StorageFill
    contents:
    - ToolboxEmergency
`;

  it('replaces the complete field set of a component', () => {
    const edited = apply(source, {
      kind: 'setComponentFields',
      id: 'ChildItem',
      component: 'Tool',
      fields: { speed: 5, useSound: '/Audio/Items/tool.ogg' },
    });
    const parsed = parse(edited).prototypes.find((prototype) => prototype.id === 'ChildItem')!;
    expect(parsed.components.find((component) => component.type === 'Tool')?.fields).toEqual({
      speed: 5,
      useSound: '/Audio/Items/tool.ogg',
    });
    expect(parsed.components.map((component) => component.type)).toEqual(['Item', 'Tool']);
    expect(parsed.fields.name).toBe('child-item');
  });

  it('adds a component when setComponentFields targets a missing type', () => {
    const edited = apply(source, {
      kind: 'setComponentFields',
      id: 'ChildItem',
      component: 'Anchorable',
      fields: { anchored: true, fixToTile: false },
    });
    const parsed = parse(edited).prototypes.find((prototype) => prototype.id === 'ChildItem')!;
    expect(parsed.components.find((component) => component.type === 'Anchorable')?.fields).toEqual({
      anchored: true,
      fixToTile: false,
    });
  });

  it('rewrites StorageFill contents while preserving Storage fields', () => {
    const edited = apply(storageSource, {
      kind: 'setStorageContents',
      id: 'StorageBox',
      contents: [
        { id: 'ToolboxEmergency', amount: 2, prob: 0.5, orGroup: 'tools' },
        { id: 'ClothingBackpack' },
      ],
    });
    const prototype = parse(edited).prototypes.find((candidate) => candidate.id === 'StorageBox')!;
    expect(
      prototype.components.find((component) => component.type === 'StorageFill')?.fields.contents,
    ).toEqual([
      { id: 'ToolboxEmergency', amount: 2, prob: 0.5, orGroup: 'tools' },
      { id: 'ClothingBackpack' },
    ]);
    expect(prototype.components.find((component) => component.type === 'Storage')?.fields).toMatchObject({
      maxItemSize: 'Normal',
      grid: ['0,0,1,1', '1,0,1,1'],
    });
  });

  it('adds StorageFill when the prototype has none', () => {
    const edited = apply(
      `- type: entity
  id: BareBox
  components:
  - type: Storage
    grid:
    - 0,0,1,1
`,
      {
        kind: 'setStorageContents',
        id: 'BareBox',
        contents: [{ id: 'ToolboxEmergency' }],
      },
    );
    const prototype = parse(edited).prototypes.find((candidate) => candidate.id === 'BareBox')!;
    expect(prototype.components.map((component) => component.type).sort()).toEqual([
      'Storage',
      'StorageFill',
    ]);
    expect(
      prototype.components.find((component) => component.type === 'StorageFill')?.fields.contents,
    ).toEqual([{ id: 'ToolboxEmergency' }]);
  });

  it('rewrites the Storage grid while preserving other Storage fields', () => {
    const edited = apply(storageSource, {
      kind: 'setStorageGrid',
      id: 'StorageBox',
      grid: ['0,0,1,1', '1,0,1,1', '0,1,1,1'],
    });
    const prototype = parse(edited).prototypes.find((candidate) => candidate.id === 'StorageBox')!;
    expect(prototype.components.find((component) => component.type === 'Storage')?.fields).toMatchObject({
      maxItemSize: 'Normal',
      grid: ['0,0,1,1', '1,0,1,1', '0,1,1,1'],
    });
    expect(
      prototype.components.find((component) => component.type === 'StorageFill')?.fields.contents,
    ).toEqual(['ToolboxEmergency']);
  });
});

describe('inherited layered sprites', () => {
  it('inherits layers and applies child colour, scale, offset and rotation', () => {
    const parsed = parse(`- type: entity
  id: LayeredBase
  components:
  - type: Sprite
    sprite: /Textures/Objects/layered.rsi
    layers:
    - state: base
    - state: overlay
      color: '#ff0000'

- type: entity
  id: LayeredChild
  parent: LayeredBase
  components:
  - type: Sprite
    color: '#00ff00'
    scale: 2
    offset: 0.25, -0.5
    rotation: 90
`);
    const resolved = new PrototypeRegistry(parsed.prototypes).resolve('LayeredChild')!;
    const sprite = extractSprite(resolved.components, resolved.fields)!;
    expect(sprite).toMatchObject({
      rsi: 'Textures/Objects/layered.rsi',
      state: 'base',
      layerState: 'base',
      color: '#00ff00',
      scale: 2,
      offset: { x: 0.25, y: -0.5 },
      rotation: 90,
      visible: true,
      component: 'Sprite',
      texture: null,
    });
    expect(sprite.layers).toHaveLength(2);
    expect(sprite.layers![0]).toMatchObject({
      index: 0,
      rsi: 'Textures/Objects/layered.rsi',
      state: 'base',
      color: '#00ff00',
      scale: 2,
      offset: { x: 0.25, y: -0.5 },
      visible: true,
    });
    expect(sprite.layers![1]).toMatchObject({
      index: 1,
      state: 'overlay',
      color: '#ff0000',
      scale: 2,
      offset: { x: 0.25, y: -0.5 },
    });
    expect(sprite.layers![1]?.fields).toEqual({ state: 'overlay', color: '#ff0000' });
  });

  it('honours a hidden child sprite and direct texture layers', () => {
    const sprite = extractSprite(
      [
        {
          type: 'Sprite',
          fields: {
            visible: false,
            layers: [{ texture: 'Textures/Objects/overlay.png', scale: 0.5 }],
          },
          sourceId: 'TextureLayer',
          sourceFile: 'texture.yml',
          contributors: ['TextureLayer'],
          fieldOrigins: {},
          tags: [],
          ownFields: [],
          inherited: false,
        },
      ],
      {},
    )!;
    expect(sprite.visible).toBe(false);
    expect(sprite.rsi).toBe('Textures/Objects/overlay.png');
    expect(sprite.texture).toBe('Textures/Objects/overlay.png');
    expect(sprite.layers![0]).toMatchObject({
      state: 'icon',
      scale: 0.5,
      visible: true,
    });
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
