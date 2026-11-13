/**
 * SS14 YAML prototype parsing, inheritance resolution and reporting.
 *
 * The engine's prototype loader is considerably more permissive than a plain
 * YAML parser. This module intentionally mirrors the parts that matter for an
 * editor: parent merging, component field merging, partial overlays, variant
 * prototypes and localization lookup. It never executes game code.
 */
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Node,
  type Pair,
  type YAMLMap,
} from 'yaml';
import type {
  Diagnostic,
  InheritanceNode,
  LocalizationEntry,
  PartialContribution,
  PartialMark,
  PrototypeComponent,
  PrototypeIndexPayload,
  PrototypeKindStat,
  PrototypeOperation,
  PrototypeSummary,
  PrototypeView,
  ParsedPrototypeFile,
  RawPrototype,
  RawPrototypeComponent,
  ResolvedField,
  ResolvedPrototype,
  SourceSpan,
  SpriteInfo,
  TextEdit,
} from './model.js';
import {
  LineIndex,
  booleanValue,
  detectEol,
  formatScalar,
  getNode,
  getPair,
  scalarFieldSpans,
  sequenceItems,
  spanOf,
  stringValue,
  tagType,
  toPlain,
} from './yaml.js';

export interface ParsePrototypeOptions {
  filePath: string;
  relativePath: string;
  fileKey?: string;
  isPartial?: boolean;
  partialIndex?: number;
  documentIndexOffset?: number;
}

interface ParseContext {
  source: string;
  lines: LineIndex;
  document: Document.Parsed;
  filePath: string;
  relativePath: string;
  isPartial: boolean;
  partialIndex: number | undefined;
  diagnostics: Diagnostic[];
}

const META_KEYS = new Set([
  'type',
  'id',
  'parent',
  'abstract',
  'components',
]);

function resolveNode(
  ctx: ParseContext,
  input: Node | null | undefined,
  seen = new Set<Node>(),
): Node | null {
  if (!input) return null;
  if (!isAlias(input)) return input;
  if (seen.has(input)) return null;
  seen.add(input);
  try {
    return resolveNode(ctx, input.resolve(ctx.document) as Node | undefined, seen);
  } catch {
    return null;
  }
}

function pushDiagnostic(
  ctx: ParseContext,
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  node?: Node | null,
): void {
  const span = node ? spanOf(node, ctx.lines) : null;
  ctx.diagnostics.push({
    severity,
    code,
    message,
    line: span?.line ?? 1,
    ...(span ? { span } : {}),
  });
}

function tagsOn(node: Node | null | undefined): string[] {
  const tags = new Set<string>();
  const tag = node?.tag;
  if (tag) tags.add(tag);
  if (node && isMap(node)) {
    for (const pair of node.items) {
      const key = pair.key as Node | undefined;
      const value = pair.value as Node | undefined;
      if (key?.tag) tags.add(key.tag);
      if (value?.tag) tags.add(value.tag);
    }
  }
  return [...tags];
}

/** Match `!Tag`, `!Tag:param` and return the parameter (null for a bare tag). */
function tagParam(
  tag: string | null | undefined,
  base: string,
): string | null | undefined {
  if (!tag) return undefined;
  const clean = tag.startsWith('!') ? tag.slice(1) : tag;
  const [name, ...rest] = clean.split(':');
  if (name !== base) return undefined;
  return rest.length > 0 ? rest.join(':') : null;
}

function partialMark(
  typeNode: Node | null,
  typeTag: string | null,
  options: ParsePrototypeOptions,
): PartialMark {
  const only = tagParam(typeTag, 'PartialOnly') !== undefined;
  const taggedIndex = tagParam(typeTag, 'Partial');
  let index: number | null =
    typeof taggedIndex === 'string' && taggedIndex !== ''
      ? Number.parseInt(taggedIndex, 10)
      : null;
  if (index != null && !Number.isFinite(index)) index = null;
  const partial =
    only ||
    taggedIndex !== undefined ||
    Boolean(options.isPartial) ||
    Boolean(typeTag && /Partial/i.test(typeTag));
  if (index == null && partial && options.partialIndex != null) {
    index = options.partialIndex;
  }
  return {
    partial,
    only,
    index,
    tag: typeTag && /Partial/i.test(typeTag) ? typeTag : null,
  };
}

