import type { StorageContentInput, StorageItemView, StorageView } from '@ss14-studio/core';

/** Move one entry and return a new array. */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const clamped = Math.max(0, Math.min(next.length - 1, to));
  const [entry] = next.splice(from, 1);
  if (entry === undefined) return next;
  next.splice(clamped, 0, entry);
  return next;
}

/** Build a rectangular storage grid in the engine's `x,y,w,h` string form. */
export function buildStorageGrid(columns: number, rows: number): string[] {
  const width = Math.max(1, Math.round(columns));
  const height = Math.max(1, Math.round(rows));
  const grid: string[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid.push(`${x},${y},1,1`);
    }
  }
  return grid;
}

/** Resize a grid by rebuilding the rectangle while keeping its cell order. */
export function resizeStorageGrid(
  _grid: readonly { x: number; y: number; width: number; height: number }[],
  columns: number,
  rows: number,
): string[] {
  return buildStorageGrid(columns, rows);
}

export interface StoragePlacement {
  item: StorageItemView;
  x: number;
  y: number;
  width: number;
  height: number;
  overflow: boolean;
}

/**
 * Map StorageFill contents onto grid coordinates. Items whose slot is null or
 * outside the grid are returned in the overflow tray.
 */
export function placeStorageItems(storage: StorageView): StoragePlacement[] {
  return storage.items.map((item) => {
    const cell = item.slot == null ? undefined : storage.grid[item.slot];
    if (!cell) {
      return {
        item,
        x: 0,
        y: 0,
        width: item.footprint.width,
        height: item.footprint.height,
        overflow: true,
      };
    }
    return {
      item,
      x: cell.x,
      y: cell.y,
      width: Math.max(cell.width, item.footprint.width),
      height: Math.max(cell.height, item.footprint.height),
      overflow: false,
    };
  });
}

/** Convert UI item views back into the compact StorageFill content shape. */
export function storageContents(items: readonly StorageItemView[]): StorageContentInput[] {
  return items.map((item) => ({
    id: item.id,
    ...(item.amount != null && item.amount !== 1 ? { amount: item.amount } : {}),
    ...(item.prob != null && item.prob !== 1 ? { prob: item.prob } : {}),
    ...(item.orGroup ? { orGroup: item.orGroup } : {}),
    ...(item.extra && Object.keys(item.extra).length > 0 ? { extra: item.extra } : {}),
  }));
}

export function storageItemCount(storage: StorageView | null): number {
  return storage?.items.length ?? 0;
}
