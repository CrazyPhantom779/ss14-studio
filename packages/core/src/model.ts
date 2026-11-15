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
  /** Spaces per indentation level when formatting XAML. */
  xamlIndentSize: number;
  /** Spaces per indentation level when writing RSI meta.json. */
  rsiMetaIndent: number;
  /** Include a trailing newline when writing RSI meta.json. */
  rsiMetaFinalNewline: boolean;
}

/* ------------------------------------------------------------------ */
/* Prototype model                                                     */
/* ------------------------------------------------------------------ */

export interface SpriteLayerInfo {
  /** Zero-based layer index inside the Sprite component. */
  index: number;
  /** Resource path beginning with Textures/, without a leading slash. */
  rsi: string | null;
  /** State name inside the RSI. */
  state: string | null;
  /** Resource path for a non-RSI texture (e.g. a direct PNG). */
  texture: string | null;
  color: string | null;
  scale: number | null;
  offset: { x: number; y: number } | null;
  visible: boolean;
  map: string | null;
  /** Raw layer mapping, preserved for editing. */
  fields: Record<string, unknown>;
}

export interface SpriteInfo {
  /** Resource path beginning with Textures/, without a leading slash. */
  rsi: string | null;
  /** State name inside the RSI. */
  state: string | null;
  /** Layer state, when the sprite is composed from layers. */
  layerState?: string | null;
  color?: string | null;
  scale?: number | null;
  offset?: { x: number; y: number } | null;
  rotation?: number | null;
  visible?: boolean;
  /** Component the sprite was read from, usually Sprite or Icon. */
  component?: string;
  /** Resource path for a non-RSI texture (e.g. icon PNG). */
  texture?: string | null;
  /** Resolved draw layers, including the base layer at index 0. */
  layers?: SpriteLayerInfo[];
  /** Other Sprite fields that affect rendering but are not edited directly. */
  extra?: Record<string, unknown>;
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

export interface StorageGridCell {
  /** Zero-based row-major slot index. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Original grid entry, preserved when writing. */
  raw: string;
}

export interface StorageContentInput {
  id: string;
  amount?: number;
  prob?: number;
  orGroup?: string;
  /** Extra fields on the StorageFill content entry. */
  extra?: Record<string, unknown>;
}

export interface StorageItemView extends StorageContentInput {
  /** Index in the StorageFill contents sequence. */
  index: number;
  name: string;
  /** Entity prototype kind, when it resolves. */
  kind: string | null;
  sprite: SpriteInfo | null;
  /** Approximate slot occupied in the storage grid. */
  slot: number | null;
  /** Approximate item footprint in grid cells. */
  footprint: { width: number; height: number };
}

export interface StorageView {
  component: 'Storage' | 'StorageFill' | null;
  /** True when the prototype has a Storage component. */
  hasStorage: boolean;
  /** True when the prototype has a StorageFill component. */
  hasFill: boolean;
  grid: StorageGridCell[];
  columns: number;
  rows: number;
  items: StorageItemView[];
  maxItemSize: string | null;
  capacity: number;
  diagnostics: Diagnostic[];
}

export interface PrototypeView {
  key: string;
  summary: PrototypeSummary;
  resolved: ResolvedPrototype;
  inheritance: InheritanceNode;
  children: PrototypeSummary[];
  partials: PartialContribution[];
  diagnostics: Diagnostic[];
  storage: StorageView | null;
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
  | {
      kind: 'setComponentFields';
      id: string;
      component: string;
      /** Complete field mapping for the component override. */
      fields: Record<string, unknown>;
    }
  | { kind: 'setStorageContents'; id: string; contents: StorageContentInput[] }
  | { kind: 'setStorageGrid'; id: string; grid: string[] }
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

export interface XamlImageInfo {
  /** Data URL for a texture or cropped sprite sheet. */
  uri: string;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  /** How the image should be fitted inside the control. */
  fit: 'contain' | 'cover' | 'stretch' | 'none';
  /** Source resource path or entity id, for diagnostics and links. */
  source: string | null;
  kind: 'texture' | 'entity' | 'sprite';
}

export interface XamlDesignNode {
  id: string;
  name: string;
  className: string;
  width: string | null;
  height: string | null;
  orientation: 'horizontal' | 'vertical' | null;
  stretch: boolean;
  /** Raw text or localization markup from the XAML attribute. */
  text: string | null;
  /** Resolved display text after Fluent lookup. */
  textResolved?: string | null;
  /** Fluent key when the text came from a {Loc ...} markup. */
  textKey?: string | null;
  tooltip: string | null;
  tooltipResolved?: string | null;
  /** Source line of the opening tag. */
  sourceLine?: number;
  /** Every attribute on the element, preserving unknown control properties. */
  attributes?: Record<string, string>;
  /** Resolved texture or entity sprite. */
  image?: XamlImageInfo | null;
  style: {
    margin?: string;
    padding?: string;
    color?: string;
    background?: string;
    border?: string;
    borderColor?: string;
    borderWidth?: number;
    cornerRadius?: number;
    align?: string;
    justify?: string;
    columns?: number;
    rows?: number;
    separation?: number;
    fontSize?: number;
    opacity?: number;
    /** CSS filter derived from Modulate when the colour cannot be applied directly. */
    filter?: string;
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
  codeBehindFields: { name: string; type: string }[];
  codeBehindNamespace: string | null;
  codeBehindTypes: CSharpTypeInfo[];
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

/* ------------------------------------------------------------------ */
/* C# model                                                            */
/* ------------------------------------------------------------------ */

export interface CSharpTypeInfo {
  name: string;
  kind: 'class' | 'struct' | 'record' | 'interface' | 'enum' | 'unknown';
  partial: boolean;
  baseTypes: string[];
  line: number;
  /** Namespace declared in the file. */
  namespace: string | null;
  /** File path for declarations from other files. */
  filePath?: string;
  relativePath?: string;
}

export interface CSharpFileInfo {
  filePath: string;
  relativePath: string;
  source: string;
  namespace: string | null;
  usings: string[];
  types: CSharpTypeInfo[];
  /** True when this file declares the same type as the linked XAML x:Class. */
  linkedXaml: string | null;
}

export interface CSharpPeer {
  filePath: string;
  relativePath: string;
  typeName: string;
  partial: boolean;
  line: number;
  namespace: string | null;
}

export interface CSharpView {
  filePath: string;
  relativePath: string;
  source: string;
  namespace: string | null;
  usings: string[];
  types: CSharpTypeInfo[];
  /** Other files declaring the same type name in the same namespace. */
  partialSiblings: CSharpPeer[];
  /** Other types sharing this file's namespace. */
  namespacePeers: CSharpPeer[];
  /** XAML files whose x:Class points at a type in this file. */
  linkedXaml: { filePath: string; relativePath: string; className: string }[];
  /** Files with a matching .xaml.cs suffix, if this is a code-behind file. */
  linkedCodeBehind: string | null;
  diagnostics: Diagnostic[];
}

export type WorkspaceView =
  | { kind: 'dashboard' }
  | { kind: 'graph'; key: string }
  | { kind: 'prototype'; id: string; kindFilter?: string }
  | { kind: 'rsi'; path: string }
  | { kind: 'xaml'; path: string }
  | { kind: 'csharp'; path: string }
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
      /** Resolved draw layers, base layer first. */
      layers?: {
        uri: string;
        width: number;
        height: number;
        frameWidth: number;
        frameHeight: number;
        columns: number;
        color?: string | null;
        scale?: number | null;
        offset?: { x: number; y: number } | null;
        visible?: boolean;
      }[];
    }
  | { type: 'indexProgress'; message: string; done: number; total: number }
  | { type: 'theme'; kind: 'dark' | 'light' | 'high-contrast' }
  | { type: 'prototypes'; payload: PrototypeIndexPayload }
  | { type: 'prototype'; view: PrototypeView | null; message?: string }
  | { type: 'rsi'; view: RsiView | null; message?: string }
  | { type: 'xaml'; view: XamlView | null; message?: string }
  | { type: 'csharp'; view: CSharpView | null; message?: string }
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
  | { type: 'openCSharp'; path: string }
  | { type: 'pickRsi' }
  | { type: 'pickXaml' }
  | { type: 'pickCSharp' }
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
