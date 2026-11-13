/**
 * RSI (Robust Sprite Image) metadata parsing, validation and editing.
 *
 * An RSI is a directory containing `meta.json` and one PNG per state. The PNG
 * is a row-major sheet of `size`-sized frames. Directional animation frames
 * are concatenated in direction order, exactly like RobustToolbox does.
 */
import type {
  Diagnostic,
  RsiImageInfo,
  RsiMeta,
  RsiOperation,
  RsiOperationResult,
  RsiStateMeta,
  RsiStateView,
  RsiView,
} from './model.js';

export interface ParsedRsiMeta {
  meta: RsiMeta;
  diagnostics: Diagnostic[];
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeState(input: unknown, index: number, diagnostics: Diagnostic[]): RsiStateMeta | null {
  if (!input || typeof input !== 'object') {
    diagnostics.push({
      severity: 'warning',
      code: 'rsi.state.invalid',
      message: `State #${index + 1} is not an object.`,
      line: 1,
    });
    return null;
  }
  const record = input as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : '';
  if (!name) {
    diagnostics.push({
      severity: 'error',
      code: 'rsi.state.name',
      message: `State #${index + 1} is missing its name.`,
      line: 1,
    });
    return null;
  }
  const directions = record.directions == null ? 1 : asNumber(record.directions, 1);
  if (![1, 4, 8].includes(directions)) {
    diagnostics.push({
      severity: 'warning',
      code: 'rsi.state.directions',
      message: `State "${name}" has ${directions} directions; RobustToolbox supports 1, 4 or 8.`,
      line: 1,
    });
  }
  const delaysInput = record.delays;
  let delays: number[][] = [];
  if (Array.isArray(delaysInput)) {
    delays = delaysInput.map((direction, directionIndex) => {
      if (!Array.isArray(direction)) {
        diagnostics.push({
          severity: 'warning',
          code: 'rsi.state.delays',
          message: `State "${name}" direction ${directionIndex + 1} has no delay list.`,
          line: 1,
        });
        return [0.1];
      }
      const list = direction.map((delay) => asNumber(delay, 0.1));
      return list.length > 0 ? list : [0.1];
    });
  }
  if (delays.length === 0) {
    delays = Array.from({ length: Math.max(1, directions) }, () => [0.1]);
  }
  while (delays.length < directions) {
    delays.push([...(delays[delays.length - 1] ?? [0.1])]);
  }
  if (delays.length !== directions) {
    diagnostics.push({
      severity: 'warning',
      code: 'rsi.state.delays.mismatch',
      message: `State "${name}" has ${delays.length} delay lists but ${directions} directions.`,
      line: 1,
    });
    delays = delays.slice(0, directions);
  }

  const flags: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (['name', 'directions', 'delays'].includes(key)) continue;
    flags[key] = value;
  }
  return {
    name,
    directions,
    delays,
    ...(Object.keys(flags).length > 0 ? { flags } : {}),
  };
}

