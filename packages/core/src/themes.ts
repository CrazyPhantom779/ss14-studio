/**
 * UI theme extraction for the XAML designer.
 *
 * SS14 projects describe interface palettes in two prototype kinds:
 *
 * - `styleTheme` (Starlight and downstream forks): a rich palette with
 *   background/surface/element/text/accent fields and optional nine-slice
 *   window/header/button textures.
 * - `uiTheme` (upstream): a texture directory plus a `colors` map used by
 *   item slots and status colours.
 *
 * The designer needs a stable, small palette, so this module normalises both
 * forms into `XamlTheme` and keeps the original keys available in `colors`.
 */
import type { RawPrototype, ResolvedPrototype, XamlTheme } from './model.js';

export interface XamlThemeSource {
  records: RawPrototype[];
  resolve(id: string, kind?: string): ResolvedPrototype | null;
  localization?: Map<string, string>;
}

const STYLE_COLOR_KEYS = [
  'background',
  'windowBackground',
  'surface',
  'surfaceInspect',
  'surfaceRaised',
  'element',
  'elementHovered',
  'elementDisabled',
  'border',
  'secondaryBorder',
  'text',
  'textMuted',
  'textDisabled',
  'accent',
  'secondaryAccent',
  'positive',
  'negative',
  'warning',
  'danger',
] as const;

/** Built-in fallback that matches the upstream dark Nano palette closely. */
export const DEFAULT_XAML_THEME: XamlTheme = {
  id: 'ss14-default',
  name: 'SS14 default (Nano)',
  kind: 'uiTheme',
  light: false,
  colors: {
    background: '#1B1B1F',
    windowBackground: '#252632',
    surface: '#2F2F3B',
    surfaceRaised: '#343541',
    element: '#424665',
    elementHovered: '#4F5376',
    elementDisabled: '#2B2D40',
    border: '#3F4159',
    text: '#FEFEFE',
    textMuted: '#A9A9B3',
    textDisabled: '#6E6E78',
    accent: '#A88B5E',
    secondaryAccent: '#126128',
    positive: '#31843E',
    negative: '#BB3232',
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function localized(
  value: string | null,
  localization: Map<string, string> | undefined,
): string | null {
  if (!value) return null;
  return localization?.get(value) ?? value;
}

function texturePath(value: unknown): string | null {
  const map = asRecord(value);
  const path = map ? stringValue(map.texture) : null;
  return path?.replace(/^\/+/, '').replace(/^Resources\//i, '') ?? null;
}

function themeFromStyle(
  record: RawPrototype,
  resolved: ResolvedPrototype,
  localization: Map<string, string> | undefined,
): XamlTheme {
  const colors: Record<string, string> = {};
  for (const key of STYLE_COLOR_KEYS) {
    const value = stringValue(resolved.fields[key]);
    if (value) colors[key] = value;
  }
  const textures: Record<string, string> = {};
  for (const key of ['window', 'header', 'button', 'panel']) {
    const path = texturePath(resolved.fields[key]);
    if (path) textures[key] = path;
  }
  const name =
    localized(stringValue(resolved.fields.name), localization) ??
    record.id;
  return {
    id: record.id,
    name,
    kind: 'styleTheme',
    light: booleanValue(resolved.fields.light),
    colors,
    path: textures.window ? textures.window.replace(/\/[^/]+$/, '/') : null,
    ...(Object.keys(textures).length > 0 ? { texturePaths: textures } : {}),
  };
}

function themeFromUi(
  record: RawPrototype,
  resolved: ResolvedPrototype,
  localization: Map<string, string> | undefined,
): XamlTheme {
  const colors: Record<string, string> = {};
  const source = asRecord(resolved.fields.colors);
  if (source) {
    for (const [key, value] of Object.entries(source)) {
      const color = stringValue(value);
      if (color) colors[key] = color;
    }
  }
  // Keep the common style-theme keys available even for upstream themes.
  if (colors.whiteText && !colors.text) colors.text = colors.whiteText;
  if (colors.slotColor && !colors.background) colors.background = colors.slotColor;
  if (colors.slotOutline && !colors.border) colors.border = colors.slotOutline;
  if (colors.nanoGold && !colors.accent) colors.accent = colors.nanoGold;
  const path = stringValue(resolved.fields.path);
  return {
    id: record.id,
    name: localized(stringValue(resolved.fields.name), localization) ?? record.id,
    kind: 'uiTheme',
    light: booleanValue(resolved.fields.light),
    colors,
    path: path ?? null,
  };
}

/** Extract every concrete UI theme in the project, sorted for a selector. */
export function extractXamlThemes(source: XamlThemeSource): XamlTheme[] {
  const themes: XamlTheme[] = [];
  const seen = new Set<string>();
  for (const record of source.records) {
    if (record.abstract || record.partial.partial) continue;
    if (record.kind !== 'styleTheme' && record.kind !== 'uiTheme') continue;
    if (seen.has(record.key)) continue;
    seen.add(record.key);
    const resolved = source.resolve(record.id, record.kind);
    if (!resolved || resolved.abstract) continue;
    const theme =
      record.kind === 'styleTheme'
        ? themeFromStyle(record, resolved, source.localization)
        : themeFromUi(record, resolved, source.localization);
    if (Object.keys(theme.colors).length === 0 && !theme.texturePaths) continue;
    themes.push(theme);
  }
  themes.sort((a, b) => {
    // Prefer the rich style themes first, then keep a stable id order.
    if (a.kind !== b.kind) return a.kind === 'styleTheme' ? -1 : 1;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return themes;
}

/**
 * Pick the most likely in-game default theme for a project.
 *
 * Upstream projects call it `SS14DefaultTheme`; style-theme forks usually put
 * the Nano palette first. Falls back to the built-in palette.
 */
export function defaultXamlTheme(themes: readonly XamlTheme[]): XamlTheme {
  return (
    themes.find((theme) => theme.id === 'SS14DefaultTheme') ??
    themes.find((theme) => /nano|default/i.test(theme.id) && !theme.light) ??
    themes.find((theme) => !theme.light) ??
    themes[0] ??
    DEFAULT_XAML_THEME
  );
}
