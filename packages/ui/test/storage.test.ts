import { describe, expect, it } from 'vitest';
import type { StorageItemView, StorageView } from '@ss14-studio/core';
import {
  buildStorageGrid,
  placeStorageItems,
  reorder,
  resizeStorageGrid,
  storageContents,
  storageItemCount,
} from '../src/lib/storage.js';

function item(
  id: string,
  overrides: Partial<StorageItemView> = {},
): StorageItemView {
  return {
    id,
    index: 0,
    name: id,
    kind: 'entity',
    sprite: null,
    slot: 0,
    footprint: { width: 1, height: 1 },
    ...overrides,
  };
}

function storage(overrides: Partial<StorageView> = {}): StorageView {
  return {
    component: 'Storage',
    hasStorage: true,
    hasFill: true,
    grid: [
      { index: 0, x: 0, y: 0, width: 1, height: 1, raw: '0,0,1,1' },
      { index: 1, x: 1, y: 0, width: 1, height: 1, raw: '1,0,1,1' },
      { index: 2, x: 0, y: 1, width: 2, height: 2, raw: '0,1,2,2' },
    ],
    columns: 2,
    rows: 3,
    items: [],
    maxItemSize: 'Normal',
    capacity: 3,
    diagnostics: [],
    ...overrides,
  };
}

describe('storage reordering', () => {
  it('moves entries forward and backward without mutating the input', () => {
    const source = ['a', 'b', 'c', 'd'];
    expect(reorder(source, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorder(source, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(source).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clamps destinations and ignores invalid sources', () => {
    expect(reorder(['a', 'b'], 0, 99)).toEqual(['b', 'a']);
    expect(reorder(['a', 'b'], 1, -5)).toEqual(['b', 'a']);
    expect(reorder(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
    expect(reorder(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('storage grids', () => {
  it('builds a row-major rectangular grid', () => {
    expect(buildStorageGrid(3, 2)).toEqual([
      '0,0,1,1',
      '1,0,1,1',
      '2,0,1,1',
      '0,1,1,1',
      '1,1,1,1',
      '2,1,1,1',
    ]);
  });

  it('rounds sizes and never produces an empty grid', () => {
    expect(buildStorageGrid(0, 0)).toEqual(['0,0,1,1']);
    expect(buildStorageGrid(1.6, 1.4)).toEqual([
      '0,0,1,1',
      '1,0,1,1',
    ]);
  });

  it('rebuilds the rectangle when resized', () => {
    const grid = resizeStorageGrid(
      [
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 1, y: 0, width: 1, height: 1 },
      ],
      2,
      2,
    );
    expect(grid).toEqual(['0,0,1,1', '1,0,1,1', '0,1,1,1', '1,1,1,1']);
  });
});

describe('storage placement', () => {
  it('places items on their slots and expands to the item footprint', () => {
    const view = storage({
      items: [
        item('First', { slot: 0 }),
        item('Backpack', { slot: 2, footprint: { width: 3, height: 3 } }),
      ],
    });
    expect(placeStorageItems(view)).toEqual([
      {
        item: view.items[0],
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        overflow: false,
      },
      {
        item: view.items[1],
        x: 0,
        y: 1,
        width: 3,
        height: 3,
        overflow: false,
      },
    ]);
  });

  it('moves items with no slot or an out-of-range slot to overflow', () => {
    const view = storage({
      items: [item('Loose', { slot: null }), item('Gone', { slot: 42 })],
    });
    const placed = placeStorageItems(view);
    expect(placed.map((entry) => [entry.item.id, entry.overflow])).toEqual([
      ['Loose', true],
      ['Gone', true],
    ]);
    expect(placed[0]).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('returns no placements for an empty StorageFill', () => {
    expect(placeStorageItems(storage())).toEqual([]);
  });
});

describe('storage content serialisation', () => {
  it('drops default amount and probability and keeps extras', () => {
    const contents = storageContents([
      item('Plain', { amount: 1, prob: 1 }),
      item('Stack', { amount: 3, prob: 0.25, orGroup: 'tools' }),
      item('Extra', { extra: { entity: 'Nested' } }),
      item('EmptyExtra', { extra: {} }),
    ]);
    expect(contents).toEqual([
      { id: 'Plain' },
      { id: 'Stack', amount: 3, prob: 0.25, orGroup: 'tools' },
      { id: 'Extra', extra: { entity: 'Nested' } },
      { id: 'EmptyExtra' },
    ]);
  });

  it('counts items safely', () => {
    expect(storageItemCount(null)).toBe(0);
    expect(storageItemCount(storage())).toBe(0);
    expect(storageItemCount(storage({ items: [item('A'), item('B')] }))).toBe(2);
  });
});
