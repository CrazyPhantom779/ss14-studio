import { describe, expect, it } from 'vitest';
import {
  applyRsiOperation,
  buildRsiStateView,
  buildRsiView,
  directionFrameCounts,
  directionFrameIndices,
  findOrphanImages,
  parseRsiMeta,
  serializeRsiMeta,
  type RsiMeta,
} from '../src/index.js';

const metaSource = JSON.stringify({
  version: 1,
  license: 'CC-BY-SA-3.0',
  copyright: 'Space Wizards Federation',
  size: { x: 32, y: 32 },
  load: { srgb: 'false' },
  states: [
    { name: 'icon', directions: 1, delays: [[0.1]], flags: { flags: {} } },
    { name: 'walk', directions: 4, delays: [[0.1, 0.2], [0.1, 0.2], [0.15, 0.15], [0.2]] },
  ],
  custom: 'kept',
});

function parsedMeta(): RsiMeta {
  return parseRsiMeta(metaSource).meta;
}

describe('RSI metadata parsing', () => {
  it('parses metadata, flags and unknown keys', () => {
    const parsed = parseRsiMeta(metaSource, 'Textures/test.rsi/meta.json');
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.meta.version).toBe(1);
    expect(parsed.meta.license).toBe('CC-BY-SA-3.0');
    expect(parsed.meta.load).toEqual({ srgb: 'false' });
    expect(parsed.meta.states[0]?.flags).toEqual({ flags: { flags: {} } });
    expect(parsed.meta.extra).toEqual({ custom: 'kept' });
  });

  it('reports invalid JSON, non-objects, missing states and bad states', () => {
    expect(parseRsiMeta('{', 'meta.json').diagnostics[0]?.code).toBe('rsi.json');
    expect(parseRsiMeta('null').diagnostics[0]?.code).toBe('rsi.json.object');
    expect(parseRsiMeta('[]').diagnostics[0]?.code).toBe('rsi.states.missing');
    expect(parseRsiMeta('{}').diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['rsi.states.missing', 'rsi.size']),
    );

    const invalid = parseRsiMeta(
      JSON.stringify({
        size: { x: 0, y: 32 },
        states: [
          null,
          { directions: 1 },
          { name: 'bad', directions: 3, delays: [[0.1]] },
          { name: 'bad', directions: 1, delays: [[0.1]] },
          { name: 'odd', directions: 1, delays: 'no' },
        ],
      }),
    );
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'rsi.state.invalid',
        'rsi.state.name',
        'rsi.state.directions',
        'rsi.state.duplicate',
        'rsi.size',
      ]),
    );
    expect(invalid.meta.states.map((state) => state.name)).toEqual(['bad', 'odd']);
    expect(invalid.meta.states[1]?.delays).toEqual([[0.1]]);
  });

  it('normalizes direction delays to the requested direction count', () => {
    const parsed = parseRsiMeta(
      JSON.stringify({
        size: { x: 16, y: 16 },
        states: [{ name: 'walk', directions: 4, delays: [[0.2]] }],
      }),
    );
    const walk = parsed.meta.states[0]!;
    expect(walk.delays).toHaveLength(4);
    expect(directionFrameCounts(walk)).toEqual([1, 1, 1, 1]);
    expect(directionFrameIndices(walk)).toEqual([[0], [1], [2], [3]]);
  });
});