export function parseRsiMeta(source: string, filePath = 'meta.json'): ParsedRsiMeta {
  const diagnostics: Diagnostic[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return {
      meta: { states: [] },
      diagnostics: [
        {
          severity: 'error',
          code: 'rsi.json',
          message: `${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          line: 1,
        },
      ],
    };
  }
  if (!raw || typeof raw !== 'object') {
    return {
      meta: { states: [] },
      diagnostics: [
        {
          severity: 'error',
          code: 'rsi.json.object',
          message: 'meta.json must contain a JSON object.',
          line: 1,
        },
      ],
    };
  }
  const record = raw as Record<string, unknown>;
  const statesInput = Array.isArray(record.states) ? record.states : [];
  if (!Array.isArray(record.states)) {
    diagnostics.push({
      severity: 'error',
      code: 'rsi.states.missing',
      message: 'meta.json has no states array.',
      line: 1,
    });
  }

  const states: RsiStateMeta[] = [];
  const names = new Set<string>();
  statesInput.forEach((state, index) => {
    const normalized = normalizeState(state, index, diagnostics);
    if (!normalized) return;
    if (names.has(normalized.name)) {
      diagnostics.push({
        severity: 'error',
        code: 'rsi.state.duplicate',
        message: `Duplicate state name "${normalized.name}".`,
        line: 1,
      });
      return;
    }
    names.add(normalized.name);
    states.push(normalized);
  });

  const size = record.size && typeof record.size === 'object'
    ? {
        x: asNumber((record.size as Record<string, unknown>).x, 32),
        y: asNumber((record.size as Record<string, unknown>).y, 32),
      }
    : undefined;
  if (!size || size.x <= 0 || size.y <= 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'rsi.size',
      message: 'meta.json has no valid size; assuming 32×32.',
      line: 1,
    });
  }

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (
      ['version', 'license', 'copyright', 'size', 'load', 'metaAtlas', 'rsic', 'states'].includes(
        key,
      )
    ) {
      continue;
    }
    extra[key] = value;
  }

  const meta: RsiMeta = {
    ...(typeof record.version === 'number' ? { version: record.version } : {}),
    ...(typeof record.license === 'string' ? { license: record.license } : {}),
    ...(typeof record.copyright === 'string' ? { copyright: record.copyright } : {}),
    ...(size ? { size } : {}),
    ...(record.load && typeof record.load === 'object'
      ? { load: record.load as { srgb?: string } }
      : {}),
    ...(typeof record.metaAtlas === 'boolean' ? { metaAtlas: record.metaAtlas } : {}),
    ...(typeof record.rsic === 'boolean' ? { rsic: record.rsic } : {}),
    states,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
  return { meta, diagnostics };
}

/** Compute how many frames each direction contributes. */
export function directionFrameCounts(state: RsiStateMeta): number[] {
  const directions = Math.max(1, state.directions);
  return Array.from({ length: directions }, (_, direction) => {
    return state.delays[direction]?.length ?? state.delays[0]?.length ?? 1;
  });
}

/** Absolute frame indices in the state PNG, one array per direction. */
export function directionFrameIndices(state: RsiStateMeta): number[][] {
  const counts = directionFrameCounts(state);
  let offset = 0;
  return counts.map((count) => {
    const indices = Array.from({ length: count }, (_, frame) => offset + frame);
    offset += count;
    return indices;
  });
}

export function buildRsiStateView(
  meta: RsiMeta,
  state: RsiStateMeta,
  image: RsiImageInfo,
): RsiStateView {
  const size = meta.size ?? { x: 32, y: 32 };
  const frameWidth = Math.max(1, size.x);
  const frameHeight = Math.max(1, size.y);
  const columns = image.exists && image.width > 0 ? Math.max(1, Math.floor(image.width / frameWidth)) : 1;
  const rows = image.exists && image.height > 0 ? Math.max(1, Math.floor(image.height / frameHeight)) : 1;
  const directionFrames = directionFrameCounts(state);
  const directionIndices = directionFrameIndices(state);
  const frameCount = directionFrames.reduce((sum, count) => sum + count, 0);
  const totalDuration = (state.delays[0] ?? []).reduce((sum, delay) => sum + delay, 0);
  return {
    ...state,
    frameCount,
    directionFrames,
    totalDuration: Math.round(totalDuration * 1000) / 1000,
    image,
    columns,
    rows,
    frameWidth,
    frameHeight,
    directionIndices,
    missing: !image.exists,
  };
}

export function buildRsiView(input: {
  dirPath: string;
  relativePath: string;
  metaPath: string;
  meta: RsiMeta;
  images: Record<string, RsiImageInfo>;
  diagnostics?: Diagnostic[];
  orphanImages?: string[];
}): RsiView {
  const size = input.meta.size ?? { x: 32, y: 32 };
  const meta = { ...input.meta, size };
  const states = meta.states.map((state) =>
    buildRsiStateView(
      meta,
      state,
      input.images[state.name] ?? {
        path: `${state.name}.png`,
        exists: false,
        width: 0,
        height: 0,
        uri: null,
      },
    ),
  );
  const diagnostics = [...(input.diagnostics ?? [])];
  for (const state of states) {
    if (state.missing) {
      diagnostics.push({
        severity: 'error',
        code: 'rsi.image.missing',
        message: `State "${state.name}" has no ${state.name}.png.`,
        line: 1,
      });
    } else {
      if (state.image.width % state.frameWidth !== 0 || state.image.height % state.frameHeight !== 0) {
        diagnostics.push({
          severity: 'warning',
          code: 'rsi.image.size',
          message: `State "${state.name}" image ${state.image.width}×${state.image.height} is not a multiple of ${state.frameWidth}×${state.frameHeight}.`,
          line: 1,
        });
      }
      const requiredRows = Math.ceil(state.frameCount / Math.max(1, state.columns));
      if (requiredRows > state.rows) {
        diagnostics.push({
          severity: 'warning',
          code: 'rsi.image.frames',
          message: `State "${state.name}" needs ${state.frameCount} frame(s) but its sheet only has ${state.columns * state.rows}.`,
          line: 1,
        });
      }
    }
    if (state.directionFrames.some((count) => count !== state.directionFrames[0])) {
      diagnostics.push({
        severity: 'warning',
        code: 'rsi.state.frame-count',
        message: `State "${state.name}" has different frame counts per direction; the engine folds these at load time.`,
        line: 1,
      });
    }
  }

  return {
    dirPath: input.dirPath,
    relativePath: input.relativePath,
    metaPath: input.metaPath,
    meta,
    states,
    diagnostics,
    license: meta.license ?? null,
    copyright: meta.copyright ?? null,
    metaAtlas: meta.metaAtlas ?? true,
    rsic: meta.rsic ?? true,
    size,
    orphanImages: input.orphanImages ?? [],
  };
}

function cleanDelays(state: RsiStateMeta): number[][] {
  const directions = [1, 4, 8].includes(state.directions) ? state.directions : 1;
  const source = state.delays.length > 0 ? state.delays : [[0.1]];
  const delays = Array.from({ length: directions }, (_, index) => {
    const list = source[index] ?? source[source.length - 1] ?? [0.1];
    return list.length > 0
      ? list.map((delay) => (Number.isFinite(delay) && delay >= 0 ? delay : 0.1))
      : [0.1];
  });
  const target = delays[0]!.length;
  for (const list of delays) {
    while (list.length < target) list.push(list[list.length - 1] ?? 0.1);
    if (list.length > target) list.length = target;
  }
  return delays;
}

/** Apply an RSI operation to metadata. File-system work is handled by the host. */
export function applyRsiOperation(meta: RsiMeta, operation: RsiOperation): RsiOperationResult {
  const next: RsiMeta = {
    ...meta,
    size: meta.size ? { ...meta.size } : { x: 32, y: 32 },
    load: meta.load ? { ...meta.load } : undefined,
    states: meta.states.map((state) => ({
      ...state,
      delays: state.delays.map((list) => [...list]),
      flags: state.flags ? { ...state.flags } : undefined,
    })),
  };
  const notes: string[] = [];
  let message = '';
  let changed = true;

  const state = (name: string) => next.states.find((candidate) => candidate.name === name);

  switch (operation.kind) {
    case 'setMeta': {
      if (operation.field === 'version') {
        if (typeof operation.value === 'number') next.version = operation.value;
        else delete next.version;
      } else if (operation.field === 'metaAtlas') {
        next.metaAtlas = operation.value === true;
      } else if (operation.field === 'rsic') {
        next.rsic = operation.value === true;
      } else if (operation.field === 'license') {
        if (typeof operation.value === 'string' && operation.value) next.license = operation.value;
        else delete next.license;
      } else if (operation.field === 'copyright') {
        if (typeof operation.value === 'string' && operation.value) next.copyright = operation.value;
        else delete next.copyright;
      }
      message = `Updated ${operation.field}.`;
      break;
    }
    case 'setSize': {
      next.size = {
        x: Math.max(1, Math.round(operation.width)),
        y: Math.max(1, Math.round(operation.height)),
      };
      message = `Frame size set to ${next.size.x}×${next.size.y}.`;
      break;
    }
    case 'addState': {
      if (state(operation.state.name)) {
        return { meta, changed: false, message: 'That state already exists.', notes };
      }
      next.states.push({
        ...operation.state,
        delays: operation.state.delays.length > 0 ? operation.state.delays.map((d) => [...d]) : [[0.1]],
      });
      message = `Added state "${operation.state.name}".`;
      break;
    }
    case 'removeState': {
      const before = next.states.length;
      next.states = next.states.filter((candidate) => candidate.name !== operation.state);
      changed = next.states.length !== before;
      message = changed ? `Removed state "${operation.state}".` : 'That state was already gone.';
      break;
    }
    case 'renameState': {
      const target = state(operation.state);
      if (!target) return { meta, changed: false, message: 'State not found.', notes };
      if (operation.name && operation.name !== operation.state) {
        if (state(operation.name)) {
          return { meta, changed: false, message: 'A state with that name already exists.', notes };
        }
        target.name = operation.name;
      }
      message = `Renamed state to "${target.name}".`;
      break;
    }
    case 'setDirections': {
      const target = state(operation.state);
      if (!target) return { meta, changed: false, message: 'State not found.', notes };
      target.directions = [1, 4, 8].includes(operation.directions) ? operation.directions : 1;
      target.delays = cleanDelays(target);
      message = `Set "${target.name}" to ${target.directions} directions.`;
      break;
    }
    case 'setDelays': {
      const target = state(operation.state);
      if (!target) return { meta, changed: false, message: 'State not found.', notes };
      target.delays = operation.delays.map((list) => list.map((value) => Math.max(0, value)));
      target.delays = cleanDelays(target);
      message = `Updated delays for "${target.name}".`;
      break;
    }
    case 'setFrameDelay': {
      const target = state(operation.state);
      if (!target) return { meta, changed: false, message: 'State not found.', notes };
      const list = target.delays[operation.direction];
      if (!list || operation.frame < 0 || operation.frame >= list.length) {
        return { meta, changed: false, message: 'Frame not found.', notes };
      }
      list[operation.frame] = Math.max(0, operation.delay);
      message = `Frame delay set to ${list[operation.frame]}s.`;
      break;
    }
    case 'addFrame': {
      const target = state(operation.state);
      if (!target) return { meta, changed: false, message: 'State not found.', notes };
      target.delays = target.delays.map((list, index) => {
        if (operation.afterDirection != null && index !== operation.afterDirection) return list;
        return [...list, list[list.length - 1] ?? 0.1];
      });
      message = `Added a frame to "${target.name}".`;
      break;
    }
    case 'duplicateFrame': {
      const target = state(operation.state);
      if (!target) return { meta, changed: false, message: 'State not found.', notes };
      const list = target.delays[operation.direction];
      if (!list || !list[operation.frame]) {
        return { meta, changed: false, message: 'Frame not found.', notes };
      }
      const delay = list[operation.frame]!;
      target.delays = target.delays.map((direction) => [...direction, delay]);
      message = `Duplicated frame ${operation.frame + 1} into every direction.`;
      break;
    }
    case 'removeFrame': {
      const target = state(operation.state);
      if (!target) return { meta, changed: false, message: 'State not found.', notes };
      const anyList = target.delays[0] ?? [];
      if (anyList.length <= 1) {
        return { meta, changed: false, message: 'A state needs at least one frame.', notes };
      }
      target.delays = target.delays.map((list) => {
        if (list.length <= 1) return list;
        return list.filter((_, index) => index !== Math.min(operation.frame, list.length - 1));
      });
      message = `Removed frame ${operation.frame + 1} from "${target.name}" in every direction.`;
      break;
    }
    case 'cleanup': {
      let fixes = 0;
      if (!next.version) {
        next.version = 1;
        fixes++;
      }
      if (!next.size || next.size.x <= 0 || next.size.y <= 0) {
        next.size = { x: 32, y: 32 };
        fixes++;
      }
      for (const target of next.states) {
        const cleaned = cleanDelays(target);
        if (JSON.stringify(cleaned) !== JSON.stringify(target.delays)) {
          target.delays = cleaned;
          fixes++;
        }
        if (![1, 4, 8].includes(target.directions)) {
          target.directions = 1;
          fixes++;
        }
        if (!target.name.trim()) {
          notes.push('A state has an empty name and must be renamed manually.');
        }
      }
      const seen = new Set<string>();
      next.states = next.states.filter((target) => {
        if (seen.has(target.name)) {
          fixes++;
          notes.push(`Removed duplicate state "${target.name}".`);
          return false;
        }
        seen.add(target.name);
        return true;
      });
      message = fixes > 0 ? `Applied ${fixes} cleanup fix(es).` : 'RSI metadata is already clean.';
      changed = fixes > 0;
      break;
    }
    default:
      changed = false;
      message = 'Unsupported RSI operation.';
  }

  return { meta: next, changed, message, notes };
}

export function serializeRsiMeta(meta: RsiMeta): string {
  const output: Record<string, unknown> = {
    version: meta.version ?? 1,
  };
  if (meta.license) output.license = meta.license;
  if (meta.copyright) output.copyright = meta.copyright;
  output.size = meta.size ?? { x: 32, y: 32 };
  if (meta.load) output.load = meta.load;
  if (meta.metaAtlas === false) output.metaAtlas = false;
  if (meta.rsic === false) output.rsic = false;
  if (meta.extra) Object.assign(output, meta.extra);
  output.states = meta.states.map((state) => ({
    name: state.name,
    directions: state.directions,
    delays: state.delays,
    ...(state.flags ?? {}),
  }));
  return `${JSON.stringify(output, null, 2)}\n`;
}

/** Find PNG files in an RSI directory that no state references. */
export function findOrphanImages(
  meta: RsiMeta,
  files: string[],
): string[] {
  const used = new Set(meta.states.map((state) => `${state.name}.png`));
  return files
    .filter((file) => file.toLowerCase().endsWith('.png'))
    .filter((file) => !used.has(file))
    .sort();
}
