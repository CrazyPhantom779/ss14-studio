import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  ConstructionEdge,
  ConstructionNode,
  ConstructionStep,
  Diagnostic,
  EditResult,
  GraphOperation,
  GraphView,
  IndexPayload,
  TaggedEntry,
  TaggedScope,
} from '@ss14-studio/core';
import {
  getIncoming,
  summarizeStep,
} from '@ss14-studio/core';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  FileCode2,
  Flag,
  GitBranch,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  Plus,
  Route,
  Scissors,
  Timer,
  Trash2,
  TriangleAlert,
  Wand2,
  Wrench,
  X,
} from 'lucide-react';
import type { ConfirmOptions, DialogState } from '../lib/dialogs';
import {
  diagnosticCount,
  diagnosticMaps,
  formatNumber,
  formatSeconds,
  highestSeverity,
  initialsFor,
  nodeAccent,
  outgoingMaterials,
} from '../lib/graph';
import type { StudioSelection } from '../lib/selection';
import {
  draftToFieldValue,
  editableFieldType,
  fieldValueToDraft,
  stepFieldLabel,
  stepKindLabel,
  taggedEntrySummary,
  type EditableFieldType,
} from '../lib/stepFields';
import { Badge, Button, IconButton, Section } from './ui';

interface InspectorProps {
  graph: GraphView;
  selection: StudioSelection | null;
  index: IndexPayload | null;
  readOnly: boolean;
  onClose: () => void;
  onSelect: (selection: StudioSelection | null) => void;
  onOperation: (operation: GraphOperation) => Promise<EditResult>;
  onOpenSource: (line?: number, node?: string, edgeIndex?: number) => void;
  onOpenDialog: (dialog: DialogState) => void;
  onConfirm: (options: ConfirmOptions) => Promise<boolean>;
  onAutoLayout: () => void;
  onNotify: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
  onCopy: (text: string) => void;
}

function severityIcon(severity: Diagnostic['severity']) {
  if (severity === 'error') return <CircleAlert size={12} aria-hidden />;
  if (severity === 'warning') return <TriangleAlert size={12} aria-hidden />;
  return <CircleAlert size={12} aria-hidden />;
}

function InlineField({
  label,
  value,
  placeholder,
  disabled,
  mono = false,
  validate,
  onSubmit,
  hint,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => Promise<EditResult>;
  hint?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const dirty = draft.trim() !== value.trim();

  const commit = async () => {
    if (!dirty) return;
    const next = draft.trim();
    const validation = validate?.(next);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onSubmit(next);
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not save.');
  };

  return (
    <form
      className={`inline-field ${mono ? 'mono' : ''}`.trim()}
      onSubmit={(event) => {
        event.preventDefault();
        void commit();
      }}
    >
      <label>
        <span>{label}</span>
        <div className="inline-field-input">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            spellCheck={false}
          />
          {dirty || busy ? (
            <button type="submit" className="inline-save" disabled={disabled || busy} title="Save">
              {busy ? <Loader2 size={13} className="spin" aria-hidden /> : <Check size={13} aria-hidden />}
            </button>
          ) : null}
        </div>
      </label>
      {error ? <span className="inline-error">{error}</span> : hint ? <span className="inline-hint">{hint}</span> : null}
    </form>
  );
}

function TaggedList({
  entries,
  scope,
  readOnly,
  onAdd,
  onRemove,
  compact = false,
}: {
  entries: TaggedEntry[];
  scope: TaggedScope;
  readOnly: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`tagged-list ${compact ? 'compact' : ''}`.trim()}>
      {entries.length === 0 ? (
        <div className="tagged-empty">No entries yet.</div>
      ) : (
        entries.map((entry, index) => (
          <div className="tagged-row" key={`${scope}-${entry.span.start}-${index}`}>
            <span className="tagged-type">!type:{entry.type ?? 'untyped'}</span>
            <span className="tagged-fields">{taggedEntrySummary(entry)}</span>
            {!readOnly ? (
              <button
                type="button"
                className="tagged-remove"
                title="Remove entry"
                onClick={() => onRemove(index)}
              >
                <X size={11} aria-hidden />
              </button>
            ) : null}
          </div>
        ))
      )}
      {!readOnly ? (
        <button type="button" className="tagged-add" onClick={onAdd}>
          <Plus size={11} aria-hidden />
          Add {scope === 'nodeActions' || scope === 'nodeTransforms' ? 'action' : 'condition'}
        </button>
      ) : null}
    </div>
  );
}

