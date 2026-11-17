import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreateGraphOptions,
  CSharpView,
  DiffPayload,
  EditResult,
  GraphAtlas,
  GraphOperation,
  GraphView,
  HostMessage,
  IndexPayload,
  LayoutMap,
  PersistedLayout,
  PrototypeIndexPayload,
  PrototypeOperation,
  PrototypeView,
  RsiOperation,
  RsiView,
  StudioConfig,
  WorkspaceView,
  XamlOperation,
  XamlView,
} from '@ss14-studio/core';
import { post, readUiState, writeUiState } from '../vscode';
import { ensurePositions } from './layout';

export type ThemeKind = 'dark' | 'light' | 'high-contrast';
export type ToastLevel = 'info' | 'warn' | 'error' | 'success';

export interface ToastItem {
  id: number;
  level: ToastLevel;
  message: string;
}

export interface IconLayerSheet {
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
}

export interface IconSheet extends IconLayerSheet {
  /** Additional draw layers when the entity sprite is layered. */
  layers?: IconLayerSheet[];
}

interface PendingRequest {
  resolve: (result: EditResult) => void;
  timeout: number;
  notify: boolean;
}

const DEFAULT_CONFIG: StudioConfig = {
  entityIcons: true,
  showGrid: true,
  animations: true,
  blueprintIntensity: 'balanced',
  graphSprites: true,
  graphEntityIds: true,
  graphStats: true,
  graphEdgeSteps: true,
  graphMinimap: true,
  graphLegend: true,
  graphControls: true,
  graphPathHighlight: true,
  graphCompact: false,
  graphEdgeStyle: 'bezier',
  graphNodeAccent: 'hash',
  prototypeCompact: false,
  prototypeShowResolved: true,
  autoSidePreview: false,
  defaultGraphEditor: false,
  xamlIndentSize: 4,
  rsiMetaIndent: 2,
  rsiMetaFinalNewline: true,
};

export interface StudioHost {
  index: IndexPayload | null;
  prototypes: PrototypeIndexPayload | null;
  atlas: GraphAtlas | null;
  graph: GraphView | null;
  prototype: PrototypeView | null;
  rsi: RsiView | null;
  xaml: XamlView | null;
  csharp: CSharpView | null;
  diff: DiffPayload | null;
  view: WorkspaceView;
  positions: LayoutMap;
  readOnly: boolean;
  config: StudioConfig;
  theme: ThemeKind;
  openingKey: string | null;
  recent: string[];
  toasts: ToastItem[];
  icons: Record<string, IconSheet>;
  openGraph: (key: string) => void;
  openDashboard: () => void;
  openAtlas: () => void;
  openPrototype: (id: string, kind?: string) => void;
  openRsi: (path: string) => void;
  openXaml: (path: string) => void;
  openCSharp: (path: string) => void;
  pickRsi: () => void;
  pickXaml: () => void;
  pickCSharp: () => void;
  openPath: (path: string, line?: number) => void;
  openAbout: () => void;
  applyOperation: (operation: GraphOperation) => Promise<EditResult>;
  applyPrototypeOperation: (filePath: string, operation: PrototypeOperation) => Promise<EditResult>;
  applyRsiOperation: (path: string, operation: RsiOperation) => Promise<EditResult>;
  applyXamlOperation: (filePath: string, operation: XamlOperation) => Promise<EditResult>;
  saveRsiPng: (path: string, state: string, dataUrl: string, frameIndex?: number) => Promise<EditResult>;
  importRsiFrames: (path: string, state: string) => Promise<EditResult>;
  deleteRsiImage: (path: string, state: string) => Promise<EditResult>;
  createGraph: (options: CreateGraphOptions) => Promise<EditResult>;
  savePositions: (positions: LayoutMap, zoom?: number) => void;
  saveZoom: (zoom: number) => void;
  openSource: (line?: number, node?: string, edgeIndex?: number) => void;
  openPrototypeSource: (filePath: string, line?: number) => void;
  openFile: (uri: string) => void;
  openCodeBehind: (filePath: string) => void;
  refreshIndex: () => void;
  requestDiff: (title: string, oldText: string, newText: string, oldLabel?: string, newLabel?: string) => void;
  requestIcon: (entityId: string) => void;
  saveConfig: (config: Partial<StudioConfig>) => void;
  revealSetting: (setting: string) => void;
  copyText: (text: string) => void;
  openSettings: () => void;
  openDocs: () => void;
  notify: (level: ToastLevel, message: string) => void;
  dismissToast: (id: number) => void;
}

