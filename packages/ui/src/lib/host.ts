import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreateGraphOptions,
  EditResult,
  GraphOperation,
  GraphView,
  HostMessage,
  IndexPayload,
  LayoutMap,
  PersistedLayout,
  StudioConfig,
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
};

export interface StudioHost {
  index: IndexPayload | null;
  graph: GraphView | null;
  positions: LayoutMap;
  readOnly: boolean;
  config: StudioConfig;
  theme: ThemeKind;
  openingKey: string | null;
  recent: string[];
  toasts: ToastItem[];
  openGraph: (key: string) => void;
  openDashboard: () => void;
  applyOperation: (operation: GraphOperation) => Promise<EditResult>;
  createGraph: (options: CreateGraphOptions) => Promise<EditResult>;
  savePositions: (positions: LayoutMap, zoom?: number) => void;
  saveZoom: (zoom: number) => void;
  openSource: (line?: number, node?: string, edgeIndex?: number) => void;
  openFile: (uri: string) => void;
  refreshIndex: () => void;
  copyText: (text: string) => void;
  openSettings: () => void;
  openDocs: () => void;
  notify: (level: ToastLevel, message: string) => void;
  dismissToast: (id: number) => void;
}

export function useStudioHost(): StudioHost {
  const [index, setIndex] = useState<IndexPayload | null>(null);
  const [graph, setGraph] = useState<GraphView | null>(null);
  const [positions, setPositions] = useState<LayoutMap>({});
  const [readOnly, setReadOnly] = useState(false);
  const [config, setConfig] = useState<StudioConfig>(DEFAULT_CONFIG);
  const [theme, setTheme] = useState<ThemeKind>('dark');
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => readUiState().recent ?? []);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const graphRef = useRef<GraphView | null>(null);
  const positionsRef = useRef<LayoutMap>({});
  const layoutKeyRef = useRef<string | null>(null);
  const zoomRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef(new Map<number, PendingRequest>());
  const requestIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const notifiedReadyRef = useRef(false);

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

        case 'theme':
          setTheme(message.kind);
          break;

        case 'index':
          setIndex(message.payload);
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
          // Older hosts may still answer with editResult; surface failures.
          if (!message.result.ok) {
            notifyRef.current('error', message.result.error ?? 'The edit failed.');
          }
          break;

        case 'indexProgress':
          break;

        case 'entityIcon':
          break;

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

  const openFile = useCallback((uri: string) => {
    post({ type: 'openFile', uri });
  }, []);

  const refreshIndex = useCallback(() => {
    post({ type: 'refreshIndex' });
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
    graph,
    positions,
    readOnly,
    config,
    theme,
    openingKey,
    recent,
    toasts,
    openGraph,
    openDashboard,
    applyOperation,
    createGraph,
    savePositions,
    saveZoom,
    openSource,
    openFile,
    refreshIndex,
    copyText,
    openSettings,
    openDocs,
    notify,
    dismissToast,
  };
}
