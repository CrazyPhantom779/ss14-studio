/**
 * The framework-agnostic construction graph model.
 *
 * Everything in this package is intentionally free of VS Code, Node and DOM
 * dependencies so it can be reused by the Rider plugin and a standalone UI.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface SourceSpan {
  /** Byte offset into the source string. */
  start: number;
  /** Byte offset into the source string. */
  end: number;
  /** 1-based line. */
  line: number;
  /** 1-based line. */
  endLine: number;
}

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  line: number;
  span?: SourceSpan;
  node?: string;
  edge?: { from: string; to: string; index: number };
  stepIndex?: number;
}

export type StepKind =
  | 'material'
  | 'tool'
  | 'tag'
  | 'multipleTags'
  | 'component'
  | 'temperature'
  | 'partAssembly'
  | 'unknown';

export interface TaggedEntry {
  type: string | null;
  fields: Record<string, unknown>;
  span: SourceSpan;
  fieldSpans: Record<string, SourceSpan>;
  raw: string;
}

export interface ConstructionStep {
  kind: StepKind;
  typeName: string;
  fields: Record<string, unknown>;
  doAfter: number | null;
  completed: TaggedEntry[];
  span: SourceSpan;
  fieldSpans: Record<string, SourceSpan>;
  raw: string;
}

export interface ConstructionEdge {
  target: string;
  targetSpan: SourceSpan;
  steps: ConstructionStep[];
  conditions: TaggedEntry[];
  completed: TaggedEntry[];
  span: SourceSpan;
  line: number;
}

export interface ConstructionNode {
  name: string;
  nameSpan: SourceSpan;
  entity: string | null;
  entitySpan: SourceSpan | null;
  /** Tag when entity uses the mapping form, e.g. BoardNodeEntity. */
  entityType: string | null;
  actions: TaggedEntry[];
  transforms: TaggedEntry[];
  doNotReplaceInheritingEntities: boolean;
  edges: ConstructionEdge[];
  span: SourceSpan;
  line: number;
  /** Index inside the YAML graph sequence. Used for stable edits. */
  yamlIndex: number;
}

export interface MaterialUse {
  material: string;
  amount: number;
  edges: number;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  steps: number;
  actions: number;
  conditions: number;
  materials: MaterialUse[];
  totalDoAfter: number;
  maxDepth: number;
}

export interface ConstructionGraph {
  /** Stable key: file key + graph id. */
  key: string;
  id: string;
  idSpan: SourceSpan;
  start: string;
  startSpan: SourceSpan | null;
  nodes: ConstructionNode[];
  span: SourceSpan;
  line: number;
  source: string;
  filePath: string;
  relativePath: string;
  documentIndex: number;
  diagnostics: Diagnostic[];
  stats: GraphStats;
}

export interface ParsedGraphFile {
  filePath: string;
  relativePath: string;
  source: string;
  graphs: ConstructionGraph[];
  diagnostics: Diagnostic[];
}

export interface GraphSummary {
  key: string;
  id: string;
  filePath: string;
  relativePath: string;
  folder: string;
  line: number;
  nodes: number;
  edges: number;
  errors: number;
  warnings: number;
}

export interface ProjectRootInfo {
  name: string;
  path: string;
}

export interface ProjectInfo {
  roots: ProjectRootInfo[];
  totalGraphs: number;
  totalNodes: number;
  totalEdges: number;
  errors: number;
  warnings: number;
  scanDurationMs: number;
  scannedFiles: number;
  skipped: boolean;
}

export interface TagUsage {
  type: string;
  actions: number;
  conditions: number;
}

export interface IndexPayload {
  summaries: GraphSummary[];
  project: ProjectInfo;
  knownTags: TagUsage[];
}

export interface NodePosition {
  x: number;
  y: number;
}

export type LayoutMap = Record<string, NodePosition>;

export interface PersistedLayout {
  positions: LayoutMap;
  zoom?: number;
}

export interface GraphView extends ConstructionGraph {
  readOnly: boolean;
}

