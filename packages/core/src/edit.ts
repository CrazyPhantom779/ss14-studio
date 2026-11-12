import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Node,
  type Pair,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';
import type {
  ConstructionGraph,
  ConstructionNode,
  GraphOperation,
  OperationResult,
  StepInput,
  TaggedScope,
  TextEdit,
} from './model.js';
import {
  LineIndex,
  detectEol,
  formatScalar,
  getNode,
  getPair,
  sequenceLayout,
  spanOf,
  stringValue,
} from './yaml.js';

class EditFailure extends Error {}

interface AstContext {
  source: string;
  lines: LineIndex;
  eol: '\n' | '\r\n';
  proto: YAMLMap<unknown, unknown>;
  graphSeq: YAMLSeq<unknown>;
}

interface MapAst {
  map: YAMLMap<unknown, unknown>;
  contentIndent: number;
}

function spaces(count: number): string {
  return ' '.repeat(Math.max(0, count));
}

function edit(start: number, end: number, text: string): TextEdit {
  return { start, end, text };
}

function ensureLeadingNewline(ctx: AstContext, offset: number): string {
  return offset > 0 && ctx.source.charCodeAt(offset - 1) === 10 ? '' : ctx.eol;
}

function loadAst(graph: ConstructionGraph): AstContext {
  const doc = parseDocument(graph.source, {
    keepSourceTokens: true,
    prettyErrors: false,
    strict: false,
  });
  if (doc.errors.length > 0) {
    throw new EditFailure(`Cannot edit while the YAML has parse errors: ${doc.errors[0]!.message}`);
  }

  const root = doc.contents as Node | null;
  if (!isSeq(root)) throw new EditFailure('The prototype file root is not a YAML list.');
  const proto = root.items[graph.documentIndex];
  if (!isMap(proto)) throw new EditFailure('Could not find the construction graph prototype.');

  const graphSeq = getNode(proto, 'graph');
  if (!isSeq(graphSeq)) throw new EditFailure('The graph list is missing or is not a list.');

  return {
    source: graph.source,
    lines: new LineIndex(graph.source),
    eol: detectEol(graph.source),
    proto,
    graphSeq,
  };
}

function keyColumn(ctx: AstContext, pair: Pair<unknown, unknown>): number {
  const key = pair.key as Node | undefined;
  if (!key?.range) return 0;
  const line = ctx.lines.lineAt(key.range[0]);
  return key.range[0] - ctx.lines.lineStart(line);
}

function mapContentIndent(ctx: AstContext, map: YAMLMap<unknown, unknown>): number {
  const pair = map.items.find((candidate) => isScalar(candidate.key) && candidate.key.range);
  if (!pair) return 0;
  return keyColumn(ctx, pair);
}

function mapAst(ctx: AstContext, map: YAMLMap<unknown, unknown>): MapAst {
  return { map, contentIndent: mapContentIndent(ctx, map) };
}

function nodeAst(ctx: AstContext, graph: ConstructionGraph, name: string): MapAst {
  const model = graph.nodes.find((node) => node.name === name);
  if (!model) throw new EditFailure(`Node "${name}" does not exist.`);

  let item = ctx.graphSeq.items[model.yamlIndex] as Node | undefined;
  if (!isMap(item) || stringValue(getNode(item, 'node')) !== name) {
    item = ctx.graphSeq.items.find(
      (candidate) => isMap(candidate) && stringValue(getNode(candidate, 'node')) === name,
    ) as Node | undefined;
  }
  if (!isMap(item)) throw new EditFailure(`Could not locate node "${name}" in the YAML.`);
  return mapAst(ctx, item);
}

function nodeModel(graph: ConstructionGraph, name: string): ConstructionNode {
  const node = graph.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new EditFailure(`Node "${name}" does not exist.`);
  return node;
}

function edgeAst(
  ctx: AstContext,
  graph: ConstructionGraph,
  from: string,
  edgeIndex: number,
): { node: MapAst; edge: MapAst; edgesSeq: YAMLSeq<unknown> } {
  const node = nodeAst(ctx, graph, from);
  const edgesNode = getNode(node.map, 'edges');
  if (!isSeq(edgesNode)) throw new EditFailure(`Node "${from}" has no edge list.`);
  const item = edgesNode.items[edgeIndex];
  if (!isMap(item)) throw new EditFailure(`Edge ${edgeIndex} on node "${from}" was not found.`);
  return { node, edge: mapAst(ctx, item), edgesSeq: edgesNode };
}

