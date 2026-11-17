import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  InheritanceNode,
  PrototypeComponent,
  PrototypeOperation,
  PrototypeSummary,
  PrototypeView,
  ResolvedField,
  SpriteInfo,
  StorageContainerView,
  StorageItemView,
  StorageView,
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
  GripVertical,
  Image as ImageIcon,
  Info,
  Layers,
  LayoutGrid,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Sparkles,
  Tag,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { StudioHost } from '../lib/host';
import {
  buildStorageGrid,
  placeStorageItems,
  reorder,
  storageContents,
} from '../lib/storage';
import {
  emptySpriteLayer,
  layersFromSprite,
  spriteComponentFields,
  type EditableSpriteLayer,
} from '../lib/sprite';
import { Badge, Button, Field, IconButton } from './ui';
import { EntitySprite } from './SpritePreview';

type Tab = 'overview' | 'components' | 'sprite' | 'storage' | 'inheritance' | 'partials';

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
  const displayEntity = view?.displayEntity ?? entityId;
  const headerSprite = view?.resolved.sprite ?? view?.displaySprite ?? null;

  useEffect(() => {
    if (displayEntity) host.requestIcon(displayEntity);
  }, [displayEntity, host.requestIcon]);

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

  useEffect(() => {
    for (const summary of filtered.slice(0, limit)) {
      const entity =
        summary.displayEntity ??
        (summary.kind === 'entity' ? summary.id : null);
      if (entity) host.requestIcon(entity);
    }
  }, [filtered, host.requestIcon, limit]);

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
                  <EntitySprite
                    entityId={
                      summary.displayEntity ??
                      (summary.kind === 'entity' ? summary.id : null)
                    }
                    icons={host.icons}
                    size={26}
                  />
                  <span className="prototype-row-main">
                    <span className="prototype-row-name">{summary.name || summary.id}</span>
                    <span className="prototype-row-id">
                      {summary.id}
                      {summary.abstract ? <em>abstract</em> : null}
                      {summary.partial ? <em className="partial">partial</em> : null}
                      {summary.displayEntity && summary.displayEntity !== summary.id ? (
                        <em className="display-entity" title={`Shows ${summary.displayEntity}`}>
                          → {summary.displayEntity}
                        </em>
                      ) : null}
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
                  <EntitySprite entityId={displayEntity} icons={host.icons} size={56} />
                </div>
                <div>
                  <div className="prototype-eyebrow">
                    <Badge tone="accent">{view.summary.kind}</Badge>
                    {view.summary.abstract ? <Badge tone="muted">abstract</Badge> : null}
                    {view.summary.partial ? <Badge tone="warning">partial</Badge> : null}
                    {view.displayKind ? (
                      <Badge tone="muted" title={`Sprite resolved from ${view.displayEntity}`}>
                        shows {view.displayKind}
                      </Badge>
                    ) : null}
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
                  {view.displayEntity && view.displayEntity !== view.summary.id ? (
                    <button
                      type="button"
                      className="inline-path display-entity-link"
                      onClick={() => host.openPrototype(view.displayEntity!)}
                      title="Open the entity whose sprite is previewed"
                    >
                      <Boxes size={12} aria-hidden />
                      shows {view.displayEntity}
                    </button>
                  ) : null}
                  {view.summary.description ? <p>{view.summary.description}</p> : null}
                </div>
              </div>
              <div className="prototype-head-actions">
                {headerSprite?.rsi ? (
                  <Button icon={ImageIcon} size="sm" onClick={() => host.openRsi(headerSprite.rsi!)}>
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
              {view.resolved.sprite ? (
                <button type="button" className={tab === 'sprite' ? 'active' : ''} onClick={() => setTab('sprite')}>
                  <ImageIcon size={13} aria-hidden /> Sprite
                  <span>{view.resolved.sprite.layers?.length ?? 1}</span>
                </button>
              ) : null}
              {view.storage ? (
                <button type="button" className={tab === 'storage' ? 'active' : ''} onClick={() => setTab('storage')}>
                  <LayoutGrid size={13} aria-hidden /> Storage
                  <span>
                    {view.storage.containers.length > 1
                      ? `${view.storage.containers.length} containers`
                      : view.storage.items.length}
                  </span>
                </button>
              ) : null}
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
                  <InGameCard view={view} host={host} entityId={displayEntity} />
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

              {tab === 'sprite' && view.resolved.sprite ? (
                <SpriteLayerEditor view={view} host={host} />
              ) : null}

              {tab === 'storage' && view.storage ? (
                <StorageEditor view={view} storage={view.storage} host={host} />
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

function SpriteLayerEditor({ view, host }: { view: PrototypeView; host: StudioHost }) {
  const sprite = view.resolved.sprite!;
  const component = sprite.component ?? 'Sprite';
  const [layers, setLayers] = useState<EditableSpriteLayer[]>(() => layersFromSprite(sprite));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLayers(layersFromSprite(sprite));
    setDirty(false);
  }, [sprite]);

  const update = (index: number, patch: Partial<EditableSpriteLayer>) => {
    setLayers((current) =>
      current.map((layer, layerIndex) =>
        layerIndex === index ? { ...layer, ...patch } : layer,
      ),
    );
    setDirty(true);
  };

  const save = async () => {
    const result = await host.applyPrototypeOperation(view.resolved.filePath, {
      kind: 'setComponentFields',
      id: view.resolved.id,
      component,
      fields: spriteComponentFields(sprite, layers, component),
    });
    if (result.ok) setDirty(false);
  };

  return (
    <div className="sprite-editor">
      <section className="studio-card">
        <header className="studio-card-head">
          <h3>
            <Layers size={14} aria-hidden />
            {component} layers
          </h3>
          <Badge tone="muted">{layers.length} layer{layers.length === 1 ? '' : 's'}</Badge>
          <div className="card-head-actions">
            <Button
              size="sm"
              icon={Plus}
              disabled={host.readOnly || component === 'Icon'}
              onClick={() => {
                setLayers((current) => [...current, emptySpriteLayer(current[0])]);
                setDirty(true);
              }}
            >
              Add layer
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={Save}
              disabled={host.readOnly || !dirty}
              onClick={() => void save()}
            >
              Save sprite
            </Button>
          </div>
        </header>

        <div className="sprite-editor-note">
          <Info size={13} aria-hidden />
          <span>
            Each layer can use a different RSI, state, colour, scale and offset.
            The first layer is the base sprite; extra layers are written under
            <code>layers:</code> in the YAML.
          </span>
        </div>

        <div className="sprite-layer-list">
          {layers.map((layer, index) => (
            <div className="sprite-layer-row" key={index}>
              <div className="sprite-layer-index">
                <GripVertical size={14} aria-hidden />
                <strong>{index === 0 ? 'Base' : `Layer ${index + 1}`}</strong>
              </div>
              <Field label="RSI path">
                <input
                  value={layer.rsi}
                  placeholder="Textures/Objects/..."
                  spellCheck={false}
                  onChange={(event) => update(index, { rsi: event.target.value })}
                />
              </Field>
              <Field label="State">
                <input
                  value={layer.state}
                  placeholder="icon"
                  spellCheck={false}
                  onChange={(event) => update(index, { state: event.target.value })}
                />
              </Field>
              <Field label="Colour">
                <input
                  value={layer.color}
                  placeholder="#RRGGBBAA"
                  spellCheck={false}
                  onChange={(event) => update(index, { color: event.target.value })}
                />
              </Field>
              <Field label="Scale">
                <input
                  value={layer.scale}
                  inputMode="decimal"
                  onChange={(event) => update(index, { scale: event.target.value })}
                />
              </Field>
              <Field label="Offset X">
                <input
                  value={layer.offsetX}
                  inputMode="decimal"
                  onChange={(event) => update(index, { offsetX: event.target.value })}
                />
              </Field>
              <Field label="Offset Y">
                <input
                  value={layer.offsetY}
                  inputMode="decimal"
                  onChange={(event) => update(index, { offsetY: event.target.value })}
                />
              </Field>
              <label className="sprite-layer-visible">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={(event) => update(index, { visible: event.target.checked })}
                />
                Visible
              </label>
              <IconButton
                icon={Trash2}
                label={`Remove layer ${index + 1}`}
                disabled={host.readOnly || layers.length <= 1}
                onClick={() => {
                  setLayers((current) => current.filter((_, layerIndex) => layerIndex !== index));
                  setDirty(true);
                }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="studio-card">
        <header className="studio-card-head">
          <h3>
            <ImageIcon size={14} aria-hidden />
            Current composite
          </h3>
          <Badge tone="muted">approximate</Badge>
        </header>
        <div className="sprite-composite">
          <EntitySprite
            entityId={view.summary.kind === 'entity' ? view.summary.id : null}
            icons={host.icons}
            size={96}
            animate={host.config.animations}
          />
          <div>
            <strong>{spriteLabel(sprite)}</strong>
            <span>
              {layers.filter((layer) => layer.visible).length} visible layer(s)
              {sprite.extra && Object.keys(sprite.extra).length > 0
                ? ` · ${Object.keys(sprite.extra).length} extra field(s) preserved`
                : ''}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function StorageEditor({
  view,
  storage,
  host,
}: {
  view: PrototypeView;
  storage: StorageView;
  host: StudioHost;
}) {
  const containers = useMemo<StorageContainerView[]>(() => {
    if (storage.containers.length > 0) return storage.containers;
    return [
      {
        id: 'storagebase',
        label: 'Storage',
        component: storage.component ?? 'StorageFill',
        grid: storage.grid,
        columns: storage.columns,
        rows: storage.rows,
        items: storage.items,
        maxItemSize: storage.maxItemSize,
        capacity: storage.capacity,
        editable: storage.hasFill,
        diagnostics: storage.diagnostics,
      },
    ];
  }, [storage]);

  const [activeId, setActiveId] = useState(containers[0]?.id ?? 'storagebase');
  useEffect(() => {
    setActiveId((current) =>
      containers.some((container) => container.id === current)
        ? current
        : containers[0]?.id ?? 'storagebase',
    );
  }, [containers, view.key]);
  const active =
    containers.find((container) => container.id === activeId) ?? containers[0]!;

  const [adding, setAdding] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const placements = useMemo(() => placeStorageItems(active), [active]);
  const placed = placements.filter((placement) => !placement.overflow);
  const overflow = placements.filter((placement) => placement.overflow);
  const columns = Math.max(1, active.columns);
  const rows = Math.max(1, active.rows);
  const editable = active.editable && !host.readOnly;
  const canResize =
    active.id === 'storagebase' && storage.hasStorage && !host.readOnly;

  useEffect(() => {
    for (const container of containers) {
      for (const item of container.items) host.requestIcon(item.id);
    }
  }, [containers, host.requestIcon]);

  const applyContents = (items: readonly StorageItemView[]) =>
    host.applyPrototypeOperation(view.resolved.filePath, {
      kind: 'setStorageContents',
      id: view.resolved.id,
      contents: storageContents(items),
    });

  const move = (from: number, to: number) => {
    if (from === to) return;
    void applyContents(reorder(active.items, from, to));
  };

  const addItem = () => {
    const id = adding.trim();
    if (!id) return;
    void applyContents([
      ...active.items,
      {
        id,
        index: active.items.length,
        name: id,
        kind: null,
        sprite: null,
        slot: null,
        footprint: { width: 1, height: 1 },
      },
    ]);
    setAdding('');
  };

  const resize = (nextColumns: number, nextRows: number) => {
    void host.applyPrototypeOperation(view.resolved.filePath, {
      kind: 'setStorageGrid',
      id: view.resolved.id,
      grid: buildStorageGrid(nextColumns, nextRows),
    });
  };

  return (
    <div className="storage-editor">
      <section className="studio-card">
        <header className="studio-card-head">
          <h3>
            <LayoutGrid size={14} aria-hidden />
            Containers
          </h3>
          <Badge tone="muted">
            {containers.length} container{containers.length === 1 ? '' : 's'}
          </Badge>
          <div className="card-head-actions">
            {canResize ? (
              <>
                <Button size="sm" icon={Plus} onClick={() => resize(columns + 1, rows)}>
                  Add column
                </Button>
                <Button size="sm" icon={Plus} onClick={() => resize(columns, rows + 1)}>
                  Add row
                </Button>
                <Button
                  size="sm"
                  icon={RotateCcw}
                  disabled={columns === 8 && rows === 4}
                  onClick={() => resize(8, 4)}
                >
                  Reset 8×4
                </Button>
              </>
            ) : null}
          </div>
        </header>

        {containers.length > 1 ? (
          <div className="storage-container-tabs" role="tablist" aria-label="Storage containers">
            {containers.map((container) => (
              <button
                key={container.id}
                type="button"
                role="tab"
                aria-selected={container.id === active.id}
                className={container.id === active.id ? 'active' : ''}
                onClick={() => {
                  setActiveId(container.id);
                  setDragIndex(null);
                }}
                title={`${container.component} · ${container.id}`}
              >
                <span>{container.label}</span>
                <em>{container.items.length}</em>
                {container.editable ? (
                  <Badge tone="success">edit</Badge>
                ) : (
                  <Badge tone="muted">preview</Badge>
                )}
              </button>
            ))}
          </div>
        ) : null}

        <div className="storage-meta">
          <span>
            <Badge tone="accent">{active.component}</Badge> {active.id}
          </span>
          <span>{columns} × {rows} grid</span>
          <span>{active.items.length}/{active.capacity} slots</span>
          <span>max item size: {active.maxItemSize ?? 'default'}</span>
          {editable ? (
            <span className="storage-editable">editable</span>
          ) : (
            <span className="storage-preview-only">preview only</span>
          )}
        </div>

        {active.diagnostics.length > 0 ? (
          <div className="storage-diagnostics">
            {active.diagnostics.map((diagnostic, index) => (
              <span key={`${diagnostic.code}:${index}`} className={diagnostic.severity}>
                {diagnostic.severity === 'warning' ? (
                  <TriangleAlert size={11} aria-hidden />
                ) : (
                  <Info size={11} aria-hidden />
                )}
                {diagnostic.message}
              </span>
            ))}
          </div>
        ) : null}

        <div
          className={`storage-grid ${editable ? 'is-editable' : 'is-preview'}`}
          style={{
            gridTemplateColumns: `repeat(${columns}, 42px)`,
            gridTemplateRows: `repeat(${rows}, 42px)`,
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (editable && dragIndex != null) move(dragIndex, active.items.length - 1);
            setDragIndex(null);
          }}
        >
          {Array.from({ length: columns * rows }, (_, index) => (
            <span
              className="storage-cell"
              key={`cell:${index}`}
              style={{
                gridColumn: `${(index % columns) + 1}`,
                gridRow: `${Math.floor(index / columns) + 1}`,
              }}
            />
          ))}
          {placed.map((placement) => (
            <button
              type="button"
              key={`${placement.item.index}:${placement.item.id}`}
              className={`storage-item ${dragIndex === placement.item.index ? 'dragging' : ''} ${placement.item.alternative ? 'alternative' : ''}`}
              style={{
                gridColumn: `${placement.x + 1} / span ${placement.width}`,
                gridRow: `${placement.y + 1} / span ${placement.height}`,
              }}
              draggable={editable}
              onDragStart={() => editable && setDragIndex(placement.item.index)}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (editable && dragIndex != null) move(dragIndex, placement.item.index);
                setDragIndex(null);
              }}
              title={storageItemTitle(placement.item)}
            >
              <EntitySprite entityId={placement.item.id} icons={host.icons} size={30} />
              <span>{placement.item.name}</span>
              {placement.item.amount && placement.item.amount !== 1 ? <em>×{placement.item.amount}</em> : null}
              {placement.item.rotation != null && placement.item.rotation % 360 !== 0 ? (
                <em className="rotation">{placement.item.rotation}°</em>
              ) : null}
              {placement.item.slotName ? <em className="slot-name">{placement.item.slotName}</em> : null}
              {editable ? (
                <span
                  className="storage-remove"
                  role="button"
                  tabIndex={0}
                  title="Remove from StorageFill"
                  onClick={(event) => {
                    event.stopPropagation();
                    void applyContents(active.items.filter((item) => item.index !== placement.item.index));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.stopPropagation();
                      void applyContents(active.items.filter((item) => item.index !== placement.item.index));
                    }
                  }}
                >
                  <X size={10} aria-hidden />
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {editable ? (
          <form
            className="storage-add"
            onSubmit={(event) => {
              event.preventDefault();
              addItem();
            }}
          >
            <Field label="Spawn an entity inside">
              <input
                value={adding}
                placeholder="e.g. ToolboxEmergency, ClothingBackpack"
                spellCheck={false}
                onChange={(event) => setAdding(event.target.value)}
              />
            </Field>
            <Button icon={Plus} type="submit" disabled={!adding.trim()}>
              Add item
            </Button>
          </form>
        ) : (
          <div className="storage-readonly-note">
            <Info size={13} aria-hidden />
            <span>
              {active.component === 'StorageFill'
                ? 'This StorageFill has no editable Storage grid. Add a Storage component to edit its contents.'
                : `${active.component} containers are preview-only in SS14 Studio. Edit the YAML source to change them.`}
            </span>
          </div>
        )}

        {overflow.length > 0 ? (
          <div className="storage-overflow">
            <div className="card-subhead">Does not fit</div>
            {overflow.map((placement) => (
              <button
                type="button"
                key={`overflow:${placement.item.index}`}
                draggable={editable}
                onDragStart={() => editable && setDragIndex(placement.item.index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (editable && dragIndex != null) move(dragIndex, placement.item.index);
                  setDragIndex(null);
                }}
                onClick={() =>
                  editable &&
                  void applyContents(active.items.filter((item) => item.index !== placement.item.index))
                }
                title={storageItemTitle(placement.item)}
              >
                <EntitySprite entityId={placement.item.id} icons={host.icons} size={22} />
                <span>{placement.item.name}</span>
                <em>{placement.item.footprint.width}×{placement.item.footprint.height}</em>
                {editable ? <em>remove</em> : null}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="studio-card">
        <header className="studio-card-head">
          <h3>
            <Sparkles size={14} aria-hidden />
            Spawn summary
          </h3>
          <Badge tone="muted">
            {containers.reduce((sum, container) => sum + container.items.length, 0)} entries
          </Badge>
        </header>
        <div className="storage-summary">
          {containers.map((container) => (
            <div className="storage-summary-group" key={container.id}>
              <div className="storage-summary-head">
                <strong>{container.label}</strong>
                <code>{container.component}</code>
                <Badge tone="muted">{container.items.length}</Badge>
              </div>
              {container.items.map((item) => (
                <div
                  className="storage-summary-row"
                  key={`${container.id}:${item.index}:${item.id}`}
                >
                  <EntitySprite entityId={item.id} icons={host.icons} size={22} />
                  <span>{item.name}</span>
                  <code>{item.id}</code>
                  {item.amount && item.amount !== 1 ? <em>×{item.amount}</em> : null}
                  <em>{item.footprint.width}×{item.footprint.height}</em>
                  {item.rotation != null && item.rotation % 360 !== 0 ? (
                    <em>{item.rotation}°</em>
                  ) : null}
                  {item.slotName ? <em className="slot-name">{item.slotName}</em> : null}
                  {item.alternative ? <em className="alternative">or</em> : null}
                </div>
              ))}
              {container.items.length === 0 ? <span className="muted">No entries.</span> : null}
            </div>
          ))}
        </div>
        <p className="storage-summary-note">
          Positions are approximate: entries are packed first-fit into unit cells using their
          item footprint and stored rotation. Group selectors list every alternative.
        </p>
      </section>
    </div>
  );
}

function storageItemTitle(item: StorageItemView): string {
  const parts = [item.id];
  if (item.amount && item.amount !== 1) parts.push(`×${item.amount}`);
  if (item.slotName) parts.push(item.slotName);
  if (item.rotation != null && item.rotation % 360 !== 0) parts.push(`${item.rotation}°`);
  parts.push(`${item.footprint.width}×${item.footprint.height}`);
  return parts.join(' · ');
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
  const sprite = view.resolved.sprite ?? view.displaySprite ?? null;
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
