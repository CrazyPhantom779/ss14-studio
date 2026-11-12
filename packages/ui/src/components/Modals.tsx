import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  CreateGraphOptions,
  EditResult,
  GraphOperation,
  GraphView,
  IndexPayload,
  StepInput,
} from '@ss14-studio/core';
import {
  AlertTriangle,
  Braces,
  Boxes,
  Check,
  Cpu,
  FilePlus2,
  GitBranch,
  Layers,
  Plus,
  Puzzle,
  Tag,
  Tags,
  Thermometer,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { mermaidFor } from '../lib/graph';
import type { ConfirmState, DialogState } from '../lib/dialogs';
import {
  STEP_KINDS,
  buildStepInput,
  defaultsForKind,
  validateStepDraft,
  type CustomFieldDraft,
} from '../lib/stepFields';
import { Button, Field, Modal } from './ui';

const STEP_ICONS: Record<string, LucideIcon> = {
  material: Boxes,
  tool: Wrench,
  tag: Tag,
  component: Cpu,
  multipleTags: Tags,
  temperature: Thermometer,
  partAssembly: Puzzle,
  unknown: Braces,
};

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="form-error">
      <AlertTriangle size={14} aria-hidden />
      {error}
    </div>
  );
}

function parseTagValue(value: string): string | number | boolean {
  const raw = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

function Footer({
  onClose,
  busy,
  submitLabel,
  submitIcon,
  onSubmit,
  disabled = false,
}: {
  onClose: () => void;
  busy: boolean;
  submitLabel: string;
  submitIcon?: LucideIcon;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button
        variant="primary"
        icon={submitIcon}
        busy={busy}
        disabled={disabled}
        onClick={onSubmit}
      >
        {submitLabel}
      </Button>
    </>
  );
}

function StepBuilder({
  kind,
  draft,
  customFields,
  onKindChange,
  onDraftChange,
  onCustomFieldsChange,
  compact = false,
}: {
  kind: StepInput['kind'];
  draft: Record<string, string>;
  customFields: CustomFieldDraft[];
  onKindChange: (kind: StepInput['kind']) => void;
  onDraftChange: (key: string, value: string) => void;
  onCustomFieldsChange: (fields: CustomFieldDraft[]) => void;
  compact?: boolean;
}) {
  const definition = STEP_KINDS.find((candidate) => candidate.kind === kind);

  return (
    <div className={`step-builder ${compact ? 'compact' : ''}`.trim()}>
      <div className="step-kind-picker" role="radiogroup" aria-label="Construction step type">
        {STEP_KINDS.map((candidate) => {
          const Icon = STEP_ICONS[candidate.kind] ?? Braces;
          return (
            <button
              type="button"
              key={candidate.kind}
              role="radio"
              aria-checked={candidate.kind === kind}
              className={candidate.kind === kind ? 'active' : ''}
              onClick={() => onKindChange(candidate.kind)}
              title={candidate.description}
            >
              <Icon size={13} aria-hidden />
              {candidate.label}
            </button>
          );
        })}
      </div>

      {definition && definition.fields.length > 0 ? (
        <div className="form-grid two">
          {definition.fields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              required={field.required}
              hint={field.type === 'csv' ? 'Comma separated' : undefined}
            >
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                step={field.type === 'number' ? 'any' : undefined}
                value={draft[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => onDraftChange(field.key, event.target.value)}
                spellCheck={false}
              />
            </Field>
          ))}
        </div>
      ) : kind === 'unknown' ? (
        <div className="custom-step-fields">
          {customFields.map((field, index) => (
            <div className="custom-field-row" key={index}>
              <input
                value={field.key}
                placeholder="field"
                aria-label={`Custom field ${index + 1} name`}
                onChange={(event) => {
                  const next = [...customFields];
                  next[index] = { ...field, key: event.target.value };
                  onCustomFieldsChange(next);
                }}
                spellCheck={false}
              />
              <input
                value={field.value}
                placeholder="value"
                aria-label={`Custom field ${index + 1} value`}
                onChange={(event) => {
                  const next = [...customFields];
                  next[index] = { ...field, value: event.target.value };
                  onCustomFieldsChange(next);
                }}
                spellCheck={false}
              />
              <button
                type="button"
                className="inline-cancel"
                title="Remove field"
                onClick={() => onCustomFieldsChange(customFields.filter((_, item) => item !== index))}
              >
                <Trash2 size={12} aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="tagged-add"
            onClick={() => onCustomFieldsChange([...customFields, { key: '', value: '' }])}
          >
            <Plus size={11} aria-hidden />
            Add field
          </button>
        </div>
      ) : null}

      {definition ? <p className="step-builder-hint">{definition.description}</p> : null}
    </div>
  );
}

function useStepDraft(initialKind: StepInput['kind'] = 'material') {
  const [kind, setKind] = useState<StepInput['kind']>(initialKind);
  const [draft, setDraft] = useState<Record<string, string>>(() => defaultsForKind(initialKind));
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>([{ key: '', value: '' }]);

  const changeKind = (next: StepInput['kind']) => {
    setKind(next);
    setDraft(defaultsForKind(next));
  };

  return {
    kind,
    draft,
    customFields,
    changeKind,
    setDraft,
    setCustomFields,
    step: () => buildStepInput(kind, draft, customFields),
    error: () => validateStepDraft(kind, draft, customFields),
  };
}

function CreateGraphForm({
  busy,
  error,
  onCreate,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onCreate: (options: CreateGraphOptions) => void;
  onClose: () => void;
}) {
  const [id, setId] = useState('MyConstructionGraph');
  const [start, setStart] = useState('start');
  const [entity, setEntity] = useState('');
  const [path, setPath] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!/^[A-Za-z0-9_.-]+$/.test(id.trim())) {
      setLocalError('Use letters, numbers, underscores, dots or dashes for the graph id.');
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(start.trim())) {
      setLocalError('Use a valid node name for the start node.');
      return;
    }
    setLocalError(null);
    onCreate({
      id: id.trim(),
      start: start.trim(),
      entity: entity.trim() || undefined,
      path: path.trim(),
    });
  };

  return (
    <Modal
      title="Create construction graph"
      subtitle="Scaffold a YAML prototype and open it in the editor."
      icon={FilePlus2}
      onClose={onClose}
      busy={busy}
      footer={
        <Footer
          onClose={onClose}
          busy={busy}
          submitLabel="Create graph"
          submitIcon={Plus}
          onSubmit={() => submit()}
        />
      }
    >
      <form
        className="modal-form"
        onSubmit={(event) => submit(event)}
      >
        <div className="form-grid two">
          <Field label="Graph id" required hint="e.g. StarlightComputer">
            <input
              value={id}
              onChange={(event) => setId(event.target.value)}
              autoFocus
              spellCheck={false}
            />
          </Field>
          <Field label="Start node" required hint="The node shown first in the graph">
            <input value={start} onChange={(event) => setStart(event.target.value)} spellCheck={false} />
          </Field>
        </div>
        <Field label="Start entity" hint="Optional entity prototype attached to the start node">
          <input
            value={entity}
            onChange={(event) => setEntity(event.target.value)}
            placeholder="e.g. ComputerFrame"
            spellCheck={false}
          />
        </Field>
        <Field
          label="File path"
          hint="Relative to the SS14 workspace. Leave blank to use Resources/Prototypes/Recipes/Construction/Graphs/<id>.yml"
        >
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="Resources/Prototypes/Recipes/Construction/Graphs/MyConstructionGraph.yml"
            spellCheck={false}
          />
        </Field>
        <FormError error={localError ?? error} />
      </form>
    </Modal>
  );
}

function AddNodeForm({
  graph,
  busy,
  error,
  onApply,
  onClose,
}: {
  graph: GraphView | null;
  busy: boolean;
  error: string | null;
  onApply: (operation: GraphOperation) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [entity, setEntity] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setLocalError('A node name is required.');
      return;
    }
    if (graph?.nodes.some((node) => node.name === clean)) {
      setLocalError(`A node named "${clean}" already exists.`);
      return;
    }
    setLocalError(null);
    onApply({ kind: 'addNode', name: clean, entity: entity.trim() || null });
  };

  return (
    <Modal
      title="Add construction node"
      subtitle="New nodes are appended to the graph prototype."
      icon={Plus}
      onClose={onClose}
      busy={busy}
      footer={
        <Footer
          onClose={onClose}
          busy={busy}
          submitLabel="Add node"
          submitIcon={Plus}
          onSubmit={() => submit()}
        />
      }
    >
      <form className="modal-form" onSubmit={(event) => submit(event)}>
        <Field label="Node name" required hint="Unique inside this construction graph">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. frame"
            autoFocus
            spellCheck={false}
          />
        </Field>
        <Field label="Entity prototype" hint="Optional. Leave empty to inherit from the graph prototype.">
          <input
            value={entity}
            onChange={(event) => setEntity(event.target.value)}
            placeholder="e.g. ComputerFrame"
            spellCheck={false}
          />
        </Field>
        <FormError error={localError ?? error} />
      </form>
    </Modal>
  );
}

