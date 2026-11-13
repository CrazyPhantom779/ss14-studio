import { describe, expect, it } from 'vitest';
import {
  PrototypeRegistry,
  applyPrototypeOperation,
  applyRsiOperation,
  applyXamlOperation,
  buildRsiView,
  diffText,
  directionFrameIndices,
  extractSprite,
  findOrphanImages,
  locatePrototype,
  parseFluent,
  parsePrototypeFile,
  parseRsiMeta,
  parseXaml,
  renderPartialPrototype,
  serializeRsiMeta,
} from '../src/index.js';

function file(source: string, name = 'test.yml') {
  return parsePrototypeFile(source, {
    filePath: `/workspace/Resources/Prototypes/${name}`,
    relativePath: `Resources/Prototypes/${name}`,
  });
}

describe('prototype parsing and inheritance', () => {
  const source = `
- type: entity
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
    weight: 1

- type: entity
  id: BaseTool
  abstract: true
  parent: BaseItem
  components:
  - type: Tool
    speed: 1

- type: entity
  id: Wrench
  parent: [BaseTool, BaseItem]
  name: wrench
  components:
  - type: Tool
    speed: 2
`;

  it('merges parents in order and lets the child override fields', () => {
    const parsed = file(source);
    expect(parsed.diagnostics).toHaveLength(0);
    const registry = new PrototypeRegistry(parsed.prototypes, new Map([
      ['base-item', 'base item'],
      ['base-desc', 'A base item description.'],
      ['wrench', 'wrench'],
    ]));
    const wrench = registry.resolve('Wrench');
    expect(wrench).not.toBeNull();
    expect(wrench!.name).toBe('wrench');
    expect(wrench!.description).toBe('A base item description.');
    expect(wrench!.components.map((component) => component.type)).toEqual([
      'Sprite',
      'Item',
      'Tool',
    ]);
    const sprite = extractSprite(wrench!.components, wrench!.fields);
    expect(sprite?.rsi).toBe('Textures/Objects/base.rsi');
    const tool = wrench!.components.find((component) => component.type === 'Tool')!;
    expect(tool.fields.speed).toBe(2);
    expect(tool.contributors).toContain('Wrench');
  });

  it('reports missing parents and supports localizable names', () => {
    const parsed = file(`
- type: entity
  id: Child
  parent: DoesNotExist
  name: child-name
`);
    const registry = new PrototypeRegistry(parsed.prototypes, new Map([['child-name', 'Child item']]));
    const resolved = registry.resolve('Child')!;
    expect(resolved.name).toBe('Child item');
    expect(resolved.diagnostics[0]?.code).toBe('prototype.parent.missing');
  });

  it('applies partial overlays to fields and components', () => {
    const base = file(source);
    const patch = parsePrototypeFile(
      `
- type: !Partial:0 entity
  id: Wrench
  name: adjustable-wrench
  components:
  - type: Tool
    speed: 3
  - type: Item
    size: Normal
`,
      {
        filePath: '/workspace/Resources/Prototypes/_Test/Partials/wrench.yml',
        relativePath: 'Resources/Prototypes/_Test/Partials/wrench.yml',
        isPartial: true,
        partialIndex: 0,
      },
    );
    const registry = new PrototypeRegistry([...base.prototypes, ...patch.prototypes]);
    const wrench = registry.resolve('Wrench')!;
    expect(wrench.fields.name).toBe('adjustable-wrench');
    expect(wrench.components.find((component) => component.type === 'Tool')?.fields.speed).toBe(3);
    expect(wrench.components.find((component) => component.type === 'Item')?.fields.size).toBe('Normal');
    expect(wrench.partials).toContain('Wrench');
  });

  it('locates and edits prototypes without rewriting the file', () => {
    const parsed = file(source);
    expect(parsed.prototypes).toHaveLength(3);
    const located = locatePrototype(source, 'Wrench');
    expect(located?.kind).toBe('entity');
    const edited = applyPrototypeOperation(source, {
      kind: 'setField',
      id: 'Wrench',
      field: 'name',
      value: 'adjustable wrench',
    });
    expect(edited.edits).toHaveLength(1);
    const next = source.slice(0, edited.edits[0]!.start) + edited.edits[0]!.text + source.slice(edited.edits[0]!.end);
    expect(next).toContain('name: "adjustable wrench"');
    expect(next).toContain('type: Tool');
  });

  it('renders partial prototypes with the correct tag', () => {
    const snippet = renderPartialPrototype(source, 'Wrench', ['name'], ['Tool']);
    expect(snippet).toContain('!Partial:0 entity');
    expect(snippet).toContain('id: Wrench');
    expect(snippet).toContain('name: wrench');
    expect(snippet).toContain('- type: Tool');
  });

  it('parses Fluent localization values', () => {
    const entries = parseFluent(`
# comment
wrench = a wrench
wrench-desc =
    A tool used to turn bolts.
`);
    const map = new Map(entries.map((entry) => [entry.id, entry.value]));
    expect(map.get('wrench')).toBe('a wrench');
    expect(map.get('wrench-desc')).toContain('turn bolts');
  });
});

