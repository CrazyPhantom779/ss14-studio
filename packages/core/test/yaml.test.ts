import { describe, expect, it } from 'vitest';
import { isMap, isSeq, parseDocument, type YAMLMap } from 'yaml';
import {
  LineIndex,
  booleanValue,
  detectEol,
  escapeRegExp,
  formatScalar,
  getNode,
  getPair,
  lineIndent,
  mapContentIndent,
  mappingFields,
  numberValue,
  rawOf,
  scalarFieldSpans,
  sequenceItems,
  sequenceLayout,
  spanOf,
  stringValue,
  tagType,
  toPlain,
} from '../src/index.js';

describe('YAML helpers', () => {
  it('normalizes all SS14 tag spellings', () => {
    expect(tagType('!type:SnapToGrid')).toBe('SnapToGrid');
    expect(tagType('!Partial:0')).toBe('Partial:0');
    expect(tagType('!<tag:robusttoolbox.com,2020:ConstructionGraphStep>')).toBe(
      'ConstructionGraphStep',
    );
    expect(tagType('!<Simple>')).toBe('Simple');
    expect(tagType(null)).toBeNull();
    expect(tagType(undefined)).toBeNull();
    expect(tagType('plain')).toBe('plain');
  });

  it('indexes LF and CRLF lines without losing offsets', () => {
    const source = 'alpha\r\nbeta\r\ngamma';
    const lines = new LineIndex(source);
    expect(lines.lineCount).toBe(3);
    expect(lines.lineAt(0)).toBe(1);
    expect(lines.lineAt(7)).toBe(2);
    expect(lines.lineAt(source.length)).toBe(3);
    expect(lines.lineAt(-20)).toBe(1);
    expect(lines.lineStart(2)).toBe(7);
    expect(lines.lineContentEnd(1)).toBe(5);
    expect(lines.lineEndWithNewline(1)).toBe(7);
    expect(lines.lineText(3)).toBe('gamma');
  });

  it('extracts source spans and raw text from parsed nodes', () => {
    const source = 'id: Thing\nname: A thing\n';
    const document = parseDocument(source, { keepSourceTokens: true });
    const root = document.contents;
    expect(isMap(root)).toBe(true);
    const map = root as YAMLMap<unknown, unknown>;
    const name = getNode(map, 'name');
    const span = spanOf(name, new LineIndex(source));
    expect(span?.line).toBe(2);
    expect(span?.endLine).toBe(2);
    expect(rawOf(name, source)).toBe('A thing');
    expect(spanOf(null, new LineIndex(source))).toBeNull();
  });

  it('reads scalar values with type coercion and mapping helpers', () => {
    const source = `name: Thing
amount: 4
amountText: "5"
enabled: true
disabled: "false"
tags: [A, B]
nested:
  key: value
`;
    const document = parseDocument(source);
    const map = document.contents as YAMLMap<unknown, unknown>;
    expect(getPair(map, 'name')?.key).toBeTruthy();
    expect(getPair(map, 'missing')).toBeUndefined();
    expect(stringValue(getNode(map, 'name'))).toBe('Thing');
    expect(stringValue(getNode(map, 'missing'))).toBeNull();
    expect(numberValue(getNode(map, 'amount'))).toBe(4);
    expect(numberValue(getNode(map, 'amountText'))).toBe(5);
    expect(numberValue(getNode(map, 'name'))).toBeNull();
    expect(booleanValue(getNode(map, 'enabled'))).toBe(true);
    expect(booleanValue(getNode(map, 'disabled'))).toBe(false);
    expect(sequenceItems(getNode(map, 'tags'))).toHaveLength(2);
    expect(sequenceItems(getNode(map, 'name'))).toEqual([]);
    expect(mappingFields(getNode(map, 'nested'))).toEqual({ key: 'value' });
    expect(mappingFields(getNode(map, 'name'))).toEqual({});
    expect(mappingFields(map)).toMatchObject({ name: 'Thing', amount: 4, enabled: true });
  });

  it('preserves YAML tags in plain-object conversion', () => {
    const source = `entry: !type:SnapToGrid
  southRotation: true
items: !CustomSeq
  - !Tagged one
  - two
`;
    const document = parseDocument(source);
    const map = document.contents as YAMLMap<unknown, unknown>;
    const entry = toPlain(getNode(map, 'entry')) as Record<string, unknown>;
    expect(entry.$type).toBe('SnapToGrid');
    expect(entry.southRotation).toBe(true);

    const items = toPlain(getNode(map, 'items')) as {
      $type: string;
      items: unknown[];
    };
    expect(items.$type).toBe('CustomSeq');
    expect(items.items).toHaveLength(2);
    expect((items.items[0] as Record<string, unknown>).$type).toBe('Tagged');
  });

  it('reports field spans and formats YAML-safe scalars', () => {
    const source = 'id: Thing\nname: A thing\nenabled: true\n';
    const document = parseDocument(source, { keepSourceTokens: true });
    const map = document.contents as YAMLMap<unknown, unknown>;
    const spans = scalarFieldSpans(map, new LineIndex(source));
    expect(spans.name?.line).toBe(2);
    expect(spans.enabled?.line).toBe(3);

    expect(formatScalar('Simple_ID')).toBe('Simple_ID');
    expect(formatScalar('has space')).toBe('"has space"');
    expect(formatScalar('true')).toBe('"true"');
    expect(formatScalar('')).toBe("''");
    expect(formatScalar(2.5)).toBe('2.5');
    expect(formatScalar(false)).toBe('false');
  });

  it('detects EOL style and indentation', () => {
    expect(detectEol('a\r\nb')).toBe('\r\n');
    expect(detectEol('a\nb')).toBe('\n');
    const source = 'root:\n    child: true\n';
    const lines = new LineIndex(source);
    expect(lineIndent(source, lines, 2)).toBe('    ');
    expect(lineIndent(source, lines, 1)).toBe('');
  });

  it('detects sequence and mapping layout used by each file style', () => {
    const source = `graph:
  - node: start
    edges: []
`;
    const document = parseDocument(source);
    const map = document.contents as YAMLMap<unknown, unknown>;
    const seq = getNode(map, 'graph');
    expect(isSeq(seq)).toBe(true);
    const layout = sequenceLayout(source, new LineIndex(source), seq, 0);
    expect(layout).toEqual({ dashIndent: 2, contentIndent: 4 });
    expect(
      sequenceLayout('graph:\n- node: start\n', new LineIndex('graph:\n- node: start\n'), null, 0),
    ).toEqual({ dashIndent: 0, contentIndent: 2 });

    const span = spanOf(seq, new LineIndex(source))!;
    expect(mapContentIndent(source, new LineIndex(source), span)).toBe(2);
    expect(escapeRegExp('a.b[c]')).toBe('a\\.b\\[c\\]');
  });
});
