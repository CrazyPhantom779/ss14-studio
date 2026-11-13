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

/** Visual and behavioural settings shared by every studio surface. */
export interface StudioConfig {
  entityIcons: boolean;
  showGrid: boolean;
  animations: boolean;
  blueprintIntensity: 'subtle' | 'balanced' | 'bold';
  /** Graph-only display options. */
  graphSprites: boolean;
  graphEntityIds: boolean;
  graphStats: boolean;
  graphEdgeSteps: boolean;
  graphMinimap: boolean;
  graphLegend: boolean;
  graphControls: boolean;
  graphPathHighlight: boolean;
  graphCompact: boolean;
  graphEdgeStyle: 'bezier' | 'step' | 'straight';
  graphNodeAccent: 'hash' | 'kind' | 'mono';
  /** Prototype explorer display options. */
  prototypeCompact: boolean;
  prototypeShowResolved: boolean;
  /** Open a side preview when a matching editor becomes active. */
  autoSidePreview: boolean;
  /** Whether SS14 Studio is registered as the preferred editor for graphs. */
  defaultGraphEditor: boolean;
}

/* ------------------------------------------------------------------ */
/* Prototype model                                                     */
/* ------------------------------------------------------------------ */

export interface SpriteInfo {
  /** Resource path beginning with Textures/, without a leading slash. */
  rsi: string | null;
  /** State name inside the RSI. */
  state: string | null;
  /** Layer state, when the sprite is composed from layers. */
  layerState?: string | null;
  color?: string | null;
  scale?: number | null;
  /** Component the sprite was read from, usually Sprite or Icon. */
  component?: string;
  /** Resource path for a non-RSI texture (e.g. icon PNG). */
  texture?: string | null;
}

export interface PrototypeComponent {
  type: string;
  fields: Record<string, unknown>;
  /** Prototype id that last contributed this component. */
  sourceId: string;
  sourceFile: string;
  /** Every prototype that contributed a field to this component. */
  contributors: string[];
  fieldOrigins: Record<string, string>;
  tags: string[];
  /** Fields explicitly overridden by the prototype itself. */
  ownFields: string[];
  inherited: boolean;
}

export interface RawPrototypeComponent {
  type: string;
  fields: Record<string, unknown>;
  tag: string | null;
  operation: 'remove' | 'clear' | 'index' | 'combineIndex' | null;
  operationIndex: number | null;
}

export interface PartialMark {
  partial: boolean;
  only: boolean;
  index: number | null;
  tag: string | null;
}

export interface RawPrototype {
  key: string;
  kind: string;
  id: string;
  abstract: boolean;
  parents: string[];
  fields: Record<string, unknown>;
  fieldTags: Record<string, string>;
  components: RawPrototypeComponent[];
  span: SourceSpan;
  idSpan: SourceSpan | null;
  typeSpan: SourceSpan | null;
  line: number;
  filePath: string;
  relativePath: string;
  documentIndex: number;
  partial: PartialMark;
  /** Tags found on the prototype mapping itself. */
  tags: string[];
  /** Variant ids generated from a CreateVariants id node. */
  variants: string[];
}

export interface PrototypeFileDiagnostic extends Diagnostic {
  filePath?: string;
}

export interface ParsedPrototypeFile {
  filePath: string;
  relativePath: string;
  source: string;
  prototypes: RawPrototype[];
  diagnostics: PrototypeFileDiagnostic[];
}

export interface ResolvedField {
  key: string;
  value: unknown;
  sourceId: string;
  sourceFile: string;
  inherited: boolean;
  /** Values the field shadows from parent prototypes. */
  overridden: { sourceId: string; value: unknown }[];
}

export interface ResolvedPrototype {
  key: string;
  id: string;
  kind: string;
  abstract: boolean;
  parents: string[];
  fields: Record<string, unknown>;
  resolvedFields: ResolvedField[];
  components: PrototypeComponent[];
  name: string;
  description: string | null;
  suffix: string | null;
  sprite: SpriteInfo | null;
  sourceId: string;
  sourceFile: string;
  filePath: string;
  relativePath: string;
  line: number;
  partials: string[];
  diagnostics: Diagnostic[];
}

export interface PrototypeSummary {
  key: string;
  id: string;
  kind: string;
  abstract: boolean;
  name: string;
  description: string | null;
  parents: string[];
  filePath: string;
  relativePath: string;
  line: number;
  componentCount: number;
  sprite: SpriteInfo | null;
  partial: boolean;
  children: number;
}

export interface PrototypeKindStat {
  kind: string;
  count: number;
  abstract: number;
}