describe('RSI metadata', () => {
  const metaSource = JSON.stringify({
    version: 1,
    license: 'CC-BY-SA-3.0',
    copyright: 'Space Wizards Federation',
    size: { x: 32, y: 32 },
    states: [
      { name: 'icon', directions: 1, delays: [[0.1]] },
      { name: 'walk', directions: 4, delays: [[0.1, 0.2], [0.1, 0.2], [0.15, 0.15], [0.2]] },
    ],
  });

  it('computes direction frame indices and view metadata', () => {
    const parsed = parseRsiMeta(metaSource);
    expect(parsed.diagnostics).toHaveLength(0);
    const walk = parsed.meta.states[1]!;
    expect(directionFrameIndices(walk)).toEqual([[0, 1], [2, 3], [4, 5], [6]]);
    const view = buildRsiView({
      dirPath: '/workspace/Textures/test.rsi',
      relativePath: 'Textures/test.rsi',
      metaPath: '/workspace/Textures/test.rsi/meta.json',
      meta: parsed.meta,
      images: {
        icon: { path: 'icon.png', exists: true, width: 32, height: 32, uri: null },
        walk: { path: 'walk.png', exists: true, width: 128, height: 64, uri: null },
      },
    });
    expect(view.states[1]?.frameCount).toBe(7);
    expect(view.states[1]?.columns).toBe(4);
    expect(view.states[1]?.totalDuration).toBe(0.3);
    expect(view.metaAtlas).toBe(true);
  });

  it('edits and cleans metadata', () => {
    const parsed = parseRsiMeta(metaSource);
    const added = applyRsiOperation(parsed.meta, { kind: 'addFrame', state: 'walk' });
    expect(added.meta.states[1]?.delays[3]).toEqual([0.2, 0.2]);
    const removed = applyRsiOperation(added.meta, {
      kind: 'removeFrame',
      state: 'walk',
      direction: 0,
      frame: 0,
    });
    expect(removed.meta.states[1]?.delays[0]).toEqual([0.2, 0.2]);
    const cleaned = applyRsiOperation(
      {
        ...parsed.meta,
        states: [
          { name: 'bad', directions: 4, delays: [[], [0.1]] },
          { name: 'bad', directions: 1, delays: [[0.1]] },
        ],
      },
      { kind: 'cleanup' },
    );
    expect(cleaned.meta.states).toHaveLength(1);
    expect(cleaned.meta.states[0]?.delays).toEqual([[0.1], [0.1], [0.1], [0.1]]);
    const text = serializeRsiMeta(cleaned.meta);
    expect(JSON.parse(text).states[0].directions).toBe(4);
  });

  it('finds orphaned images', () => {
    const parsed = parseRsiMeta(metaSource);
    expect(findOrphanImages(parsed.meta, ['icon.png', 'walk.png', 'old.png'])).toEqual(['old.png']);
  });
});

