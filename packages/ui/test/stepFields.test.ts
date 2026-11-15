import { describe, expect, it } from 'vitest';
import {
  STEP_KINDS,
  STEP_KIND_MAP,
  buildStepInput,
  defaultsForKind,
  draftToFieldValue,
  editableFieldType,
  fieldValueToDraft,
  isKnownStepKind,
  stepFieldLabel,
  stepKindLabel,
  taggedEntrySummary,
  validateStepDraft,
} from '../src/lib/stepFields.js';
import type { ConstructionStep, TaggedEntry } from '@ss14-studio/core';

describe('step field definitions', () => {
  it('has a definition for every supported kind and defaults', () => {
    expect(new Set(STEP_KINDS.map((definition) => definition.kind)).size).toBe(STEP_KINDS.length);
    expect(isKnownStepKind('material')).toBe(true);
    expect(isKnownStepKind('custom')).toBe(false);
    expect(STEP_KIND_MAP.get('material')?.label).toBe('Material');
    expect(defaultsForKind('material')).toEqual({
      material: '',
      amount: '1',
      doAfter: '',
      store: '',
      name: '',
    });
    expect(defaultsForKind('none')).toEqual({});
    expect(defaultsForKind('unknown')).toEqual({});
  });

  it('builds typed step inputs from draft strings', () => {
    expect(
      buildStepInput('material', {
        material: ' Steel ',
        amount: '3',
        doAfter: '1.5',
        store: '',
      }),
    ).toEqual({
      kind: 'material',
      fields: { material: 'Steel', amount: 3, doAfter: 1.5 },
    });
    expect(
      buildStepInput('multipleTags', {
        allTags: 'Anchorable, Wrenchable,,',
        anyTags: 'Wirecutter',
      }),
    ).toEqual({
      kind: 'multipleTags',
      fields: { allTags: ['Anchorable', 'Wrenchable'], anyTags: ['Wirecutter'] },
    });
    expect(buildStepInput('none', { material: 'Steel' })).toEqual({ kind: 'none', fields: {} });
  });

  it('parses custom fields with sensible primitive types', () => {
    const input = buildStepInput(
      'unknown',
      {},
      [
        { key: ' count ', value: ' 12 ' },
        { key: 'enabled', value: 'true' },
        { key: 'disabled', value: 'false' },
        { key: 'label', value: 'hello' },
        { key: 'bad key', value: 'ignored' },
        { key: '', value: 'ignored' },
        { key: 'empty', value: '' },
      ],
    );
    expect(input.fields).toEqual({
      count: 12,
      enabled: true,
      disabled: false,
      label: 'hello',
    });
  });

  it('validates required fields and custom drafts', () => {
    expect(validateStepDraft('none', {})).toBeNull();
    expect(validateStepDraft('material', { material: 'Steel' })).toBeNull();
    expect(validateStepDraft('material', { material: '  ' })).toBe('Material is required.');
    expect(validateStepDraft('tool', { tool: 'Screwing' })).toBeNull();
    expect(validateStepDraft('unknown', {}, [])).toBe('Add at least one custom field.');
    expect(validateStepDraft('unknown', {}, [{ key: 'bad key', value: 'x' }])).toContain(
      'not a valid field name',
    );
    expect(validateStepDraft('unknown', {}, [{ key: 'valid', value: 'x' }])).toBeNull();
  });

  it('renders labels and summaries for known and unknown entries', () => {
    const step = {
      kind: 'material',
      fields: { material: 'Steel' },
      doAfter: null,
      completed: [],
      span: { start: 0, end: 1, line: 1, endLine: 1 },
      fieldSpans: {},
      raw: '',
      typeName: 'MaterialConstructionGraphStep',
    } satisfies ConstructionStep;
    expect(stepKindLabel(step)).toBe('Material');
    expect(stepKindLabel({ ...step, kind: 'unknown' })).toBe('Custom');
    expect(stepFieldLabel('doAfter')).toBe('Do after');
    expect(stepFieldLabel('someCustomKey')).toBe('Some Custom Key');
    expect(stepFieldLabel('material')).toBe('Material');

    const entry: TaggedEntry = {
      type: 'SetAnchor',
      fields: { value: false, tags: ['A', 'B'], nested: { a: 1 }, ignored: 1 },
      span: { start: 0, end: 1, line: 1, endLine: 1 },
      fieldSpans: {},
      raw: '',
    };
    expect(taggedEntrySummary(entry)).toContain('value: false');
    expect(taggedEntrySummary(entry)).toContain('tags: A, B');
    expect(taggedEntrySummary({ ...entry, fields: {} })).toBe('no parameters');
  });
});

describe('field value conversion', () => {
  it('converts values to editable draft text', () => {
    expect(fieldValueToDraft(null)).toBe('');
    expect(fieldValueToDraft(undefined)).toBe('');
    expect(fieldValueToDraft(['A', 'B'])).toBe('A, B');
    expect(fieldValueToDraft({ nested: true })).toBe('{"nested":true}');
    expect(fieldValueToDraft(4.5)).toBe('4.5');
  });

  it('chooses an editor type from the key and value', () => {
    expect(editableFieldType('anything', ['A'])).toBe('csv');
    expect(editableFieldType('anything', true)).toBe('boolean');
    expect(editableFieldType('anything', 2)).toBe('number');
    expect(editableFieldType('anything', { a: 1 })).toBe('complex');
    expect(editableFieldType('doAfter', '1')).toBe('number');
    expect(editableFieldType('minTemperature', '1')).toBe('number');
    expect(editableFieldType('amount', '1')).toBe('number');
    expect(editableFieldType('material', 'Steel')).toBe('text');
  });

  it('converts draft text back into step field values', () => {
    expect(draftToFieldValue('text', '  ')).toBeNull();
    expect(draftToFieldValue('number', '4.2')).toBe(4.2);
    expect(draftToFieldValue('number', 'not-a-number')).toBeNull();
    expect(draftToFieldValue('boolean', 'true')).toBe(true);
    expect(draftToFieldValue('boolean', 'false')).toBe(false);
    expect(draftToFieldValue('csv', 'A, B, , C')).toEqual(['A', 'B', 'C']);
    expect(draftToFieldValue('text', ' Steel ')).toBe('Steel');
  });
});
