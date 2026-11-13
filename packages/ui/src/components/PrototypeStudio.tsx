import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  InheritanceNode,
  PrototypeComponent,
  PrototypeOperation,
  PrototypeSummary,
  PrototypeView,
  ResolvedField,
  SpriteInfo,
} from '@ss14-studio/core';
import {
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  FileCode2,
  GitBranch,
  Image as ImageIcon,
  Info,
  Layers,
  Pencil,
  Plus,
  Scissors,
  Search,
  Sparkles,
  Tag,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { StudioHost } from '../lib/host';
import { Badge, Button, Field, IconButton } from './ui';
import { EntitySprite } from './SpritePreview';

type Tab = 'overview' | 'components' | 'inheritance' | 'partials';

function formatValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 0);
  } catch {
    return String(value);
  }
}

function editValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function parseValue(input: string): string | number | boolean | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed) as string | number | boolean;
    } catch {
      return input;
    }
  }
  return input;
}

function spriteLabel(sprite: SpriteInfo | null): string {
  if (!sprite) return 'No sprite';
  return [sprite.rsi, sprite.state].filter(Boolean).join(' · ') || 'Sprite';
}

export function PrototypeStudio({ host }: { host: StudioHost }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [tab, setTab] = useState<Tab>('overview');
  const [limit, setLimit] = useState(80);
  const [extracting, setExtracting] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);

  const view = host.prototype;
  const payload = host.prototypes;
  const currentKind = view?.summary.kind;
  const entityId = view && view.summary.kind === 'entity' ? view.summary.id : undefined;

  useEffect(() => {
    if (entityId) host.requestIcon(entityId);
  }, [entityId, host.requestIcon]);

  useEffect(() => {
    setQuery('');
    setTab('overview');
    setExtracting(false);
  }, [view?.key]);

  useEffect(() => {
    setLimit(80);
  }, [query, kind]);

  const filtered = useMemo(() => {
    const summaries = payload?.summaries ?? [];
    const needle = query.trim().toLowerCase();
    return summaries.filter((summary) => {
      if (kind !== 'all' && summary.kind !== kind) return false;
      if (!needle) return true;
      return `${summary.id} ${summary.name} ${summary.description ?? ''} ${summary.relativePath}`
        .toLowerCase()
        .includes(needle);
    });
  }, [kind, payload?.summaries, query]);

  const open = (summary: PrototypeSummary) => {
    host.openPrototype(summary.id, summary.kind);
  };

  return (
    <div className="studio-split prototype-studio">
      <aside className="studio-list-pane">
        <header className="studio-list-head">
          <div className="section-eyebrow">Prototype atlas</div>
          <h2>
            <Layers size={17} aria-hidden />
            Prototypes
            <span className="list-count">{payload?.total ?? 0}</span>
          </h2>
          <p>Browse every YAML prototype, its resolved data and inheritance chain.</p>
          <label className="studio-search">
            <Search size={14} aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search id, name, description…"
              spellCheck={false}
            />
          </label>
          <label className="studio-select prototype-kind-select">
            <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Filter prototypes by kind">
              <option value="all">All kinds ({payload?.total ?? 0})</option>
              {(payload?.kinds ?? []).map((stat) => (
                <option key={stat.kind} value={stat.kind}>
                  {stat.kind} ({stat.count})
                </option>
              ))}
            </select>
          </label>
        </header>

        <div className={`studio-list-scroll ${host.config.prototypeCompact ? 'compact' : ''}`}>
          {!payload ? (
            <div className="studio-list-empty">
              <Sparkles size={22} aria-hidden />
              <strong>Indexing prototypes…</strong>
            </div>
          ) : filtered.length === 0 ? (
            <div className="studio-list-empty">
              <Search size={22} aria-hidden />
              <strong>No prototypes match</strong>
              <span>Try a different search or kind.</span>
            </div>
          ) : (
            <>
              {filtered.slice(0, limit).map((summary) => (
                <button
                  type="button"
                  key={summary.key}
                  className={`prototype-row ${view?.key === summary.key ? 'active' : ''}`}
                  onClick={() => open(summary)}
                  title={`${summary.relativePath}:${summary.line}`}
                >
                  <EntitySprite entityId={summary.kind === 'entity' ? summary.id : null} icons={host.icons} size={26} />
                  <span className="prototype-row-main">
                    <span className="prototype-row-name">{summary.name || summary.id}</span>
                    <span className="prototype-row-id">
                      {summary.id}
                      {summary.abstract ? <em>abstract</em> : null}
                      {summary.partial ? <em className="partial">partial</em> : null}
                    </span>
                  </span>
                  <span className="prototype-row-meta">
                    <span>{summary.kind}</span>
                    {summary.componentCount > 0 ? <span>{summary.componentCount} comp.</span> : null}
                    {summary.children > 0 ? (
                      <span className="children">
                        <GitBranch size={9} aria-hidden />
                        {summary.children}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
              {filtered.length > limit ? (
                <button type="button" className="list-more" onClick={() => setLimit((value) => value + 100)}>
                  Show more ({filtered.length - limit} remaining)
                </button>
              ) : null}
            </>
          )}
        </div>
        <footer className="studio-list-foot">
          <span>{payload ? `${payload.localizationCount.toLocaleString()} localisation keys` : 'Scanning…'}</span>
          <span>{payload?.partialFiles.length ?? 0} partial sources</span>
        </footer>
      </aside>

      <section className="studio-detail-pane">
        {!view ? (
          <div className="studio-detail-empty">
            <span className="detail-empty-icon">
              <Layers size={30} aria-hidden />
            </span>
            <h2>Pick a prototype</h2>
            <p>
              Select any prototype from the atlas to see its resolved sprite, components, parent
              chain, partial overlays and approximate in-game card.
            </p>
          </div>
        ) : (
          <>
            <header className="prototype-head">
              <div className="prototype-head-main">
                <div className="prototype-sprite">
                  <EntitySprite entityId={entityId} icons={host.icons} size={56} />
                </div>
                <div>
                  <div className="prototype-eyebrow">
                    <Badge tone="accent">{view.summary.kind}</Badge>
                    {view.summary.abstract ? <Badge tone="muted">abstract</Badge> : null}
                    {view.summary.partial ? <Badge tone="warning">partial</Badge> : null}
                    <button
                      type="button"
                      className="inline-path"
                      onClick={() => host.openPrototypeSource(view.resolved.filePath, view.resolved.line)}
                      title="Open the YAML source"
                    >
                      <FileCode2 size={12} aria-hidden />
                      {view.summary.relativePath}:{view.summary.line}
                    </button>
                  </div>
                  <h1>{view.summary.name || view.summary.id}</h1>
                  <code>{view.summary.id}</code>
                  {view.summary.description ? <p>{view.summary.description}</p> : null}
                </div>
              </div>
              <div className="prototype-head-actions">
                {view.resolved.sprite?.rsi ? (
                  <Button icon={ImageIcon} size="sm" onClick={() => host.openRsi(view.resolved.sprite!.rsi!)}>
                    Sprite
                  </Button>
                ) : null}
                <Button
                  icon={ArrowUpRight}
                  size="sm"
                  onClick={() => host.openPrototypeSource(view.resolved.filePath, view.resolved.line)}
                >
                  YAML
                </Button>
                <Button
                  icon={Scissors}
                  size="sm"
                  disabled={host.readOnly}
                  onClick={() => {
                    setSelectedFields([]);
                    setSelectedComponents([]);
                    setExtracting(true);
                  }}
                >
                  Extract partial
                </Button>
              </div>
            </header>

            <nav className="prototype-tabs" aria-label="Prototype detail tabs">
              <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
                <Info size={13} aria-hidden /> Overview
              </button>
              <button type="button" className={tab === 'components' ? 'active' : ''} onClick={() => setTab('components')}>
                <Boxes size={13} aria-hidden /> Components <span>{view.resolved.components.length}</span>
              </button>
              <button type="button" className={tab === 'inheritance' ? 'active' : ''} onClick={() => setTab('inheritance')}>
                <GitBranch size={13} aria-hidden /> Inheritance
              </button>
              <button type="button" className={tab === 'partials' ? 'active' : ''} onClick={() => setTab('partials')}>
                <Layers size={13} aria-hidden /> Partials <span>{view.partials.length}</span>
              </button>
            </nav>

            <div className="prototype-detail-scroll">
              {view.diagnostics.length > 0 ? (
                <div className="prototype-diagnostics">
                  {view.diagnostics.map((diagnostic, index) => (
                    <div className={`prototype-diagnostic ${diagnostic.severity}`} key={index}>
                      {diagnostic.severity === 'error' ? <CircleAlert size={13} aria-hidden /> : diagnostic.severity === 'warning' ? <TriangleAlert size={13} aria-hidden /> : <Info size={13} aria-hidden />}
                      <span>{diagnostic.message}</span>
                      <button type="button" onClick={() => host.openPrototypeSource(view.resolved.filePath, diagnostic.line)}>
                        line {diagnostic.line}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {tab === 'overview' ? (
                <div className="prototype-overview-grid">
                  <InGameCard view={view} host={host} entityId={entityId} />
                  <section className="studio-card">
                    <header className="studio-card-head">
                      <h3>Resolved fields</h3>
                      <Badge tone="muted">{view.resolved.resolvedFields.length}</Badge>
                    </header>
                    <div className="field-table">
                      {view.resolved.resolvedFields.map((field) => (
                        <FieldRow
                          key={field.key}
                          field={field}
                          readOnly={host.readOnly}
                          onSet={(value) =>
                            host.applyPrototypeOperation(view.resolved.filePath, {
                              kind: 'setField',
                              id: view.resolved.id,
                              field: field.key,
                              value,
                            })
                          }
                        />
                      ))}
                      {view.resolved.resolvedFields.length === 0 ? (
                        <div className="table-empty">This prototype has no top-level fields.</div>
                      ) : null}
                    </div>
                  </section>
                  <section className="studio-card">
                    <header className="studio-card-head">
                      <h3>Inheritance chain</h3>
                      <Badge tone="muted">{view.summary.parents.length} parents</Badge>
                    </header>
                    <InheritanceTree node={view.inheritance} onOpen={(id) => host.openPrototype(id)} root />
                    {view.children.length > 0 ? (
                      <>
                        <div className="card-subhead">Direct children ({view.children.length})</div>
                        <div className="children-list">
                          {view.children.slice(0, 18).map((child) => (
                            <button type="button" key={child.key} onClick={() => host.openPrototype(child.id, child.kind)}>
                              <GitBranch size={11} aria-hidden />
                              {child.id}
                              {child.abstract ? <em>abstract</em> : null}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </section>
                </div>
              ) : null}

              {tab === 'components' ? (
                <div className="component-list">
                  {view.resolved.components.map((component) => (
                    <ComponentCard
                      key={component.type}
                      component={component}
                      view={view}
                      readOnly={host.readOnly}
                      onSet={(field, value) =>
                        host.applyPrototypeOperation(view.resolved.filePath, {
                          kind: 'setComponentField',
                          id: view.resolved.id,
                          component: component.type,
                          field,
                          value,
                        })
                      }
                      onRemove={() =>
                        host.applyPrototypeOperation(view.resolved.filePath, {
                          kind: 'removeComponent',
                          id: view.resolved.id,
                          component: component.type,
                        })
                      }
                    />
                  ))}
                  {!host.readOnly ? (
                    <AddComponent
                      onAdd={(name) =>
                        host.applyPrototypeOperation(view.resolved.filePath, {
                          kind: 'addComponent',
                          id: view.resolved.id,
                          component: name,
                        })
                      }
                    />
                  ) : null}
                </div>
              ) : null}

              {tab === 'inheritance' ? (
                <div className="prototype-overview-grid">
                  <section className="studio-card">
                    <header className="studio-card-head">
                      <h3>Parent tree</h3>
                    </header>
                    <InheritanceTree node={view.inheritance} onOpen={(id) => host.openPrototype(id)} root />
                  </section>
                  <section className="studio-card">
                    <header className="studio-card-head">
                      <h3>Children</h3>
                      <Badge tone="muted">{view.children.length}</Badge>
                    </header>
                    <div className="children-list">
                      {view.children.map((child) => (
                        <button type="button" key={child.key} onClick={() => host.openPrototype(child.id, child.kind)}>
                          <GitBranch size={11} aria-hidden />
                          {child.name || child.id}
                          <code>{child.id}</code>
                        </button>
                      ))}
                      {view.children.length === 0 ? <div className="table-empty">No direct children.</div> : null}
                    </div>
                  </section>
                </div>
              ) : null}

              {tab === 'partials' ? (
                <div className="component-list">
                  <section className="studio-card">
                    <header className="studio-card-head">
                      <h3>Active partial overlays</h3>
                      <Badge tone="muted">{view.partials.length}</Badge>
                    </header>
                    {view.partials.length === 0 ? (
                      <div className="table-empty">No partials modify this prototype.</div>
                    ) : (
                      view.partials.map((partial) => (
                        <div className="partial-row" key={`${partial.filePath}:${partial.line}`}>
                          <div>
                            <strong>{partial.tag ?? (partial.only ? '!PartialOnly' : '!Partial')}</strong>
                            <code>{partial.relativePath}:{partial.line}</code>
                          </div>
                          <span>{partial.index != null ? `index ${partial.index}` : 'declaration order'}</span>
                          <div className="partial-tags">
                            {partial.fields.map((field) => <em key={field}>{field}</em>)}
                            {partial.components.map((component) => <em className="component" key={component}>{component}</em>)}
                          </div>
                          <IconButton icon={FileCode2} label="Open partial YAML" onClick={() => host.openPrototypeSource(partial.filePath, partial.line)} />
                        </div>
                      ))
                    )}
                  </section>
                  <section className="studio-card">
                    <header className="studio-card-head">
                      <h3>Workspace partial sources</h3>
                    </header>
                    <div className="partial-source-list">
                      {(host.prototypes?.partialFiles ?? []).map((file) => (
                        <code key={file}>{file}</code>
                      ))}
                      {(host.prototypes?.partialFiles.length ?? 0) === 0 ? (
                        <div className="table-empty">No PartialPrototypes directories declared.</div>
                      ) : null}
                    </div>
                  </section>
                </div>
              ) : null}
            </div>

            {extracting ? (
              <ExtractPartialDialog
                view={view}
                fields={selectedFields}
                components={selectedComponents}
                onToggleField={(field) =>
                  setSelectedFields((current) =>
                    current.includes(field) ? current.filter((item) => item !== field) : [...current, field],
                  )
                }
                onToggleComponent={(component) =>
                  setSelectedComponents((current) =>
                    current.includes(component)
                      ? current.filter((item) => item !== component)
                      : [...current, component],
                  )
                }
                onClose={() => setExtracting(false)}
                onExtract={async () => {
                  setExtracting(false);
                  await host.applyPrototypeOperation(view.resolved.filePath, {
                    kind: 'extractPartial',
                    id: view.resolved.id,
                    fields: selectedFields,
                    components: selectedComponents,
                  });
                }}
              />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function FieldRow({
  field,
  readOnly,
  onSet,
}: {
  field: ResolvedField;
  readOnly: boolean;
  onSet: (value: string | number | boolean | null) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editValue(field.value));
  return (
    <div className="field-row">
      <div className="field-key">
        <code>{field.key}</code>
        {field.inherited ? <em>inherited</em> : <em className="own">own</em>}
      </div>
      <div className="field-value">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setEditing(false);
                void onSet(parseValue(draft));
              }
              if (event.key === 'Escape') setEditing(false);
            }}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <span title={formatValue(field.value)}>{formatValue(field.value)}</span>
        )}
        {field.overridden.length > 0 ? (
          <small title={field.overridden.map((item) => `${item.sourceId}: ${formatValue(item.value)}`).join('\n')}>
            overrides {field.overridden.length}
          </small>
        ) : null}
      </div>
      <div className="field-source" title={field.sourceFile}>{field.sourceId}</div>
      {!readOnly ? (
        <IconButton
          icon={Pencil}
          label={`Edit ${field.key}`}
          onClick={() => {
            setDraft(editValue(field.value));
            setEditing(true);
          }}
        />
      ) : null}
    </div>
  );
}

function ComponentCard({
  component,
  view,
  readOnly,
  onSet,
  onRemove,
}: {
  component: PrototypeComponent;
  view: PrototypeView;
  readOnly: boolean;
  onSet: (field: string, value: string | number | boolean | null) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(component.ownFields.length > 0 || !component.inherited);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <section className={`component-card ${open ? 'open' : ''}`}>
      <header>
        <button type="button" className="component-toggle" onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          <Boxes size={14} aria-hidden />
          <strong>{component.type}</strong>
          <span>{Object.keys(component.fields).length} fields</span>
          {component.inherited ? <Badge tone="muted">inherited</Badge> : <Badge tone="accent">own</Badge>}
        </button>
        <code>{component.inherited ? component.contributors[0] ?? component.sourceId : view.summary.id}</code>
        {!readOnly && !component.inherited ? (
          <IconButton icon={Trash2} label={`Remove ${component.type}`} onClick={() => void onRemove()} />
        ) : null}
      </header>
      {open ? (
        <div className="component-fields">
          {Object.entries(component.fields).map(([key, value]) => {
            const own = component.ownFields.includes(key);
            const origin = component.fieldOrigins[key] ?? component.sourceId;
            return (
              <div className="component-field-row" key={key}>
                <code>{key}</code>
                {editing === key ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        setEditing(null);
                        void onSet(key, parseValue(draft));
                      }
                      if (event.key === 'Escape') setEditing(null);
                    }}
                    onBlur={() => setEditing(null)}
                  />
                ) : (
                  <span title={formatValue(value)}>{formatValue(value)}</span>
                )}
                <em className={own ? 'own' : ''} title={`Contributed by ${origin}`}>{own ? 'own' : origin}</em>
                {!readOnly ? (
                  <IconButton
                    icon={Pencil}
                    label={`Edit ${component.type}.${key}`}
                    onClick={() => {
                      setDraft(editValue(value));
                      setEditing(key);
                    }}
                  />
                ) : null}
              </div>
            );
          })}
          {Object.keys(component.fields).length === 0 ? <div className="table-empty">No fields.</div> : null}
        </div>
      ) : null}
    </section>
  );
}

function AddComponent({ onAdd }: { onAdd: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState('');
  return (
    <form
      className="add-component"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void onAdd(name.trim());
        setName('');
      }}
    >
      <Field label="Add component">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Item, Anchorable, Sprite" />
      </Field>
      <Button icon={Plus} type="submit" disabled={!name.trim()}>
        Add
      </Button>
    </form>
  );
}

function InheritanceTree({
  node,
  onOpen,
  root = false,
}: {
  node: InheritanceNode;
  onOpen: (id: string) => void;
  root?: boolean;
}) {
  return (
    <div className={`inheritance-node ${root ? 'root' : ''}`}>
      <button type="button" onClick={() => !root && !node.missing && onOpen(node.id)} disabled={root || node.missing}>
        <GitBranch size={11} aria-hidden />
        <span>{node.name || node.id}</span>
        <code>{node.id}</code>
        {node.abstract ? <em>abstract</em> : null}
        {node.missing ? <em className="missing">missing</em> : null}
      </button>
      {node.parents.length > 0 ? (
        <div className="inheritance-children">
          {node.parents.map((parent, index) => (
            <InheritanceTree key={`${parent.id}:${index}`} node={parent} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InGameCard({ view, host, entityId }: { view: PrototypeView; host: StudioHost; entityId?: string }) {
  const sprite = view.resolved.sprite;
  return (
    <section className="studio-card in-game-card">
      <header className="studio-card-head">
        <h3>
          <Sparkles size={14} aria-hidden />
          Approximate in-game card
        </h3>
        <Badge tone="muted">preview</Badge>
      </header>
      <div className="ingame-preview">
        <div className="ingame-sprite">
          <EntitySprite entityId={entityId} icons={host.icons} size={80} />
        </div>
        <div className="ingame-copy">
          <strong>
            {view.resolved.name}
            {view.resolved.suffix ? <em> {view.resolved.suffix}</em> : null}
          </strong>
          <span className="ingame-desc">{view.resolved.description ?? 'No description set.'}</span>
          <div className="ingame-tags">
            <span>{view.summary.kind}</span>
            <span>{view.resolved.components.length} components</span>
            {sprite?.rsi ? <span className="sprite-tag" title={spriteLabel(sprite)}><ImageIcon size={10} aria-hidden />{sprite.state}</span> : null}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="ingame-sprite-link"
        onClick={() => sprite?.rsi && host.openRsi(sprite.rsi)}
        disabled={!sprite?.rsi}
        title={spriteLabel(sprite)}
      >
        <ImageIcon size={13} aria-hidden />
        <span>{spriteLabel(sprite)}</span>
        <ChevronRight size={13} aria-hidden />
      </button>
      <div className="ingame-components">
        {view.resolved.components.slice(0, 12).map((component) => (
          <span key={component.type} title={Object.keys(component.fields).join(', ')}>
            {component.type}
          </span>
        ))}
        {view.resolved.components.length > 12 ? <span>+{view.resolved.components.length - 12}</span> : null}
      </div>
      <div className="ingame-actions">
        <Button icon={Copy} size="sm" onClick={() => host.copyText(view.resolved.id)}>Copy id</Button>
        <Button icon={FileCode2} size="sm" onClick={() => host.openPrototypeSource(view.resolved.filePath, view.resolved.line)}>
          Source
        </Button>
      </div>
    </section>
  );
}

function ExtractPartialDialog({
  view,
  fields,
  components,
  onToggleField,
  onToggleComponent,
  onClose,
  onExtract,
}: {
  view: PrototypeView;
  fields: string[];
  components: string[];
  onToggleField: (field: string) => void;
  onToggleComponent: (component: string) => void;
  onClose: () => void;
  onExtract: () => Promise<void>;
}) {
  const ownFields = view.resolved.resolvedFields.filter((field) => !field.inherited);
  const ownComponents = view.resolved.components.filter((component) => !component.inherited);
  return (
    <div className="studio-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="studio-modal extract-modal" role="dialog" aria-label="Extract partial prototype">
        <header className="studio-modal-head">
          <div className="studio-modal-heading">
            <span className="studio-modal-icon"><Scissors size={18} aria-hidden /></span>
            <div>
              <h2>Extract a YAML partial</h2>
              <p>Generate a !Partial overlay for {view.resolved.id} and open it as a new document.</p>
            </div>
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="studio-modal-body">
          <div className="extract-columns">
            <div>
              <h3><Tag size={13} aria-hidden /> Own fields</h3>
              {ownFields.length === 0 ? <span className="muted">No own fields.</span> : ownFields.map((field) => (
                <label key={field.key} className="extract-check">
                  <input
                    type="checkbox"
                    checked={fields.includes(field.key)}
                    onChange={() => onToggleField(field.key)}
                  />
                  <code>{field.key}</code>
                </label>
              ))}
            </div>
            <div>
              <h3><Boxes size={13} aria-hidden /> Own components</h3>
              {ownComponents.length === 0 ? <span className="muted">No own components.</span> : ownComponents.map((component) => (
                <label key={component.type} className="extract-check">
                  <input
                    type="checkbox"
                    checked={components.includes(component.type)}
                    onChange={() => onToggleComponent(component.type)}
                  />
                  <code>{component.type}</code>
                </label>
              ))}
            </div>
          </div>
          <div className="extract-note">
            <Info size={14} aria-hidden />
            <span>
              The partial is written as <code>- type: !Partial:0 {view.summary.kind}</code>. Save it under a
              directory declared in <code>Resources/PartialPrototypes</code>.
            </span>
          </div>
        </div>
        <footer className="studio-modal-footer">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} disabled={fields.length + components.length === 0} onClick={() => void onExtract()}>
            Generate partial
          </Button>
        </footer>
      </div>
    </div>
  );
}