function AddEdgeForm({
  graph,
  from: initialFrom,
  busy,
  error,
  onApply,
  onClose,
}: {
  graph: GraphView | null;
  from?: string;
  busy: boolean;
  error: string | null;
  onApply: (operation: GraphOperation) => void;
  onClose: () => void;
}) {
  const nodes = useMemo(
    () => [...(graph?.nodes ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [graph],
  );
  const [from, setFrom] = useState(initialFrom ?? graph?.start ?? nodes[0]?.name ?? '');
  const [to, setTo] = useState('');
  const [withStep, setWithStep] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const stepDraft = useStepDraft('material');

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!from) {
      setLocalError('Choose a source node.');
      return;
    }
    if (!to) {
      setLocalError('Choose a target node.');
      return;
    }
    const stepError = withStep ? stepDraft.error() : null;
    if (stepError) {
      setLocalError(stepError);
      return;
    }
    setLocalError(null);
    onApply({
      kind: 'addEdge',
      from,
      to,
      steps: withStep ? [stepDraft.step()] : [],
    });
  };

  return (
    <Modal
      title="Add construction edge"
      subtitle="Connect two nodes and optionally begin the step chain."
      icon={GitBranch}
      onClose={onClose}
      busy={busy}
      width={640}
      footer={
        <Footer
          onClose={onClose}
          busy={busy}
          submitLabel="Add edge"
          submitIcon={GitBranch}
          onSubmit={() => submit()}
        />
      }
    >
      <form className="modal-form" onSubmit={(event) => submit(event)}>
        <div className="form-grid two">
          <Field label="From" required>
            <select value={from} onChange={(event) => setFrom(event.target.value)}>
              <option value="" disabled>
                Choose a node…
              </option>
              {nodes.map((node) => (
                <option key={node.name} value={node.name}>
                  {node.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="To" required>
            <select value={to} onChange={(event) => setTo(event.target.value)}>
              <option value="" disabled>
                Choose a node…
              </option>
              {nodes.map((node) => (
                <option key={node.name} value={node.name}>
                  {node.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button
          type="button"
          className={`modal-toggle-row ${withStep ? 'active' : ''}`}
          onClick={() => setWithStep((current) => !current)}
        >
          <span className="modal-toggle-box">{withStep ? <Check size={12} aria-hidden /> : null}</span>
          <span>
            <strong>Add a first construction step</strong>
            <em>Skip this and add steps from the inspector later.</em>
          </span>
        </button>
        {withStep ? (
          <StepBuilder
            kind={stepDraft.kind}
            draft={stepDraft.draft}
            customFields={stepDraft.customFields}
            onKindChange={stepDraft.changeKind}
            onDraftChange={(key, value) =>
              stepDraft.setDraft((current) => ({ ...current, [key]: value }))
            }
            onCustomFieldsChange={stepDraft.setCustomFields}
          />
        ) : null}
        <FormError error={localError ?? error} />
      </form>
    </Modal>
  );
}

function AddStepForm({
  from,
  to,
  edgeIndex,
  busy,
  error,
  onApply,
  onClose,
}: {
  from: string;
  to: string;
  edgeIndex: number;
  busy: boolean;
  error: string | null;
  onApply: (operation: GraphOperation) => void;
  onClose: () => void;
}) {
  const stepDraft = useStepDraft('material');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    const stepError = stepDraft.error();
    if (stepError) {
      setLocalError(stepError);
      return;
    }
    setLocalError(null);
    onApply({
      kind: 'addStep',
      from,
      to,
      edgeIndex,
      step: stepDraft.step(),
    });
  };

  return (
    <Modal
      title="Add construction step"
      subtitle={`Append a step to ${from} → ${to}.`}
      icon={Layers}
      onClose={onClose}
      busy={busy}
      width={680}
      footer={
        <Footer
          onClose={onClose}
          busy={busy}
          submitLabel="Add step"
          submitIcon={Plus}
          onSubmit={submit}
        />
      }
    >
      <div className="modal-form">
        <StepBuilder
          kind={stepDraft.kind}
          draft={stepDraft.draft}
          customFields={stepDraft.customFields}
          onKindChange={stepDraft.changeKind}
          onDraftChange={(key, value) =>
            stepDraft.setDraft((current) => ({ ...current, [key]: value }))
          }
          onCustomFieldsChange={stepDraft.setCustomFields}
        />
        <FormError error={localError ?? error} />
      </div>
    </Modal>
  );
}

function AddTaggedForm({
  dialog,
  index,
  busy,
  error,
  onApply,
  onClose,
}: {
  dialog: Extract<DialogState, { kind: 'addTagged' }>;
  index: IndexPayload | null;
  busy: boolean;
  error: string | null;
  onApply: (operation: GraphOperation) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState('');
  const [rows, setRows] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);
  const [localError, setLocalError] = useState<string | null>(null);

  const title =
    dialog.scope === 'edgeConditions'
      ? 'Add edge condition'
      : dialog.scope === 'nodeTransforms'
        ? 'Add node transform'
        : dialog.scope === 'stepCompleted'
          ? 'Add step completion action'
          : dialog.scope === 'edgeCompleted'
            ? 'Add edge completion action'
            : 'Add node action';

  const suggestions = useMemo(() => {
    const tags = index?.knownTags ?? [];
    const preferred = dialog.scope === 'edgeConditions'
      ? [...tags].sort((left, right) => right.conditions - left.conditions)
      : [...tags].sort((left, right) => right.actions - left.actions);
    return preferred.slice(0, 8);
  }, [dialog.scope, index]);

  const submit = () => {
    const clean = type.trim().replace(/^!type:/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(clean)) {
      setLocalError('Use a valid C# type name, for example Screwdriver or Welding.');
      return;
    }
    const fields: Record<string, string | number | boolean> = {};
    for (const row of rows) {
      const key = row.key.trim();
      const value = row.value.trim();
      if (!key && !value) continue;
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
        setLocalError(`"${key || 'empty'}" is not a valid field name.`);
        return;
      }
      if (!value) {
        setLocalError(`Give "${key}" a value or remove the row.`);
        return;
      }
      fields[key] = parseTagValue(value);
    }
    setLocalError(null);
    onApply({
      kind: 'addTaggedEntry',
      scope: dialog.scope,
      node: dialog.node,
      from: dialog.from,
      to: dialog.to,
      edgeIndex: dialog.edgeIndex,
      stepIndex: dialog.stepIndex,
      entryType: clean,
      fields,
    });
  };

  return (
    <Modal
      title={title}
      subtitle="Actions and conditions use the !type: tag used by Robust Toolbox."
      icon={Tag}
      onClose={onClose}
      busy={busy}
      width={600}
      footer={
        <Footer
          onClose={onClose}
          busy={busy}
          submitLabel="Add entry"
          submitIcon={Tag}
          onSubmit={submit}
        />
      }
    >
      <div className="modal-form">
        <Field label="Entry type" required hint="Without the !type: prefix">
          <input
            value={type}
            onChange={(event) => setType(event.target.value)}
            placeholder="e.g. Screwdriver"
            list="ss14-known-tags"
            autoFocus
            spellCheck={false}
          />
          <datalist id="ss14-known-tags">
            {suggestions.map((tag) => (
              <option key={tag.type} value={tag.type} />
            ))}
          </datalist>
        </Field>
        {suggestions.length > 0 ? (
          <div className="suggestion-row">
            {suggestions.map((tag) => (
              <button type="button" key={tag.type} className="tag-suggestion" onClick={() => setType(tag.type)}>
                {tag.type}
                <em>{dialog.scope === 'edgeConditions' ? tag.conditions : tag.actions}</em>
              </button>
            ))}
          </div>
        ) : null}
        <div className="field-group-head">
          <span>Parameters</span>
          <button
            type="button"
            className="tagged-add"
            onClick={() => setRows((current) => [...current, { key: '', value: '' }])}
          >
            <Plus size={11} aria-hidden />
            Parameter
          </button>
        </div>
        <div className="tagged-form-fields">
          {rows.map((row, index) => (
            <div className="custom-field-row" key={index}>
              <input
                value={row.key}
                placeholder="key"
                aria-label={`Parameter ${index + 1} key`}
                onChange={(event) => {
                  const next = [...rows];
                  next[index] = { ...row, key: event.target.value };
                  setRows(next);
                }}
                spellCheck={false}
              />
              <input
                value={row.value}
                placeholder="value"
                aria-label={`Parameter ${index + 1} value`}
                onChange={(event) => {
                  const next = [...rows];
                  next[index] = { ...row, value: event.target.value };
                  setRows(next);
                }}
                spellCheck={false}
              />
              <button
                type="button"
                className="inline-cancel"
                title="Remove parameter"
                onClick={() => setRows((current) => current.filter((_, item) => item !== index))}
              >
                <Trash2 size={12} aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <FormError error={localError ?? error} />
      </div>
    </Modal>
  );
}

function ExportForm({
  graph,
  onCopy,
  onClose,
}: {
  graph: GraphView | null;
  onCopy: (text: string) => void;
  onClose: () => void;
}) {
  const mermaid = useMemo(() => (graph ? mermaidFor(graph) : ''), [graph]);

  return (
    <Modal
      title="Export as Mermaid"
      subtitle="Drop this into a Mermaid renderer for a lightweight diagram."
      icon={Layers}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" icon={Check} onClick={() => onCopy(mermaid)}>
            Copy Mermaid
          </Button>
        </>
      }
    >
      <div className="modal-form">
        <textarea className="mermaid-output" value={mermaid} readOnly rows={18} spellCheck={false} />
        <p className="export-hint">
          The Mermaid export is intentionally simplified: it keeps node ids and step summaries but
          drops conditions and actions. The visual editor remains the source of truth.
        </p>
      </div>
    </Modal>
  );
}

export function Modals({
  dialog,
  graph,
  index,
  readOnly,
  onClose,
  onApply,
  onCreate,
  onCopy,
}: {
  dialog: DialogState | null;
  graph: GraphView | null;
  index: IndexPayload | null;
  readOnly: boolean;
  onClose: () => void;
  onApply: (operation: GraphOperation) => Promise<EditResult>;
  onCreate: (options: CreateGraphOptions) => Promise<EditResult>;
  onCopy: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [dialog]);

  if (!dialog) return null;

  if (readOnly && dialog.kind !== 'export') {
    return (
      <Modal title="Editing unavailable" icon={AlertTriangle} onClose={onClose}>
        <p className="readonly-modal-text">
          The workspace is not trusted, so SS14 Studio cannot make edits. Trust the workspace and
          reopen the graph to continue.
        </p>
      </Modal>
    );
  }

  const run = async (operation: GraphOperation) => {
    setBusy(true);
    setError(null);
    const result = await onApply(operation);
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error ?? 'The operation failed.');
  };

  if (dialog.kind === 'createGraph') {
    return (
      <CreateGraphForm
        busy={busy}
        error={error}
        onClose={onClose}
        onCreate={(options) => {
          setBusy(true);
          setError(null);
          void onCreate(options).then((result) => {
            setBusy(false);
            if (result.ok) onClose();
            else setError(result.error ?? 'Could not create the graph.');
          });
        }}
      />
    );
  }

  if (dialog.kind === 'addNode') {
    return (
      <AddNodeForm
        graph={graph}
        busy={busy}
        error={error}
        onClose={onClose}
        onApply={(operation) => void run(operation)}
      />
    );
  }

  if (dialog.kind === 'addEdge') {
    return (
      <AddEdgeForm
        graph={graph}
        from={dialog.from}
        busy={busy}
        error={error}
        onClose={onClose}
        onApply={(operation) => void run(operation)}
      />
    );
  }

  if (dialog.kind === 'addStep') {
    return (
      <AddStepForm
        from={dialog.from}
        to={dialog.to}
        edgeIndex={dialog.edgeIndex}
        busy={busy}
        error={error}
        onClose={onClose}
        onApply={(operation) => void run(operation)}
      />
    );
  }

  if (dialog.kind === 'addTagged') {
    return (
      <AddTaggedForm
        dialog={dialog}
        index={index}
        busy={busy}
        error={error}
        onClose={onClose}
        onApply={(operation) => void run(operation)}
      />
    );
  }

  return <ExportForm graph={graph} onCopy={onCopy} onClose={onClose} />;
}

export function ConfirmDialog({
  confirm,
  onResolve,
}: {
  confirm: ConfirmState;
  onResolve: (confirmed: boolean) => void;
}) {
  return (
    <Modal
      title={confirm.title}
      subtitle={confirm.message}
      icon={AlertTriangle}
      onClose={() => onResolve(false)}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={() => onResolve(false)}>
            Cancel
          </Button>
          <Button
            variant={confirm.tone === 'primary' ? 'primary' : 'danger'}
            icon={Trash2}
            onClick={() => onResolve(true)}
          >
            {confirm.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="confirm-body">
        <span className={`confirm-orb ${confirm.tone === 'primary' ? 'primary' : ''}`}>
          <AlertTriangle size={22} aria-hidden />
        </span>
        <p>{confirm.detail ?? 'This action updates the construction graph YAML.'}</p>
        <span className="confirm-hint">You can undo this with the VS Code editor undo command.</span>
      </div>
    </Modal>
  );
}
