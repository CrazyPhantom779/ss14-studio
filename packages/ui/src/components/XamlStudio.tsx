import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import type { XamlDesignNode, XamlImageInfo, XamlTheme } from '@ss14-studio/core';
import {
  Braces,
  Check,
  ChevronDown,
  CircleAlert,
  Code2,
  FileCode2,
  Info,
  Layers,
  LayoutTemplate,
  ListTree,
  Palette,
  Search,
  Sparkles,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import type { StudioHost } from '../lib/host';
import { Badge, Button, IconButton } from './ui';

type XamlTab = 'designer' | 'outline' | 'completions' | 'source';

const SWATCH_KEYS = [
  'background',
  'surface',
  'element',
  'accent',
  'text',
  'positive',
  'negative',
] as const;

function themeColor(
  theme: XamlTheme,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = theme.colors[key];
    if (value) return value;
  }
  return undefined;
}

/**
 * Override the studio CSS variables so the designer chrome adopts the SS14
 * palette. Explicit XAML colours are inline styles and still win.
 */
function themeStyle(theme: XamlTheme | null): CSSProperties {
  if (!theme) return {};
  const dark = !theme.light;
  const bg = themeColor(theme, 'background', 'windowBackground', 'surfaceInspect') ?? (dark ? '#1b1b1f' : '#f4f4f5');
  const fg = themeColor(theme, 'text', 'whiteText') ?? (dark ? '#fefefe' : '#18181b');
  const muted = themeColor(theme, 'textMuted') ?? `color-mix(in srgb, ${fg} 62%, transparent)`;
  const faint = themeColor(theme, 'textDisabled') ?? `color-mix(in srgb, ${fg} 42%, transparent)`;
  const surface = themeColor(theme, 'windowBackground', 'surface') ?? `color-mix(in srgb, ${bg} 88%, ${fg} 12%)`;
  const surface2 = themeColor(theme, 'surfaceRaised', 'element', 'surface') ?? `color-mix(in srgb, ${bg} 82%, ${fg} 18%)`;
  const border = themeColor(theme, 'border', 'secondaryBorder') ?? `color-mix(in srgb, ${fg} 16%, transparent)`;
  const borderStrong = themeColor(theme, 'secondaryBorder', 'border') ?? `color-mix(in srgb, ${fg} 28%, transparent)`;
  const accent = themeColor(theme, 'accent', 'nanoGold') ?? (dark ? '#a88b5e' : '#0e7490');
  const accent2 = themeColor(theme, 'secondaryAccent') ?? accent;
  const success = themeColor(theme, 'positive') ?? (dark ? '#3e9a5a' : '#2f7d46');
  const warning = themeColor(theme, 'warning') ?? (dark ? '#fbbf24' : '#b45309');
  const danger = themeColor(theme, 'danger', 'negative') ?? (dark ? '#c24141' : '#b42f2f');
  const vars: Record<string, string> = {
    '--studio-bg': bg,
    '--studio-fg': fg,
    '--studio-muted': muted,
    '--studio-faint': faint,
    '--studio-surface': surface,
    '--studio-surface-2': surface2,
    '--studio-border': border,
    '--studio-border-strong': borderStrong,
    '--studio-accent': accent,
    '--studio-accent-strong': accent,
    '--studio-accent-2': accent2,
    '--studio-accent-soft': `color-mix(in srgb, ${accent} 14%, transparent)`,
    '--studio-accent-line': `color-mix(in srgb, ${accent} 40%, transparent)`,
    '--studio-success': success,
    '--studio-warning': warning,
    '--studio-danger': danger,
  };
  for (const key of ['window', 'header', 'button', 'panel'] as const) {
    const uri = theme.textures?.[key];
    if (uri) vars[`--xaml-${key}-image`] = `url("${uri}")`;
  }
  return vars as unknown as CSSProperties;
}

function swatchColor(theme: XamlTheme, key: string): string {
  const value = theme.colors[key];
  if (value) return value;
  switch (key) {
    case 'background':
      return theme.colors.windowBackground ?? '#1b1b1f';
    case 'surface':
      return theme.colors.windowBackground ?? theme.colors.background ?? '#252632';
    case 'element':
      return theme.colors.surfaceRaised ?? theme.colors.element ?? '#424665';
    case 'accent':
      return theme.colors.nanoGold ?? theme.colors.accent ?? '#a88b5e';
    case 'text':
      return theme.colors.whiteText ?? theme.colors.text ?? '#fefefe';
    case 'positive':
      return theme.colors.positive ?? '#3e9a5a';
    case 'negative':
      return theme.colors.danger ?? theme.colors.negative ?? '#c24141';
    default:
      return '#888';
  }
}