/** Basic metadata the extension sends down once. */
export interface StudioConfig {
  entityIcons: boolean;
  showGrid: boolean;
  animations: boolean;
  blueprintIntensity: 'subtle' | 'balanced' | 'bold';
}

/* ------------------------------------------------------------------ */
/* Editing protocol                                                    */
/* ------------------------------------------------------------------ */

export type StepFieldValue =
  | string
  | number
  | boolean
  | string[]
  | null
  | undefined;

export interface StepInput {
  kind: StepKind | 'none';
  fields: Record<string, StepFieldValue>;
}

export type TaggedScope =
  | 'nodeActions'
  | 'nodeTransforms'
  | 'edgeConditions'
  | 'edgeCompleted'
  | 'stepCompleted';

export type GraphOperation =
  | { kind: 'renameNode'; node: string; newName: string }
  | { kind: 'setNodeEntity'; node: string; entity: string | null }
  | {
      kind: 'setNodeFlag';
      node: string;
      field: 'doNotReplaceInheritingEntities';
      value: boolean;
    }
  | { kind: 'addNode'; name: string; entity?: string | null }
  | { kind: 'deleteNode'; node: string }
  | { kind: 'addEdge'; from: string; to: string; steps: StepInput[] }
  | { kind: 'deleteEdge'; from: string; to: string; edgeIndex: number }
  | { kind: 'addStep'; from: string; to: string; edgeIndex: number; step: StepInput }
  | {
      kind: 'removeStep';
      from: string;
      to: string;
      edgeIndex: number;
      stepIndex: number;
    }
  | {
      kind: 'setStepField';
      from: string;
      to: string;
      edgeIndex: number;
      stepIndex: number;
      field: string;
      value: string | number | boolean | string[] | null;
    }
  | {
      kind: 'addTaggedEntry';
      scope: TaggedScope;
      node?: string;
      from?: string;
      to?: string;
      edgeIndex?: number;
      stepIndex?: number;
      entryType: string;
      fields?: Record<string, string | number | boolean>;
    }
  | {
      kind: 'removeTaggedEntry';
      scope: TaggedScope;
      node?: string;
      from?: string;
      to?: string;
      edgeIndex?: number;
      stepIndex?: number;
      entryIndex: number;
    };

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export interface OperationResult {
  edits: TextEdit[];
  message: string;
}

export interface EditResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/* ------------------------------------------------------------------ */
/* Webview protocol                                                    */
/* ------------------------------------------------------------------ */

export interface CreateGraphOptions {
  id: string;
  path: string;
  start: string;
  entity?: string;
  folder?: string;
}

export type HostMessage =
  | { type: 'ready' }
  | { type: 'index'; payload: IndexPayload }
  | { type: 'graph'; graph: GraphView | null; reason?: 'open' | 'update' | 'created' }
  | { type: 'graphMissing'; key: string; message: string }
  | { type: 'layout'; key: string; layout: PersistedLayout | null }
  | { type: 'editResult'; requestId: number; result: EditResult }
  | { type: 'operationResult'; requestId: number; result: EditResult }
  | { type: 'toast'; level: 'info' | 'warn' | 'error' | 'success'; message: string }
  | { type: 'readyState'; readOnly: boolean; config: StudioConfig }
  | { type: 'entityIcon'; entityId: string; uri: string | null }
  | { type: 'indexProgress'; message: string; done: number; total: number }
  | { type: 'theme'; kind: 'dark' | 'light' | 'high-contrast' };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'requestIndex' }
  | { type: 'openGraph'; key: string }
  | { type: 'openDashboard' }
  | { type: 'openSource'; key: string; line?: number; node?: string; edgeIndex?: number }
  | { type: 'openFile'; uri: string }
  | { type: 'saveLayout'; key: string; layout: PersistedLayout }
  | { type: 'applyOperation'; requestId: number; key: string; operation: GraphOperation }
  | { type: 'createGraph'; requestId: number; options: CreateGraphOptions }
  | { type: 'refreshIndex' }
  | { type: 'requestEntityIcon'; entityId: string }
  | { type: 'copyText'; text: string }
  | { type: 'openSettings' }
  | { type: 'openDocs' };
