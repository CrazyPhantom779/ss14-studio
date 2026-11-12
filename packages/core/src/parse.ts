import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Node,
  type YAMLMap,
} from 'yaml';
import { computeGraphStats } from './analyze.js';
import type {
  ConstructionEdge,
  ConstructionGraph,
  ConstructionNode,
  ConstructionStep,
  Diagnostic,
  ParsedGraphFile,
  StepKind,
  TaggedEntry,
} from './model.js';
import { validateGraph } from './validate.js';
import {
  LineIndex,
  booleanValue,
  getNode,
  getPair,
  mappingFields,
  numberValue,
  rawOf,
  scalarFieldSpans,
  sequenceItems,
  spanOf,
  stringValue,
  tagType,
} from './yaml.js';

export interface ParseFileOptions {
  filePath: string;
  relativePath: string;
  /** Usually the URI string. Used to build stable graph keys. */
  fileKey?: string;
}

interface ParseContext {
  source: string;
  lines: LineIndex;
  document: Document.Parsed;
  filePath: string;
  relativePath: string;
  fileKey: string;
  diagnostics: Diagnostic[];
}

/**
 * Resolve YAML anchors/aliases while keeping the original node for formatting.
 * SS14 graph files commonly reuse step and edge sequences with `*anchor`.
 */
function resolveNode(
  ctx: ParseContext,
  node: Node | null | undefined,
  seen = new Set<Node>(),
): Node | null {
  if (!node) return null;
  if (!isAlias(node)) return node;
  if (seen.has(node)) return null;
  seen.add(node);
  let resolved: Node | null | undefined;
  try {
    resolved = node.resolve(ctx.document) as Node | undefined;
  } catch {
    return null;
  }
  return resolved ? resolveNode(ctx, resolved, seen) : null;
}

function push(
  ctx: ParseContext,
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  node?: Node | null,
  extra?: Partial<Diagnostic>,
): void {
  const span = node ? spanOf(node, ctx.lines) : null;
  ctx.diagnostics.push({
    severity,
    code,
    message,
    line: span?.line ?? 1,
    ...(span ? { span } : {}),
    ...extra,
  });
}

function parseTaggedEntry(
  ctx: ParseContext,
  input: Node,
  scope: string,
): TaggedEntry | null {
  const node = resolveNode(ctx, input);
  if (!node) return null;
  const span = spanOf(node, ctx.lines);
  if (!span) return null;

  let type: string | null = null;
  let fields: Record<string, unknown> = {};
  let fieldSpans: Record<string, ReturnType<typeof scalarFieldSpans>[string]> = {};

  if (isMap(node)) {
    type = tagType(node.tag);
    fields = mappingFields(node);
    fieldSpans = scalarFieldSpans(node, ctx.lines);
  } else if (isScalar(node)) {
    type = tagType(node.tag);
    if (node.value != null && node.value !== '') fields.value = node.value;
  } else if (isSeq(node)) {
    type = tagType(node.tag);
    fields = { items: sequenceItems(node).map((item) => mappingFields(item as YAMLMap)) };
  }

  if (!type) {
    push(
      ctx,
      'warning',
      'entry.untyped',
      `Entry in ${scope} has no !type tag.`,
      node,
    );
  }

  return {
    type,
    fields,
    span,
    fieldSpans,
    raw: rawOf(node, ctx.source),
  };
}

function parseTaggedSeq(
  ctx: ParseContext,
  input: Node | null,
  scope: string,
): TaggedEntry[] {
  const entries: TaggedEntry[] = [];
  const node = resolveNode(ctx, input);
  for (const item of sequenceItems(node)) {
    const entry = parseTaggedEntry(ctx, item, scope);
    if (entry) entries.push(entry);
  }
  return entries;
}

const STEP_TYPES: Record<
  Exclude<StepKind, 'unknown'>,
  { typeName: string; keys: string[] }
> = {
  material: {
    typeName: 'MaterialConstructionGraphStep',
    keys: ['material'],
  },
  tool: {
    typeName: 'ToolConstructionGraphStep',
    keys: ['tool'],
  },
  component: {
    typeName: 'ComponentConstructionGraphStep',
    keys: ['component'],
  },
  tag: {
    typeName: 'TagConstructionGraphStep',
    keys: ['tag'],
  },
  multipleTags: {
    typeName: 'MultipleTagsConstructionGraphStep',
    keys: ['allTags', 'anyTags'],
  },
  temperature: {
    typeName: 'TemperatureConstructionGraphStep',
    keys: ['minTemperature', 'maxTemperature'],
  },
  partAssembly: {
    typeName: 'PartAssemblyConstructionGraphStep',
    keys: ['assemblyId', 'guideString'],
  },
};

function detectStepKind(fields: Record<string, unknown>): StepKind {
  for (const [kind, info] of Object.entries(STEP_TYPES)) {
    if (info.keys.some((key) => key in fields)) return kind as StepKind;
  }
  return 'unknown';
}

