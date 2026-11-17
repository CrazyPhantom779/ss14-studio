/**
 * Storage, fill and container visualisation helpers.
 *
 * SS14 has several ways to put prototypes inside other prototypes:
 *
 * - `Storage` + `StorageFill.contents` (the classic storage grid)
 * - `ContainerFill.containers`
 * - `EntityTableContainerFill.containers`
 * - `startingGear.equipment` / `startingGear.storage` / `startingGear.inhand`
 * - `entityTable.table`
 * - `ItemSlots.slots[].startingItem`
 * - `listing.productEntity`
 *
 * This module flattens all of those forms into `StorageContainerView`s. Item
 * placement is an approximation of the engine's item storage: the declared
 * grid boxes are expanded into unit cells and items are first-fit packed by
 * their `Item.shape`/`Item.size` footprint.
 */
import type {
  Diagnostic,
  PrototypeComponent,
  StorageContainerView,
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
  /** `Item.storedRotation`, in degrees. */
  rotation?: number | null;
}

export type StorageItemResolver = (id: string) => StorageItemResolution | null;

export interface StorageTableResolution {
  id: string;
  fields: Record<string, unknown>;
}

export type StorageTableResolver = (id: string) => StorageTableResolution | null;

export interface StoragePrototypeContext {
  /** Prototype kind, used to recognise top-level container forms. */
  kind?: string;
  /** Resolved top-level fields, used for startingGear/entityTable/listing. */
  fields?: Record<string, unknown>;
}

interface FillEntry {
  content: StorageContentInput;
  /** True when this entry is one possible result of a GroupSelector. */
  alternative: boolean;
  /** Equipment slot / ItemSlots slot label. */
  slotName?: string;
}

interface ContainerInput {
  id: string;
  label: string;
  component: StorageContainerView['component'];
  entries: FillEntry[];
  grid: StorageGridCell[];
  maxItemSize: string | null;
  editable: boolean;
  /** Preferred column count for synthetic grids. */
  columns?: number;
  diagnostics?: Diagnostic[];
}

