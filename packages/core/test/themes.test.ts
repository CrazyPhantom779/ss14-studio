import { describe, expect, it } from 'vitest';
import {
  DEFAULT_XAML_THEME,
  PrototypeRegistry,
  defaultXamlTheme,
  extractXamlThemes,
  parsePrototypeFile,
} from '../src/index.js';

const source = `- type: styleTheme
  id: StyleNano
  name: style-theme-nano
  light: false
  background: "#1B1B1F"
  surface: "#2F2F3B"
  text: "#FEFEFE"
  accent: "#A88B5E"
  border: "#3F4159"
  window:
    texture: /Textures/Interface/Default/window.png

- type: styleTheme
  id: StyleLight
  name: style-theme-light
  light: true
  background: "#E8E8EC"
  text: "#18181B"

- type: uiTheme
  id: SS14DefaultTheme
  name: ui-theme-default
  path: /Textures/Interface/Default/
  colors:
    whiteText: "#FFF5EE"
    slotColor: "#0f1215"
    slotOutline: "#333850"
    nanoGold: "#e6b812"
`;

function registry(): PrototypeRegistry {
  const parsed = parsePrototypeFile(source, {
    filePath: '/repo/Resources/Prototypes/themes.yml',
    relativePath: 'Resources/Prototypes/themes.yml',
    fileKey: 'Resources/Prototypes/themes.yml',
  });
  return new PrototypeRegistry(
    parsed.prototypes,
    new Map([
      ['style-theme-nano', 'Nano (dark)'],
      ['style-theme-light', 'Nano (light)'],
      ['ui-theme-default', 'Default UI'],
    ]),
  );
}

function themesFrom(local: PrototypeRegistry) {
  return extractXamlThemes({
    records: local.records,
    resolve: (id, kind) => local.resolve(id, kind),
    localization: local.localization,
  });
}

describe('XAML themes', () => {
  it('extracts style and ui themes with resolved names and colours', () => {
    const themes = themesFrom(registry());
    expect(themes.map((theme) => theme.id)).toEqual([
      'StyleNano',
      'StyleLight',
      'SS14DefaultTheme',
    ]);

    const nano = themes.find((theme) => theme.id === 'StyleNano')!;
    expect(nano.kind).toBe('styleTheme');
    expect(nano.name).toBe('Nano (dark)');
    expect(nano.light).toBe(false);
    expect(nano.colors.background).toBe('#1B1B1F');
    expect(nano.texturePaths?.window).toBe('Textures/Interface/Default/window.png');

    const upstream = themes.find((theme) => theme.id === 'SS14DefaultTheme')!;
    expect(upstream.kind).toBe('uiTheme');
    expect(upstream.path).toBe('/Textures/Interface/Default/');
    expect(upstream.colors.text).toBe('#FFF5EE');
    expect(upstream.colors.background).toBe('#0f1215');
    expect(upstream.colors.border).toBe('#333850');
    expect(upstream.colors.accent).toBe('#e6b812');
  });

  it('prefers the upstream default theme and falls back to the built-in palette', () => {
    const themes = themesFrom(registry());
    expect(defaultXamlTheme(themes).id).toBe('SS14DefaultTheme');
    expect(defaultXamlTheme([]).id).toBe(DEFAULT_XAML_THEME.id);
    expect(defaultXamlTheme([]).colors.background).toBe(DEFAULT_XAML_THEME.colors.background);
  });

  it('skips abstract themes and themes without colours', () => {
    const parsed = parsePrototypeFile(
      `- type: styleTheme
  id: EmptyTheme
  abstract: true
`,
      {
        filePath: '/repo/Resources/Prototypes/themes.yml',
        relativePath: 'Resources/Prototypes/themes.yml',
        fileKey: 'Resources/Prototypes/themes.yml',
      },
    );
    const local = new PrototypeRegistry(parsed.prototypes);
    expect(
      extractXamlThemes({
        records: local.records,
        resolve: (id, kind) => local.resolve(id, kind),
      }),
    ).toEqual([]);
  });
});
