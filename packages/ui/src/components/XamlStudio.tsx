import { useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import type { XamlDesignNode } from '@ss14-studio/core';
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
  Search,
  Sparkles,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import type { StudioHost } from '../lib/host';
import { Badge, Button, IconButton } from './ui';

type XamlTab = 'designer' | 'outline' | 'completions' | 'source';

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

function designStyle(node: XamlDesignNode): CSSProperties {
  const style: CSSProperties = {
    margin: thickness(node.style.margin),
    padding: thickness(node.style.padding),
    color: node.style.color ?? undefined,
    background: node.style.background ?? undefined,
    border: node.style.border ?? undefined,
    justifyContent:
      node.style.align === 'Center' ? 'center' : node.style.align === 'Right' || node.style.align === 'End' ? 'flex-end' : undefined,
    alignItems:
      node.style.justify === 'Center' ? 'center' : node.style.justify === 'Bottom' ? 'flex-end' : undefined,
    width: dimension(node.width),
    height: dimension(node.height),
  };
  if (node.name === 'BoxContainer' || node.name === 'SplitContainer') {
    style.display = 'flex';
    style.flexDirection = node.orientation === 'vertical' ? 'column' : 'row';
    style.gap = 6;
  }
  if (node.name === 'GridContainer') {
    style.display = 'grid';
    style.gridTemplateColumns = `repeat(${Math.max(1, node.style.columns ?? 1)}, minmax(0, 1fr))`;
    style.gap = 6;
  }
  if (node.name === 'ScrollContainer' || node.name === 'PanelContainer' || node.name === 'MarginContainer' || node.name === 'CenterContainer' || node.name === 'TabContainer') {
    style.display = 'flex';
    style.flexDirection = 'column';
    style.gap = 6;
  }
  return style;
}

function DesignerNode({ node, depth = 0, onSelect }: { node: XamlDesignNode; depth?: number; onSelect: (node: XamlDesignNode) => void }) {
  const style = designStyle(node);
  const label = node.text;
  const common = {
    className: `xaml-design-node xaml-${node.name.toLowerCase()} ${node.stretch ? 'stretch' : ''}`.trim(),
    style,
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onSelect(node);
    },
    title: `${node.className}${label ? ` · ${label}` : ''}`,
  };

  switch (node.name) {
    case 'DefaultWindow':
      return (
        <div className="xaml-window" style={style}>
          <div className="xaml-window-title">{node.className}</div>
          <div className="xaml-window-body">
            {node.children.map((child) => <DesignerNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />)}
          </div>
        </div>
      );
    case 'Label':
    case 'RichTextLabel':
      return <div {...common} className={`${common.className} xaml-label`}>{label || <span className="xaml-placeholder">Label</span>}</div>;
    case 'Button':
      return <button type="button" {...common} className={`${common.className} xaml-button`}>{label || 'Button'}</button>;
    case 'LineEdit':
      return <div {...common} className={`${common.className} xaml-lineedit`}>{label || 'Text input'}</div>;
    case 'TextEdit':
      return <div {...common} className={`${common.className} xaml-textedit`}>{label || 'Multi-line input'}</div>;
    case 'CheckBox':
      return <label {...common} className={`${common.className} xaml-checkbox`}><span className="xaml-checkbox-box" />{label || 'Checkbox'}</label>;
    case 'OptionButton':
      return <div {...common} className={`${common.className} xaml-option`}>{label || 'Option'}<ChevronDown size={12} aria-hidden /></div>;
    case 'Slider':
      return <div {...common} className={`${common.className} xaml-slider`}><span /><span className="knob" /></div>;
    case 'ProgressBar':
      return <div {...common} className={`${common.className} xaml-progress`}><span style={{ width: '60%' }} /></div>;
    case 'TextureRect':
    case 'SpriteView':
    case 'EntityPrototypeView':
      return <div {...common} className={`${common.className} xaml-texture`}><LayoutTemplate size={18} aria-hidden /><span>{node.name}</span></div>;
    case 'TabContainer':
    case 'TabBar':
      return (
        <div {...common} className={`${common.className} xaml-tabs`}>
          <div className="xaml-tabbar"><span>Tab 1</span><span>Tab 2</span></div>
          {node.children.map((child) => <DesignerNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />)}
        </div>
      );
    case 'ItemList':
    case 'Tree':
      return <div {...common} className={`${common.className} xaml-list`}>{[0, 1, 2].map((index) => <span key={index}>Item {index + 1}</span>)}</div>;
    default:
      return (
        <div {...common}>
          {node.children.length > 0
            ? node.children.map((child) => <DesignerNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />)
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
                <span><LayoutTemplate size={13} aria-hidden /> Approximate RobustToolbox layout</span>
                {selected ? <code onClick={() => host.openPath(view.filePath, outlineLine(view, selected))}>{selected.className}</code> : null}
              </div>
              <div className="xaml-designer">
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

          <section className="studio-card">
            <header className="studio-card-head"><h3><Code2 size={14} aria-hidden /> Code-behind</h3></header>
            <div className="xaml-codebehind">
              <code>{view.codeBehindPath ?? 'No linked .xaml.cs found'}</code>
              {view.codeBehindExists ? (
                <Button size="sm" icon={FileCode2} onClick={() => view.codeBehindPath && host.openCodeBehind(view.codeBehindPath)}>
                  Open C#
                </Button>
              ) : null}
              <div className="handler-list">
                {view.codeBehindHandlers.slice(0, 24).map((handler) => <code key={handler}>{handler}()</code>)}
              </div>
            </div>
          </section>

          <section className="studio-card xaml-help">
            <header className="studio-card-head"><h3><Sparkles size={14} aria-hidden /> SS14 XAML</h3></header>
            <p>
              This designer is an approximation, not the engine renderer. Use the source tab for the
              final say, and check the code-behind handlers before running the client.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function outlineLine(view: NonNullable<StudioHost['xaml']>, node: XamlDesignNode): number {
  const name = node.name;
  const outline = view.outline.find((item) => item.name === name || item.xname === node.className.split('#')[1]);
  return outline?.line ?? 1;
}