function thickness(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parts = value.split(/[,\s]+/).filter(Boolean);
  if (parts.length === 1) return `${parts[0]}px`;
  if (parts.length === 2) return `${parts[0]}px ${parts[1]}px`;
  if (parts.length === 4) return parts.map((part) => `${part}px`).join(' ');
  return undefined;
}

function dimension(value: string | null): string | undefined {
  if (!value) return undefined;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return `${value}px`;
  return value;
}

function alignment(value: string | undefined): CSSProperties['justifyContent'] {
  switch ((value ?? '').toLowerCase()) {
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'flex-end';
    case 'left':
    case 'begin':
    case 'start':
      return 'flex-start';
    default:
      return undefined;
  }
}

function crossAlignment(value: string | undefined): CSSProperties['alignItems'] {
  switch ((value ?? '').toLowerCase()) {
    case 'center':
      return 'center';
    case 'bottom':
    case 'end':
      return 'flex-end';
    case 'top':
    case 'begin':
    case 'start':
      return 'flex-start';
    default:
      return undefined;
  }
}

function designStyle(node: XamlDesignNode): CSSProperties {
  const style: CSSProperties = {
    margin: thickness(node.style.margin),
    padding: thickness(node.style.padding),
    color: node.style.color ?? undefined,
    background: node.style.background ?? undefined,
    borderColor: node.style.borderColor ?? undefined,
    borderStyle: node.style.borderWidth ? 'solid' : undefined,
    borderWidth: node.style.borderWidth ? `${node.style.borderWidth}px` : undefined,
    borderRadius: node.style.cornerRadius ? `${node.style.cornerRadius}px` : undefined,
    fontSize: node.style.fontSize ? `${node.style.fontSize}px` : undefined,
    opacity: node.style.opacity,
    justifyContent: alignment(node.style.align),
    alignItems: crossAlignment(node.style.justify),
    width: dimension(node.width),
    height: dimension(node.height),
  };
  const gap = node.style.separation ? `${node.style.separation}px` : undefined;
  if (node.name === 'BoxContainer' || node.name === 'SplitContainer') {
    style.display = 'flex';
    style.flexDirection = node.orientation === 'vertical' ? 'column' : 'row';
    style.gap = gap ?? 6;
  }
  if (node.name === 'GridContainer') {
    style.display = 'grid';
    style.gridTemplateColumns = `repeat(${Math.max(1, node.style.columns ?? 1)}, minmax(0, 1fr))`;
    style.gridTemplateRows = node.style.rows
      ? `repeat(${Math.max(1, node.style.rows)}, minmax(0, auto))`
      : undefined;
    style.gap = gap ?? 6;
  }
  if (
    node.name === 'ScrollContainer' ||
    node.name === 'PanelContainer' ||
    node.name === 'MarginContainer' ||
    node.name === 'CenterContainer' ||
    node.name === 'TabContainer' ||
    node.name === 'DefaultWindow'
  ) {
    style.display = 'flex';
    style.flexDirection = 'column';
    style.gap = gap ?? 6;
  }
  if (node.name === 'CenterContainer') {
    style.alignItems = 'center';
    style.justifyContent = 'center';
  }
  return style;
}