describe('XAML tooling', () => {
  const xaml = `<DefaultWindow xmlns="https://spacestation14.io"
                xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
                x:Class="Content.Client.TestWindow">
  <BoxContainer Orientation="Vertical" Margin="8">
    <Label Text="{Loc test-title}" />
    <Button Name="ConfirmButton" OnPressed="OnConfirm">Confirm</Button>
  </BoxContainer>
</DefaultWindow>`;

  it('parses an outline, names and event handlers', () => {
    const view = parseXaml(xaml, {
      filePath: '/workspace/Content.Client/TestWindow.xaml',
      relativePath: 'Content.Client/TestWindow.xaml',
      codeBehindPath: '/workspace/Content.Client/TestWindow.xaml.cs',
      codeBehindSource: `public sealed class TestWindow : DefaultWindow { private void OnConfirm() {} }`,
    });
    expect(view.root?.name).toBe('DefaultWindow');
    expect(view.className).toBe('Content.Client.TestWindow');
    expect(view.outline.map((item) => item.name)).toEqual([
      'DefaultWindow',
      'BoxContainer',
      'Label',
      'Button',
    ]);
    expect(view.diagnostics.some((diagnostic) => diagnostic.code === 'xaml.handler.missing')).toBe(false);
    expect(view.codeBehindHandlers).toContain('OnConfirm');
    expect(view.design?.children[0]?.orientation).toBe('vertical');
    expect(view.design?.children[0]?.children[1]?.text).toBe('Confirm');
  });

  it('reports missing handlers and unclosed tags', () => {
    const view = parseXaml(
      `<DefaultWindow xmlns="https://spacestation14.io"><Button OnPressed="Nope" /></DefaultWindow>`,
      {
        filePath: 'test.xaml',
        relativePath: 'test.xaml',
        codeBehindSource: 'public class Test {}',
      },
    );
    expect(view.diagnostics.some((diagnostic) => diagnostic.code === 'xaml.handler.missing')).toBe(true);
    const broken = parseXaml('<DefaultWindow><BoxContainer></DefaultWindow>', {
      filePath: 'broken.xaml',
      relativePath: 'broken.xaml',
    });
    expect(broken.diagnostics.some((diagnostic) => diagnostic.code === 'xaml.close.mismatch')).toBe(true);
    expect(broken.diagnostics.some((diagnostic) => diagnostic.code === 'xaml.open.unclosed')).toBe(true);
  });

  it('formats, cleans and marks generated XAML', () => {
    const messy = `<DefaultWindow xmlns="https://spacestation14.io">
<BoxContainer>
<Label Text="Hi" />
</BoxContainer>
</DefaultWindow>`;
    const formatted = applyXamlOperation(messy, { kind: 'format' });
    expect(formatted.text).toContain('  <BoxContainer>');
    expect(formatted.text).toContain('    <Label Text="Hi" />');
    const generated = applyXamlOperation(messy, { kind: 'markAutoGenerated' });
    expect(generated.text).toMatch(/AutoGenerated/);
    const cleaned = applyXamlOperation(generated.text, { kind: 'cleanup' });
    expect(cleaned.text).toMatch(/AutoGenerated/);
  });
});

describe('diff', () => {
  it('produces hunks and counts', () => {
    const diff = diffText({
      oldText: 'a\nb\nc\nd\ne\n',
      newText: 'a\nb\nC\nd\ne\n',
    });
    expect(diff.identical).toBe(false);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.hunks[0]?.lines.some((line) => line.kind === 'add')).toBe(true);
  });

  it('handles identical input', () => {
    expect(diffText({ oldText: 'same\n', newText: 'same\n' }).identical).toBe(true);
  });
});