function stepAst(
  ctx: AstContext,
  graph: ConstructionGraph,
  from: string,
  edgeIndex: number,
  stepIndex: number,
): { edge: MapAst; step: MapAst } {
  const { edge } = edgeAst(ctx, graph, from, edgeIndex);
  const stepsNode = getNode(edge.map, 'steps');
  if (!isSeq(stepsNode)) throw new EditFailure(`Edge ${edgeIndex} has no steps.`);
  const item = stepsNode.items[stepIndex];
  if (!isMap(item)) throw new EditFailure(`Step ${stepIndex} was not found.`);
  return { edge, step: mapAst(ctx, item) };
}

function fallbackDash(contentIndent: number): number {
  return contentIndent + 2;
}

function sequenceLayoutForPair(
  ctx: AstContext,
  pair: Pair<unknown, unknown> | undefined,
  contentIndent: number,
): { dashIndent: number; contentIndent: number } {
  const fallback = fallbackDash(contentIndent);
  if (pair && isSeq(pair.value)) {
    return sequenceLayout(ctx.source, ctx.lines, pair.value, fallback);
  }
  return { dashIndent: fallback, contentIndent: fallback + 2 };
}

/**
 * Insert rendered item lines into a sequence. Handles existing lists, empty
 * flow lists (`key: []`) and missing keys (`key:` appended at the end).
 */
function insertSequenceItem(
  ctx: AstContext,
  parent: MapAst,
  key: string,
  render: (dashIndent: number, contentIndent: number) => string[],
): TextEdit[] {
  const pair = getPair(parent.map, key);

  if (!pair) {
    const mapSpan = spanOf(parent.map, ctx.lines);
    if (!mapSpan) throw new EditFailure(`Could not find a place to add "${key}".`);
    const layout = { dashIndent: fallbackDash(parent.contentIndent), contentIndent: fallbackDash(parent.contentIndent) + 2 };
    const lines = render(layout.dashIndent, layout.contentIndent);
    const offset = ctx.lines.lineEndWithNewline(mapSpan.endLine);
    const text =
      ensureLeadingNewline(ctx, offset) +
      spaces(parent.contentIndent) +
      `${key}:` +
      ctx.eol +
      lines.join(ctx.eol) +
      ctx.eol;
    return [edit(offset, offset, text)];
  }

  const value = pair.value as Node | undefined;
  if (isSeq(value)) {
    if (value.items.length > 0) {
      const layout = sequenceLayoutForPair(ctx, pair, parent.contentIndent);
      const lines = render(layout.dashIndent, layout.contentIndent);
      const last = spanOf(value.items[value.items.length - 1] as Node, ctx.lines);
      if (!last) throw new EditFailure(`Could not find the end of "${key}".`);
      const offset = ctx.lines.lineEndWithNewline(last.endLine);
      const text = ensureLeadingNewline(ctx, offset) + lines.join(ctx.eol) + ctx.eol;
      return [edit(offset, offset, text)];
    }

    const range = value.range;
    if (!range) throw new EditFailure(`Could not find the empty list for "${key}".`);
    const layout = { dashIndent: fallbackDash(parent.contentIndent), contentIndent: fallbackDash(parent.contentIndent) + 2 };
    const lines = render(layout.dashIndent, layout.contentIndent);
    return [edit(range[0], range[1] ?? range[0], ctx.eol + lines.join(ctx.eol))];
  }

  if (value && isScalar(value) && (value.value == null || value.value === '')) {
    const keySpan = spanOf(pair.key as Node, ctx.lines);
    if (!keySpan) throw new EditFailure(`Could not find "${key}".`);
    const layout = { dashIndent: fallbackDash(parent.contentIndent), contentIndent: fallbackDash(parent.contentIndent) + 2 };
    const lines = render(layout.dashIndent, layout.contentIndent);
    const offset = ctx.lines.lineEndWithNewline(keySpan.line);
    return [
      edit(
        offset,
        offset,
        ensureLeadingNewline(ctx, offset) + lines.join(ctx.eol) + ctx.eol,
      ),
    ];
  }

  throw new EditFailure(`"${key}" exists but is not a list.`);
}

