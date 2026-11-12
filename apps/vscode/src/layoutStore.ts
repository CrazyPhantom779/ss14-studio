import * as vscode from 'vscode';
import type { LayoutMap, PersistedLayout } from '@ss14-studio/core';

const STORAGE_KEY = 'ss14Studio.layouts.v1';

interface StoredLayouts {
  [key: string]: PersistedLayout;
}

export class LayoutStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private read(): StoredLayouts {
    const stored = this.context.workspaceState.get<StoredLayouts>(STORAGE_KEY);
    return stored && typeof stored === 'object' ? stored : {};
  }

  get(key: string): PersistedLayout | undefined {
    return this.read()[key];
  }

  set(key: string, layout: PersistedLayout): void {
    const all = this.read();
    all[key] = sanitize(layout);
    void this.context.workspaceState.update(STORAGE_KEY, all);
  }

  delete(key: string): void {
    const all = this.read();
    if (!(key in all)) return;
    delete all[key];
    void this.context.workspaceState.update(STORAGE_KEY, all);
  }
}

function sanitize(layout: PersistedLayout): PersistedLayout {
  const positions: LayoutMap = {};
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