describe('RSI views', () => {
  it('computes crops, durations and missing-image diagnostics', () => {
    const meta = parsedMeta();
    const view = buildRsiView({
      dirPath: '/repo/Textures/test.rsi',
      relativePath: 'Textures/test.rsi',
      metaPath: '/repo/Textures/test.rsi/meta.json',
      meta,
      images: {
        icon: { path: 'icon.png', exists: true, width: 32, height: 32, uri: 'data:image/png;base64,AA==' },
        walk: { path: 'walk.png', exists: true, width: 128, height: 64, uri: null },
      },
    });
    expect(view.license).toBe('CC-BY-SA-3.0');
    expect(view.metaAtlas).toBe(true);
    expect(view.rsic).toBe(true);
    expect(view.size).toEqual({ x: 32, y: 32 });
    expect(view.states[0]).toMatchObject({ frameCount: 1, columns: 1, rows: 1, totalDuration: 0.1 });
    expect(view.states[1]).toMatchObject({ frameCount: 7, columns: 4, rows: 2, totalDuration: 0.3 });
    expect(view.states[1]?.directionIndices).toEqual([[0, 1], [2, 3], [4, 5], [6]]);
    expect(view.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'rsi.state.frame-count',
    ]);
  });

  it('warns about missing, misaligned and undersized sheets', () => {
    const view = buildRsiView({
      dirPath: '/repo/Textures/test.rsi',
      relativePath: 'Textures/test.rsi',
      metaPath: '/repo/Textures/test.rsi/meta.json',
      meta: {
        size: { x: 32, y: 32 },
        states: [
          { name: 'missing', directions: 1, delays: [[0.1]] },
          { name: 'odd', directions: 1, delays: [[0.1, 0.1]] },
          { name: 'short', directions: 1, delays: [[0.1, 0.1, 0.1]] },
        ],
      },
      images: {
        odd: { path: 'odd.png', exists: true, width: 40, height: 32, uri: null },
        short: { path: 'short.png', exists: true, width: 32, height: 32, uri: null },
      },
      diagnostics: [{ severity: 'info', code: 'custom', message: 'kept', line: 1 }],
    });
    expect(view.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['custom', 'rsi.image.missing', 'rsi.image.size', 'rsi.image.frames']),
    );
  });

  it('builds a single state view and detects frame-count mismatches', () => {
    const meta: RsiMeta = { size: { x: 32, y: 32 }, states: [] };
    const state = { name: 'walk', directions: 4, delays: [[0.1], [0.1, 0.2], [0.1], [0.1]] };
    const view = buildRsiStateView(meta, state, {
      path: 'walk.png',
      exists: true,
      width: 160,
      height: 32,
      uri: null,
    });
    expect(view.frameCount).toBe(5);
    expect(view.directionFrames).toEqual([1, 2, 1, 1]);
    expect(view.columns).toBe(5);
    expect(view.rows).toBe(1);
    expect(view.missing).toBe(false);
    expect(view.totalDuration).toBeCloseTo(0.1);
  });
});