export function useStudioHost(): StudioHost {
  const [index, setIndex] = useState<IndexPayload | null>(null);
  const [prototypes, setPrototypes] = useState<PrototypeIndexPayload | null>(null);
  const [atlas, setAtlas] = useState<GraphAtlas | null>(null);
  const [graph, setGraph] = useState<GraphView | null>(null);
  const [prototype, setPrototype] = useState<PrototypeView | null>(null);
  const [rsi, setRsi] = useState<RsiView | null>(null);
  const [xaml, setXaml] = useState<XamlView | null>(null);
  const [csharp, setCSharp] = useState<CSharpView | null>(null);
  const [diff, setDiff] = useState<DiffPayload | null>(null);
  const [view, setView] = useState<WorkspaceView>({ kind: 'dashboard' });
  const [positions, setPositions] = useState<LayoutMap>({});
  const [readOnly, setReadOnly] = useState(false);
  const [config, setConfig] = useState<StudioConfig>(DEFAULT_CONFIG);
  const [theme, setTheme] = useState<ThemeKind>('dark');
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => readUiState().recent ?? []);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [icons, setIcons] = useState<Record<string, IconSheet>>({});

  const graphRef = useRef<GraphView | null>(null);
  const positionsRef = useRef<LayoutMap>({});
  const layoutKeyRef = useRef<string | null>(null);
  const zoomRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef(new Map<number, PendingRequest>());
  const requestIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const notifiedReadyRef = useRef(false);
  const requestedIconsRef = useRef(new Set<string>());

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (level: ToastLevel, message: string) => {
      const id = ++toastIdRef.current;
      setToasts((current) => [
        ...current.slice(-4),
        { id, level, message },
      ]);
      const timeout = level === 'error' ? 9000 : 4800;
      window.setTimeout(() => dismissToast(id), timeout);
    },
    [dismissToast],
  );

  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const applyGraphPositions = useCallback((nextGraph: GraphView) => {
    setPositions((current) => {
      const base = layoutKeyRef.current === nextGraph.key ? current : {};
      const next = ensurePositions(nextGraph, base);
      positionsRef.current = next;
      layoutKeyRef.current = nextGraph.key;
      return next;
    });
  }, []);

  const clearGraph = useCallback(() => {
    graphRef.current = null;
    layoutKeyRef.current = null;
    positionsRef.current = {};
    setGraph(null);
    setPositions({});
    setOpeningKey(null);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;

      switch (message.type) {
        case 'readyState':
          setReadOnly(message.readOnly);
          setConfig(message.config);
          break;

        case 'settings':
          setConfig(message.config);
          break;

        case 'theme':
          setTheme(message.kind);
          break;

        case 'index':
          setIndex(message.payload);
          requestedIconsRef.current.clear();
          setIcons({});
          break;

        case 'prototypes':
          setPrototypes(message.payload);
          requestedIconsRef.current.clear();
          setIcons({});
          break;

        case 'atlas':
          setAtlas(message.atlas);
          break;

        case 'prototype':
          setPrototype(message.view);
          if (!message.view && message.message) {
            notifyRef.current('error', message.message);
          }
          break;

        case 'rsi':
          setRsi(message.view);
          if (!message.view && message.message) {
            notifyRef.current('error', message.message);
          }
          break;

        case 'xaml':
          setXaml(message.view);
          if (!message.view && message.message) {
            notifyRef.current('error', message.message);
          }
          break;

        case 'csharp':
          setCSharp(message.view);
          if (!message.view && message.message) {
            notifyRef.current('error', message.message);
          }
          break;

        case 'diff':
          setDiff(message.payload);
          break;

        case 'view':
          setView(message.view);
          if (message.view.kind === 'dashboard') {
            clearGraph();
            setPrototype(null);
            setRsi(null);
            setXaml(null);
            setCSharp(null);
            setAtlas(null);
          }
          break;

        case 'graph': {
          setOpeningKey(null);
          if (!message.graph) {
            clearGraph();
            break;
          }
          const nextGraph = message.graph;
          graphRef.current = nextGraph;
          setGraph(nextGraph);
          applyGraphPositions(nextGraph);
          if (message.reason === 'open' || message.reason === 'created') {
            setRecent((current) => {
              const next = [nextGraph.key, ...current.filter((key) => key !== nextGraph.key)].slice(0, 12);
              writeUiState({ ...readUiState(), recent: next });
              return next;
            });
          }
          break;
        }

        case 'layout': {
          const current = graphRef.current;
          if (!current || current.key !== message.key) break;
          if (message.layout) {
            const next = ensurePositions(current, message.layout.positions);
            positionsRef.current = next;
            layoutKeyRef.current = current.key;
            setPositions(next);
            zoomRef.current = message.layout.zoom;
          }
          break;
        }

        case 'graphMissing':
          clearGraph();
          notifyRef.current('error', message.message);
          break;

        case 'operationResult': {
          const pending = pendingRef.current.get(message.requestId);
          if (pending) {
            pendingRef.current.delete(message.requestId);
            window.clearTimeout(pending.timeout);
            if (!message.result.ok) {
              notifyRef.current('error', message.result.error ?? 'The edit could not be applied.');
            } else if (pending.notify && message.result.message) {
              notifyRef.current('success', message.result.message);
            }
            pending.resolve(message.result);
          } else if (!message.result.ok) {
            notifyRef.current('error', message.result.error ?? 'The edit could not be applied.');
          }
          break;
        }

        case 'toast':
          notifyRef.current(message.level, message.message);
          break;

        case 'editResult':
          if (!message.result.ok) {
            notifyRef.current('error', message.result.error ?? 'The edit failed.');
          }
          break;

        case 'indexProgress':
          break;

        case 'entityIcon': {
          if (!message.uri) {
            setIcons((current) => {
              const next = { ...current };
              delete next[message.entityId];
              return next;
            });
            break;
          }
          const sheet = message.sheet;
          setIcons((current) => ({
            ...current,
            [message.entityId]: {
              uri: message.uri!,
              width: sheet?.width ?? 32,
              height: sheet?.height ?? 32,
              frameWidth: sheet?.frameWidth ?? 32,
              frameHeight: sheet?.frameHeight ?? 32,
              columns: sheet?.columns ?? 1,
              layers: message.layers?.map((layer) => ({ ...layer })),
            },
          }));
          break;
        }

        default:
          break;
      }
    };

    window.addEventListener('message', onMessage);
    if (!notifiedReadyRef.current) {
      notifiedReadyRef.current = true;
      post({ type: 'ready' });
    }
    return () => window.removeEventListener('message', onMessage);
  }, [applyGraphPositions, clearGraph]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('no-animations', !config.animations);
  }, [config.animations]);

  const openGraph = useCallback((key: string) => {
    setOpeningKey(key);
    post({ type: 'openGraph', key });
  }, []);

  const openDashboard = useCallback(() => {
    setOpeningKey(null);
    post({ type: 'openDashboard' });
  }, []);

  const openAtlas = useCallback(() => {
    setOpeningKey(null);
    post({ type: 'openAtlas' });
  }, []);

  const openPrototype = useCallback((id: string, kind?: string) => {
    post({ type: 'openPrototype', id, kind });
  }, []);

  const openRsi = useCallback((path: string) => {
    post({ type: 'openRsi', path });
  }, []);

  const openXaml = useCallback((path: string) => {
    post({ type: 'openXaml', path });
  }, []);

  const openCSharp = useCallback((path: string) => {
    post({ type: 'openCSharp', path });
  }, []);

  const pickRsi = useCallback(() => {
    post({ type: 'pickRsi' });
  }, []);

  const pickXaml = useCallback(() => {
    post({ type: 'pickXaml' });
  }, []);

  const pickCSharp = useCallback(() => {
    post({ type: 'pickCSharp' });
  }, []);

  const openPath = useCallback((path: string, line?: number) => {
    post({ type: 'openPath', path, line });
  }, []);

  const openAbout = useCallback(() => {
    post({ type: 'openAbout' });
  }, []);

  const request = useCallback(
    (makeMessage: (requestId: number) => Parameters<typeof post>[0], notifyOnSuccess: boolean) =>
      new Promise<EditResult>((resolve) => {
        const requestId = ++requestIdRef.current;
        const timeout = window.setTimeout(() => {
          if (!pendingRef.current.has(requestId)) return;
          pendingRef.current.delete(requestId);
          notifyRef.current('error', 'The edit timed out before VS Code responded.');
          resolve({ ok: false, error: 'Timed out.' });
        }, 20_000);
        pendingRef.current.set(requestId, {
          resolve,
          timeout,
          notify: notifyOnSuccess,
        });
        post(makeMessage(requestId));
      }),
    [],
  );

  const applyOperation = useCallback(
    (operation: GraphOperation) => {
      const current = graphRef.current;
      if (!current) {
        return Promise.resolve<EditResult>({
          ok: false,
          error: 'Open a construction graph first.',
        });
      }
      return request(
        (requestId) => ({
          type: 'applyOperation',
          requestId,
          key: current.key,
          operation,
        }),
        true,
      );
    },
    [request],
  );

  const applyPrototypeOperation = useCallback(
    (filePath: string, operation: PrototypeOperation) =>
      request(
        (requestId) => ({ type: 'applyPrototypeOperation', requestId, filePath, operation }),
        true,
      ),
    [request],
  );

  const applyRsiOperation = useCallback(
    (path: string, operation: RsiOperation) =>
      request(
        (requestId) => ({ type: 'applyRsiOperation', requestId, path, operation }),
        true,
      ),
    [request],
  );

  const applyXamlOperation = useCallback(
    (filePath: string, operation: XamlOperation) =>
      request(
        (requestId) => ({ type: 'applyXamlOperation', requestId, filePath, operation }),
        true,
      ),
    [request],
  );

  const saveRsiPng = useCallback(
    (path: string, state: string, dataUrl: string, frameIndex?: number) =>
      request(
        (requestId) => ({ type: 'saveRsiPng', requestId, path, state, dataUrl, frameIndex }),
        true,
      ),
    [request],
  );

  const importRsiFrames = useCallback(
    (path: string, state: string) =>
      request(
        (requestId) => ({ type: 'importRsiFrames', requestId, path, state }),
        true,
      ),
    [request],
  );

  const deleteRsiImage = useCallback(
    (path: string, state: string) =>
      request(
        (requestId) => ({ type: 'deleteRsiImage', requestId, path, state }),
        true,
      ),
    [request],
  );

  const createGraph = useCallback(
    (options: CreateGraphOptions) =>
      request(
        (requestId) => ({ type: 'createGraph', requestId, options }),
        false,
      ),
    [request],
  );

  const savePositions = useCallback((next: LayoutMap, zoom?: number) => {
    positionsRef.current = next;
    setPositions(next);
    const current = graphRef.current;
    if (!current) return;
    if (typeof zoom === 'number') zoomRef.current = zoom;
    const layout: PersistedLayout = { positions: next };
    if (typeof zoomRef.current === 'number') layout.zoom = zoomRef.current;
    post({ type: 'saveLayout', key: current.key, layout });
  }, []);

  const saveZoom = useCallback((zoom: number) => {
    zoomRef.current = zoom;
  }, []);

  const openSource = useCallback((line?: number, node?: string, edgeIndex?: number) => {
    const current = graphRef.current;
    if (!current) return;
    post({ type: 'openSource', key: current.key, line, node, edgeIndex });
  }, []);

  const openPrototypeSource = useCallback((filePath: string, line?: number) => {
    post({ type: 'openPath', path: filePath, line });
  }, []);

  const openFile = useCallback((uri: string) => {
    post({ type: 'openFile', uri });
  }, []);

  const openCodeBehind = useCallback((filePath: string) => {
    post({ type: 'openCodeBehind', filePath });
  }, []);

  const refreshIndex = useCallback(() => {
    post({ type: 'refreshIndex' });
  }, []);

  const requestDiff = useCallback(
    (title: string, oldText: string, newText: string, oldLabel?: string, newLabel?: string) => {
      post({ type: 'requestDiff', title, oldText, newText, oldLabel, newLabel });
    },
    [],
  );

  const requestIcon = useCallback((entityId: string) => {
    if (!entityId || requestedIconsRef.current.has(entityId)) return;
    requestedIconsRef.current.add(entityId);
    post({ type: 'requestEntityIcon', entityId });
  }, []);

  const saveConfig = useCallback((next: Partial<StudioConfig>) => {
    setConfig((current) => ({ ...current, ...next }));
    post({ type: 'saveConfig', config: next });
  }, []);

  const revealSetting = useCallback((setting: string) => {
    post({ type: 'revealSetting', setting });
  }, []);

  const copyText = useCallback((text: string) => {
    post({ type: 'copyText', text });
  }, []);

  const openSettings = useCallback(() => {
    post({ type: 'openSettings' });
  }, []);

  const openDocs = useCallback(() => {
    post({ type: 'openDocs' });
  }, []);

  useEffect(() => {
    return () => {
      for (const pending of pendingRef.current.values()) {
        window.clearTimeout(pending.timeout);
      }
      pendingRef.current.clear();
    };
  }, []);

  return {
    index,
    prototypes,
    atlas,
    graph,
    prototype,
    rsi,
    xaml,
    csharp,
    diff,
    view,
    positions,
    readOnly,
    config,
    theme,
    openingKey,
    recent,
    toasts,
    icons,
    openGraph,
    openDashboard,
    openAtlas,
    openPrototype,
    openRsi,
    openXaml,
    openCSharp,
    pickRsi,
    pickXaml,
    pickCSharp,
    openPath,
    openAbout,
    applyOperation,
    applyPrototypeOperation,
    applyRsiOperation,
    applyXamlOperation,
    saveRsiPng,
    importRsiFrames,
    deleteRsiImage,
    createGraph,
    savePositions,
    saveZoom,
    openSource,
    openPrototypeSource,
    openFile,
    openCodeBehind,
    refreshIndex,
    requestDiff,
    requestIcon,
    saveConfig,
    revealSetting,
    copyText,
    openSettings,
    openDocs,
    notify,
    dismissToast,
  };
}