function parseComponent(
  ctx: ParseContext,
  input: Node,
): RawPrototypeComponent | null {
  const node = resolveNode(ctx, input);
  if (!node) return null;
  if (!isMap(node)) {
    pushDiagnostic(ctx, 'warning', 'prototype.component.invalid', 'A component is not a mapping.', node);
    return null;
  }

  const typeNode = resolveNode(ctx, getNode(node, 'type'));
  const type = stringValue(typeNode);
  const allTags = tagsOn(node);
  let operation: RawPrototypeComponent['operation'] = null;
  let operationIndex: number | null = null;
  for (const tag of allTags) {
    if (tagParam(tag, 'Remove') !== undefined) operation = 'remove';
    else if (tagParam(tag, 'Clear') !== undefined) operation = 'clear';
    const indexTag = tagParam(tag, 'Index') ?? tagParam(tag, 'CombineIndex');
    if (indexTag !== undefined) {
      operation = tagParam(tag, 'CombineIndex') !== undefined ? 'combineIndex' : 'index';
      if (typeof indexTag === 'string') {
        const parsed = Number.parseInt(indexTag, 10);
        if (Number.isFinite(parsed)) operationIndex = parsed;
      }
    }
  }

  const tag = allTags.find((candidate) =>
    /^!(Remove|Clear|Index|CombineIndex|PartialModified)/i.test(candidate),
  ) ?? null;

  const resolvedType =
    type ??
    (typeNode && isScalar(typeNode) ? stringValue(typeNode) : null) ??
    (node.tag ? tagType(node.tag) : null);
  if (!resolvedType || resolvedType === 'Remove' || resolvedType === 'Clear') {
    pushDiagnostic(
      ctx,
      'warning',
      'prototype.component.type',
      'A component is missing its type.',
      node,
    );
    return null;
  }

  const fields: Record<string, unknown> = {};
  const span = spanOf(node, ctx.lines);
  for (const pair of node.items) {
    if (!isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    if (key === 'type') continue;
    fields[key] = toPlain(resolveNode(ctx, pair.value as Node));
  }

  return {
    type: resolvedType,
    fields,
    tag,
    operation: span ? operation : operation,
    operationIndex,
  };
}

function parseParents(
  ctx: ParseContext,
  node: Node | null,
): string[] {
  if (!node) return [];
  if (isSeq(node)) {
    return sequenceItems(node)
      .map((item) => stringValue(resolveNode(ctx, item)))
      .filter((value): value is string => Boolean(value));
  }
  const single = stringValue(resolveNode(ctx, node));
  return single ? [single] : [];
}

interface VariantInfo {
  ids: string[];
  template: string | null;
}

function variantIds(
  ctx: ParseContext,
  idNode: Node | null,
): VariantInfo {
  if (!idNode) return { ids: [], template: null };
  const tag = idNode.tag;
  const isVariants = tag?.endsWith('CreateVariants') ?? false;
  if (!isVariants || !isMap(idNode)) {
    const id = stringValue(resolveNode(ctx, idNode));
    return { ids: id ? [id] : [], template: null };
  }
  const values = sequenceItems(getNode(idNode, 'values'))
    .map((item) => stringValue(resolveNode(ctx, item)))
    .filter((value): value is string => Boolean(value));
  const template = stringValue(resolveNode(ctx, getNode(idNode, 'id')));
  return { ids: values, template };
}

function parsePrototypeMap(
  ctx: ParseContext,
  node: YAMLMap<unknown, unknown>,
  documentIndex: number,
): RawPrototype[] {
  const typeNode = resolveNode(ctx, getNode(node, 'type'));
  const kind = stringValue(typeNode);
  if (!kind) {
    pushDiagnostic(ctx, 'warning', 'prototype.type.missing', 'A prototype has no type.', node);
    return [];
  }

  const idNode = resolveNode(ctx, getNode(node, 'id'));
  const variants = variantIds(ctx, idNode);
  if (variants.ids.length === 0) {
    return [];
  }

  const parents = parseParents(ctx, resolveNode(ctx, getNode(node, 'parent')));
  const abstract = booleanValue(getNode(node, 'abstract'));
  const fields: Record<string, unknown> = {};
  const fieldTags: Record<string, string> = {};
  for (const pair of node.items) {
    if (!isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    if (META_KEYS.has(key)) continue;
    const valueNode = resolveNode(ctx, pair.value as Node);
    fields[key] = toPlain(valueNode);
    const tag = pair.key?.tag ?? valueNode?.tag;
    if (tag) fieldTags[key] = tag;
  }

  const components: RawPrototypeComponent[] = [];
  for (const item of sequenceItems(resolveNode(ctx, getNode(node, 'components')))) {
    const component = parseComponent(ctx, item);
    if (component) components.push(component);
  }

  const span = spanOf(node, ctx.lines);
  if (!span) return [];
  const ids = variants.ids.length > 1 ? variants.ids : variants.ids.slice(0, 1);
  const typeTag = typeNode?.tag ?? null;
  const partial = partialMark(typeNode, typeTag, {
    filePath: ctx.filePath,
    relativePath: ctx.relativePath,
    isPartial: ctx.isPartial,
    partialIndex: ctx.partialIndex,
  });

  return ids.map((id, variantIndex) => ({
    key: `${kind}:${id}`,
    kind,
    id,
    abstract,
    parents,
    fields,
    fieldTags,
    components,
    span,
    idSpan: spanOf(idNode, ctx.lines),
    typeSpan: spanOf(typeNode, ctx.lines),
    line: span.line,
    filePath: ctx.filePath,
    relativePath: ctx.relativePath,
    documentIndex,
    partial: variantIndex === 0 ? partial : { ...partial, tag: partial.tag },
    tags: [...new Set([...tagsOn(node), ...(typeTag ? [typeTag] : [])])],
    variants: variants.ids,
  }));
}

/** Parse every prototype in a single YAML file. */
export function parsePrototypeFile(
  source: string,
  options: ParsePrototypeOptions,
): ParsedPrototypeFile {
  const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const result: ParsedPrototypeFile = {
    filePath: options.filePath,
    relativePath: options.relativePath,
    source: normalized,
    prototypes: [],
    diagnostics: [],
  };

  let document: Document.Parsed;
  try {
    document = parseDocument(normalized, {
      keepSourceTokens: true,
      prettyErrors: false,
      strict: false,
    });
  } catch (error) {
    result.diagnostics.push({
      severity: 'error',
      code: 'yaml.parse',
      message: `Could not parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      line: 1,
      filePath: options.filePath,
    });
    return result;
  }

  for (const error of document.errors) {
    result.diagnostics.push({
      severity: 'error',
      code: 'yaml.parse',
      message: error.message,
      line: error.linePos?.[0]?.line ?? 1,
      filePath: options.filePath,
    });
  }

  const ctx: ParseContext = {
    source: normalized,
    lines: new LineIndex(normalized),
    document,
    filePath: options.filePath,
    relativePath: options.relativePath,
    isPartial: options.isPartial ?? false,
    partialIndex: options.partialIndex,
    diagnostics: [],
  };

  const root = resolveNode(ctx, document.contents as Node | null);
  const candidates: Node[] = isSeq(root) ? (root.items as Node[]) : root ? [root] : [];
  candidates.forEach((candidate, index) => {
    if (!isMap(candidate)) return;
    result.prototypes.push(
      ...parsePrototypeMap(
        ctx,
        candidate,
        index + (options.documentIndexOffset ?? 0),
      ),
    );
  });

  result.diagnostics.push(
    ...ctx.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      filePath: options.filePath,
    })),
  );
  return result;
}

/** Parse a Fluent (.ftl) localization file. Only simple messages are needed. */
export function parseFluent(source: string, filePath = ''): LocalizationEntry[] {
  const entries: LocalizationEntry[] = [];
  let current: LocalizationEntry | null = null;
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.*)$/.exec(line);
    if (match) {
      current = {
        id: match[1]!,
        value: match[2]!.trim(),
        filePath,
      };
      entries.push(current);
      continue;
    }
    if (current && /^\s{2,}\S/.test(line) && !line.trimStart().startsWith('{')) {
      current.value = `${current.value} ${line.trim()}`.trim();
      continue;
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      current = null;
    }
  }
  return entries;
}

function localizationFor(
  localization: Map<string, string>,
  value: string | null,
): string | null {
  if (value == null) return null;
  return localization.get(value) ?? value;
}

function fieldString(
  fields: Record<string, unknown>,
  key: string,
): string | null {
  const value = fields[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function componentField(
  components: PrototypeComponent[],
  type: string,
  field: string,
): unknown {
  return components.find((component) => component.type === type)?.fields[field];
}

/** Locate the first sprite definition in a resolved prototype. */
export function extractSprite(
  components: PrototypeComponent[],
  fields: Record<string, unknown>,
): SpriteInfo | null {
  const candidates = ['Sprite', 'Icon'];
  for (const type of candidates) {
    const component = components.find((candidate) => candidate.type === type);
    if (!component) continue;
    const rsi = typeof component.fields.sprite === 'string'
      ? component.fields.sprite
      : typeof fields.sprite === 'string'
        ? fields.sprite
        : null;
    let state =
      typeof component.fields.state === 'string'
        ? component.fields.state
        : null;
    const layers = component.fields.layers;
    let layerState: string | null = null;
    if (Array.isArray(layers)) {
      for (const layer of layers) {
        if (!layer || typeof layer !== 'object') continue;
        const record = layer as Record<string, unknown>;
        if (typeof record.state === 'string') {
          layerState = record.state;
          break;
        }
      }
    }
    state = state ?? layerState;
    if (!rsi && !state) continue;
    const normalized = rsi
      ?.replace(/^\/+/, '')
      .replace(/^Resources\//, '')
      .replace(/\/+$/, '');
    const scale =
      typeof component.fields.scale === 'number'
        ? component.fields.scale
        : null;
    const color =
      typeof component.fields.color === 'string'
        ? component.fields.color
        : null;
    return {
      rsi: normalized ?? null,
      state: state ?? 'icon',
      layerState,
      color,
      scale,
      component: type,
      texture: normalized && !normalized.endsWith('.rsi') ? normalized : null,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Partial overlays                                                    */
/* ------------------------------------------------------------------ */

function mergeComponent(
  components: RawPrototypeComponent[],
  incoming: RawPrototypeComponent,
): void {
  const existing = components.find((component) => component.type === incoming.type);
  if (!existing) {
    if (incoming.operation !== 'remove') {
      components.push({
        ...incoming,
        fields: { ...incoming.fields },
        operation: null,
      });
    }
    return;
  }
  switch (incoming.operation) {
    case 'remove':
      components.splice(components.indexOf(existing), 1);
      break;
    case 'clear':
      existing.fields = { ...incoming.fields };
      break;
    case 'combineIndex':
    case 'index':
      existing.fields = { ...existing.fields, ...incoming.fields };
      break;
    default:
      existing.fields = { ...existing.fields, ...incoming.fields };
      break;
  }
}

function applyPatch(base: RawPrototype, patch: RawPrototype): RawPrototype {
  const fields = { ...base.fields };
  const fieldTags = { ...base.fieldTags };
  for (const [key, value] of Object.entries(patch.fields)) {
    const tag = patch.fieldTags[key];
    if (tag && /\bClear\b/.test(tag)) {
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
        delete fields[key];
        delete fieldTags[key];
        continue;
      }
    }
    if (tag && /\bRemove\b/.test(tag)) {
      delete fields[key];
      delete fieldTags[key];
      continue;
    }
    fields[key] = value;
    if (tag) fieldTags[key] = tag;
  }
  const components = base.components.map((component) => ({
    ...component,
    fields: { ...component.fields },
  }));
  for (const component of patch.components) {
    mergeComponent(components, component);
  }
  return {
    ...base,
    fields,
    fieldTags,
    components,
    parents: patch.parents.length > 0 ? patch.parents : base.parents,
    abstract: patch.abstract || base.abstract,
  };
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

interface RecordSet {
  base: Map<string, RawPrototype>;
  patches: Map<string, RawPrototype[]>;
  duplicates: Map<string, number>;
  order: string[];
}

function recordSet(records: RawPrototype[]): RecordSet {
  const base = new Map<string, RawPrototype>();
  const patches = new Map<string, RawPrototype[]>();
  const duplicates = new Map<string, number>();
  const order: string[] = [];

  for (const record of records) {
    if (record.partial.partial) {
      const list = patches.get(record.key) ?? [];
      list.push(record);
      patches.set(record.key, list);
      continue;
    }
    if (base.has(record.key)) {
      duplicates.set(record.key, (duplicates.get(record.key) ?? 1) + 1);
      continue;
    }
    base.set(record.key, record);
    order.push(record.key);
  }

  for (const list of patches.values()) {
    list.sort(
      (a, b) =>
        (a.partial.index ?? Number.MAX_SAFE_INTEGER) -
          (b.partial.index ?? Number.MAX_SAFE_INTEGER) ||
        a.filePath.localeCompare(b.filePath) ||
        a.line - b.line,
    );
  }
  order.sort((a, b) => a.localeCompare(b));
  return { base, patches, duplicates, order };
}

export class PrototypeRegistry {
  private readonly set: RecordSet;
  private readonly cache = new Map<string, ResolvedPrototype>();
  private summaryCache: PrototypeSummary[] | null = null;
  private effectiveCache = new Map<string, RawPrototype>();

  constructor(
    readonly records: RawPrototype[],
    readonly localization: Map<string, string> = new Map(),
  ) {
    this.set = recordSet(records);
  }

  get size(): number {
    return this.set.base.size;
  }

  get duplicateCount(): number {
    let total = 0;
    for (const count of this.set.duplicates.values()) total += count - 1;
    return total;
  }

  get allBaseRecords(): RawPrototype[] {
    return this.set.order
      .map((key) => this.set.base.get(key))
      .filter((record): record is RawPrototype => Boolean(record));
  }

  find(id: string, kind?: string): RawPrototype | undefined {
    if (kind) return this.set.base.get(`${kind}:${id}`);
    const direct = this.set.base.get(id);
    if (direct) return direct;
    for (const record of this.set.base.values()) {
      if (record.id === id) return record;
    }
    return undefined;
  }

  private effective(record: RawPrototype): RawPrototype {
    const cached = this.effectiveCache.get(record.key);
    if (cached) return cached;
    let result = record;
    for (const patch of this.set.patches.get(record.key) ?? []) {
      result = applyPatch(result, patch);
    }
    this.effectiveCache.set(record.key, result);
    return result;
  }

  private resolveParents(
    record: RawPrototype,
    stack: string[],
    diagnostics: Diagnostic[],
  ): ResolvedPrototype[] {
    const resolved: ResolvedPrototype[] = [];
    for (const parentId of record.parents) {
      const parent = this.find(parentId, record.kind) ?? this.find(parentId);
      if (!parent) {
        diagnostics.push({
          severity: 'error',
          code: 'prototype.parent.missing',
          message: `Parent prototype "${parentId}" was not found.`,
          line: record.line,
          node: record.id,
        });
        continue;
      }
      if (stack.includes(parent.key)) {
        diagnostics.push({
          severity: 'error',
          code: 'prototype.parent.cycle',
          message: `Inheritance cycle: ${[...stack, parent.key].join(' → ')}.`,
          line: record.line,
          node: record.id,
        });
        continue;
      }
      resolved.push(this.resolveRecord(parent, [...stack, record.key]));
    }
    return resolved;
  }

  private mergeComponents(
    parents: ResolvedPrototype[],
    own: RawPrototypeComponent[],
    record: RawPrototype,
  ): PrototypeComponent[] {
    const output: PrototypeComponent[] = [];

    const mergeFields = (
      target: PrototypeComponent,
      source: PrototypeComponent,
      sourceId: string,
      preferExisting: boolean,
    ) => {
      for (const [key, value] of Object.entries(source.fields)) {
        if (preferExisting && key in target.fields) continue;
        target.fields[key] = value;
        target.fieldOrigins[key] = source.fieldOrigins[key] ?? sourceId;
        if (!target.contributors.includes(sourceId)) target.contributors.push(sourceId);
      }
    };

    for (const parent of parents) {
      for (const component of parent.components) {
        const existing = output.find((candidate) => candidate.type === component.type);
        if (!existing) {
          output.push({
            ...component,
            fields: { ...component.fields },
            fieldOrigins: { ...component.fieldOrigins },
            contributors: [...component.contributors],
            ownFields: [],
            inherited: true,
          });
        } else {
          mergeFields(existing, component, component.sourceId, true);
        }
      }
    }

    for (const component of own) {
      const existing = output.find((candidate) => candidate.type === component.type);
      if (component.operation === 'remove') {
        if (existing) output.splice(output.indexOf(existing), 1);
        continue;
      }
      if (!existing) {
        if (component.operation === 'clear') {
          // Clearing a component creates an empty component with the new data.
        }
        output.push({
          type: component.type,
          fields: { ...component.fields },
          sourceId: record.id,
          sourceFile: record.relativePath,
          contributors: [record.id],
          fieldOrigins: Object.fromEntries(
            Object.keys(component.fields).map((key) => [key, record.id]),
          ),
          tags: component.tag ? [component.tag] : [],
          ownFields: Object.keys(component.fields),
          inherited: false,
        });
        continue;
      }
      const cleared = component.operation === 'clear';
      if (cleared) existing.fields = {};
      for (const [key, value] of Object.entries(component.fields)) {
        existing.fields[key] = value;
        existing.fieldOrigins[key] = record.id;
        if (!existing.contributors.includes(record.id)) existing.contributors.push(record.id);
        if (!existing.ownFields.includes(key)) existing.ownFields.push(key);
      }
      existing.sourceId = record.id;
      existing.sourceFile = record.relativePath;
      existing.inherited = false;
    }

    return output;
  }

  resolve(id: string, kind?: string): ResolvedPrototype | null {
    const record = this.find(id, kind);
    if (!record) return null;
    return this.resolveRecord(record, []);
  }

  private resolveRecord(record: RawPrototype, stack: string[]): ResolvedPrototype {
    const cached = this.cache.get(record.key);
    if (cached) return cached;
    if (stack.includes(record.key)) {
      // A cycle deeper in the graph; return a shallow placeholder.
      return {
        key: record.key,
        id: record.id,
        kind: record.kind,
        abstract: record.abstract,
        parents: record.parents,
        fields: { ...record.fields },
        resolvedFields: [],
        components: [],
        name: record.id,
        description: null,
        suffix: null,
        sprite: null,
        sourceId: record.id,
        sourceFile: record.relativePath,
        filePath: record.filePath,
        relativePath: record.relativePath,
        line: record.line,
        partials: [],
        diagnostics: [
          {
            severity: 'error',
            code: 'prototype.parent.cycle',
            message: `Inheritance cycle involving "${record.id}".`,
            line: record.line,
          },
        ],
      };
    }

    const effective = this.effective(record);
    const diagnostics: Diagnostic[] = [];
    const parents = this.resolveParents(effective, [...stack, record.key], diagnostics);

    const fields: Record<string, unknown> = {};
    const fieldOrigins = new Map<string, { sourceId: string; sourceFile: string; inherited: boolean }>();
    const fieldOverrides = new Map<string, { sourceId: string; value: unknown }[]>();

    for (const parent of parents) {
      for (const [key, value] of Object.entries(parent.fields)) {
        if (key in fields) continue;
        fields[key] = value;
        const origin = parent.resolvedFields.find((field) => field.key === key);
        fieldOrigins.set(key, {
          sourceId: origin?.sourceId ?? parent.id,
          sourceFile: origin?.sourceFile ?? parent.relativePath,
          inherited: true,
        });
      }
    }

    for (const [key, value] of Object.entries(effective.fields)) {
      if (key in fields) {
        const list = fieldOverrides.get(key) ?? [];
        list.push({
          sourceId: fieldOrigins.get(key)?.sourceId ?? record.id,
          value: fields[key],
        });
        fieldOverrides.set(key, list);
      }
      fields[key] = value;
      fieldOrigins.set(key, {
        sourceId: record.id,
        sourceFile: record.relativePath,
        inherited: false,
      });
    }

    const components = this.mergeComponents(parents, effective.components, effective);
    const sprite = extractSprite(components, fields);

    const rawName = fieldString(fields, 'name');
    const rawDescription = fieldString(fields, 'description');
    const rawSuffix = fieldString(fields, 'suffix');
    const name = localizationFor(this.localization, rawName) ?? record.id;
    const description = localizationFor(this.localization, rawDescription);
    const suffix = localizationFor(this.localization, rawSuffix);

    const resolvedFields: ResolvedField[] = Object.entries(fields).map(([key, value]) => {
      const origin = fieldOrigins.get(key);
      return {
        key,
        value,
        sourceId: origin?.sourceId ?? record.id,
        sourceFile: origin?.sourceFile ?? record.relativePath,
        inherited: origin?.inherited ?? false,
        overridden: fieldOverrides.get(key) ?? [],
      };
    });

    const partials = (this.set.patches.get(record.key) ?? []).map((patch) => patch.id);
    const resolved: ResolvedPrototype = {
      key: record.key,
      id: record.id,
      kind: record.kind,
      abstract: record.abstract || effective.abstract,
      parents: effective.parents,
      fields,
      resolvedFields: resolvedFields.sort((a, b) => a.key.localeCompare(b.key)),
      components,
      name,
      description,
      suffix,
      sprite,
      sourceId: record.id,
      sourceFile: record.relativePath,
      filePath: record.filePath,
      relativePath: record.relativePath,
      line: record.line,
      partials,
      diagnostics,
    };

    this.cache.set(record.key, resolved);
    return resolved;
  }

  summary(id: string, kind?: string): PrototypeSummary | null {
    const record = this.find(id, kind);
    if (!record) return null;
    const resolved = this.resolveRecord(record, []);
    changeSummaryCache(this);
    return this.summaryFor(record, resolved);
  }

  private childrenIndex(): Map<string, Set<string>> {
    if (this.childCache) return this.childCache;
    const index = new Map<string, Set<string>>();
    for (const record of this.set.base.values()) {
      for (const parent of record.parents) {
        const set = index.get(parent) ?? new Set<string>();
        set.add(record.key);
        index.set(parent, set);
      }
    }
    this.childCache = index;
    return index;
  }

  private childCache: Map<string, Set<string>> | null = null;

  private summaryFor(record: RawPrototype, resolved: ResolvedPrototype): PrototypeSummary {
    const children = this.childrenIndex().get(record.id)?.size ?? 0;
    return {
      key: record.key,
      id: record.id,
      kind: record.kind,
      abstract: resolved.abstract,
      name: resolved.name,
      description: resolved.description,
      parents: resolved.parents,
      filePath: record.filePath,
      relativePath: record.relativePath,
      line: record.line,
      componentCount: resolved.components.length,
      sprite: resolved.sprite,
      partial: record.partial.partial,
      children,
    };
  }

  summaries(): PrototypeSummary[] {
    if (this.summaryCache) return this.summaryCache;
    const summaries: PrototypeSummary[] = [];
    for (const record of this.allBaseRecords) {
      const resolved = this.resolveRecord(record, []);
      summaries.push(this.summaryFor(record, resolved));
    }
    summaries.sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
    this.summaryCache = summaries;
    return summaries;
  }

  indexPayload(partialFiles: string[] = [], scanDurationMs = 0): PrototypeIndexPayload {
    const summaries = this.summaries();
    const kinds = new Map<string, PrototypeKindStat>();
    let errors = this.duplicateCount;
    let warnings = 0;
    for (const summary of summaries) {
      const stat = kinds.get(summary.kind) ?? { kind: summary.kind, count: 0, abstract: 0 };
      stat.count++;
      if (summary.abstract) stat.abstract++;
      kinds.set(summary.kind, stat);
    }
    for (const record of this.allBaseRecords) {
      for (const diagnostic of this.resolveRecord(record, []).diagnostics) {
        if (diagnostic.severity === 'error') errors++;
        else if (diagnostic.severity === 'warning') warnings++;
      }
    }
    return {
      summaries,
      kinds: [...kinds.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
      total: summaries.length,
      errors,
      warnings,
      duplicates: this.duplicateCount,
      localizationCount: this.localization.size,
      partialFiles,
      scanDurationMs,
    };
  }

  view(id: string, kind?: string): PrototypeView | null {
    const record = this.find(id, kind);
    if (!record) return null;
    const resolved = this.resolveRecord(record, []);
    const summary = this.summaryFor(record, resolved);
    const children = [...(this.childrenIndex().get(record.id) ?? [])]
      .map((key) => this.set.base.get(key))
      .filter((child): child is RawPrototype => Boolean(child))
      .map((child) => this.summaryFor(child, this.resolveRecord(child, [])))
      .sort((a, b) => a.id.localeCompare(b.id));

    const partials: PartialContribution[] = (this.set.patches.get(record.key) ?? []).map(
      (patch) => ({
        id: patch.id,
        kind: patch.kind,
        filePath: patch.filePath,
        relativePath: patch.relativePath,
        line: patch.line,
        only: patch.partial.only,
        index: patch.partial.index,
        tag: patch.partial.tag,
        fields: Object.keys(patch.fields),
        components: patch.components.map((component) => component.type),
        tags: patch.tags,
      }),
    );

    const diagnostics: Diagnostic[] = [...resolved.diagnostics];
    if (record.partial.partial && !record.partial.only) {
      diagnostics.push({
        severity: 'info',
        code: 'prototype.partial',
        message: 'This prototype is defined in a partial file.',
        line: record.line,
      });
    }

    return {
      key: record.key,
      summary,
      resolved,
      inheritance: this.inheritanceTree(record, new Set()),
      children,
      partials,
      diagnostics,
    };
  }

  private inheritanceTree(record: RawPrototype, seen: Set<string>): InheritanceNode {
    const parents: InheritanceNode[] = [];
    if (!seen.has(record.key)) {
      seen.add(record.key);
      for (const parentId of record.parents) {
        const parent = this.find(parentId, record.kind) ?? this.find(parentId);
        if (!parent) {
          parents.push({
            id: parentId,
            kind: record.kind,
            abstract: false,
            missing: true,
            name: parentId,
            parents: [],
          });
          continue;
        }
        parents.push(this.inheritanceTree(parent, seen));
      }
    }
    return {
      id: record.id,
      kind: record.kind,
      abstract: record.abstract,
      missing: false,
      name: this.resolveRecord(record, []).name,
      parents,
    };
  }
}

function changeSummaryCache(_registry: PrototypeRegistry): void {
  // Intentionally empty: summary() is a read-only convenience. The cache is
  // built lazily by summaries().
}

/** Build summaries without creating a view for every entity. */
export function buildPrototypeIndex(
  records: RawPrototype[],
  localization: Map<string, string> = new Map(),
  partialFiles: string[] = [],
  scanDurationMs = 0,
): { registry: PrototypeRegistry; payload: PrototypeIndexPayload } {
  const registry = new PrototypeRegistry(records, localization);
  return {
    registry,
    payload: registry.indexPayload(partialFiles, scanDurationMs),
  };
}

/* ------------------------------------------------------------------ */
/* Locating and editing prototypes                                     */
/* ------------------------------------------------------------------ */

export interface PrototypeLocator {
  span: SourceSpan;
  idSpan: SourceSpan | null;
  typeSpan: SourceSpan | null;
  fieldSpans: Record<string, SourceSpan>;
  componentSpans: Record<string, { span: SourceSpan; typeSpan: SourceSpan | null }>;
  line: number;
  id: string;
  kind: string;
}

export function locatePrototype(
  source: string,
  id: string,
  kind?: string,
): PrototypeLocator | null {
  const lineIndex = new LineIndex(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  let document: Document.Parsed;
  try {
    document = parseDocument(text, { keepSourceTokens: true, strict: false });
  } catch {
    return null;
  }
  const root = document.contents as Node | null;
  const items: Node[] = root && isMap(root)
    ? [root]
    : root && isSeq(root)
      ? (root.items as Node[])
      : [];
  for (const item of items) {
    if (!isMap(item)) continue;
    const idNode = getNode(item, 'id');
    const itemId = stringValue(idNode);
    if (itemId !== id) continue;
    const kindNode = getNode(item, 'type');
    const itemKind = stringValue(kindNode) ?? '';
    if (kind && itemKind !== kind) continue;
    const span = spanOf(item, lineIndex);
    if (!span) continue;
    const componentSpans: Record<string, { span: SourceSpan; typeSpan: SourceSpan | null }> = {};
    for (const component of sequenceItems(getNode(item, 'components'))) {
      if (!isMap(component)) continue;
      const type = stringValue(getNode(component, 'type'));
      if (!type) continue;
      const componentSpan = spanOf(component, lineIndex);
      if (componentSpan) {
        componentSpans[type] = {
          span: componentSpan,
          typeSpan: spanOf(getNode(component, 'type'), lineIndex),
        };
      }
    }
    return {
      span,
      idSpan: spanOf(idNode, lineIndex),
      typeSpan: spanOf(kindNode, lineIndex),
      fieldSpans: scalarFieldSpans(item, lineIndex),
      componentSpans,
      line: span.line,
      id: itemId,
      kind: itemKind,
    };
  }
  return null;
}

function edit(start: number, end: number, value: string): TextEdit {
  return { start, end, text: value };
}

function indentUnit(source: string): string {
  const match = /\n([ \t]+)\S/.exec(source);
  if (!match) return '  ';
  const whitespace = match[1]!;
  return whitespace.includes('\t') ? '\t' : whitespace.slice(0, Math.min(2, whitespace.length));
}

function mappingIndent(span: SourceSpan, lines: LineIndex): number {
  const line = lines.lineText(span.line);
  return line.length - line.trimStart().length;
}

/**
 * Apply one surgical prototype edit. Ranges are computed from the current
 * source, so callers must reparse between edits.
 */
export function applyPrototypeOperation(
  source: string,
  operation: PrototypeOperation,
): { edits: TextEdit[]; message: string } {
  const bom = source.charCodeAt(0) === 0xfeff;
  const text = bom ? source.slice(1) : source;
  const lines = new LineIndex(text);
  const locator = locatePrototype(text, operation.id);
  if (!locator) {
    return { edits: [], message: `Could not find prototype "${operation.id}".` };
  }

  if (operation.kind === 'setField') {
    const pair = locateFieldPair(text, locator.span, operation.field);
    const formatted = operation.value == null ? null : formatScalar(operation.value);
    if (pair) {
      if (formatted == null) {
        const start = lines.lineStart(pair.line);
        const end = lines.lineEndWithNewline(pair.line);
        return {
          edits: [edit(start, end, '')],
          message: `Removed ${operation.field} from ${operation.id}.`,
        };
      }
      return {
        edits: [edit(pair.start, pair.end, formatted)],
        message: `Updated ${operation.field} on ${operation.id}.`,
      };
    }
    if (formatted == null) {
      return { edits: [], message: `${operation.field} was already unset.` };
    }
    const indent = ' '.repeat(mappingIndent(locator.span, lines));
    const insertAt = lines.lineEndWithNewline(locator.span.endLine);
    const eol = detectEol(text);
    return {
      edits: [edit(insertAt, insertAt, `${indent}${operation.field}: ${formatted}${eol}`)],
      message: `Added ${operation.field} to ${operation.id}.`,
    };
  }

  if (operation.kind === 'addComponent') {
    if (locator.componentSpans[operation.component]) {
      return { edits: [], message: `${operation.component} is already on ${operation.id}.` };
    }
    const baseIndent = mappingIndent(locator.span, lines);
    const eol = detectEol(text);
    const unit = indentUnit(text);
    const componentsPair = locateFieldPair(text, locator.span, 'components');
    const fieldLines = Object.entries(operation.fields ?? {}).map(
      ([key, value]) => `${' '.repeat(baseIndent + unit.length * 2)}${key}: ${formatScalar(
        typeof value === 'object' ? JSON.stringify(value) : (value as string | number | boolean),
      )}`,
    );
    const block = [
      `${' '.repeat(baseIndent + unit.length)}- type: ${operation.component}`,
      ...fieldLines,
    ].join(eol);

    if (componentsPair) {
      const insertAt = lines.lineEndWithNewline(componentsPair.line);
      return {
        edits: [edit(insertAt, insertAt, `${block}${eol}`)],
        message: `Added ${operation.component} to ${operation.id}.`,
      };
    }
    const insertAt = lines.lineEndWithNewline(locator.span.endLine);
    return {
      edits: [
        edit(
          insertAt,
          insertAt,
          `${' '.repeat(baseIndent)}components:${eol}${block}${eol}`,
        ),
      ],
      message: `Added ${operation.component} to ${operation.id}.`,
    };
  }

  if (operation.kind === 'removeComponent') {
    const target = locator.componentSpans[operation.component];
    if (!target) {
      return { edits: [], message: `${operation.component} is not defined on ${operation.id}.` };
    }
    const start = lines.lineStart(target.span.line);
    const end = lines.lineEndWithNewline(target.span.endLine);
    return {
      edits: [edit(start, end, '')],
      message: `Removed ${operation.component} from ${operation.id}.`,
    };
  }

  if (operation.kind === 'setComponentField') {
    const component = locator.componentSpans[operation.component];
    if (!component) {
      return { edits: [], message: `${operation.component} is not defined on ${operation.id}.` };
    }
    const pair = locateFieldPair(text, component.span, operation.field);
    const formatted = formatScalar(operation.value ?? '');
    if (pair) {
      return {
        edits: [edit(pair.start, pair.end, formatted)],
        message: `Updated ${operation.component}.${operation.field}.`,
      };
    }
    const indent = ' '.repeat(mappingIndent(component.span, lines) + indentUnit(text).length);
    const insertAt = lines.lineEndWithNewline(component.span.endLine);
    const eol = detectEol(text);
    return {
      edits: [edit(insertAt, insertAt, `${indent}${operation.field}: ${formatted}${eol}`)],
      message: `Added ${operation.component}.${operation.field}.`,
    };
  }

  if (operation.kind === 'extractPartial') {
    return {
      edits: [],
      message: renderPartialPrototype(source, operation.id, operation.fields, operation.components),
    };
  }

  return { edits: [], message: 'Unsupported prototype operation.' };
}

function locateFieldPair(
  source: string,
  span: SourceSpan,
  field: string,
): { line: number; start: number; end: number } | null {
  const lines = new LineIndex(source);
  for (let line = span.line; line <= span.endLine; line++) {
    const text = lines.lineText(line);
    const match = new RegExp(`^(\\s*)${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`).exec(text);
    if (!match) continue;
    const value = match[2]!.trim();
    const valueOffset = lines.lineStart(line) + match[0].length - match[2]!.length;
    return {
      line,
      start: valueOffset,
      end: valueOffset + match[2]!.length,
    };
    // The value can be on a following line (mappings/sequences). For scalar
    // fields this is always enough; parent/component fields use their own
    // locators.
  }
  return null;
}

/** Render a partial prototype that mirrors the selected fields/components. */
export function renderPartialPrototype(
  source: string,
  id: string,
  fields: string[],
  components: string[],
): string {
  const lines = new LineIndex(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const locator = locatePrototype(text, id);
  if (!locator) return '';
  const eol = detectEol(text);
  const fieldLines: string[] = [];
  for (const field of fields) {
    const span = locator.fieldSpans[field];
    if (!span) continue;
    fieldLines.push(text.slice(lines.lineStart(span.line), lines.lineContentEnd(span.endLine)));
  }
  const componentLines: string[] = [];
  for (const component of components) {
    const span = locator.componentSpans[component];
    if (!span) continue;
    const block = text.slice(lines.lineStart(span.span.line), lines.lineContentEnd(span.span.endLine));
    componentLines.push(block);
  }
  return [
    '# Partial prototype generated by SS14 Studio.',
    '# Apply this file from Resources/PartialPrototypes/partialPrototypes.yml.',
    `- type: !Partial:0 ${locator.kind}`,
    `  id: ${id}`,
    ...fieldLines,
    ...(componentLines.length > 0 ? ['  components:'] : []),
    ...componentLines.map((line) => `  ${line}`),
    '',
  ].join(eol);
}

export { getPair, isMap, isScalar, isSeq };

// Re-exported for callers that only need the summary shape.
export type { PrototypeSummary };