function imageStyle(image: XamlImageInfo): CSSProperties {
  const columns = Math.max(1, image.columns);
  const rows = Math.max(1, Math.floor(image.height / Math.max(1, image.frameHeight)));
  const isSheet = columns > 1 || rows > 1;
  if (isSheet) {
    return {
      backgroundImage: `url("${image.uri}")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: '0 0',
      backgroundSize: `${columns * 100}% ${rows * 100}%`,
      imageRendering: 'pixelated',
    };
  }
  const size =
    image.fit === 'stretch'
      ? '100% 100%'
      : image.fit === 'cover'
        ? 'cover'
        : image.fit === 'none'
          ? 'auto'
          : 'contain';
  return {
    backgroundImage: `url("${image.uri}")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
    backgroundSize: size,
    imageRendering: 'pixelated',
  };
}

function DesignerNode({
  node,
  depth = 0,
  onSelect,
}: {
  node: XamlDesignNode;
  depth?: number;
  onSelect: (node: XamlDesignNode) => void;
}) {
  const style = designStyle(node);
  const label = node.textResolved ?? node.text;
  const common = {
    className: `xaml-design-node xaml-${node.name.toLowerCase()} ${node.stretch ? 'stretch' : ''}`.trim(),
    style,
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onSelect(node);
    },
    title: `${node.className}${node.textKey ? ` · ${node.textKey}` : label ? ` · ${label}` : ''}`,
  };
  const children = node.children.map((child) => (
    <DesignerNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />
  ));
  const image = node.image ? (
    <span className="xaml-image" style={imageStyle(node.image)} role="img" aria-label={node.image.source ?? node.name} />
  ) : null;

  switch (node.name) {
    case 'DefaultWindow':
      return (
        <div className="xaml-window" style={style}>
          <div className="xaml-window-title">{label || node.className}</div>
          <div className="xaml-window-body">{children}</div>
        </div>
      );
    case 'Label':
    case 'RichTextLabel':
      return (
        <div {...common} className={`${common.className} xaml-label`}>
          {label || <span className="xaml-placeholder">Label</span>}
          {node.textKey ? <code className="xaml-loc-key">{node.textKey}</code> : null}
        </div>
      );
    case 'Button':
      return <button type="button" {...common} className={`${common.className} xaml-button`}>{label || 'Button'}</button>;
    case 'LineEdit':
      return (
        <div {...common} className={`${common.className} xaml-lineedit`}>
          <span>{label || 'Text input'}</span>
          <span className="xaml-caret" />
        </div>
      );
    case 'TextEdit':
      return <div {...common} className={`${common.className} xaml-textedit`}>{label || 'Multi-line input'}</div>;
    case 'CheckBox':
      return (
        <label {...common} className={`${common.className} xaml-checkbox`}>
          <span className="xaml-checkbox-box" />
          {label || 'Checkbox'}
        </label>
      );
    case 'OptionButton':
      return <div {...common} className={`${common.className} xaml-option`}>{label || 'Option'}<ChevronDown size={12} aria-hidden /></div>;
    case 'Slider':
      return <div {...common} className={`${common.className} xaml-slider`}><span /><span className="knob" /></div>;
    case 'ProgressBar':
      return <div {...common} className={`${common.className} xaml-progress`}><span style={{ width: '60%' }} /></div>;
    case 'TextureRect':
    case 'AnimatedTextureRect':
    case 'TextureButton':
    case 'SpriteView':
    case 'EntityPrototypeView':
    case 'Icon':
      return (
        <div {...common} className={`${common.className} xaml-texture`}>
          {image ?? <LayoutTemplate size={18} aria-hidden />}
          {!image ? <span>{label || node.name}</span> : null}
        </div>
      );
    case 'PanelContainer':
    case 'MarginContainer':
      return <div {...common}>{children}</div>;
    case 'TabContainer':
    case 'TabBar':
      return (
        <div {...common} className={`${common.className} xaml-tabs`}>
          <div className="xaml-tabbar">
            {(node.children.length > 0 ? node.children : [node]).slice(0, 4).map((child, index) => (
              <span key={child.id} className={index === 0 ? 'active' : ''}>{child.name || `Tab ${index + 1}`}</span>
            ))}
          </div>
          {node.children.map((child) => <DesignerNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />)}
        </div>
      );
    case 'ItemList':
    case 'Tree':
      return <div {...common} className={`${common.className} xaml-list`}>{[0, 1, 2].map((index) => <span key={index}>Item {index + 1}</span>)}</div>;
    default:
      return (
        <div {...common}>
          {image}
          {node.children.length > 0
            ? children
            : label
              ? <span className="xaml-label">{label}</span>
              : null}
        </div>
      );
  }
}