const DEFAULT_COLUMNS = 8;
const DEFAULT_ROWS = 4;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numeric(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringField(
  fields: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!fields) return null;
  const value = fields[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseGridCell(input: unknown, index: number): StorageGridCell | null {
  if (typeof input === 'string') {
    const parts = input
      .split(/[,\s]+/)
      .map((part) => Number(part.trim()))
      .filter((part) => Number.isFinite(part));
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

/** Build a rectangular unit grid. */
export function rectangularGrid(columns: number, rows: number): StorageGridCell[] {
  const width = Math.max(1, Math.round(columns));
  const height = Math.max(1, Math.round(rows));
  const grid: StorageGridCell[] = [];
  let index = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid.push({ index, x, y, width: 1, height: 1, raw: `${x},${y},1,1` });
      index++;
    }
  }
  return grid;
}

function contentFromMap(map: Record<string, unknown>): StorageContentInput | null {
  const id = map.id ?? map.entity ?? map.prototype ?? map.startingItem ?? map.Id;
  if (typeof id !== 'string' || !id.trim()) return null;
  const amount = numeric(map.amount ?? map.Amount, 1);
  const prob = numeric(map.prob ?? map.Prob, 1);
  const orGroup = typeof map.orGroup === 'string' ? map.orGroup : undefined;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    if (
      ['id', 'entity', 'prototype', 'startingItem', 'Id', 'amount', 'Amount', 'prob', 'Prob', 'orGroup', '$type'].includes(
        key,
      )
    ) {
      continue;
    }
    extra[key] = value;
  }
  return {
    id: id.trim(),
    ...(amount !== 1 ? { amount } : {}),
    ...(prob !== 1 ? { prob } : {}),
    ...(orGroup ? { orGroup } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

function entry(
  content: StorageContentInput,
  alternative: boolean,
  slotName?: string,
): FillEntry {
  return { content, alternative, ...(slotName ? { slotName } : {}) };
}

/**
 * Expand an entity selector tree (`AllSelector`, `GroupSelector`,
 * `NestedSelector`, `EntSelector`) or a direct list into fill entries.
 */
function selectorEntries(
  value: unknown,
  resolveTable: StorageTableResolver | undefined,
  depth = 0,
  alternative = false,
  slotName?: string,
): FillEntry[] {
  if (depth > 16 || value == null) return [];
  if (typeof value === 'string') {
    const id = value.trim();
    return id ? [entry({ id }, alternative, slotName)] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      selectorEntries(item, resolveTable, depth + 1, alternative, slotName),
    );
  }
  const map = record(value);
  if (!map) return [];
  const type = typeof map.$type === 'string' ? map.$type : null;

  if (type === 'NestedSelector') {
    const tableId = stringField(map, 'tableId');
    const table = tableId ? resolveTable?.(tableId) : null;
    if (!table) return [];
    const nested = table.fields.table ?? table.fields.contents ?? table.fields;
    return selectorEntries(nested, resolveTable, depth + 1, alternative, slotName);
  }

  if (type === 'AllSelector' || type === 'GroupSelector') {
    const children = Array.isArray(map.children) ? map.children : [];
    const childAlternative = alternative || type === 'GroupSelector';
    return children.flatMap((child) =>
      selectorEntries(child, resolveTable, depth + 1, childAlternative, slotName),
    );
  }

  // Number selectors are not entities; ignore them.
  if (type && /NumberSelector$/.test(type)) return [];

  const content = contentFromMap(map);
  return content ? [entry(content, alternative, slotName)] : [];
}

/** Parse a `shape:` list into an approximate bounding-box footprint. */
function shapeFootprint(shape: unknown): { width: number; height: number } | null {
  if (!Array.isArray(shape)) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const input of shape) {
    const box = parseGridCell(input, 0);
    if (!box) continue;
    found = true;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!found) return null;
  return {
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/** Approximate an entity's storage footprint from its `Item` component fields. */
export function itemFootprintFromFields(
  fields: Record<string, unknown> | null | undefined,
): { width: number; height: number } {
  if (!fields) return { width: 1, height: 1 };
  const shaped = shapeFootprint(fields.shape);
  if (shaped) return shaped;
  const size = typeof fields.size === 'string' ? fields.size.toLowerCase() : '';
  switch (size) {
    case 'large':
      return { width: 2, height: 2 };
    case 'huge':
      return { width: 3, height: 3 };
    case 'ginormous':
      return { width: 4, height: 4 };
    default:
      return { width: 1, height: 1 };
  }
}

/** Read `Item.storedRotation` in degrees. */
export function itemRotationFromFields(
  fields: Record<string, unknown> | null | undefined,
): number | null {
  if (!fields) return null;
  const value = fields.storedRotation;
  const rotation = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(rotation) ? rotation : null;
}

function labelFor(id: string): string {
  const known: Record<string, string> = {
    storagebase: 'Storage',
    entity_storage: 'Entity storage',
    item: 'Item',
    equipment: 'Equipment',
    inhand: 'In hand',
    itemslots: 'Item slots',
    table: 'Table',
    product: 'Product',
    back: 'Back',
    belt: 'Belt',
    suitstorage: 'Suit storage',
    hand: 'Hand',
    cell_slot: 'Cell slot',
    part_slot: 'Part slot',
  };
  const direct = known[id];
  if (direct) return direct;
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function syntheticGrid(count: number, columnsHint?: number): StorageGridCell[] {
  const columns = Math.max(
    1,
    Math.round(
      columnsHint ??
        (count <= 1 ? 1 : Math.min(DEFAULT_COLUMNS, Math.max(2, Math.ceil(Math.sqrt(count * 1.5))))),
    ),
  );
  const rows = Math.max(1, Math.ceil(Math.max(1, count) / columns));
  return rectangularGrid(columns, rows);
}

interface UnitCell {
  x: number;
  y: number;
  cell: StorageGridCell;
}

function unitCells(grid: StorageGridCell[]): UnitCell[] {
  const seen = new Set<string>();
  const cells: UnitCell[] = [];
  for (const cell of grid) {
    for (let y = cell.y; y < cell.y + cell.height; y++) {
      for (let x = cell.x; x < cell.x + cell.width; x++) {
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push({ x, y, cell });
      }
    }
  }
  cells.sort((a, b) => a.y - b.y || a.x - b.x);
  return cells;
}

function canPlace(
  x: number,
  y: number,
  width: number,
  height: number,
  available: Set<string>,
  occupied: Set<string>,
): boolean {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const key = `${x + dx},${y + dy}`;
      if (!available.has(key) || occupied.has(key)) return false;
    }
  }
  return true;
}

function buildContainer(
  input: ContainerInput,
  resolveItem: StorageItemResolver | undefined,
): StorageContainerView {
  const grid =
    input.grid.length > 0 ? input.grid : syntheticGrid(input.entries.length, input.columns);
  const units = unitCells(grid);
  const available = new Set(units.map((unit) => `${unit.x},${unit.y}`));
  const occupied = new Set<string>();
  const columns = Math.max(1, ...grid.map((cell) => cell.x + cell.width));
  const rows = Math.max(1, ...grid.map((cell) => cell.y + cell.height));
  const diagnostics: Diagnostic[] = [...(input.diagnostics ?? [])];

  const items: StorageItemView[] = [];
  for (const [index, fill] of input.entries.entries()) {
    const resolution = resolveItem?.(fill.content.id) ?? null;
    if (!resolution && !fill.alternative) {
      diagnostics.push({
        severity: 'warning',
        code: 'prototype.storage.unknownItem',
        message: `Container entry "${fill.content.id}" in ${input.id} does not resolve to a prototype.`,
        line: 1,
      });
    }
    let footprint = resolution?.footprint ?? { width: 1, height: 1 };
    const rotation = resolution?.rotation ?? null;
    let placement: UnitCell | null = null;
    for (const origin of units) {
      if (canPlace(origin.x, origin.y, footprint.width, footprint.height, available, occupied)) {
        placement = origin;
        break;
      }
    }
    // A 90/270 degree stored rotation swaps the effective footprint.
    if (
      !placement &&
      rotation != null &&
      Math.abs(rotation) % 180 !== 0 &&
      footprint.width !== footprint.height
    ) {
      const swapped = { width: footprint.height, height: footprint.width };
      for (const origin of units) {
        if (canPlace(origin.x, origin.y, swapped.width, swapped.height, available, occupied)) {
          placement = origin;
          footprint = swapped;
          break;
        }
      }
    }
    if (placement) {
      for (let dy = 0; dy < footprint.height; dy++) {
        for (let dx = 0; dx < footprint.width; dx++) {
          occupied.add(`${placement.x + dx},${placement.y + dy}`);
        }
      }
    }
    items.push({
      ...fill.content,
      index,
      name: resolution?.name ?? fill.content.id,
      kind: resolution?.kind ?? null,
      sprite: resolution?.sprite ?? null,
      slot: placement?.cell.index ?? null,
      footprint,
      container: input.id,
      ...(fill.slotName ? { slotName: fill.slotName } : {}),
      ...(rotation != null ? { rotation } : {}),
      ...(fill.alternative ? { alternative: true } : {}),
      ...(placement ? { x: placement.x, y: placement.y } : {}),
    });
  }

  const overflow = items.filter((item) => !item.alternative && item.slot == null).length;
  if (overflow > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'prototype.storage.overflow',
      message: `${overflow} spawn entr${overflow === 1 ? 'y' : 'ies'} in ${input.id} do not fit the ${grid.length}-cell storage grid.`,
      line: 1,
    });
  }

  return {
    id: input.id,
    label: input.label,
    component: input.component,
    grid,
    columns,
    rows,
    items,
    maxItemSize: input.maxItemSize,
    capacity: available.size,
    editable: input.editable,
    diagnostics,
  };
}

function gearContainers(
  fields: Record<string, unknown>,
  resolveTable: StorageTableResolver | undefined,
): ContainerInput[] {
  const containers: ContainerInput[] = [];
  const equipment = record(fields.equipment);
  if (equipment) {
    const entries: FillEntry[] = [];
    for (const [slotName, value] of Object.entries(equipment)) {
      entries.push(...selectorEntries(value, resolveTable, 0, false, slotName));
    }
    if (entries.length > 0) {
      containers.push({
        id: 'equipment',
        label: 'Equipment',
        component: 'startingGear',
        entries,
        grid: [],
        maxItemSize: null,
        editable: false,
        columns: Math.min(4, Math.max(1, entries.length)),
      });
    }
  }

  const storage = record(fields.storage);
  if (storage) {
    for (const [id, value] of Object.entries(storage)) {
      const entries = selectorEntries(value, resolveTable);
      if (entries.length === 0) continue;
      containers.push({
        id,
        label: labelFor(id),
        component: 'startingGear',
        entries,
        grid: [],
        maxItemSize: null,
        editable: false,
      });
    }
  }

  const inhand = fields.inhand;
  if (inhand != null) {
    const entries = selectorEntries(inhand, resolveTable);
    if (entries.length > 0) {
      containers.push({
        id: 'inhand',
        label: 'In hand',
        component: 'startingGear',
        entries,
        grid: [],
        maxItemSize: null,
        editable: false,
        columns: Math.min(4, Math.max(1, entries.length)),
      });
    }
  }
  return containers;
}

/**
 * Read every storage/fill/container form from resolved components and
 * top-level prototype fields.
 */
export function extractStorage(
  components: PrototypeComponent[],
  resolveItem?: StorageItemResolver,
  resolveTable?: StorageTableResolver,
  context: StoragePrototypeContext = {},
): StorageView | null {
  const find = (type: string) =>
    components.find((component) => component.type === type);
  const storage = find('Storage');
  const fill = find('StorageFill');
  const containerFill = find('ContainerFill');
  const tableFill = find('EntityTableContainerFill');
  const itemSlots = find('ItemSlots');
  const fields = context.fields ?? {};
  const diagnostics: Diagnostic[] = [];
  const inputs: ContainerInput[] = [];

  if (storage || fill) {
    const grid = parseGrid(storage?.fields.grid);
    const maxItemSize =
      typeof storage?.fields.maxItemSize === 'string'
        ? storage.fields.maxItemSize
        : null;
    if (!storage) {
      diagnostics.push({
        severity: 'info',
        code: 'prototype.storage.noStorage',
        message:
          'StorageFill is present without a Storage component; the grid is approximate.',
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
      grid.length > 0 ? grid : rectangularGrid(DEFAULT_COLUMNS, DEFAULT_ROWS);
    const entries = fill
      ? selectorEntries(fill.fields.contents, resolveTable)
      : [];
    inputs.push({
      id: 'storagebase',
      label: 'Storage',
      component: storage ? 'Storage' : 'StorageFill',
      entries,
      grid: effectiveGrid,
      maxItemSize,
      editable: Boolean(fill),
      diagnostics: diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === 'prototype.storage.noStorage' ||
          diagnostic.code === 'prototype.storage.noGrid',
      ),
    });
  }

  const directContainers = record(containerFill?.fields.containers);
  if (directContainers) {
    for (const [id, value] of Object.entries(directContainers)) {
      const entries = selectorEntries(value, resolveTable);
      if (entries.length === 0) continue;
      inputs.push({
        id,
        label: labelFor(id),
        component: 'ContainerFill',
        entries,
        grid: [],
        maxItemSize: null,
        editable: false,
      });
    }
  }

  const tableContainers = record(tableFill?.fields.containers);
  if (tableContainers) {
    for (const [id, value] of Object.entries(tableContainers)) {
      const entries = selectorEntries(value, resolveTable);
      if (entries.length === 0) continue;
      inputs.push({
        id,
        label: labelFor(id),
        component: 'EntityTableContainerFill',
        entries,
        grid: [],
        maxItemSize: null,
        editable: false,
      });
    }
  }

  const slots = record(itemSlots?.fields.slots);
  if (slots) {
    const entries: FillEntry[] = [];
    for (const [slotName, value] of Object.entries(slots)) {
      const map = record(value);
      if (!map) continue;
      const starting = contentFromMap(map);
      if (starting) entries.push(entry(starting, false, slotName));
    }
    if (entries.length > 0) {
      inputs.push({
        id: 'itemslots',
        label: 'Item slots',
        component: 'ItemSlots',
        entries,
        grid: [],
        maxItemSize: null,
        editable: false,
        columns: Math.min(4, Math.max(1, entries.length)),
      });
    }
  }

  inputs.push(...gearContainers(fields, resolveTable));

  const table = fields.table;
  if (table != null) {
    const entries = selectorEntries(table, resolveTable);
    if (entries.length > 0) {
      inputs.push({
        id: 'table',
        label: 'Table',
        component: 'entityTable',
        entries,
        grid: [],
        maxItemSize: null,
        editable: false,
      });
    }
  }

  const product =
    stringField(fields, 'productEntity') ?? stringField(fields, 'product');
  if (product && context.kind === 'listing') {
    inputs.push({
      id: 'product',
      label: 'Product',
      component: 'listing',
      entries: [entry({ id: product }, false)],
      grid: [],
      maxItemSize: null,
      editable: false,
      columns: 1,
    });
  }

  if (inputs.length === 0) return null;

  const containers = inputs.map((input) =>
    buildContainer(input, resolveItem),
  );
  for (const container of containers) {
    diagnostics.push(...container.diagnostics);
  }
  const primary =
    containers.find((container) => container.id === 'storagebase') ??
    containers[0]!;

  return {
    component: primary.component,
    hasStorage: Boolean(storage),
    hasFill: Boolean(fill),
    grid: primary.grid,
    columns: primary.columns,
    rows: primary.rows,
    items: primary.items,
    maxItemSize: primary.maxItemSize,
    capacity: primary.capacity,
    containers,
    diagnostics: dedupeDiagnostics(diagnostics),
  };
}

function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const output: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(diagnostic);
  }
  return output;
}