function removePair(ctx: AstContext, map: YAMLMap<unknown, unknown>, key: string): TextEdit[] {
  const pair = getPair(map, key);
  if (!pair) return [];
  const keySpan = spanOf(pair.key as Node, ctx.lines);
  const valueSpan = spanOf(pair.value as Node, ctx.lines);
  if (!keySpan) return [];
  const lineStart = ctx.lines.lineStart(keySpan.line);
  const prefix = ctx.source.slice(lineStart, keySpan.start);
  if (prefix.trim() !== '') {
    throw new EditFailure(`Cannot remove "${key}" because it is not on its own line.`);
  }
  const end = ctx.lines.lineEndWithNewline(valueSpan?.endLine ?? keySpan.line);
  return [edit(lineStart, end, '')];
}

function replacePairWithEmptySeq(
  ctx: AstContext,
  map: YAMLMap<unknown, unknown>,
  key: string,
): TextEdit[] {
  const pair = getPair(map, key);
  if (!pair) return [];
  const keySpan = spanOf(pair.key as Node, ctx.lines);
  const valueSpan = spanOf(pair.value as Node, ctx.lines);
  if (!keySpan) return [];
  const lineStart = ctx.lines.lineStart(keySpan.line);
  const indent = ctx.source.slice(lineStart, keySpan.start);
  if (indent.trim() !== '') {
    throw new EditFailure(`Cannot replace "${key}" because it is not on its own line.`);
  }
  const end = ctx.lines.lineEndWithNewline(valueSpan?.endLine ?? keySpan.line);
  return [edit(lineStart, end, `${indent}${key}: []${ctx.eol}`)];
}

function removeSequenceItem(
  ctx: AstContext,
  parent: YAMLMap<unknown, unknown>,
  key: string,
  seq: YAMLSeq<unknown>,
  index: number,
): TextEdit[] {
  if (seq.items.length <= 1) {
    return replacePairWithEmptySeq(ctx, parent, key);
  }
  const item = seq.items[index] as Node | undefined;
  const span = spanOf(item, ctx.lines);
  if (!span) throw new EditFailure(`Could not find item ${index} in "${key}".`);
  const start = ctx.lines.lineStart(span.line);
  const end = ctx.lines.lineEndWithNewline(span.endLine);
  return [edit(start, end, '')];
}

function replaceScalarValue(
  ctx: AstContext,
  pair: Pair<unknown, unknown>,
  value: string,
): TextEdit[] {
  const valueNode = pair.value as Node | undefined;
  const span = spanOf(valueNode, ctx.lines);
  if (!span) {
    const keySpan = spanOf(pair.key as Node, ctx.lines);
    if (!keySpan) throw new EditFailure('Could not find the value to replace.');
    return [edit(keySpan.end, keySpan.end, ` ${value}`)];
  }
  return [edit(span.start, span.end, value)];
}

function setMapField(
  ctx: AstContext,
  parent: MapAst,
  key: string,
  value: string | null,
): TextEdit[] {
  const pair = getPair(parent.map, key);
  if (pair) {
    if (value == null) return removePair(ctx, parent.map, key);
    return replaceScalarValue(ctx, pair, value);
  }
  if (value == null) return [];

  const mapSpan = spanOf(parent.map, ctx.lines);
  if (!mapSpan) throw new EditFailure(`Could not add "${key}".`);
  const offset = ctx.lines.lineEndWithNewline(mapSpan.endLine);
  return [
    edit(
      offset,
      offset,
      ensureLeadingNewline(ctx, offset) +
        spaces(parent.contentIndent) +
        `${key}: ${value}` +
        ctx.eol,
    ),
  ];
}

function renderNode(
  name: string,
  entity: string | null | undefined,
  dashIndent: number,
  contentIndent: number,
): string[] {
  const lines = [`${spaces(dashIndent)}- node: ${formatScalar(name)}`];
  if (entity) lines.push(`${spaces(contentIndent)}entity: ${formatScalar(entity)}`);
  lines.push(`${spaces(contentIndent)}edges: []`);
  return lines;
}