function StepFieldEditor({
  fieldKey,
  value,
  readOnly,
  onSave,
  onOpenSource,
}: {
  fieldKey: string;
  value: unknown;
  readOnly: boolean;
  onSave: (value: string | number | boolean | string[] | null) => Promise<EditResult>;
  onOpenSource: () => void;
}) {
  const type: EditableFieldType = editableFieldType(fieldKey, value);
  const [draft, setDraft] = useState(() => fieldValueToDraft(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(fieldValueToDraft(value));
    setError(null);
  }, [value]);

  const original = fieldValueToDraft(value);
  const dirty = draft !== original;

  if (type === 'complex') {
    return (
      <div className="step-field complex">
        <span className="step-field-key">{stepFieldLabel(fieldKey)}</span>
        <code>{JSON.stringify(value)}</code>
        <button type="button" className="step-field-yaml" onClick={onOpenSource}>
          Edit YAML
        </button>
      </div>
    );
  }

  const save = async () => {
    if (!dirty) return;
    setBusy(true);
    setError(null);
    const result = await onSave(draftToFieldValue(type, draft) ?? null);
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not save the field.');
  };

  return (
    <div className={`step-field ${type}`.trim()}>
      <span className="step-field-key">
        {stepFieldLabel(fieldKey)}
        {fieldKey.endsWith('Temperature') ? <em> K</em> : null}
        {fieldKey === 'doAfter' ? <em> s</em> : null}
      </span>
      <div className="step-field-control">
        {type === 'boolean' ? (
          <select
            value={draft}
            disabled={readOnly || busy}
            onChange={(event) => setDraft(event.target.value)}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            value={draft}
            type={type === 'number' ? 'number' : 'text'}
            step={type === 'number' ? 'any' : undefined}
            disabled={readOnly || busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
            placeholder={type === 'csv' ? 'comma, separated' : undefined}
            spellCheck={false}
          />
        )}
        {dirty || busy ? (
          <button type="button" className="inline-save" onClick={() => void save()} disabled={readOnly || busy} title="Save field">
            {busy ? <Loader2 size={12} className="spin" aria-hidden /> : <Check size={12} aria-hidden />}
          </button>
        ) : null}
      </div>
      {error ? <span className="inline-error">{error}</span> : null}
    </div>
  );
}

function AddFieldRow({
  readOnly,
  onSave,
}: {
  readOnly: boolean;
  onSave: (key: string, value: string | number | boolean) => Promise<EditResult>;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (readOnly) return null;

  if (!open) {
    return (
      <button type="button" className="step-add-field" onClick={() => setOpen(true)}>
        <Plus size={11} aria-hidden />
        Add field
      </button>
    );
  }

  const parsed = (): string | number | boolean => {
    const raw = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  };

  return (
    <form
      className="add-field-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key.trim())) {
          setError('Use a valid YAML field name.');
          return;
        }
        if (!value.trim()) {
          setError('A value is required.');
          return;
        }
        setBusy(true);
        setError(null);
        void onSave(key.trim(), parsed()).then((result) => {
          setBusy(false);
          if (!result.ok) {
            setError(result.error ?? 'Could not add the field.');
          } else {
            setOpen(false);
            setKey('');
            setValue('');
          }
        });
      }}
    >
      <input
        value={key}
        onChange={(event) => setKey(event.target.value)}
        placeholder="field"
        aria-label="New field name"
        spellCheck={false}
      />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="value"
        aria-label="New field value"
        spellCheck={false}
      />
      <button type="submit" className="inline-save" disabled={busy} title="Add field">
        {busy ? <Loader2 size={12} className="spin" aria-hidden /> : <Check size={12} aria-hidden />}
      </button>
      <button type="button" className="inline-cancel" onClick={() => setOpen(false)} title="Cancel">
        <X size={12} aria-hidden />
      </button>
      {error ? <span className="inline-error">{error}</span> : null}
    </form>
  );
}

interface StepCardProps {
  step: ConstructionStep;
  stepIndex: number;
  edgeIndex: number;
  edge: ConstructionEdge;
  from: string;
  readOnly: boolean;
  onOperation: (operation: GraphOperation) => Promise<EditResult>;
  onOpenDialog: (dialog: DialogState) => void;
  onOpenSource: (line?: number, node?: string, edgeIndex?: number) => void;
  onConfirm: (options: ConfirmOptions) => Promise<boolean>;
  onNotify: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
  defaultOpen: boolean;
}

