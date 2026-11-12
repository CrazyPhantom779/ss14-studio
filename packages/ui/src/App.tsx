import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  EditResult,
  GraphOperation,
} from '@ss14-studio/core';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { GraphWorkspace } from './components/GraphWorkspace';
import { Inspector } from './components/Inspector';
import { Modals, ConfirmDialog } from './components/Modals';
import { Toasts } from './components/Toasts';
import { Spinner } from './components/ui';
import { useStudioHost } from './lib/host';
import { autoLayout } from './lib/layout';
import { readUiState, writeUiState } from './vscode';
import type { ConfirmOptions, ConfirmState, DialogState } from './lib/dialogs';
import type { StudioSelection } from './lib/selection';

export default function App() {
  const host = useStudioHost();
  const initialUi = useMemo(() => readUiState(), []);
  const [sidebarOpen, setSidebarOpen] = useState(initialUi.sidebarOpen ?? true);
  const [inspectorOpen, setInspectorOpen] = useState(initialUi.inspectorOpen ?? true);
  const [selection, setSelection] = useState<StudioSelection | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [fitSignal, setFitSignal] = useState(0);

  const graphKey = host.graph?.key ?? null;

  useEffect(() => {
    writeUiState({ ...readUiState(), sidebarOpen, inspectorOpen });
  }, [sidebarOpen, inspectorOpen]);

  useEffect(() => {
    setSelection(null);
    setDialog(null);
  }, [graphKey]);

  useEffect(() => {
    if (!host.graph) {
      setSelection(null);
      return;
    }
    const graph = host.graph;
    setSelection((current) => {
      if (!current) return null;
      if (current.kind === 'node') {
        return graph.nodes.some((node) => node.name === current.node) ? current : null;
      }
      const from = graph.nodes.find((node) => node.name === current.from);
      return from?.edges[current.index] ? current : null;
    });
  }, [host.graph]);

  useEffect(() => {
    document.title = host.graph ? `SS14 Studio — ${host.graph.id}` : 'SS14 Studio';
  }, [host.graph]);

  const handleSelect = useCallback((next: StudioSelection | null) => {
    setSelection(next);
    if (next) setInspectorOpen(true);
  }, []);

  const openGraph = useCallback(
    (key: string) => {
      setSelection(null);
      setDialog(null);
      host.openGraph(key);
    },
    [host.openGraph],
  );

  const openDashboard = useCallback(() => {
    setSelection(null);
    setDialog(null);
    host.openDashboard();
  }, [host.openDashboard]);

  const handleAutoLayout = useCallback(() => {
    if (!host.graph) return;
    host.savePositions(autoLayout(host.graph));
    setFitSignal((current) => current + 1);
    host.notify('success', 'Applied the automatic blueprint layout.');
  }, [host.graph, host.notify, host.savePositions]);

  const confirmAction = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setConfirm({ ...options, resolve });
      }),
    [],
  );

  const resolveConfirm = useCallback((confirmed: boolean) => {
    setConfirm((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const applyOperation = useCallback(
    (operation: GraphOperation): Promise<EditResult> => host.applyOperation(operation),
    [host.applyOperation],
  );

  return (
    <div className={`studio-app ${sidebarOpen ? 'has-sidebar' : 'no-sidebar'} ${inspectorOpen ? 'has-inspector' : 'no-inspector'}`}>
      <TopBar
        project={host.index?.project ?? null}
        graph={host.graph}
        sidebarOpen={sidebarOpen}
        onDashboard={openDashboard}
        onRefresh={host.refreshIndex}
        onSettings={host.openSettings}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
      />

      <div className="studio-shell">
        {sidebarOpen ? (
          <Sidebar
            summaries={host.index?.summaries ?? []}
            project={host.index?.project ?? null}
            currentKey={host.graph?.key ?? null}
            recent={host.recent}
            onOpen={openGraph}
            onCreate={() => setDialog({ kind: 'createGraph' })}
            onDocs={host.openDocs}
          />
        ) : null}

        <main className={`studio-main ${host.graph ? 'graph-mode' : 'dashboard-mode'}`}>
          {host.graph ? (
            <GraphWorkspace
              graph={host.graph}
              positions={host.positions}
              readOnly={host.readOnly}
              config={host.config}
              theme={host.theme}
              selection={selection}
              inspectorOpen={inspectorOpen}
              fitSignal={fitSignal}
              onSelect={handleSelect}
              onPositionsChange={host.savePositions}
              onZoomChange={host.saveZoom}
              onToggleInspector={() => setInspectorOpen((current) => !current)}
              onOpenDialog={setDialog}
              onOpenSource={host.openSource}
              onOpenDashboard={openDashboard}
              onAutoLayout={handleAutoLayout}
            >
              {inspectorOpen ? (
                <Inspector
                  graph={host.graph}
                  selection={selection}
                  index={host.index}
                  readOnly={host.readOnly}
                  onClose={() => setInspectorOpen(false)}
                  onSelect={handleSelect}
                  onOperation={applyOperation}
                  onOpenSource={host.openSource}
                  onOpenDialog={setDialog}
                  onConfirm={confirmAction}
                  onAutoLayout={handleAutoLayout}
                  onNotify={host.notify}
                  onCopy={host.copyText}
                />
              ) : null}
            </GraphWorkspace>
          ) : (
            <Dashboard
              index={host.index}
              recent={host.recent}
              onOpen={openGraph}
              onCreate={() => setDialog({ kind: 'createGraph' })}
              onRefresh={host.refreshIndex}
            />
          )}
        </main>
      </div>

      {host.openingKey && !host.graph ? (
        <div className="studio-loading-veil">
          <Spinner label="Loading construction graph…" />
        </div>
      ) : null}
      {host.openingKey ? <div className="studio-loading-line" /> : null}

      <Toasts toasts={host.toasts} onDismiss={host.dismissToast} />

      <Modals
        dialog={dialog}
        graph={host.graph}
        index={host.index}
        readOnly={host.readOnly}
        onClose={() => setDialog(null)}
        onApply={applyOperation}
        onCreate={host.createGraph}
        onCopy={host.copyText}
      />

      {confirm ? <ConfirmDialog confirm={confirm} onResolve={resolveConfirm} /> : null}
    </div>
  );
}
