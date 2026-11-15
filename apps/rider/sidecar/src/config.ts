import type { StudioConfig } from '@ss14-studio/core';

export interface RiderSettings {
  config: StudioConfig;
  /** Update the studio when the active editor changes and the tool window is visible. */
  followEditor: boolean;
  /** Refresh the index when project files change. */
  autoRefresh: boolean;
}

export const DEFAULT_CONFIG: StudioConfig = {
  entityIcons: true,
  showGrid: true,
  animations: true,
  blueprintIntensity: 'balanced',
  graphSprites: true,
  graphEntityIds: true,
  graphStats: true,
  graphEdgeSteps: true,
  graphMinimap: true,
  graphLegend: true,
  graphControls: true,
  graphPathHighlight: true,
  graphCompact: false,
  graphEdgeStyle: 'bezier',
  graphNodeAccent: 'hash',
  prototypeCompact: false,
  prototypeShowResolved: true,
  autoSidePreview: false,
  defaultGraphEditor: false,
  xamlIndentSize: 4,
  rsiMetaIndent: 2,
  rsiMetaFinalNewline: true,
};

export const DEFAULT_SETTINGS: RiderSettings = {
  config: { ...DEFAULT_CONFIG },
  followEditor: true,
  autoRefresh: true,
};

const BOOLEAN_KEYS = [
  'entityIcons',
  'showGrid',
  'animations',
  'graphSprites',
  'graphEntityIds',
  'graphStats',
  'graphEdgeSteps',
  'graphMinimap',
  'graphLegend',
  'graphControls',
  'graphPathHighlight',
  'graphCompact',
  'prototypeCompact',
  'prototypeShowResolved',
  'autoSidePreview',
  'defaultGraphEditor',
  'rsiMetaFinalNewline',
] as const;

export function sanitizeConfig(input: unknown): StudioConfig {
  const record =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const config: StudioConfig = { ...DEFAULT_CONFIG };
  for (const key of BOOLEAN_KEYS) {
    if (typeof record[key] === 'boolean') {
      (config as unknown as Record<string, unknown>)[key] = record[key];
    }
  }
  if (
    record.blueprintIntensity === 'subtle' ||
    record.blueprintIntensity === 'balanced' ||
    record.blueprintIntensity === 'bold'
  ) {
    config.blueprintIntensity = record.blueprintIntensity;
  }
  if (
    record.graphEdgeStyle === 'bezier' ||
    record.graphEdgeStyle === 'step' ||
    record.graphEdgeStyle === 'straight'
  ) {
    config.graphEdgeStyle = record.graphEdgeStyle;
  }
  if (
    record.graphNodeAccent === 'hash' ||
    record.graphNodeAccent === 'kind' ||
    record.graphNodeAccent === 'mono'
  ) {
    config.graphNodeAccent = record.graphNodeAccent;
  }
  for (const key of ['xamlIndentSize', 'rsiMetaIndent'] as const) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      config[key] = Math.max(1, Math.min(8, Math.round(value)));
    }
  }
  // Keep the legacy alias in sync with its canonical setting.
  if (
    typeof record.graphSprites !== 'boolean' &&
    typeof record.entityIcons === 'boolean'
  ) {
    config.graphSprites = config.entityIcons;
  }
  config.entityIcons = config.graphSprites;
  return config;
}

export function sanitizeSettings(input: unknown): RiderSettings {
  const record =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  return {
    config: sanitizeConfig(record.config),
    followEditor:
      typeof record.followEditor === 'boolean'
        ? record.followEditor
        : DEFAULT_SETTINGS.followEditor,
    autoRefresh:
      typeof record.autoRefresh === 'boolean'
        ? record.autoRefresh
        : DEFAULT_SETTINGS.autoRefresh,
  };
}