export function XamlStudio({ host }: { host: StudioHost }) {
  const view = host.xaml;
  const [tab, setTab] = useState<XamlTab>('designer');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<XamlDesignNode | null>(null);
  const [themeId, setThemeId] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
    setThemeId(null);
  }, [view?.filePath]);

  const themes = useMemo(() => view?.themes ?? [], [view?.themes]);
  const activeTheme =
    themes.find((theme) => theme.id === themeId) ??
    view?.theme ??
    themes[0] ??
    null;

  const completions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = view?.completions ?? [];
    return needle ? list.filter((item) => `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(needle)) : list;
  }, [query, view?.completions]);

  const errors = view?.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length ?? 0;
  const warnings = view?.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length ?? 0;

  if (!view) {
    return (
      <div className="studio-detail-empty">
        <span className="detail-empty-icon"><Braces size={30} aria-hidden /></span>
        <h2>No XAML opened</h2>
        <p>Open any SS14 window from the editor title bar, explorer context menu or command palette.</p>
        <Button icon={FileCode2} onClick={host.pickXaml}>Open XAML file</Button>
      </div>
    );
  }

  return (
    <div className="xaml-studio">
      <header className="studio-page-head">
        <div>
          <div className="prototype-eyebrow">
            <Badge tone="accent">XAML</Badge>
            <code>{view.relativePath}</code>
            {view.autoGenerated ? <Badge tone="warning">AutoGenerated</Badge> : null}
            {view.codeBehindExists ? <Badge tone="success">code-behind</Badge> : <Badge tone="muted">no code-behind</Badge>}
          </div>
          <h1>{view.className?.split('.').pop() ?? view.relativePath.split('/').pop()}</h1>
          <p className="studio-page-sub">
            {view.outline.length} elements · {view.diagnostics.length} diagnostics ·{' '}
            {view.codeBehindHandlers.length} handlers
            {view.codeBehindNamespace ? ` · ${view.codeBehindNamespace}` : ''}
          </p>
        </div>
        <div className="studio-page-actions">
          <Button
            icon={Wand2}
            size="sm"
            onClick={async () => {
              const result = await host.applyXamlOperation(view.filePath, { kind: 'format' });
              if (result.ok) host.notify('success', result.message ?? 'Formatted XAML.');
            }}
          >
            Format
          </Button>
          <Button
            icon={Sparkles}
            size="sm"
            onClick={async () => {
              const result = await host.applyXamlOperation(view.filePath, { kind: 'cleanup' });
              if (result.ok) host.notify('success', result.message ?? 'Cleaned up XAML.');
            }}
          >
            Clean up
          </Button>
          <Button
            icon={Check}
            size="sm"
            onClick={() => void host.applyXamlOperation(view.filePath, { kind: view.autoGenerated ? 'removeAutoGenerated' : 'markAutoGenerated' })}
          >
            {view.autoGenerated ? 'Remove marker' : 'AutoGenerated'}
          </Button>
          <Button icon={Code2} size="sm" disabled={!view.codeBehindPath} onClick={() => view.codeBehindPath && host.openCodeBehind(view.codeBehindPath)}>
            Code-behind
          </Button>
          <Button icon={Braces} size="sm" disabled={!view.codeBehindPath} onClick={() => view.codeBehindPath && host.openCSharp(view.codeBehindPath)}>
            C# context
          </Button>
        </div>
      </header>

      <nav className="prototype-tabs">
        <button type="button" className={tab === 'designer' ? 'active' : ''} onClick={() => setTab('designer')}>
          <LayoutTemplate size={13} aria-hidden /> Designer
        </button>
        <button type="button" className={tab === 'outline' ? 'active' : ''} onClick={() => setTab('outline')}>
          <ListTree size={13} aria-hidden /> Outline <span>{view.outline.length}</span>
        </button>
        <button type="button" className={tab === 'completions' ? 'active' : ''} onClick={() => setTab('completions')}>
          <Braces size={13} aria-hidden /> Reference
        </button>
        <button type="button" className={tab === 'source' ? 'active' : ''} onClick={() => setTab('source')}>
          <FileCode2 size={13} aria-hidden /> Source
        </button>
        <div className="xaml-health">
          {errors > 0 ? <span className="error"><CircleAlert size={12} aria-hidden />{errors}</span> : null}
          {warnings > 0 ? <span className="warning"><TriangleAlert size={12} aria-hidden />{warnings}</span> : null}
          {errors + warnings === 0 ? <span className="ok"><Check size={12} aria-hidden />clean</span> : null}
        </div>
      </nav>

      <div className="xaml-layout">
        <main className="xaml-main">
          {tab === 'designer' ? (
            <div className="xaml-designer-wrap">
              <div className="xaml-designer-toolbar">
                <span><LayoutTemplate size={13} aria-hidden /> Approximate RobustToolbox layout · resolved Fluent text · sprites</span>
                <div className="xaml-designer-tools">
                  {themes.length > 0 ? (
                    <label className="xaml-theme-picker" title="Preview the window with an in-game UI theme">
                      <Palette size={12} aria-hidden />
                      <select
                        value={activeTheme?.id ?? ''}
                        onChange={(event) => setThemeId(event.target.value)}
                        aria-label="UI theme"
                      >
                        {themes.map((theme) => (
                          <option key={`${theme.kind}:${theme.id}`} value={theme.id}>
                            {theme.name} · {theme.kind === 'styleTheme' ? 'style' : 'ui'}
                          </option>
                        ))}
                      </select>
                      {activeTheme ? (
                        <span className="xaml-theme-swatches" aria-hidden>
                          {SWATCH_KEYS.map((key) => (
                            <i
                              key={key}
                              style={{ background: swatchColor(activeTheme, key) }}
                              title={`${key}: ${swatchColor(activeTheme, key)}`}
                            />
                          ))}
                        </span>
                      ) : null}
                    </label>
                  ) : null}
                  {selected ? (
                    <code onClick={() => host.openPath(view.filePath, selected.sourceLine ?? outlineLine(view, selected))}>
                      {selected.className}
                    </code>
                  ) : null}
                </div>
              </div>
              <div className="xaml-designer" style={themeStyle(activeTheme)}>
                {view.design ? <DesignerNode node={view.design} onSelect={setSelected} /> : <div className="studio-detail-empty small">No root element.</div>}
              </div>
            </div>
          ) : null}

          {tab === 'outline' ? (
            <div className="xaml-outline-list">
              {view.outline.map((item, index) => (
                <button
                  type="button"
                  key={`${item.name}:${item.line}:${index}`}
                  style={{ paddingLeft: 14 + item.depth * 16 }}
                  onClick={() => host.openPath(view.filePath, item.line)}
                >
                  <span className="xaml-outline-icon"><Layers size={11} aria-hidden /></span>
                  <strong>{item.name}</strong>
                  {item.xname ? <code>{item.xname}</code> : null}
                  <em>line {item.line}</em>
                </button>
              ))}
            </div>
          ) : null}

          {tab === 'completions' ? (
            <div className="xaml-reference">
              <label className="studio-search">
                <Search size={14} aria-hidden />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search controls, properties, events…" spellCheck={false} />
              </label>
              <div className="completion-list">
                {completions.map((item) => (
                  <div className="completion-row" key={`${item.kind}:${item.label}`}>
                    <Badge tone={item.kind === 'control' ? 'accent' : item.kind === 'event' ? 'warning' : 'muted'}>{item.kind}</Badge>
                    <code>{item.label}</code>
                    <span>{item.detail}</span>
                    <IconButton icon={Code2} label={`Copy ${item.label}`} onClick={() => host.copyText(item.insertText ?? item.label)} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === 'source' ? (
            <div className="xaml-source">
              <pre>
                {view.source.split(/\r?\n/).map((line, index) => (
                  <span key={index} className="source-line">
                    <em>{index + 1}</em>
                    <code>{line || ' '}</code>
                  </span>
                ))}
              </pre>
            </div>
          ) : null}
        </main>

        <aside className="xaml-side">
          <section className="studio-card">
            <header className="studio-card-head">
              <h3><CircleAlert size={14} aria-hidden /> Validation</h3>
              <Badge tone={errors > 0 ? 'danger' : warnings > 0 ? 'warning' : 'success'}>{view.diagnostics.length}</Badge>
            </header>
            {view.diagnostics.length === 0 ? (
              <div className="xaml-clean"><Check size={16} aria-hidden /> No XAML issues found.</div>
            ) : (
              <div className="xaml-diagnostics">
                {view.diagnostics.map((diagnostic, index) => (
                  <button type="button" key={index} className={`xaml-diagnostic ${diagnostic.severity}`} onClick={() => host.openPath(view.filePath, diagnostic.line)}>
                    {diagnostic.severity === 'error' ? <CircleAlert size={12} aria-hidden /> : diagnostic.severity === 'warning' ? <TriangleAlert size={12} aria-hidden /> : <Info size={12} aria-hidden />}
                    <span>{diagnostic.message}</span>
                    <em>{diagnostic.line}</em>
                  </button>
                ))}
              </div>
            )}
          </section>

          {selected ? (
            <section className="studio-card xaml-selected">
              <header className="studio-card-head">
                <h3><Layers size={14} aria-hidden /> Selected element</h3>
                <Badge tone="muted">{selected.name}</Badge>
              </header>
              <div className="xaml-selected-body">
                <code>{selected.className}</code>
                <button
                  type="button"
                  className="inline-path"
                  onClick={() => host.openPath(view.filePath, selected.sourceLine ?? outlineLine(view, selected))}
                >
                  <FileCode2 size={12} aria-hidden /> line {selected.sourceLine ?? outlineLine(view, selected)}
                </button>
                {selected.textResolved || selected.text ? (
                  <div className="xaml-selected-text">
                    <strong>{selected.textResolved ?? selected.text}</strong>
                    {selected.textKey ? <em>{selected.textKey}</em> : null}
                  </div>
                ) : null}
                {selected.image ? (
                  <div className="xaml-selected-image">
                    <span className="xaml-image-preview" style={imageStyle(selected.image)} />
                    <div>
                      <strong>{selected.image.kind}</strong>
                      <em>{selected.image.source}</em>
                      <span>{selected.image.frameWidth}×{selected.image.frameHeight} · {selected.image.columns} column(s)</span>
                    </div>
                  </div>
                ) : null}
                <div className="xaml-attribute-table">
                  {Object.entries(selected.attributes ?? {}).map(([key, value]) => (
                    <div key={key}>
                      <code>{key}</code>
                      <span>{value}</span>
                    </div>
                  ))}
                  {Object.keys(selected.attributes ?? {}).length === 0 ? (
                    <div className="table-empty">No attributes on this element.</div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <section className="studio-card">
            <header className="studio-card-head"><h3><Code2 size={14} aria-hidden /> C# context</h3></header>
            <div className="xaml-codebehind">
              <code>{view.codeBehindPath ?? 'No linked .xaml.cs found'}</code>
              {view.codeBehindExists ? (
                <div className="xaml-codebehind-actions">
                  <Button size="sm" icon={FileCode2} onClick={() => view.codeBehindPath && host.openCodeBehind(view.codeBehindPath)}>
                    Open C#
                  </Button>
                  <Button size="sm" icon={Braces} onClick={() => view.codeBehindPath && host.openCSharp(view.codeBehindPath)}>
                    Context
                  </Button>
                </div>
              ) : null}
              {view.codeBehindNamespace ? <span className="xaml-namespace">namespace <code>{view.codeBehindNamespace}</code></span> : null}
              <div className="xaml-csharp-types">
                {view.codeBehindTypes.map((type) => (
                  <span key={`${type.name}:${type.line}`}>
                    <Badge tone={type.partial ? 'success' : 'muted'}>{type.kind}{type.partial ? ' partial' : ''}</Badge>
                    <code>{type.name}</code>
                  </span>
                ))}
              </div>
              <div className="handler-list">
                {view.codeBehindHandlers.slice(0, 24).map((handler) => <code key={handler}>{handler}()</code>)}
              </div>
              {view.codeBehindFields.length > 0 ? (
                <div className="handler-list">
                  {view.codeBehindFields.slice(0, 16).map((field) => <code key={`${field.type}:${field.name}`}>{field.type} {field.name}</code>)}
                </div>
              ) : null}
            </div>
          </section>

          <section className="studio-card xaml-help">
            <header className="studio-card-head"><h3><Sparkles size={14} aria-hidden /> SS14 XAML</h3></header>
            <p>
              Localized text is resolved from Fluent and textures or entity sprites are rendered
              inline. This designer is still an approximation, not the engine renderer; use the
              source tab for the final say.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function outlineLine(view: NonNullable<StudioHost['xaml']>, node: XamlDesignNode): number {
  if (node.sourceLine) return node.sourceLine;
  const name = node.name;
  const outline = view.outline.find((item) => item.name === name || item.xname === node.className.split('#')[1]);
  return outline?.line ?? 1;
}
