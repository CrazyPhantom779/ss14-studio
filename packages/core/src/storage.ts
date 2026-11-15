/**
 * Storage and StorageFill visualisation helpers.
 *
 * This is an approximation of the in-game storage grid. It reads the same
 * component data the prototype resolver produces and maps StorageFill contents
 * onto the grid in declaration order, which is the order the engine uses when
 * it inserts spawn entries.
 */
import type {
  Diagnostic,
  PrototypeComponent,
  StorageContentInput,
  StorageGridCell,
  StorageItemView,
  StorageView,
  SpriteInfo,
} from './model.js';

export interface StorageItemResolution {
  name: string;
  kind: string | null;
  sprite: SpriteInfo | null;
  footprint?: { width: number; height: number };
}

export type StorageItemResolver = (id: string) => StorageItemResolution | null;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numeric(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseGridCell(input: unknown, index: number): StorageGridCell | null {
  if (typeof input === 'string') {
    const parts = input.split(/[,\s]+/).map((part) => Number(part.trim())).filter((part) => Number.isFinite(part));
    if (parts.length >= 2) {
      return {
        index,
        x: Math.max(0, Math.round(parts[0]!)),
        y: Math.max(0, Math.round(parts[1]!)),
        width: Math.max(1, Math.round(parts[2] ?? 1)),
        height: Math.max(1, Math.round(parts[3] ?? 1)),
        raw: input,
      };
    }
    return null;
  }
  if (Array.isArray(input)) {
    const values = input.map((value) => numeric(value, 0));
    if (values.length >= 2) {
      return {
        index,
        x: Math.max(0, Math.round(values[0]!)),
        y: Math.max(0, Math.round(values[1]!)),
        width: Math.max(1, Math.round(values[2] ?? 1)),
        height: Math.max(1, Math.round(values[3] ?? 1)),
        raw: values.join(','),
      };
    }
    return null;
  }
  const map = record(input);
  if (!map) return null;
  const x = numeric(map.x ?? map.X, 0);
  const y = numeric(map.y ?? map.Y, 0);
  const width = numeric(map.width ?? map.Width ?? map.w, 1);
  const height = numeric(map.height ?? map.Height ?? map.h, 1);
  return {
    index,
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    raw: `${x},${y},${width},${height}`,
  };
}

function parseGrid(value: unknown): StorageGridCell[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => parseGridCell(entry, index))
    .filter((entry): entry is StorageGridCell => entry != null);
}

function parseContents(value: unknown): StorageContentInput[] {
  if (!Array.isArray(value)) return [];
  const output: StorageContentInput[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      output.push({ id: entry });
      continue;
    }
    const map = record(entry);
    if (!map) continue;
    const id = map.id ?? map.entity ?? map.prototype ?? map.Id;
    if (typeof id !== 'string' || !id.trim()) continue;
    const amount = numeric(map.amount ?? map.Amount, 1);
    const prob = numeric(map.prob ?? map.Prob, 1);
    const orGroup = typeof map.orGroup === 'string' ? map.orGroup : undefined;
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(map)) {
      if (['id', 'entity', 'prototype', 'amount', 'prob', 'orGroup'].includes(key)) continue;
      extra[key] = value;
    }
    output.push({
      id: id.trim(),
      ...(amount !== 1 ? { amount } : {}),
      ...(prob !== 1 ? { prob } : {}),
      ...(orGroup ? { orGroup } : {}),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    });
  }
  return output;
}

function footprintFor(size: unknown): { width: number; height: number } {
  if (typeof size !== 'string') return { width: 1, height: 1 };
  switch (size.toLowerCase()) {
    case 'large':
      return { width: 2, height: 2 };
    case 'huge':
      return { width: 2, height: 2 };
    case 'tiny':
    case 'small':
    case 'normal':
    default:
      return { width: 1, height: 1 };
  }
}

/** Read the storage grid and spawn contents from resolved components. */
export function extractStorage(
  components: PrototypeComponent[],
  resolveItem?: StorageItemResolver,
): StorageView | null {
  const storage = components.find((component) => component.type === 'Storage');
  const fill = components.find((component) => component.type === 'StorageFill');
  if (!storage && !fill) return null;

  const diagnostics: Diagnostic[] = [];
  const grid = parseGrid(storage?.fields.grid);
  const contents = parseContents(fill?.fields.contents);
  const maxItemSize =
    typeof storage?.fields.maxItemSize === 'string'
      ? storage.fields.maxItemSize
      : null;

  if (!storage) {
    diagnostics.push({
      severity: 'info',
      code: 'prototype.storage.noStorage',
      message: 'StorageFill is present without a Storage component; the grid is approximate.',
      line: 1,
    });
  }
  if (storage && grid.length === 0) {
    diagnostics.push({
      severity: 'info',
      code: 'prototype.storage.noGrid',
      message: 'Storage has no explicit grid; showing an 8×4 default grid.',
      line: 1,
    });
  }

  const effectiveGrid =
    grid.length > 0
      ? grid
      : Array.from({ length: 32 }, (_, index) => ({
          index,
          x: index % 8,
          y: Math.floor(index / 8),
          width: 1,
          height: 1,
          raw: `${index % 8},${Math.floor(index / 8)},1,1`,
        }));
  const columns = Math.max(1, ...effectiveGrid.map((cell) => cell.x + cell.width));
  const rows = Math.max(1, ...effectiveGrid.map((cell) => cell.y + cell.height));

  if (contents.length > effectiveGrid.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'prototype.storage.overflow',
      message: `${contents.length} spawn entries do not fit the ${effectiveGrid.length}-slot storage grid.`,
      line: 1,
    });
  }

  const items: StorageItemView[] = [];
  const used = new Set<number>();
  let cursor = 0;
  for (const [index, content] of contents.entries()) {
    const resolution = resolveItem?.(content.id) ?? null;
    if (!resolution) {
      diagnostics.push({
        severity: 'warning',
        code: 'prototype.storage.unknownItem',
        message: `StorageFill entry "${content.id}" does not resolve to a prototype.`,
        line: 1,
      });
    }
    const footprint = resolution?.footprint ?? footprintFor(null);
    let slot: number | null = null;
    while (cursor < effectiveGrid.length) {
      const candidate = cursor++;
      if (used.has(candidate)) continue;
      const cell = effectiveGrid[candidate]!;
      if (cell.width < footprint.width || cell.height < footprint.height) continue;
      slot = candidate;
      used.add(candidate);
      break;
    }
    items.push({
      ...content,
      index,
      name: resolution?.name ?? content.id,
      kind: resolution?.kind ?? null,
      sprite: resolution?.sprite ?? null,
      slot,
      footprint,
    });
  }

  return {
    component: storage ? 'Storage' : 'StorageFill',
    hasStorage: Boolean(storage),
    hasFill: Boolean(fill),
    grid: effectiveGrid,
    columns,
    rows,
    items,
    maxItemSize,
    capacity: effectiveGrid.length,
    diagnostics,
  };
}