function parseStep(ctx: ParseContext, input: Node): ConstructionStep | null {
  const node = resolveNode(ctx, input);
  if (!node) return null;
  const span = spanOf(node, ctx.lines);
  if (!span) return null;
  if (!isMap(node)) {
    push(ctx, 'warning', 'step.invalid', 'Construction step is not a mapping.', node);
    return {
      kind: 'unknown',
      typeName: 'UnknownConstructionGraphStep',
      fields: {},
      doAfter: null,
      completed: [],
      span,
      fieldSpans: {},
      raw: rawOf(node, ctx.source),
    };
  }

  const fields = mappingFields(node);
  const kind = detectStepKind(fields);
  const completed = parseTaggedSeq(ctx, getNode(node, 'completed'), 'step completed');
  const doAfterValue = fields.doAfter;
  const doAfter =
    typeof doAfterValue === 'number'
      ? doAfterValue
      : doAfterValue != null && Number.isFinite(Number(doAfterValue))
        ? Number(doAfterValue)
        : null;

  return {
    kind,
    typeName: kind === 'unknown' ? 'UnknownConstructionGraphStep' : STEP_TYPES[kind].typeName,
    fields,
    doAfter,
    completed,
    span,
    fieldSpans: scalarFieldSpans(node, ctx.lines),
    raw: rawOf(node, ctx.source),
  };
}

function parseEdge(ctx: ParseContext, input: Node, from: string, index: number): ConstructionEdge | null {
  const node = resolveNode(ctx, input);
  if (!node) return null;
  const span = spanOf(node, ctx.lines);
  if (!span) return null;
  if (!isMap(node)) {
    push(ctx, 'error', 'edge.invalid', 'Edge is not a mapping.', node, { node: from });
    return null;
  }

  const targetNode = resolveNode(ctx, getNode(node, 'to'));
  const target = stringValue(targetNode);
  if (!target) {
    push(ctx, 'error', 'edge.target.empty', 'Edge has no target.', node, { node: from });
    return null;
  }

  const steps: ConstructionStep[] = [];
  for (const stepNode of sequenceItems(resolveNode(ctx, getNode(node, 'steps')))) {
    const step = parseStep(ctx, stepNode);
    if (step) steps.push(step);
  }

  return {
    target,
    targetSpan: spanOf(targetNode, ctx.lines) ?? span,
    steps,
    conditions: parseTaggedSeq(ctx, getNode(node, 'conditions'), 'edge conditions'),
    completed: parseTaggedSeq(ctx, getNode(node, 'completed'), 'edge completed'),
    span,
    line: span.line,
  };
}

function parseNode(ctx: ParseContext, input: Node, index: number): ConstructionNode | null {
  const node = resolveNode(ctx, input);
  if (!node) return null;
  const span = spanOf(node, ctx.lines);
  if (!span) return null;
  if (!isMap(node)) {
    push(ctx, 'error', 'node.invalid', 'Construction graph node is not a mapping.', node);
    return null;
  }

  const nameNode = resolveNode(ctx, getNode(node, 'node'));
  const name = stringValue(nameNode);
  if (!name) {
    push(
      ctx,
      'error',
      'node.name.empty',
      `Construction graph node at index ${index} has no name.`,
      node,
    );
    return null;
  }

  const entityNode = resolveNode(ctx, getNode(node, 'entity'));
  const entityScalar = stringValue(entityNode);
  const entityType = entityNode && isMap(entityNode) ? tagType(entityNode.tag) : null;

  const edges: ConstructionEdge[] = [];
  for (const edgeNode of sequenceItems(resolveNode(ctx, getNode(node, 'edges')))) {
    const edge = parseEdge(ctx, edgeNode, name, edges.length);
    if (edge) edges.push(edge);
  }

  return {
    name,
    nameSpan: spanOf(nameNode, ctx.lines) ?? span,
    entity: entityScalar,
    entitySpan: spanOf(entityNode, ctx.lines),
    entityType,
    actions: parseTaggedSeq(ctx, getNode(node, 'actions'), 'node actions'),
    transforms: parseTaggedSeq(ctx, getNode(node, 'transform'), 'node transforms'),
    doNotReplaceInheritingEntities: booleanValue(
      getNode(node, 'doNotReplaceInheritingEntities'),
    ),
    edges,
    span,
    line: span.line,
    yamlIndex: index,
  };
}

