import { constants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { PersistedLayout } from '@ss14-studio/core';
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  type RiderSettings,
} from './config.js';
import { ensureDirectory, isDirectory, pathExists } from './paths.js';

export interface StoredLayouts {
  [key: string]: PersistedLayout;
}

export class StateStore {
  readonly settingsPath: string;
  readonly layoutsPath: string;
  readonly uiStatePath: string;
  readonly scratchDir: string;

  settings: RiderSettings = structuredClone(DEFAULT_SETTINGS);
  layouts: StoredLayouts = {};
  uiState: unknown = {};
  readOnly = false;

  constructor(
    private readonly stateDir: string,
    private readonly projectRoot: string,
  ) {
    this.settingsPath = join(stateDir, 'settings.json');
    this.layoutsPath = join(stateDir, 'layouts.json');
    this.uiStatePath = join(stateDir, 'ui-state.json');
    this.scratchDir = join(stateDir, 'scratch');
  }

  async load(): Promise<void> {
    await ensureDirectory(this.stateDir);
    await ensureDirectory(this.scratchDir);
    this.settings = sanitizeSettings(await readJson(this.settingsPath));
    this.layouts = sanitizeLayouts(await readJson(this.layoutsPath));
    this.uiState = (await readJson(this.uiStatePath)) ?? {};
    this.readOnly = !(await canWrite(this.projectRoot));
  }

  async saveSettings(): Promise<void> {
    await writeJson(this.settingsPath, this.settings);
  }

  async saveLayouts(): Promise<void> {
    await writeJson(this.layoutsPath, this.layouts);
  }

  async saveUiState(state: unknown): Promise<void> {
    if (state == null || typeof state !== 'object') return;
    this.uiState = state;
    await writeJson(this.uiStatePath, state);
  }

  getLayout(key: string): PersistedLayout | undefined {
    return this.layouts[key];
  }

  setLayout(key: string, layout: PersistedLayout): void {
    this.layouts[key] = sanitizeLayout(layout);
    void this.saveLayouts();
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

let writeSequence = 0;
const writeQueues = new Map<string, Promise<void>>();

async function writeJson(path: string, value: unknown): Promise<void> {
  // Serialize writes per file: callers such as setLayout save in the
  // background, so two writes to the same path can otherwise race on the
  // temporary file and fail with ENOENT on rename.
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const temporary = `${path}.${process.pid}.${++writeSequence}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await fs.rename(temporary, path);
    })
    .finally(() => {
      if (writeQueues.get(path) === next) writeQueues.delete(path);
    });
  writeQueues.set(path, next);
  return next;
}

async function canWrite(path: string): Promise<boolean> {
  if (!(await pathExists(path)) || !(await isDirectory(path))) return false;
  try {
    await fs.access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function sanitizeLayouts(input: unknown): StoredLayouts {
  if (!input || typeof input !== 'object') return {};
  const result: StoredLayouts = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!key || !value || typeof value !== 'object') continue;
    result[key] = sanitizeLayout(value as PersistedLayout);
  }
  return result;
}

function sanitizeLayout(layout: PersistedLayout): PersistedLayout {
  const positions: PersistedLayout['positions'] = {};
  for (const [key, position] of Object.entries(layout.positions ?? {})) {
    if (
      position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      Math.abs(position.x) < 1_000_000 &&
      Math.abs(position.y) < 1_000_000
    ) {
      positions[key] = {
        x: Math.round(position.x * 100) / 100,
        y: Math.round(position.y * 100) / 100,
      };
    }
  }
  const zoom =
    typeof layout.zoom === 'number' && Number.isFinite(layout.zoom)
      ? Math.min(2.5, Math.max(0.1, layout.zoom))
      : undefined;
  return { positions, ...(zoom == null ? {} : { zoom }) };
}