function StepCard({
  step,
  stepIndex,
  edgeIndex,
  edge,
  from,
  readOnly,
  onOperation,
  onOpenDialog,
  onOpenSource,
  onConfirm,
  onNotify,
  defaultOpen,
}: StepCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const fields = Object.entries(step.fields).filter(([key]) => key !== 'completed');

  const remove = async () => {
    const confirmed = await onConfirm({
      title: 'Remove construction step?',
      message: `Remove step ${stepIndex + 1} from ${from} → ${edge.target}?`,
      detail: summarizeStep(step),
      confirmLabel: 'Remove step',
      tone: 'danger',
    });
    if (!confirmed) return;
    const result = await onOperation({
      kind: 'removeStep',
      from,
      to: edge.target,
      edgeIndex,
      stepIndex,
    });
    if (result.ok) onNotify('success', 'Removed the construction step.');
  };

  return (
    <div className={`step-card ${open ? 'open' : ''}`}>
      <div className="step-card-head">
        <button type="button" className="step-toggle" onClick={() => setOpen((current) => !current)}>
          {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
          <span className="step-index">{stepIndex + 1}</span>
          <span className="step-kind">{stepKindLabel(step)}</span>
          <span className="step-summary">{summarizeStep(step)}</span>
          {step.doAfter != null ? (
            <span className="step-duration">
              <Timer size={10} aria-hidden />
              {formatSeconds(step.doAfter)}
            </span>
          ) : null}
        </button>
        {!readOnly ? (
          <button type="button" className="step-remove" title="Remove step" onClick={() => void remove()}>
            <Trash2 size={12} aria-hidden />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="step-card-body">
          <div className="step-fields">
            {fields.length === 0 ? <div className="tagged-empty">No fields on this step.</div> : null}
            {fields.map(([key, value]) => (
              <StepFieldEditor
                key={key}
                fieldKey={key}
                value={value}
                readOnly={readOnly}
                onOpenSource={() => onOpenSource(step.span.line, from, edgeIndex)}
                onSave={(fieldValue) =>
                  onOperation({
                    kind: 'setStepField',
                    from,
                    to: edge.target,
                    edgeIndex,
                    stepIndex,
                    field: key,
                    value: fieldValue,
                  })
                }
              />
            ))}
            <AddFieldRow
              readOnly={readOnly}
              onSave={(field, value) =>
                onOperation({
                  kind: 'setStepField',
                  from,
                  to: edge.target,
                  edgeIndex,
                  stepIndex,
                  field,
                  value,
                })
              }
            />
          </div>
          <div className="step-completed">
            <div className="mini-section-head">
              <span>
                <ListChecks size={11} aria-hidden />
                Completed actions
              </span>
            </div>
            <TaggedList
              entries={step.completed}
              scope="stepCompleted"
              readOnly={readOnly}
              compact
              onAdd={() =>
                onOpenDialog({
                  kind: 'addTagged',
                  scope: 'stepCompleted',
                  from,
                  to: edge.target,
                  edgeIndex,
                  stepIndex,
                })
              }
              onRemove={(entryIndex) =>
                void onOperation({
                  kind: 'removeTaggedEntry',
                  scope: 'stepCompleted',
                  from,
                  to: edge.target,
                  edgeIndex,
                  stepIndex,
                  entryIndex,
                })
              }
            />
          </div>
          <button
            type="button"
            className="source-link"
            onClick={() => onOpenSource(step.span.line, from, edgeIndex)}
          >
            <FileCode2 size={11} aria-hidden />
            YAML line {step.span.line}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EdgeList({
  graph,
  node,
  diagnostics,
  onSelect,
  onAdd,
  readOnly,
}: {
  graph: GraphView;
  node: ConstructionNode;
  diagnostics: Map<string, Diagnostic[]>;
  onSelect: (selection: StudioSelection) => void;
  onAdd: () => void;
  readOnly: boolean;
}) {
  return (
    <div className="edge-list">
      {node.edges.length === 0 ? (
        <div className="tagged-empty">No outgoing edges from this node.</div>
      ) : null}
      {node.edges.map((edge, index) => {
        const key = `${node.name}::${index}`;
        const issues = diagnostics.get(key) ?? [];
        return (
          <button
            type="button"
            className="edge-row"
            key={key}
            onClick={() => onSelect({ kind: 'edge', from: node.name, to: edge.target, index })}
          >
            <span className="edge-arrow">
              <ArrowRight size={12} aria-hidden />
            </span>
            <span className="edge-target">
              <strong>{edge.target}</strong>
              <span>
                {edge.steps.length} steps
                {edge.conditions.length > 0 ? ` · ${edge.conditions.length} conditions` : ''}
              </span>
            </span>
            {issues.length > 0 ? (
              <span className={`edge-issues ${highestSeverity(issues) ?? ''}`}>
                {severityIcon(highestSeverity(issues) ?? 'info')}
                {issues.length}
              </span>
            ) : (
              <ChevronRight size={13} className="edge-chevron" aria-hidden />
            )}
          </button>
        );
      })}
      {!readOnly ? (
        <button type="button" className="edge-add" onClick={onAdd}>
          <Plus size={12} aria-hidden />
          Add outgoing edge
        </button>
      ) : null}
      {node.edges.length > 0 ? (
        <div className="edge-incoming-note">
          <ArrowDownLeft size={11} aria-hidden />
          {getIncoming(graph, node.name).length} incoming
        </div>
      ) : null}
    </div>
  );
}

function InspectorShell({
  children,
  onClose,
  readOnly,
}: {
  children: ReactNode;
  onClose: () => void;
  readOnly: boolean;
}) {
  return (
    <aside className="studio-inspector">
      <header className="inspector-topbar">
        <div>
          <span className="inspector-kicker">Inspector</span>
          {readOnly ? (
            <span className="readonly-chip">
              <Lock size={10} aria-hidden />
              read-only
            </span>
          ) : null}
        </div>
        <IconButton icon={X} label="Close inspector" onClick={onClose} />
      </header>
      <div className="inspector-scroll">{children}</div>
    </aside>
  );
}

function NodeInspector({
  graph,
  node,
  readOnly,
  onSelect,
  onOperation,
  onOpenSource,
  onOpenDialog,
  onConfirm,
  onNotify,
}: {
  graph: GraphView;
  node: ConstructionNode;
  readOnly: boolean;
  onSelect: (selection: StudioSelection | null) => void;
  onOperation: (operation: GraphOperation) => Promise<EditResult>;
  onOpenSource: (line?: number, node?: string, edgeIndex?: number) => void;
  onOpenDialog: (dialog: DialogState) => void;
  onConfirm: (options: ConfirmOptions) => Promise<boolean>;
  onNotify: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
}) {
  const maps = useMemo(() => diagnosticMaps(graph), [graph]);
  const diagnostics = maps.node.get(node.name) ?? [];
  const incoming = getIncoming(graph, node.name);
  const accent = nodeAccent(node.name, node.name === graph.start);
  const [flagBusy, setFlagBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const outgoingSteps = node.edges.reduce((sum, edge) => sum + edge.steps.length, 0);
  const outgoingConditions = node.edges.reduce((sum, edge) => sum + edge.conditions.length, 0);

  const deleteNode = async () => {
    const confirmed = await onConfirm({
      title: 'Delete construction node?',
      message: `Delete "${node.name}" from ${graph.id}?`,
      detail:
        incoming.length > 0
          ? `${incoming.length} incoming edge(s) will also be removed from their source nodes.`
          : 'This node has no incoming edges.',
      confirmLabel: 'Delete node',
      tone: 'danger',
    });
    if (!confirmed) return;
    setDeleteBusy(true);
    const result = await onOperation({ kind: 'deleteNode', node: node.name });
    setDeleteBusy(false);
    if (result.ok) {
      onSelect(null);
      onNotify('success', `Deleted node "${node.name}".`);
    }
  };

  return (
    <>
      <div className="inspector-selection">
        <span className="selection-glyph" style={{ background: accent.gradient }}>
          <Flag size={16} aria-hidden />
        </span>
        <div className="selection-title">
          <span className="selection-kind">
            {node.name === graph.start ? 'Start node' : 'Construction node'}
          </span>
          <h2>{node.name}</h2>
          <span className="selection-sub">{node.entity ?? 'inherits its entity from the prototype'}</span>
        </div>
      </div>

      <div className="inspector-action-row">
        <Button
          size="sm"
          icon={FileCode2}
          onClick={() => onOpenSource(node.line, node.name)}
        >
          Reveal YAML
        </Button>
        {!readOnly ? (
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            busy={deleteBusy}
            disabled={node.name === graph.start}
            title={node.name === graph.start ? 'The start node cannot be deleted' : 'Delete this node'}
            onClick={() => void deleteNode()}
          >
            Delete
          </Button>
        ) : null}
      </div>

      {readOnly ? (
        <div className="read-only-banner">
          <Lock size={14} aria-hidden />
          Editing is disabled because the workspace is not trusted.
        </div>
      ) : null}

      {diagnostics.length > 0 ? (
        <div className="diagnostic-stack">
          {diagnostics.slice(0, 4).map((diagnostic, index) => (
            <button
              type="button"
              key={`${diagnostic.code}-${index}`}
              className={`diagnostic-chip ${diagnostic.severity}`}
              onClick={() => onOpenSource(diagnostic.line, node.name)}
              title="Open this diagnostic in YAML"
            >
              {severityIcon(diagnostic.severity)}
              <span>{diagnostic.message}</span>
            </button>
          ))}
          {diagnostics.length > 4 ? (
            <span className="diagnostic-more">+{diagnostics.length - 4} more diagnostics</span>
          ) : null}
        </div>
      ) : null}

      <Section eyebrow="Identity" title="Prototype fields">
        <InlineField
          label="Node name"
          value={node.name}
          disabled={readOnly}
          mono
          validate={(value) => {
            if (!value) return 'A node name cannot be empty.';
            if (value !== node.name && graph.nodes.some((candidate) => candidate.name === value)) {
              return `A node named "${value}" already exists.`;
            }
            return null;
          }}
          onSubmit={async (value) => {
            const result = await onOperation({ kind: 'renameNode', node: node.name, newName: value });
            if (result.ok) {
              onSelect({ kind: 'node', node: value });
              onNotify('success', `Renamed node to "${value}".`);
            }
            return result;
          }}
          hint="Renames every edge target that references this node."
        />
        <InlineField
          label="Entity prototype"
          value={node.entity ?? ''}
          placeholder="Inherited"
          disabled={readOnly}
          mono
          onSubmit={async (value) => {
            const result = await onOperation({
              kind: 'setNodeEntity',
              node: node.name,
              entity: value || null,
            });
            if (result.ok) {
              onNotify('success', value ? `Set entity to "${value}".` : 'Cleared the node entity.');
            }
            return result;
          }}
          hint="Leave empty to inherit the entity from the graph prototype."
        />
        <label className={`studio-checkbox ${readOnly ? 'disabled' : ''}`}>
          <input
            type="checkbox"
            checked={node.doNotReplaceInheritingEntities}
            disabled={readOnly || flagBusy}
            onChange={(event) => {
              setFlagBusy(true);
              void onOperation({
                kind: 'setNodeFlag',
                node: node.name,
                field: 'doNotReplaceInheritingEntities',
                value: event.target.checked,
              }).then((result) => {
                setFlagBusy(false);
                if (result.ok) {
                  onNotify(
                    'success',
                    event.target.checked
                      ? 'Enabled doNotReplaceInheritingEntities.'
                      : 'Disabled doNotReplaceInheritingEntities.',
                  );
                }
              });
            }}
          />
          <span>
            <strong>Keep inheriting entity</strong>
            <em>doNotReplaceInheritingEntities</em>
          </span>
        </label>
      </Section>

      <Section eyebrow="Flow" title="Connections" count={node.edges.length + incoming.length}>
        <div className="inspector-stats">
          <div>
            <ArrowUpRight size={12} aria-hidden />
            <strong>{node.edges.length}</strong>
            <span>out</span>
          </div>
          <div>
            <ArrowDownLeft size={12} aria-hidden />
            <strong>{incoming.length}</strong>
            <span>in</span>
          </div>
          <div>
            <ListChecks size={12} aria-hidden />
            <strong>{outgoingSteps}</strong>
            <span>steps</span>
          </div>
          <div>
            <Wrench size={12} aria-hidden />
            <strong>{outgoingConditions}</strong>
            <span>cond.</span>
          </div>
        </div>
        <EdgeList
          graph={graph}
          node={node}
          diagnostics={maps.edge}
          onSelect={onSelect}
          onAdd={() => onOpenDialog({ kind: 'addEdge', from: node.name })}
          readOnly={readOnly}
        />
        {incoming.length > 0 ? (
          <div className="incoming-list">
            <div className="mini-section-head">
              <span>
                <ArrowDownLeft size={11} aria-hidden />
                Incoming edges
              </span>
            </div>
            {incoming.map(({ from, index }) => (
              <button
                type="button"
                key={`${from.name}-${index}`}
                className="incoming-row"
                onClick={() =>
                  onSelect({ kind: 'edge', from: from.name, to: node.name, index })
                }
              >
                <span>{from.name}</span>
                <ArrowRight size={11} aria-hidden />
                <strong>{node.name}</strong>
              </button>
            ))}
          </div>
        ) : null}
      </Section>

      <Section
        eyebrow="Lifecycle"
        title="Node actions"
        count={node.actions.length}
        action={
          !readOnly ? (
            <button
              type="button"
              className="section-add"
              onClick={() => onOpenDialog({ kind: 'addTagged', scope: 'nodeActions', node: node.name })}
            >
              <Plus size={11} aria-hidden />
              Add
            </button>
          ) : null
        }
      >
        <TaggedList
          entries={node.actions}
          scope="nodeActions"
          readOnly={readOnly}
          onAdd={() => onOpenDialog({ kind: 'addTagged', scope: 'nodeActions', node: node.name })}
          onRemove={(entryIndex) =>
            void onOperation({
              kind: 'removeTaggedEntry',
              scope: 'nodeActions',
              node: node.name,
              entryIndex,
            })
          }
        />
      </Section>

      <Section
        eyebrow="Lifecycle"
        title="Transforms"
        count={node.transforms.length}
        action={
          !readOnly ? (
            <button
              type="button"
              className="section-add"
              onClick={() => onOpenDialog({ kind: 'addTagged', scope: 'nodeTransforms', node: node.name })}
            >
              <Plus size={11} aria-hidden />
              Add
            </button>
          ) : null
        }
      >
        <TaggedList
          entries={node.transforms}
          scope="nodeTransforms"
          readOnly={readOnly}
          onAdd={() => onOpenDialog({ kind: 'addTagged', scope: 'nodeTransforms', node: node.name })}
          onRemove={(entryIndex) =>
            void onOperation({
              kind: 'removeTaggedEntry',
              scope: 'nodeTransforms',
              node: node.name,
              entryIndex,
            })
          }
        />
      </Section>
    </>
  );
}

function EdgeInspector({
  graph,
  from,
  edgeIndex,
  readOnly,
  onSelect,
  onOperation,
  onOpenSource,
  onOpenDialog,
  onConfirm,
  onNotify,
}: {
  graph: GraphView;
  from: string;
  edgeIndex: number;
  readOnly: boolean;
  onSelect: (selection: StudioSelection | null) => void;
  onOperation: (operation: GraphOperation) => Promise<EditResult>;
  onOpenSource: (line?: number, node?: string, edgeIndex?: number) => void;
  onOpenDialog: (dialog: DialogState) => void;
  onConfirm: (options: ConfirmOptions) => Promise<boolean>;
  onNotify: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
}) {
  const source = graph.nodes.find((node) => node.name === from);
  const edge = source?.edges[edgeIndex];
  const target = edge ? graph.nodes.find((node) => node.name === edge.target) : undefined;
  const maps = useMemo(() => diagnosticMaps(graph), [graph]);
  const [deleteBusy, setDeleteBusy] = useState(false);

  if (!source || !edge) {
    return (
      <div className="inspector-missing">
        <CircleAlert size={22} aria-hidden />
        <strong>This edge no longer exists</strong>
        <span>The graph changed while the inspector was open.</span>
        <Button onClick={() => onSelect(null)}>Show graph overview</Button>
      </div>
    );
  }

  const key = `${source.name}::${edgeIndex}`;
  const diagnostics = maps.edge.get(key) ?? [];
  const complete = (edge: ConstructionEdge) =>
    edge.steps.reduce((sum, step) => sum + step.completed.length, 0) + edge.completed.length;
  const doAfter = edge.steps.reduce((sum, step) => sum + (step.doAfter ?? 0), 0);

  const removeEdge = async () => {
    const confirmed = await onConfirm({
      title: 'Delete construction edge?',
      message: `Delete ${source.name} → ${edge.target}?`,
      detail:
        edge.steps.length > 0
          ? `${edge.steps.length} construction step(s) and ${edge.conditions.length} condition(s) will be removed.`
          : 'This edge has no construction steps.',
      confirmLabel: 'Delete edge',
      tone: 'danger',
    });
    if (!confirmed) return;
    setDeleteBusy(true);
    const result = await onOperation({
      kind: 'deleteEdge',
      from: source.name,
      to: edge.target,
      edgeIndex,
    });
    setDeleteBusy(false);
    if (result.ok) {
      onSelect({ kind: 'node', node: source.name });
      onNotify('success', `Deleted edge "${source.name}" → "${edge.target}".`);
    }
  };

  return (
    <>
      <div className="inspector-selection edge">
        <span className="selection-glyph edge-glyph">
          <GitBranch size={16} aria-hidden />
        </span>
        <div className="selection-title">
          <span className="selection-kind">Construction edge {edgeIndex + 1}</span>
          <h2>
            {source.name}
            <ArrowRight size={15} aria-hidden />
            {edge.target}
          </h2>
          <span className="selection-sub">
            {target?.entity ?? 'Target node is missing from this graph'}
          </span>
        </div>
      </div>

      <div className="inspector-action-row">
        <Button size="sm" icon={FileCode2} onClick={() => onOpenSource(edge.line, source.name, edgeIndex)}>
          Reveal YAML
        </Button>
        {!readOnly ? (
          <Button size="sm" variant="danger" icon={Trash2} busy={deleteBusy} onClick={() => void removeEdge()}>
            Delete
          </Button>
        ) : null}
      </div>

      {diagnostics.length > 0 ? (
        <div className="diagnostic-stack">
          {diagnostics.map((diagnostic, index) => (
            <button
              type="button"
              key={`${diagnostic.code}-${index}`}
              className={`diagnostic-chip ${diagnostic.severity}`}
              onClick={() => onOpenSource(diagnostic.line, source.name, edgeIndex)}
            >
              {severityIcon(diagnostic.severity)}
              <span>{diagnostic.message}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="inspector-stats edge-stats">
        <div>
          <ListChecks size={12} aria-hidden />
          <strong>{edge.steps.length}</strong>
          <span>steps</span>
        </div>
        <div>
          <Timer size={12} aria-hidden />
          <strong>{formatSeconds(doAfter)}</strong>
          <span>do after</span>
        </div>
        <div>
          <Route size={12} aria-hidden />
          <strong>{edge.conditions.length}</strong>
          <span>cond.</span>
        </div>
        <div>
          <ListChecks size={12} aria-hidden />
          <strong>{complete(edge)}</strong>
          <span>actions</span>
        </div>
      </div>

      <Section
        eyebrow="Route"
        title="Target"
        action={
          target ? (
            <button
              type="button"
              className="section-add"
              onClick={() => onSelect({ kind: 'node', node: target.name })}
            >
              <ArrowUpRight size={11} aria-hidden />
              Inspect
            </button>
          ) : null
        }
      >
        {target ? (
          <button
            type="button"
            className="target-card"
            onClick={() => onSelect({ kind: 'node', node: target.name })}
          >
            <span className="target-arrow">
              <ArrowRight size={13} aria-hidden />
            </span>
            <span>
              <strong>{target.name}</strong>
              <em>{target.entity ?? 'inherited entity'}</em>
            </span>
            <span className="target-meta">
              {target.edges.length} out · {getIncoming(graph, target.name).length} in
            </span>
          </button>
        ) : (
          <div className="inspector-warning">
            <CircleAlert size={13} aria-hidden />
            The target node does not exist in this graph.
          </div>
        )}
      </Section>

      <Section
        eyebrow="Route"
        title="Construction steps"
        count={edge.steps.length}
        action={
          !readOnly ? (
            <button
              type="button"
              className="section-add"
              onClick={() =>
                onOpenDialog({
                  kind: 'addStep',
                  from: source.name,
                  to: edge.target,
                  edgeIndex,
                })
              }
            >
              <Plus size={11} aria-hidden />
              Step
            </button>
          ) : null
        }
      >
        <div className="step-list">
          {edge.steps.length === 0 ? (
            <div className="tagged-empty">No steps yet. This edge would be traversable instantly.</div>
          ) : null}
          {edge.steps.map((step, stepIndex) => (
            <StepCard
              key={`${key}-${stepIndex}-${step.span.start}`}
              step={step}
              stepIndex={stepIndex}
              edgeIndex={edgeIndex}
              edge={edge}
              from={source.name}
              readOnly={readOnly}
              onOperation={onOperation}
              onOpenDialog={onOpenDialog}
              onOpenSource={onOpenSource}
              onConfirm={onConfirm}
              onNotify={onNotify}
              defaultOpen={stepIndex < 2}
            />
          ))}
          {!readOnly ? (
            <button
              type="button"
              className="step-add"
              onClick={() =>
                onOpenDialog({
                  kind: 'addStep',
                  from: source.name,
                  to: edge.target,
                  edgeIndex,
                })
              }
            >
              <Plus size={12} aria-hidden />
              Add construction step
            </button>
          ) : null}
        </div>
      </Section>

      <Section
        eyebrow="Requirements"
        title="Conditions"
        count={edge.conditions.length}
        action={
          !readOnly ? (
            <button
              type="button"
              className="section-add"
              onClick={() =>
                onOpenDialog({
                  kind: 'addTagged',
                  scope: 'edgeConditions',
                  from: source.name,
                  to: edge.target,
                  edgeIndex,
                })
              }
            >
              <Plus size={11} aria-hidden />
              Add
            </button>
          ) : null
        }
      >
        <TaggedList
          entries={edge.conditions}
          scope="edgeConditions"
          readOnly={readOnly}
          onAdd={() =>
            onOpenDialog({
              kind: 'addTagged',
              scope: 'edgeConditions',
              from: source.name,
              to: edge.target,
              edgeIndex,
            })
          }
          onRemove={(entryIndex) =>
            void onOperation({
              kind: 'removeTaggedEntry',
              scope: 'edgeConditions',
              from: source.name,
              to: edge.target,
              edgeIndex,
              entryIndex,
            })
          }
        />
      </Section>

      <Section
        eyebrow="Lifecycle"
        title="Completion actions"
        count={edge.completed.length}
        action={
          !readOnly ? (
            <button
              type="button"
              className="section-add"
              onClick={() =>
                onOpenDialog({
                  kind: 'addTagged',
                  scope: 'edgeCompleted',
                  from: source.name,
                  to: edge.target,
                  edgeIndex,
                })
              }
            >
              <Plus size={11} aria-hidden />
              Add
            </button>
          ) : null
        }
      >
        <TaggedList
          entries={edge.completed}
          scope="edgeCompleted"
          readOnly={readOnly}
          onAdd={() =>
            onOpenDialog({
              kind: 'addTagged',
              scope: 'edgeCompleted',
              from: source.name,
              to: edge.target,
              edgeIndex,
            })
          }
          onRemove={(entryIndex) =>
            void onOperation({
              kind: 'removeTaggedEntry',
              scope: 'edgeCompleted',
              from: source.name,
              to: edge.target,
              edgeIndex,
              entryIndex,
            })
          }
        />
      </Section>
    </>
  );
}

function GraphOverview({
  graph,
  readOnly,
  index,
  onOpenSource,
  onOpenDialog,
  onAutoLayout,
  onCopy,
  onSelect,
}: {
  graph: GraphView;
  readOnly: boolean;
  index: IndexPayload | null;
  onOpenSource: (line?: number, node?: string, edgeIndex?: number) => void;
  onOpenDialog: (dialog: DialogState) => void;
  onAutoLayout: () => void;
  onCopy: (text: string) => void;
  onSelect: (selection: StudioSelection | null) => void;
}) {
  const totalMaterials = useMemo(
    () =>
      graph.nodes.reduce((sum, node) => sum + outgoingMaterials(node).reduce((value, material) => value + material.amount, 0), 0),
    [graph],
  );
  const materialSummary = useMemo(() => {
    const map = new Map<string, { material: string; amount: number; edges: number }>();
    for (const node of graph.nodes) {
      for (const material of outgoingMaterials(node)) {
        const current = map.get(material.material);
        if (current) {
          current.amount += material.amount;
          current.edges += material.edges;
        } else {
          map.set(material.material, { ...material });
        }
      }
    }
    return [...map.values()].sort((left, right) => right.amount - left.amount);
  }, [graph]);
  const diagnostics = graph.diagnostics;
  const errors = diagnosticCount(diagnostics, 'error');
  const warnings = diagnosticCount(diagnostics, 'warning');

  return (
    <>
      <div className="inspector-selection graph">
        <span className="selection-glyph graph-glyph">
          <Layers size={16} aria-hidden />
        </span>
        <div className="selection-title">
          <span className="selection-kind">Graph overview</span>
          <h2>{graph.id}</h2>
          <span className="selection-sub">{graph.relativePath}</span>
        </div>
      </div>

      <div className="inspector-action-row">
        <Button size="sm" icon={FileCode2} onClick={() => onOpenSource()}>
          Open YAML
        </Button>
        <Button size="sm" icon={Wand2} onClick={onAutoLayout}>
          Re-layout
        </Button>
        <Button size="sm" variant="quiet" icon={Copy} onClick={() => onCopy(graph.id)} title="Copy graph id">
          Copy id
        </Button>
      </div>

      {readOnly ? (
        <div className="read-only-banner">
          <Lock size={14} aria-hidden />
          Editing is disabled because the workspace is not trusted.
        </div>
      ) : null}

      <div className="overview-hero">
        <div>
          <span>Nodes</span>
          <strong>{formatNumber(graph.stats.nodes)}</strong>
        </div>
        <div>
          <span>Edges</span>
          <strong>{formatNumber(graph.stats.edges)}</strong>
        </div>
        <div>
          <span>Steps</span>
          <strong>{formatNumber(graph.stats.steps)}</strong>
        </div>
        <div>
          <span>Max depth</span>
          <strong>{graph.stats.maxDepth}</strong>
        </div>
        <div>
          <span>Do after</span>
          <strong>{formatSeconds(graph.stats.totalDoAfter)}</strong>
        </div>
        <div>
          <span>Actions</span>
          <strong>{formatNumber(graph.stats.actions)}</strong>
        </div>
      </div>

      <Section eyebrow="Blueprint" title="At a glance">
        <div className="overview-facts">
          <div>
            <Flag size={12} aria-hidden />
            <span>Start node</span>
            <button
              type="button"
              onClick={() => graph.start && onSelect({ kind: 'node', node: graph.start })}
              disabled={!graph.start}
            >
              {graph.start || 'missing'}
            </button>
          </div>
          <div>
            <Route size={12} aria-hidden />
            <span>Conditions</span>
            <strong>{graph.stats.conditions}</strong>
          </div>
          <div>
            <Wrench size={12} aria-hidden />
            <span>Material used</span>
            <strong>{formatNumber(totalMaterials)}</strong>
          </div>
          <div>
            <CircleAlert size={12} aria-hidden />
            <span>Diagnostics</span>
            <strong className={errors > 0 ? 'error-text' : warnings > 0 ? 'warning-text' : 'ok-text'}>
              {errors}E / {warnings}W
            </strong>
          </div>
        </div>
        {!graph.start || !graph.nodes.some((node) => node.name === graph.start) ? (
          <div className="inspector-warning">
            <CircleAlert size={13} aria-hidden />
            Start node "{graph.start || '?'}" does not exist.
          </div>
        ) : null}
      </Section>

      <Section eyebrow="Resources" title="Materials" count={materialSummary.length}>
        {materialSummary.length === 0 ? (
          <div className="tagged-empty">No material steps are defined in this graph.</div>
        ) : (
          <div className="material-list">
            {materialSummary.slice(0, 14).map((material) => (
              <div className="material-row" key={material.material}>
                <span className="material-name">{material.material}</span>
                <span className="material-bar">
                  <i
                    style={{
                      width: `${Math.max(4, (material.amount / (materialSummary[0]?.amount || 1)) * 100)}%`,
                    }}
                  />
                </span>
                <span className="material-amount">{material.amount}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section eyebrow="Prototype health" title="Diagnostics" count={diagnostics.length}>
        {diagnostics.length === 0 ? (
          <div className="health-clear compact">
            <CircleAlert size={18} aria-hidden />
            <strong>No diagnostics.</strong>
            <span>This graph is fully connected and parses cleanly.</span>
          </div>
        ) : (
          <div className="overview-diagnostics">
            {diagnostics.slice(0, 8).map((diagnostic, index) => (
              <button
                type="button"
                key={`${diagnostic.code}-${index}`}
                className={`overview-diagnostic ${diagnostic.severity}`}
                onClick={() => onOpenSource(diagnostic.line, diagnostic.node, diagnostic.edge?.index)}
              >
                {severityIcon(diagnostic.severity)}
                <span>{diagnostic.message}</span>
                <em>Ln {diagnostic.line}</em>
              </button>
            ))}
            {diagnostics.length > 8 ? (
              <span className="diagnostic-more">+{diagnostics.length - 8} more in the validation tray</span>
            ) : null}
          </div>
        )}
      </Section>

      {index ? (
        <div className="inspector-footnote">
          <SparkleIcon />
          {index.project.totalGraphs.toLocaleString()} graphs in this workspace ·{" "}
          {index.knownTags.length.toLocaleString()} known action tags
        </div>
      ) : null}
    </>
  );
}

function SparkleIcon() {
  return <span className="sparkle-dot" aria-hidden />;
}

export function Inspector({
  graph,
  selection,
  index,
  readOnly,
  onClose,
  onSelect,
  onOperation,
  onOpenSource,
  onOpenDialog,
  onConfirm,
  onAutoLayout,
  onNotify,
  onCopy,
}: InspectorProps) {
  return (
    <InspectorShell onClose={onClose} readOnly={readOnly}>
      {!selection ? (
        <GraphOverview
          graph={graph}
          readOnly={readOnly}
          index={index}
          onOpenSource={onOpenSource}
          onOpenDialog={onOpenDialog}
          onAutoLayout={onAutoLayout}
          onCopy={onCopy}
          onSelect={onSelect}
        />
      ) : selection.kind === 'node' ? (
        (() => {
          const node = graph.nodes.find((candidate) => candidate.name === selection.node);
          return node ? (
            <NodeInspector
              graph={graph}
              node={node}
              readOnly={readOnly}
              onSelect={onSelect}
              onOperation={onOperation}
              onOpenSource={onOpenSource}
              onOpenDialog={onOpenDialog}
              onConfirm={onConfirm}
              onNotify={onNotify}
            />
          ) : (
            <MissingSelection onReset={() => onSelect(null)} />
          );
        })()
      ) : (
        <EdgeInspector
          graph={graph}
          from={selection.from}
          edgeIndex={selection.index}
          readOnly={readOnly}
          onSelect={onSelect}
          onOperation={onOperation}
          onOpenSource={onOpenSource}
          onOpenDialog={onOpenDialog}
          onConfirm={onConfirm}
          onNotify={onNotify}
        />
      )}
    </InspectorShell>
  );
}

function MissingSelection({ onReset }: { onReset: () => void }) {
  return (
    <div className="inspector-missing">
      <CircleAlert size={22} aria-hidden />
      <strong>Selection lost</strong>
      <span>The selected node or edge is no longer part of this graph.</span>
      <Button onClick={onReset}>Show graph overview</Button>
    </div>
  );
}