describe('RSI operations', () => {
  it('updates metadata, size and names', () => {
    let result = applyRsiOperation(parsedMeta(), {
      kind: 'setMeta',
      field: 'license',
      value: 'MIT',
    });
    expect(result.changed).toBe(true);
    expect(result.meta.license).toBe('MIT');
    expect(result.message).toContain('license');

    result = applyRsiOperation(result.meta, { kind: 'setMeta', field: 'license', value: null });
    expect(result.meta.license).toBeUndefined();

    result = applyRsiOperation(result.meta, { kind: 'setSize', width: 48.4, height: 16.2 });
    expect(result.meta.size).toEqual({ x: 48, y: 16 });

    result = applyRsiOperation(result.meta, {
      kind: 'renameState',
      state: 'icon',
      name: 'idle',
    });
    expect(result.meta.states[0]?.name).toBe('idle');
    expect(
      applyRsiOperation(result.meta, { kind: 'renameState', state: 'walk', name: 'idle' }).changed,
    ).toBe(false);
    expect(
      applyRsiOperation(result.meta, { kind: 'renameState', state: 'nope', name: 'x' }).message,
    ).toContain('not found');
  });

  it('adds and removes states and frames', () => {
    let result = applyRsiOperation(parsedMeta(), {
      kind: 'addState',
      state: { name: 'open', directions: 1, delays: [] },
    });
    expect(result.meta.states.at(-1)?.delays).toEqual([[0.1]]);
    expect(
      applyRsiOperation(result.meta, {
        kind: 'addState',
        state: { name: 'open', directions: 1, delays: [[0.1]] },
      }).changed,
    ).toBe(false);

    result = applyRsiOperation(result.meta, { kind: 'addFrame', state: 'walk', afterDirection: 0 });
    expect(result.meta.states.find((state) => state.name === 'walk')?.delays[0]).toEqual([0.1, 0.2, 0.2]);

    result = applyRsiOperation(result.meta, {
      kind: 'setFrameDelay',
      state: 'walk',
      direction: 0,
      frame: 1,
      delay: 0.35,
    });
    expect(result.meta.states.find((state) => state.name === 'walk')?.delays[0]).toEqual([0.1, 0.35, 0.2]);

    result = applyRsiOperation(result.meta, {
      kind: 'duplicateFrame',
      state: 'walk',
      direction: 0,
      frame: 1,
    });
    expect(result.meta.states.find((state) => state.name === 'walk')?.delays[0]?.at(-1)).toBe(0.35);

    result = applyRsiOperation(result.meta, {
      kind: 'removeFrame',
      state: 'walk',
      direction: 0,
      frame: 0,
    });
    expect(result.meta.states.find((state) => state.name === 'walk')?.delays[0]).toHaveLength(3);

    result = applyRsiOperation(result.meta, { kind: 'removeState', state: 'icon' });
    expect(result.meta.states.some((state) => state.name === 'icon')).toBe(false);
  });

  it('sets directions and cleans delay arrays', () => {
    const result = applyRsiOperation(parsedMeta(), {
      kind: 'setDirections',
      state: 'walk',
      directions: 8,
    });
    const walk = result.meta.states.find((state) => state.name === 'walk')!;
    expect(walk.directions).toBe(8);
    expect(walk.delays).toHaveLength(8);
    expect(walk.delays.every((delays) => delays.length === 2)).toBe(true);

    const delays = applyRsiOperation(result.meta, {
      kind: 'setDelays',
      state: 'walk',
      delays: [[0.1, -1, 0.2]],
    });
    expect(delays.meta.states.find((state) => state.name === 'walk')?.delays[0]).toEqual([0.1, 0, 0.2]);

    const invalid = applyRsiOperation(result.meta, {
      kind: 'setDirections',
      state: 'walk',
      directions: 3,
    });
    expect(invalid.meta.states.find((state) => state.name === 'walk')?.directions).toBe(1);
  });

  it('cleans duplicate states, versions and delay shapes', () => {
    const result = applyRsiOperation(
      {
        states: [
          { name: 'bad', directions: 4, delays: [[], [0.1]] },
          { name: 'bad', directions: 1, delays: [[0.1]] },
        ],
      },
      { kind: 'cleanup' },
    );
    expect(result.changed).toBe(true);
    expect(result.meta.version).toBe(1);
    expect(result.meta.size).toEqual({ x: 32, y: 32 });
    expect(result.meta.states).toHaveLength(1);
    expect(result.meta.states[0]?.directions).toBe(4);
    expect(result.notes.some((note) => note.includes('duplicate'))).toBe(true);
    expect(applyRsiOperation(result.meta, { kind: 'cleanup' }).changed).toBe(false);
  });

  it('serializes metadata and finds orphaned images', () => {
    const text = serializeRsiMeta(parsedMeta());
    const roundTrip = JSON.parse(text) as Record<string, unknown>;
    expect(roundTrip.license).toBe('CC-BY-SA-3.0');
    expect(roundTrip.custom).toBe('kept');
    expect(roundTrip.size).toEqual({ x: 32, y: 32 });
    expect(roundTrip.states).toHaveLength(2);
    const states = roundTrip.states as Record<string, unknown>[];
    expect(states[0]).not.toHaveProperty('directions');
    expect(states[0]).not.toHaveProperty('delays');
    expect(states[1]?.directions).toBe(4);
    expect(states[1]?.delays).toEqual([
      [0.1, 0.2],
      [0.1, 0.2],
      [0.15, 0.15],
      [0.2],
    ]);
    expect(text.endsWith('\n')).toBe(true);

    expect(findOrphanImages(parsedMeta(), ['icon.png', 'walk.png', 'old.png', 'readme.txt'])).toEqual([
      'old.png',
    ]);
  });
});