function formatStepValue(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatScalar(item)).join(', ')}]`;
  }
  return formatScalar(value);
}

function isEmptyFieldValue(value: StepInput['fields'][string]): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function renderStep(step: StepInput, dashIndent: number): string[] {
  if (step.kind === 'none') return [];
  const contentIndent = dashIndent + 2;
  const fields = step.fields;
  const order: Record<string, string[]> = {
    material: ['material', 'amount', 'doAfter', 'store', 'name'],
    tool: ['tool', 'fuel', 'doAfter', 'examine'],
    tag: ['tag', 'doAfter', 'store', 'name'],
    component: ['component', 'doAfter', 'store', 'name'],
    multipleTags: ['allTags', 'anyTags', 'doAfter', 'store', 'name'],
    temperature: ['minTemperature', 'maxTemperature', 'doAfter'],
    partAssembly: ['assemblyId', 'guideString', 'doAfter'],
    unknown: [],
  };

  const preferred = order[step.kind] ?? [];
  const keys = [
    ...preferred.filter((key) => !isEmptyFieldValue(fields[key])),
    ...Object.keys(fields).filter(
      (key) => !preferred.includes(key) && !isEmptyFieldValue(fields[key]),
    ),
  ];

  const rendered: string[] = [];
  let firstKey: string | null = null;
  let firstValue: string | number | boolean | string[] | null | undefined = null;

  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
      throw new EditFailure(`"${key}" is not a valid YAML field name.`);
    }
    const value = fields[key];
    if (isEmptyFieldValue(value)) continue;
    if (firstKey == null) {
      firstKey = key;
      firstValue = value;
    } else {
      rendered.push(`${spaces(contentIndent)}${key}: ${formatStepValue(value!)}`);
    }
  }

  if (firstKey == null) {
    throw new EditFailure('A construction step needs at least one field.');
  }

  return [
    `${spaces(dashIndent)}- ${firstKey}: ${formatStepValue(firstValue!)}`,
    ...rendered,
  ];
}

function renderEdge(
  target: string,
  steps: StepInput[],
  edgeDash: number,
  edgeContent: number,
): string[] {
  const lines = [`${spaces(edgeDash)}- to: ${formatScalar(target)}`];
  const realSteps = steps.filter((step) => step.kind !== 'none');
  if (realSteps.length === 0) {
    lines.push(`${spaces(edgeContent)}steps: []`);
    return lines;
  }
  lines.push(`${spaces(edgeContent)}steps:`);
  for (const step of realSteps) {
    lines.push(...renderStep(step, edgeContent + 2));
  }
  return lines;
}

function renderTaggedEntry(
  type: string,
  fields: Record<string, string | number | boolean>,
  dashIndent: number,
): string[] {
  const cleanType = type.replace(/^!type:/, '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(cleanType)) {
    throw new EditFailure(`"${type}" is not a valid action or condition type.`);
  }
  const lines = [`${spaces(dashIndent)}- !type:${cleanType}`];
  const contentIndent = dashIndent + 2;
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
      throw new EditFailure(`"${key}" is not a valid YAML field name.`);
    }
    lines.push(`${spaces(contentIndent)}${key}: ${formatScalar(value)}`);
  }
  return lines;
}

function taggedScopeMap(
  ctx: AstContext,
  graph: ConstructionGraph,
  operation: Extract<GraphOperation, { kind: 'addTaggedEntry' | 'removeTaggedEntry' }>,
): { parent: MapAst; key: string; seq: YAMLSeq<unknown> | null } {
  switch (operation.scope) {
    case 'nodeActions':
    case 'nodeTransforms': {
      if (!operation.node) throw new EditFailure('A node is required for this action.');
      const parent = nodeAst(ctx, graph, operation.node);
      const key = operation.scope === 'nodeActions' ? 'actions' : 'transform';
      const seq = getNode(parent.map, key);
      return { parent, key, seq: isSeq(seq) ? seq : null };
    }
    case 'edgeConditions':
    case 'edgeCompleted': {
      if (!operation.from || operation.edgeIndex == null) {
        throw new EditFailure('An edge is required for this action.');
      }
      const { edge } = edgeAst(ctx, graph, operation.from, operation.edgeIndex);
      const key = operation.scope === 'edgeConditions' ? 'conditions' : 'completed';
      const seq = getNode(edge.map, key);
      return { parent: edge, key, seq: isSeq(seq) ? seq : null };
    }
    case 'stepCompleted': {
      if (!operation.from || operation.edgeIndex == null || operation.stepIndex == null) {
        throw new EditFailure('A step is required for this action.');
      }
      const { step } = stepAst(ctx, graph, operation.from, operation.edgeIndex, operation.stepIndex);
      const seq = getNode(step.map, 'completed');
      return { parent: step, key: 'completed', seq: isSeq(seq) ? seq : null };
    }
    default:
      throw new EditFailure('Unknown action scope.');
  }
}

function applyOperation(graph: ConstructionGraph, operation: GraphOperation): OperationResult {
  const ctx = loadAst(graph);
  let edits: TextEdit[] = [];
  let message = 'Updated construction graph.';

  switch (operation.kind) {
    case 'renameNode': {
      const oldName = operation.node;
      const newName = operation.newName.trim();
      if (!newName) throw new EditFailure('A node name cannot be empty.');
      if (oldName === newName) return { edits: [], message: 'Nothing to change.' };
      if (graph.nodes.some((node) => node.name === newName)) {
        throw new EditFailure(`A node named "${newName}" already exists.`);
      }
      const node = nodeModel(graph, oldName);
      edits.push(edit(node.nameSpan.start, node.nameSpan.end, formatScalar(newName)));
      if (graph.start === oldName && graph.startSpan) {
        edits.push(edit(graph.startSpan.start, graph.startSpan.end, formatScalar(newName)));
      }
      for (const candidate of graph.nodes) {
        for (const edge of candidate.edges) {
          if (edge.target === oldName) {
            edits.push(edit(edge.targetSpan.start, edge.targetSpan.end, formatScalar(newName)));
          }
        }
      }
      message = `Renamed "${oldName}" to "${newName}".`;
      break;
    }

    case 'setNodeEntity': {
      const node = nodeAst(ctx, graph, operation.node);
      const value = operation.entity?.trim() || null;
      edits = setMapField(ctx, node, 'entity', value ? formatScalar(value) : null);
      message = value ? `Set entity to "${value}".` : 'Removed the node entity override.';
      break;
    }

    case 'setNodeFlag': {
      const node = nodeAst(ctx, graph, operation.node);
      edits = setMapField(
        ctx,
        node,
        operation.field,
        operation.value ? 'true' : null,
      );
      message = operation.value
        ? 'Enabled doNotReplaceInheritingEntities.'
        : 'Disabled doNotReplaceInheritingEntities.';
      break;
    }

    case 'addNode': {
      const name = operation.name.trim();
      if (!name) throw new EditFailure('A node name cannot be empty.');
      if (graph.nodes.some((node) => node.name === name)) {
        throw new EditFailure(`A node named "${name}" already exists.`);
      }
      const parent = mapAst(ctx, ctx.proto);
      const pair = getPair(ctx.proto, 'graph');
      const layout = sequenceLayoutForPair(ctx, pair, parent.contentIndent);
      const entity = operation.entity?.trim() || null;
      edits = insertSequenceItem(ctx, parent, 'graph', (dash, content) =>
        renderNode(name, entity, dash, content),
      );
      void layout;
      message = `Added node "${name}".`;
      break;
    }

    case 'deleteNode': {
      if (operation.node === graph.start) {
        throw new EditFailure('You cannot delete the start node.');
      }
      const model = nodeModel(graph, operation.node);
      const removedIncoming: string[] = [];

      for (const candidate of graph.nodes) {
        if (candidate.name === operation.node) continue;
        candidate.edges.forEach((edge, index) => {
          if (edge.target !== operation.node) return;
          removedIncoming.push(`${candidate.name} → ${operation.node}`);
          const candidateAst = nodeAst(ctx, graph, candidate.name);
          const edgesSeq = getNode(candidateAst.map, 'edges');
          if (isSeq(edgesSeq)) {
            edits.push(...removeSequenceItem(ctx, candidateAst.map, 'edges', edgesSeq, index));
          }
        });
      }

      if (ctx.graphSeq.items.length <= 1) {
        const pair = getPair(ctx.proto, 'graph');
        if (pair) {
          const valueSpan = spanOf(pair.value as Node, ctx.lines);
          if (valueSpan) {
            edits.push(edit(valueSpan.start, valueSpan.end, '[]'));
          }
        }
      } else {
        const item = ctx.graphSeq.items[model.yamlIndex] as Node | undefined;
        const span = spanOf(item, ctx.lines);
        if (!span) throw new EditFailure(`Could not locate node "${operation.node}".`);
        edits.push(edit(ctx.lines.lineStart(span.line), ctx.lines.lineEndWithNewline(span.endLine), ''));
      }

      message = removedIncoming.length
        ? `Deleted node "${operation.node}" and ${removedIncoming.length} incoming edge(s).`
        : `Deleted node "${operation.node}".`;
      break;
    }

    case 'addEdge': {
      if (!graph.nodes.some((node) => node.name === operation.to)) {
        throw new EditFailure(`Target node "${operation.to}" does not exist.`);
      }
      if (!operation.from || !operation.to) throw new EditFailure('Both edge endpoints are required.');
      const from = nodeAst(ctx, graph, operation.from);
      edits = insertSequenceItem(ctx, from, 'edges', (dash, content) =>
        renderEdge(operation.to, operation.steps, dash, content),
      );
      message = `Added edge "${operation.from}" → "${operation.to}".`;
      break;
    }

    case 'deleteEdge': {
      const { edgesSeq } = edgeAst(ctx, graph, operation.from, operation.edgeIndex);
      const node = nodeAst(ctx, graph, operation.from);
      edits = removeSequenceItem(ctx, node.map, 'edges', edgesSeq, operation.edgeIndex);
      message = `Deleted edge "${operation.from}" → "${operation.to}".`;
      break;
    }

    case 'addStep': {
      const { edge } = edgeAst(ctx, graph, operation.from, operation.edgeIndex);
      edits = insertSequenceItem(ctx, edge, 'steps', (dash) => renderStep(operation.step, dash));
      message = 'Added a construction step.';
      break;
    }

    case 'removeStep': {
      const { edge } = stepAst(ctx, graph, operation.from, operation.edgeIndex, operation.stepIndex);
      const stepsSeq = getNode(edge.map, 'steps');
      if (!isSeq(stepsSeq)) throw new EditFailure('This edge has no steps list.');
      edits = removeSequenceItem(ctx, edge.map, 'steps', stepsSeq, operation.stepIndex);
      message = 'Removed a construction step.';
      break;
    }

    case 'setStepField': {
      const { step } = stepAst(ctx, graph, operation.from, operation.edgeIndex, operation.stepIndex);
      const field = operation.field.trim();
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)) {
        throw new EditFailure(`"${field}" is not a valid YAML field name.`);
      }
      const value =
        operation.value == null ||
        operation.value === '' ||
        (Array.isArray(operation.value) && operation.value.length === 0)
          ? null
          : Array.isArray(operation.value)
            ? `[${operation.value.map((item) => formatScalar(item)).join(', ')}]`
            : formatScalar(operation.value);
      edits = setMapField(ctx, step, field, value);
      message = `Updated step field "${field}".`;
      break;
    }

    case 'addTaggedEntry': {
      const { parent, key } = taggedScopeMap(ctx, graph, operation);
      edits = insertSequenceItem(ctx, parent, key, (dash) =>
        renderTaggedEntry(operation.entryType, operation.fields ?? {}, dash),
      );
      message = `Added !type:${operation.entryType.replace(/^!type:/, '')}.`;
      break;
    }

    case 'removeTaggedEntry': {
      const { parent, key, seq } = taggedScopeMap(ctx, graph, operation);
      if (!seq) throw new EditFailure(`This ${key} list does not exist.`);
      edits = removeSequenceItem(ctx, parent.map, key, seq, operation.entryIndex);
      message = 'Removed entry.';
      break;
    }

    default:
      throw new EditFailure('Unsupported operation.');
  }

  return { edits, message };
}

export function applyGraphOperation(
  graph: ConstructionGraph,
  operation: GraphOperation,
): OperationResult {
  return applyOperation(graph, operation);
}

/** Apply edits to a string. Used by tests and by the Rider host. */
export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = source;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const change of sorted) {
    if (change.end > lastStart) {
      throw new Error('Overlapping text edits.');
    }
    result = result.slice(0, change.start) + change.text + result.slice(change.end);
    lastStart = change.start;
  }
  return result;
}

export function renderGraphTemplate(options: {
  id: string;
  start: string;
  entity?: string;
}): string {
  const id = options.id.trim();
  const start = options.start.trim() || 'start';
  const entity = options.entity?.trim();
  const lines = [
    '- type: constructionGraph',
    `  id: ${formatScalar(id)}`,
    `  start: ${formatScalar(start)}`,
    '  graph:',
    `  - node: ${formatScalar(start)}`,
  ];
  if (entity) lines.push(`    entity: ${formatScalar(entity)}`);
  lines.push('    edges: []', '');
  return lines.join('\n');
}

export { EditFailure };
