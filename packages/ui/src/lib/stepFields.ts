import type {
  ConstructionStep,
  StepFieldValue,
  StepInput,
  StepKind,
  TaggedEntry,
} from '@ss14-studio/core';

export type StepDraftFieldType = 'text' | 'number' | 'csv';

export interface StepFieldDef {
  key: string;
  label: string;
  type: StepDraftFieldType;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface StepKindDef {
  kind: StepKind;
  label: string;
  description: string;
  fields: StepFieldDef[];
}

export const STEP_KINDS: StepKindDef[] = [
  {
    kind: 'material',
    label: 'Material',
    description: 'Consume a stack of material.',
    fields: [
      { key: 'material', label: 'Material', type: 'text', placeholder: 'Steel', required: true },
      { key: 'amount', label: 'Amount', type: 'number', placeholder: '1', defaultValue: '1' },
      { key: 'doAfter', label: 'Do after (s)', type: 'number', placeholder: '0.5' },
      { key: 'store', label: 'Store in', type: 'text', placeholder: 'optional storage prototype' },
      { key: 'name', label: 'Display name', type: 'text', placeholder: 'optional custom name' },
    ],
  },
  {
    kind: 'tool',
    label: 'Tool',
    description: 'Require a tool to be used.',
    fields: [
      { key: 'tool', label: 'Tool', type: 'text', placeholder: 'Screwdriver', required: true },
      { key: 'fuel', label: 'Fuel', type: 'text', placeholder: 'optional fuel prototype' },
      { key: 'doAfter', label: 'Do after (s)', type: 'number', placeholder: '0.5' },
      { key: 'examine', label: 'Examine hint', type: 'text', placeholder: 'optional guide string' },
    ],
  },
  {
    kind: 'tag',
    label: 'Tag',
    description: 'Require an item with a tag.',
    fields: [
      { key: 'tag', label: 'Tag', type: 'text', placeholder: 'Wirecutter', required: true },
      { key: 'doAfter', label: 'Do after (s)', type: 'number', placeholder: '0.5' },
      { key: 'store', label: 'Store in', type: 'text', placeholder: 'optional storage prototype' },
      { key: 'name', label: 'Display name', type: 'text', placeholder: 'optional custom name' },
    ],
  },
  {
    kind: 'component',
    label: 'Component',
    description: 'Require an entity with a component.',
    fields: [
      { key: 'component', label: 'Component', type: 'text', placeholder: 'Anchorable', required: true },
      { key: 'doAfter', label: 'Do after (s)', type: 'number', placeholder: '0.5' },
      { key: 'store', label: 'Store in', type: 'text', placeholder: 'optional storage prototype' },
      { key: 'name', label: 'Display name', type: 'text', placeholder: 'optional custom name' },
    ],
  },
  {
    kind: 'multipleTags',
    label: 'Any / all tags',
    description: 'Require several tags at once.',
    fields: [
      { key: 'allTags', label: 'All tags', type: 'csv', placeholder: 'Anchorable, Wrenchable' },
      { key: 'anyTags', label: 'Any tags', type: 'csv', placeholder: 'Wirecutter, Screwdriver' },
      { key: 'doAfter', label: 'Do after (s)', type: 'number', placeholder: '0.5' },
    ],
  },
  {
    kind: 'temperature',
    label: 'Temperature',
    description: 'Require a temperature range.',
    fields: [
      { key: 'minTemperature', label: 'Min (K)', type: 'number', placeholder: '293.15' },
      { key: 'maxTemperature', label: 'Max (K)', type: 'number', placeholder: '373.15' },
      { key: 'doAfter', label: 'Do after (s)', type: 'number', placeholder: '0.5' },
    ],
  },
  {
    kind: 'partAssembly',
    label: 'Part assembly',
    description: 'Use the part assembly system.',
    fields: [
      { key: 'assemblyId', label: 'Assembly id', type: 'text', placeholder: 'Clockwork', required: true },
      { key: 'guideString', label: 'Guide string', type: 'text', placeholder: 'optional guide loc string' },
      { key: 'doAfter', label: 'Do after (s)', type: 'number', placeholder: '0.5' },
    ],
  },
  {
    kind: 'unknown',
    label: 'Custom',
    description: 'Write arbitrary step fields.',
    fields: [],
  },
];

export const STEP_KIND_MAP = new Map<StepKind, StepKindDef>(
  STEP_KINDS.map((definition) => [definition.kind, definition]),
);

export function isKnownStepKind(kind: string): kind is StepKind {
  return STEP_KIND_MAP.has(kind as StepKind);
}

export function defaultsForKind(kind: StepKind | 'none'): Record<string, string> {
  if (kind === 'none') return {};
  const definition = STEP_KIND_MAP.get(kind);
  const draft: Record<string, string> = {};
  for (const field of definition?.fields ?? []) {
    draft[field.key] = field.defaultValue ?? '';
  }
  return draft;
}

export interface CustomFieldDraft {
  key: string;
  value: string;
}

export function buildStepInput(
  kind: StepInput['kind'],
  draft: Record<string, string>,
  customFields: CustomFieldDraft[] = [],
): StepInput {
  const fields: Record<string, StepFieldValue> = {};
  if (kind === 'none') return { kind, fields };

  const definition = kind === 'unknown' ? null : STEP_KIND_MAP.get(kind);
  for (const field of definition?.fields ?? []) {
    const raw = draft[field.key]?.trim() ?? '';
    if (!raw) continue;
    if (field.type === 'number') {
      const value = Number(raw);
      if (Number.isFinite(value)) fields[field.key] = value;
    } else if (field.type === 'csv') {
      const values = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (values.length > 0) fields[field.key] = values;
    } else {
      fields[field.key] = raw;
    }
  }

  if (kind === 'unknown') {
    for (const field of customFields) {
      const key = field.key.trim();
      const raw = field.value.trim();
      if (!key || !raw) continue;
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) continue;
      const number = Number(raw);
      fields[key] =
        raw !== '' && Number.isFinite(number) && /^-?\d+(\.\d+)?$/.test(raw)
          ? number
          : raw === 'true'
            ? true
            : raw === 'false'
              ? false
              : raw;
    }
  }