export interface PrototypeIndexPayload {
  summaries: PrototypeSummary[];
  kinds: PrototypeKindStat[];
  total: number;
  errors: number;
  warnings: number;
  duplicates: number;
  localizationCount: number;
  partialFiles: string[];
  scanDurationMs: number;
}

export interface InheritanceNode {
  id: string;
  kind: string;
  abstract: boolean;
  missing: boolean;
  name: string;
  parents: InheritanceNode[];
}

export interface PartialContribution {
  id: string;
  kind: string;
  filePath: string;
  relativePath: string;
  line: number;
  only: boolean;
  index: number | null;
  tag: string | null;
  fields: string[];
  components: string[];
  tags: string[];
}

export interface PrototypeView {
  key: string;
  summary: PrototypeSummary;
  resolved: ResolvedPrototype;
  inheritance: InheritanceNode;
  children: PrototypeSummary[];
  partials: PartialContribution[];
  diagnostics: Diagnostic[];
}

export interface LocalizationEntry {
  id: string;
  value: string;
  filePath: string;
}

export type PrototypeOperation =
  | { kind: 'setField'; id: string; field: string; value: string | number | boolean | null }
  | { kind: 'addComponent'; id: string; component: string; fields?: Record<string, unknown> }
  | { kind: 'removeComponent'; id: string; component: string }
  | { kind: 'setComponentField'; id: string; component: string; field: string; value: string | number | boolean | null }
  | { kind: 'extractPartial'; id: string; fields: string[]; components: string[] };

/* ------------------------------------------------------------------ */
/* RSI model                                                           */
/* ------------------------------------------------------------------ */

export interface RsiStateMeta {
  name: string;
  directions: number;
  /** One array of per-frame delays per direction, in seconds. */
  delays: number[][];
  flags?: Record<string, unknown>;
}

export interface RsiMeta {
  version?: number;
  license?: string;
  copyright?: string;
  size?: { x: number; y: number };
  load?: { srgb?: string };
  metaAtlas?: boolean;
  rsic?: boolean;
  states: RsiStateMeta[];
  /** Any other keys found in meta.json. */
  extra?: Record<string, unknown>;
}

export interface RsiImageInfo {
  /** State PNG path relative to the RSI directory. */
  path: string;
  exists: boolean;
  width: number;
  height: number;
  /** Data URL used by the webview preview. */
  uri: string | null;
}

export interface RsiStateView extends RsiStateMeta {
  frameCount: number;
  directionFrames: number[];
  totalDuration: number;
  image: RsiImageInfo;
  /** Columns in the state sheet, derived from image width. */
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  /** Frame indices per direction, flattened row-major. */
  directionIndices: number[][];
  missing: boolean;
}

export interface RsiView {
  dirPath: string;
  relativePath: string;
  metaPath: string;
  meta: RsiMeta;
  states: RsiStateView[];
  diagnostics: Diagnostic[];
  license: string | null;
  copyright: string | null;
  metaAtlas: boolean;
  rsic: boolean;
  size: { x: number; y: number };
  /** Unreferenced PNG files found in the RSI directory. */
  orphanImages: string[];
}

export type RsiOperation =
  | { kind: 'setMeta'; field: 'license' | 'copyright' | 'metaAtlas' | 'rsic' | 'version'; value: string | number | boolean | null }
  | { kind: 'setSize'; width: number; height: number }
  | { kind: 'addState'; state: RsiStateMeta }
  | { kind: 'removeState'; state: string }
  | { kind: 'renameState'; state: string; name: string }
  | { kind: 'setDirections'; state: string; directions: number }
  | { kind: 'setDelays'; state: string; delays: number[][] }
  | { kind: 'setFrameDelay'; state: string; direction: number; frame: number; delay: number }
  | { kind: 'addFrame'; state: string; afterDirection?: number }
  | { kind: 'removeFrame'; state: string; direction: number; frame: number }
  | { kind: 'duplicateFrame'; state: string; direction: number; frame: number }
  | { kind: 'cleanup' };

