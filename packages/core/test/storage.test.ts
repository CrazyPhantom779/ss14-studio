import { describe, expect, it } from 'vitest';
import { extractStorage, type StorageItemResolver } from '../src/index.js';
import type { PrototypeComponent } from '../src/index.js';

function component(
  type: string,
  fields: Record<string, unknown>,
): PrototypeComponent {
  return {
    type,
    fields,
    sourceId: 'Test',
    sourceFile: 'test.yml',
    contributors: ['Test'],
    fieldOrigins: Object.fromEntries(Object.keys(fields).map((key) => [key, 'Test'])),
    tags: [],
    ownFields: Object.keys(fields),
    inherited: false,
  };
}

const resolveItem: StorageItemResolver = (id) => {
  if (id === 'ToolboxEmergency') {
    return {
      name: 'Emergency toolbox',
      kind: 'entity',
      sprite: null,
      footprint: { width: 1, height: 1 },
    };
  }
  if (id === 'ClothingBackpack') {
    return {
      name: 'Backpack',
      kind: 'entity',
      sprite: null,
      footprint: { width: 2, height: 2 },
    };
  }
  return null;
};

describe('storage extraction', () => {
  it('returns null when neither Storage nor StorageFill exists', () => {
    expect(extractStorage([])).toBeNull();
    expect(extractStorage([component('Item', { size: 'Small' })])).toBeNull();
  });

  it('reads string and object grid entries and maps contents in order', () => {
    const storage = extractStorage(
      [
        component('Storage', {
          grid: ['0,0,1,1', { x: 1, y: 0, width: 1, height: 1 }, [0, 1, 2, 2]],
          maxItemSize: 'Normal',
        }),
        component('StorageFill', {
          contents: [
            'ToolboxEmergency',
            { id: 'ClothingBackpack', amount: 2, prob: 0.5, orGroup: 'bags', extra: 'kept' },
          ],
        }),
      ],
      resolveItem,
    )!;
    expect(storage.component).toBe('Storage');
    expect(storage.hasStorage).toBe(true);
    expect(storage.hasFill).toBe(true);
    expect(storage.grid.map((cell) => [cell.x, cell.y, cell.width, cell.height])).toEqual([
      [0, 0, 1, 1],
      [1, 0, 1, 1],
      [0, 1, 2, 2],
    ]);
    expect(storage.columns).toBe(2);
    expect(storage.rows).toBe(3);
    expect(storage.capacity).toBe(6);
    expect(storage.maxItemSize).toBe('Normal');
    expect(storage.items).toHaveLength(2);
    expect(storage.items[0]).toMatchObject({
      id: 'ToolboxEmergency',
      index: 0,
      name: 'Emergency toolbox',
      kind: 'entity',
      slot: 0,
      footprint: { width: 1, height: 1 },
    });
    expect(storage.items[1]).toMatchObject({
      id: 'ClothingBackpack',
      index: 1,
      amount: 2,
      prob: 0.5,
      orGroup: 'bags',
      extra: { extra: 'kept' },
    });
    expect(storage.items[1]?.slot).toBe(2);
    expect(storage.items[1]?.footprint).toEqual({ width: 2, height: 2 });
    expect(storage.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'prototype.storage.overflow',
    );
  });

  it('shows an 8x4 default grid when Storage has no explicit grid', () => {
    const storage = extractStorage([component('Storage', {})], resolveItem)!;
    expect(storage.grid).toHaveLength(32);
    expect(storage.columns).toBe(8);
    expect(storage.rows).toBe(4);
    expect(storage.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'prototype.storage.noGrid',
    );
  });

  it('warns about StorageFill without Storage and unresolved items', () => {
    const storage = extractStorage(
      [component('StorageFill', { contents: ['MissingPrototype'] })],
      resolveItem,
    )!;
    expect(storage.component).toBe('StorageFill');
    expect(storage.hasStorage).toBe(false);
    expect(storage.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'prototype.storage.noStorage',
        'prototype.storage.unknownItem',
      ]),
    );
    expect(storage.items[0]).toMatchObject({
      id: 'MissingPrototype',
      name: 'MissingPrototype',
      kind: null,
      slot: 0,
    });
  });

  it('uses prototype footprints when choosing slots', () => {
    const storage = extractStorage(
      [
        component('Storage', {
          grid: ['0,0,1,1', '1,0,1,1', '2,0,2,2'],
        }),
        component('StorageFill', {
          contents: ['ToolboxEmergency', 'ClothingBackpack'],
        }),
      ],
      resolveItem,
    )!;
    expect(storage.items[0]?.slot).toBe(0);
    expect(storage.items[1]?.slot).toBe(2);
    expect(storage.items[1]?.footprint).toEqual({ width: 2, height: 2 });
  });

  it('treats malformed grid and content entries defensively', () => {
    const storage = extractStorage(
      [
        component('Storage', {
          grid: ['nonsense', null, { x: 1, y: 2, w: 2, h: 3 }],
        }),
        component('StorageFill', {
          contents: [null, 4, {}, { entity: ' ToolboxEmergency ' }],
        }),
      ],
      resolveItem,
    )!;
    expect(storage.grid).toHaveLength(1);
    expect(storage.grid[0]).toMatchObject({ x: 1, y: 2, width: 2, height: 3 });
    expect(storage.items).toHaveLength(1);
    expect(storage.items[0]?.id).toBe('ToolboxEmergency');
  });
});