  return { kind, fields };
}

export function validateStepDraft(
  kind: StepInput['kind'],
  draft: Record<string, string>,
  customFields: CustomFieldDraft[] = [],
): string | null {
  if (kind === 'none') return null;
  if (kind === 'unknown') {
    const usable = customFields.filter(
      (field) => field.key.trim() !== '' && field.value.trim() !== '',
    );
    if (usable.length === 0) return 'Add at least one custom field.';
    for (const field of usable) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.key.trim())) {
        return `"${field.key}" is not a valid field name.`;
      }
    }
    return null;
  }
  const definition = STEP_KIND_MAP.get(kind);
  if (!definition) return 'Choose a step type.';
  for (const field of definition.fields) {
    if (field.required && !draft[field.key]?.trim()) {
      return `${field.label} is required.`;
    }
  }
  if (Object.keys(buildStepInput(kind, draft, customFields).fields).length === 0) {
    return 'A construction step needs at least one field.';
  }
  return null;
}

export function stepKindLabel(step: ConstructionStep): string {
  return STEP_KIND_MAP.get(step.kind)?.label ?? 'Custom';
}

export function stepFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    material: 'Material',
    amount: 'Amount',
    tool: 'Tool',
    fuel: 'Fuel',
    tag: 'Tag',
    component: 'Component',
    allTags: 'All tags',
    anyTags: 'Any tags',
    minTemperature: 'Min temperature',
    maxTemperature: 'Max temperature',
    assemblyId: 'Assembly id',
    guideString: 'Guide string',
    doAfter: 'Do after',
    store: 'Store in',
    name: 'Display name',
    examine: 'Examine hint',
    completed: 'Completed actions',
  };
  if (labels[key]) return labels[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

export function fieldValueToDraft(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export type EditableFieldType = 'text' | 'number' | 'boolean' | 'csv' | 'complex';

export function editableFieldType(key: string, value: unknown): EditableFieldType {
  if (Array.isArray(value)) return 'csv';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'object' && value !== null) return 'complex';
  if (key === 'doAfter' || key.endsWith('Temperature') || key === 'amount') return 'number';
  return 'text';
}

export function draftToFieldValue(
  type: EditableFieldType,
  draft: string,
): StepFieldValue {
  const raw = draft.trim();
  if (!raw) return null;
  if (type === 'number') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  if (type === 'boolean') return raw === 'true';
  if (type === 'csv') {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return raw;
}

export function taggedEntrySummary(entry: TaggedEntry): string {
  const fields = Object.entries(entry.fields).filter(([key]) => key !== '$type');
  const parts = fields
    .slice(0, 3)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join(', ')}`;
      if (typeof value === 'object' && value !== null) return `${key}: {…}`;
      return `${key}: ${String(value)}`;
    });
  return parts.length > 0 ? parts.join(' · ') : 'no parameters';
}