export interface RsiOperationResult {
  meta: RsiMeta;
  changed: boolean;
  message: string;
  /** Changes that require the user to confirm, such as removing PNG files. */
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* XAML model                                                          */
/* ------------------------------------------------------------------ */

export interface XamlAttribute {
  name: string;
  value: string;
  span: SourceSpan;
}

export interface XamlElement {
  name: string;
  prefix: string | null;
  namespace: string | null;
  attributes: XamlAttribute[];
  children: XamlElement[];
  text: string;
  span: SourceSpan;
  startTagSpan: SourceSpan;
  endTagSpan: SourceSpan | null;
  selfClosing: boolean;
  /** x:Name / Name attribute. */
  xname: string | null;
  /** Event handlers declared in attributes, e.g. OnPressed="OnPressed". */
  events: { event: string; handler: string }[];
}

export interface XamlDiagnostic extends Diagnostic {
  element?: string;
}

export interface XamlDesignNode {
  id: string;
  name: string;
  className: string;
  width: string | null;
  height: string | null;
  orientation: 'horizontal' | 'vertical' | null;
  stretch: boolean;
  text: string | null;
  tooltip: string | null;
  style: {
    margin?: string;
    padding?: string;
    color?: string;
    background?: string;
    border?: string;
    align?: string;
    justify?: string;
    columns?: number;
    rows?: number;
  };
  children: XamlDesignNode[];
}

export interface XamlView {
  filePath: string;
  relativePath: string;
  source: string;
  root: XamlElement | null;
  className: string | null;
  codeBehindPath: string | null;
  codeBehindExists: boolean;
  codeBehindHandlers: string[];
  outline: { name: string; depth: number; xname: string | null; line: number }[];
  diagnostics: XamlDiagnostic[];
  completions: XamlCompletion[];
  design: XamlDesignNode | null;
  autoGenerated: boolean;
}

export interface XamlCompletion {
  label: string;
  kind: 'control' | 'property' | 'namespace' | 'event';
  detail?: string;
  insertText?: string;
}

export type XamlOperation =
  | { kind: 'format' }
  | { kind: 'cleanup' }
  | { kind: 'markAutoGenerated' }
  | { kind: 'removeAutoGenerated' };

/* ------------------------------------------------------------------ */
/* Diff model                                                          */
/* ------------------------------------------------------------------ */

export interface DiffLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffPayload {
  title: string;
  oldLabel: string;
  newLabel: string;
  oldText?: string;
  newText?: string;
  hunks: DiffHunk[];
  added: number;
  removed: number;
  identical: boolean;
  /** True when either side still contains Git merge conflict markers. */
  conflicts?: boolean;
}

/* ------------------------------------------------------------------ */
/* Additional host protocol                                            */
/* ------------------------------------------------------------------ */

export type WorkspaceView =
  | { kind: 'dashboard' }
  | { kind: 'graph'; key: string }
  | { kind: 'prototype'; id: string; kindFilter?: string }
  | { kind: 'rsi'; path: string }
  | { kind: 'xaml'; path: string }
  | { kind: 'diff'; payload: DiffPayload }
  | { kind: 'about' };

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
  | {
      type: 'entityIcon';
      entityId: string;
      uri: string | null;
      sheet?: {
        width: number;
        height: number;
        frameWidth: number;
        frameHeight: number;
        columns: number;
      };
    }
  | { type: 'indexProgress'; message: string; done: number; total: number }
  | { type: 'theme'; kind: 'dark' | 'light' | 'high-contrast' }
  | { type: 'prototypes'; payload: PrototypeIndexPayload }
  | { type: 'prototype'; view: PrototypeView | null; message?: string }
  | { type: 'rsi'; view: RsiView | null; message?: string }
  | { type: 'xaml'; view: XamlView | null; message?: string }
  | { type: 'diff'; payload: DiffPayload }
  | { type: 'view'; view: WorkspaceView }
  | { type: 'selection'; text: string }
  | { type: 'settings'; config: StudioConfig };

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
  | { type: 'openDocs' }
  | { type: 'openPrototype'; id: string; kind?: string }
  | { type: 'openRsi'; path: string }
  | { type: 'openXaml'; path: string }
  | { type: 'pickRsi' }
  | { type: 'pickXaml' }
  | { type: 'openPath'; path: string; line?: number }
  | { type: 'openAbout' }
  | { type: 'requestDiff'; title: string; oldText: string; newText: string; oldLabel?: string; newLabel?: string }
  | { type: 'applyPrototypeOperation'; requestId: number; filePath: string; operation: PrototypeOperation }
  | { type: 'applyRsiOperation'; requestId: number; path: string; operation: RsiOperation }
  | { type: 'applyXamlOperation'; requestId: number; filePath: string; operation: XamlOperation }
  | { type: 'saveRsiPng'; requestId: number; path: string; state: string; dataUrl: string; frameIndex?: number }
  | { type: 'importRsiFrames'; requestId: number; path: string; state: string }
  | { type: 'deleteRsiImage'; requestId: number; path: string; state: string }
  | { type: 'saveConfig'; config: Partial<StudioConfig> }
  | { type: 'revealSetting'; setting: string }
  | { type: 'openCodeBehind'; filePath: string }
  | { type: 'runXamlCleanup'; filePath: string };
