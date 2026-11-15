import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_SETTINGS,
  sanitizeConfig,
  sanitizeSettings,
} from '../src/config.js';

describe('Rider settings', () => {
  it('exposes safe defaults', () => {
    expect(DEFAULT_CONFIG).toMatchObject({
      entityIcons: true,
      graphSprites: true,
      showGrid: true,
      blueprintIntensity: 'balanced',
      graphEdgeStyle: 'bezier',
      graphNodeAccent: 'hash',
      autoSidePreview: false,
      defaultGraphEditor: false,
    });
    expect(DEFAULT_SETTINGS).toEqual({
      config: DEFAULT_CONFIG,
      followEditor: true,
      autoRefresh: true,
    });
    expect(DEFAULT_SETTINGS.config).not.toBe(DEFAULT_CONFIG);
  });

  it('ignores malformed input and preserves known values', () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig('nope')).toEqual(DEFAULT_CONFIG);
    expect(
      sanitizeConfig({
        entityIcons: false,
        graphSprites: false,
        graphStats: false,
        showGrid: 'yes',
        blueprintIntensity: 'bold',
        graphEdgeStyle: 'step',
        graphNodeAccent: 'mono',
      }),
    ).toMatchObject({
      entityIcons: false,
      graphSprites: false,
      graphStats: false,
      showGrid: true,
      blueprintIntensity: 'bold',
      graphEdgeStyle: 'step',
      graphNodeAccent: 'mono',
    });
  });

  it('rejects unknown enum values', () => {
    const config = sanitizeConfig({
      blueprintIntensity: 'extreme',
      graphEdgeStyle: 'curvy',
      graphNodeAccent: 'rainbow',
    });
    expect(config.blueprintIntensity).toBe(DEFAULT_CONFIG.blueprintIntensity);
    expect(config.graphEdgeStyle).toBe(DEFAULT_CONFIG.graphEdgeStyle);
    expect(config.graphNodeAccent).toBe(DEFAULT_CONFIG.graphNodeAccent);
  });

  it('keeps the legacy graphSprites/entityIcons aliases in sync', () => {
    expect(sanitizeConfig({ entityIcons: false })).toMatchObject({
      entityIcons: false,
      graphSprites: false,
    });
    expect(sanitizeConfig({ graphSprites: false })).toMatchObject({
      entityIcons: false,
      graphSprites: false,
    });
    expect(sanitizeConfig({ graphSprites: true, entityIcons: false })).toMatchObject({
      entityIcons: true,
      graphSprites: true,
    });
    expect(sanitizeConfig({ graphSprites: false, entityIcons: true })).toMatchObject({
      entityIcons: false,
      graphSprites: false,
    });
  });

  it('sanitizes top-level preferences', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(
      sanitizeSettings({
        config: { showGrid: false },
        followEditor: false,
        autoRefresh: false,
      }),
    ).toEqual({
      config: { ...DEFAULT_CONFIG, showGrid: false },
      followEditor: false,
      autoRefresh: false,
    });
    expect(
      sanitizeSettings({ followEditor: 'no', autoRefresh: 1 }).config,
    ).toEqual(DEFAULT_CONFIG);
    expect(sanitizeSettings({ followEditor: 'no' }).followEditor).toBe(true);
  });
});