function parseGraphPrototype(
  ctx: ParseContext,
  node: YAMLMap<unknown, unknown>,
  documentIndex: number,
  keySuffix: string,
): ConstructionGraph | null {
  const idNode = resolveNode(ctx, getNode(node, 'id'));
  const id = stringValue(idNode);
  const span = spanOf(node, ctx.lines);
  if (!span) return null;

  if (!id) {
    push(ctx, 'error', 'graph.id.missing', 'constructionGraph is missing its id.', node);
    return null;
  }

  const startNode = resolveNode(ctx, getNode(node, 'start'));
  const start = stringValue(startNode) ?? '';
  if (!start) {
    push(ctx, 'error', 'graph.start.missing', `Graph "${id}" has no start node.`, node, {
      node: id,
    });
  }

  const graphNode = resolveNode(ctx, getNode(node, 'graph'));
  if (!graphNode) {
    push(ctx, 'error', 'graph.graph.missing', `Graph "${id}" has no graph list.`, node, {
      node: id,
    });
  } else if (!isSeq(graphNode)) {
    push(ctx, 'error', 'graph.graph.invalid', `Graph "${id}" graph field is not a list.`, graphNode, {
      node: id,
    });
  }

  const nodes: ConstructionNode[] = [];
  let yamlIndex = 0;
  for (const nodeItem of sequenceItems(graphNode)) {
    const parsed = parseNode(ctx, nodeItem, yamlIndex);
    if (parsed) nodes.push(parsed);
    yamlIndex++;
  }

  const graph: ConstructionGraph = {
    key: `${ctx.fileKey}#${id}${keySuffix}`,
    id,
    idSpan: spanOf(idNode, ctx.lines) ?? span,
    start,
    startSpan: spanOf(startNode, ctx.lines),
    nodes,
    span,
    line: span.line,
    source: ctx.source,
    filePath: ctx.filePath,
    relativePath: ctx.relativePath,
    documentIndex,
    diagnostics: [],
    stats: {
      nodes: 0,
      edges: 0,
      steps: 0,
      actions: 0,
      conditions: 0,
      materials: [],
      totalDoAfter: 0,
      maxDepth: 0,
    },
  };

  graph.diagnostics = validateGraph(graph);
  graph.stats = computeGraphStats(graph);
  return graph;
}

export function parseGraphFile(source: string, options: ParseFileOptions): ParsedGraphFile {
  const normalizedSource =
    source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = new LineIndex(normalizedSource);
  const fileKey = options.fileKey ?? options.filePath;

  const result: ParsedGraphFile = {
    filePath: options.filePath,
    relativePath: options.relativePath,
    source: normalizedSource,
    graphs: [],
    diagnostics: [],
  };

  let document;
  try {
    document = parseDocument(normalizedSource, {
      keepSourceTokens: true,
      prettyErrors: false,
      strict: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.diagnostics.push({
      severity: 'error',
      code: 'yaml.parse',
      message: `Could not parse YAML: ${message}`,
      line: 1,
    });
    return result;
  }

  for (const error of document.errors) {
    const line = error.linePos?.[0]?.line ?? 1;
    result.diagnostics.push({
      severity: 'error',
      code: 'yaml.parse',
      message: error.message,
      line,
    });
  }

  const ctx: ParseContext = {
    source: normalizedSource,
    lines,
    document,
    filePath: options.filePath,
    relativePath: options.relativePath,
    fileKey,
    diagnostics: [],
  };

  const root = resolveNode(ctx, document.contents as Node | null);
  const candidates: Node[] = isSeq(root) ? (root.items as Node[]) : root ? [root] : [];
  const seenIDs = new Map<string, number>();

  candidates.forEach((candidate, documentIndex) => {
    if (!isMap(candidate)) return;
    const type = stringValue(getNode(candidate, 'type'));
    if (type !== 'constructionGraph') return;

    const id = stringValue(getNode(candidate, 'id')) ?? '';
    const seen = seenIDs.get(id) ?? 0;
    seenIDs.set(id, seen + 1);
    const keySuffix = seen === 0 ? '' : `~${seen + 1}`;

    const graph = parseGraphPrototype(ctx, candidate, documentIndex, keySuffix);
    if (graph) result.graphs.push(graph);
  });

  result.diagnostics.push(...ctx.diagnostics);
  return result;
}

/** Pull every tag used by construction graph actions and conditions. */
export function collectTagUsage(graphs: ConstructionGraph[]): Map<string, { actions: number; conditions: number }> {
  const usage = new Map<string, { actions: number; conditions: number }>();
  const bump = (type: string | null, key: 'actions' | 'conditions') => {
    if (!type) return;
    const entry = usage.get(type) ?? { actions: 0, conditions: 0 };
    entry[key]++;
    usage.set(type, entry);
  };

  for (const graph of graphs) {
    for (const node of graph.nodes) {
      for (const action of node.actions) bump(action.type, 'actions');
      for (const transform of node.transforms) bump(transform.type, 'actions');
      for (const edge of node.edges) {
        for (const condition of edge.conditions) bump(condition.type, 'conditions');
        for (const action of edge.completed) bump(action.type, 'actions');
        for (const step of edge.steps) {
          for (const action of step.completed) bump(action.type, 'actions');
        }
      }
    }
  }

  return usage;
}

/** True when a file contains the token at all, before paying for a full parse. */
export function mayContainConstructionGraph(source: string): boolean {
  return source.includes('constructionGraph');
}

export { getPair, isMap, isScalar, isSeq };
