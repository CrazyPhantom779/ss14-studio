import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { StateStore } from '../src/state.js';

let root = '';
let stateDir = '';
let projectRoot = '';

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'ss14-state-'));
  stateDir = join(root, '.idea', 'ss14-studio');
  projectRoot = join(root, 'project');
  await fs.mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('state store', () => {
  it('creates state directories and loads defaults', async () => {
    const store = new StateStore(stateDir, projectRoot);
    await store.load();
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    expect(store.layouts).toEqual({});
    expect(store.uiState).toEqual({});
    expect(store.readOnly).toBe(false);
    expect(await fs.stat(stateDir)).toBeTruthy();
    expect(await fs.stat(store.scratchDir)).toBeTruthy();
  });

  it('persists settings and reloads them with sanitization', async () => {
    const store = new StateStore(stateDir, projectRoot);
    await store.load();
    store.settings.config.showGrid = false;
    store.settings.followEditor = false;
    await store.saveSettings();

    const reloaded = new StateStore(stateDir, projectRoot);
    await reloaded.load();
    expect(reloaded.settings.config.showGrid).toBe(false);
    expect(reloaded.settings.followEditor).toBe(false);
    expect(reloaded.settings.autoRefresh).toBe(true);
  });

  it('sanitizes layouts, rounds positions and clamps zoom', async () => {
    const store = new StateStore(stateDir, projectRoot);
    await store.load();
    store.setLayout('graph-a', {
      positions: {
        start: { x: 10.126, y: 20.129 },
        bad: { x: Number.POSITIVE_INFINITY, y: 1 },
        tooFar: { x: 2_000_000, y: 1 },
      },
      zoom: 10,
    });
    await store.saveLayouts();
    expect(store.getLayout('graph-a')).toEqual({
      positions: { start: { x: 10.13, y: 20.13 } },
      zoom: 2.5,
    });
    expect(store.getLayout('missing')).toBeUndefined();

    const reloaded = new StateStore(stateDir, projectRoot);
    await reloaded.load();
    expect(reloaded.getLayout('graph-a')).toEqual(store.getLayout('graph-a'));
  });

  it('persists UI state only when it is an object', async () => {
    const store = new StateStore(stateDir, projectRoot);
    await store.load();
    await store.saveUiState({ graph: { zoom: 1.2 } });
    expect(store.uiState).toEqual({ graph: { zoom: 1.2 } });
    await store.saveUiState(null);
    expect(store.uiState).toEqual({ graph: { zoom: 1.2 } });
    await store.saveUiState('ignored');
    expect(store.uiState).toEqual({ graph: { zoom: 1.2 } });

    const reloaded = new StateStore(stateDir, projectRoot);
    await reloaded.load();
    expect(reloaded.uiState).toEqual({ graph: { zoom: 1.2 } });
  });

  it('ignores corrupt JSON and malformed layouts', async () => {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(join(stateDir, 'settings.json'), '{not json', 'utf8');
    await fs.writeFile(
      join(stateDir, 'layouts.json'),
      JSON.stringify({ good: { positions: { a: { x: 1, y: 2 } } }, bad: 'nope' }),
      'utf8',
    );
    await fs.writeFile(join(stateDir, 'ui-state.json'), '{bad', 'utf8');
    const store = new StateStore(stateDir, projectRoot);
    await store.load();
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    expect(store.layouts).toEqual({ good: { positions: { a: { x: 1, y: 2 } } } });
    expect(store.uiState).toEqual({});
  });

  it('flags a missing project root as read-only', async () => {
    const store = new StateStore(stateDir, join(root, 'missing'));
    await store.load();
    expect(store.readOnly).toBe(true);
  });
});
