import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  EditResult,
  GraphOperation,
  WorkspaceView,
} from '@ss14-studio/core';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { GraphWorkspace } from './components/GraphWorkspace';
import { Inspector } from './components/Inspector';
import { Modals, ConfirmDialog } from './components/Modals';
import { Toasts } from './components/Toasts';
import { PrototypeStudio } from './components/PrototypeStudio';
import { RsiStudio } from './components/RsiStudio';
import { XamlStudio } from './components/XamlStudio';
import { CSharpPanel } from './components/CSharpPanel';
import { DiffView } from './components/DiffView';
import { AboutPanel } from './components/AboutPanel';
import { SettingsPanel } from './components/SettingsPanel';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selection, setSelection] = useState<StudioSelection | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const previousView = useRef<WorkspaceView>({ kind: 'dashboard' });
  const view = host.view;

  const graphKey = host.graph?.key ?? null;

  useEffect(() => {
    writeUiState({ ...readUiState(), sidebarOpen, inspectorOpen });
  }, [sidebarOpen, inspectorOpen]);

  useEffect(() => {
    if (view.kind !== 'diff') previousView.current = view;
  }, [view]);

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
    const title =
      view.kind === 'graph'
        ? host.graph?.id
        : view.kind === 'prototype'
          ? view.id
          : view.kind === 'rsi' || view.kind === 'xaml' || view.kind === 'csharp'
            ? view.path.replaceAll('\\', '/').split('/').pop()
            : view.kind === 'about'
              ? 'About'
              : view.kind === 'diff'
                ? view.payload.title
                : null;
    document.title = title ? `SS14 Studio — ${title}` : 'SS14 Studio';
  }, [host.graph?.id, view]);

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

  const diffBack = useCallback(() => {
    const target = previousView.current;
    switch (target.kind) {
      case 'graph':
        host.openGraph(target.key);
        break;
      case 'prototype':
        host.openPrototype(target.id, target.kindFilter);
        break;
      case 'rsi':
        host.openRsi(target.path);
        break;
      case 'xaml':
        host.openXaml(target.path);
        break;
      case 'csharp':
        host.openCSharp(target.path);
        break;
      case 'about':
        host.openAbout();
        break;
      default:
        host.openDashboard();
        break;
    }
  }, [host.openAbout, host.openCSharp, host.openDashboard, host.openGraph, host.openPrototype, host.openRsi, host.openXaml]);

  const mainClass =
    view.kind === 'graph'
      ? 'graph-mode'
      : view.kind === 'dashboard'
        ? 'dashboard-mode'
        : 'tool-mode';

  return (
    <div className={`studio-app ${sidebarOpen ? 'has-sidebar' : 'no-sidebar'} ${inspectorOpen && view.kind === 'graph' ? 'has-inspector' : 'no-inspector'}`}>
      <TopBar
        project={host.index?.project ?? null}
        graph={host.graph}
        view={view}
        sidebarOpen={sidebarOpen}
        onDashboard={openDashboard}
        onRefresh={host.refreshIndex}
        onSettings={() => setSettingsOpen(true)}
        onAbout={host.openAbout}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
      />

      <div className="studio-shell">
        {sidebarOpen ? (
          <Sidebar
            summaries={host.index?.summaries ?? []}
            prototypes={host.prototypes}
            project={host.index?.project ?? null}
            currentKey={host.graph?.key ?? null}
            view={view}
            recent={host.recent}
            onOpen={openGraph}
            onOpenPrototype={host.openPrototype}
            onCreate={() => setDialog({ kind: 'createGraph' })}
            onDocs={host.openDocs}
            onPickRsi={host.pickRsi}
            onPickXaml={host.pickXaml}
            onPickCSharp={host.pickCSharp}
            onAbout={host.openAbout}
            onSettings={() => setSettingsOpen(true)}
          />
        ) : null}

        <main className={`studio-main ${mainClass}`}>
          {view.kind === 'dashboard' ? (
            <Dashboard
              index={host.index}
              recent={host.recent}
              onOpen={openGraph}
              onCreate={() => setDialog({ kind: 'createGraph' })}
              onRefresh={host.refreshIndex}
            />
          ) : null}

          {view.kind === 'graph' ? (
            host.graph ? (
              <GraphWorkspace
                graph={host.graph}
                positions={host.positions}
                readOnly={host.readOnly}
                config={host.config}
                theme={host.theme}
                selection={selection}
                inspectorOpen={inspectorOpen}
                fitSignal={fitSignal}
                icons={host.icons}
                onSelect={handleSelect}
                onPositionsChange={host.savePositions}
                onZoomChange={host.saveZoom}
                onToggleInspector={() => setInspectorOpen((current) => !current)}
                onOpenSettings={() => setSettingsOpen(true)}
                onRequestIcon={host.requestIcon}
                onOpenPrototype={host.openPrototype}
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
              <div className="studio-detail-empty">
                <Spinner label="Loading construction graph…" />
              </div>
            )
          ) : null}

          {view.kind === 'prototype' ? <PrototypeStudio host={host} /> : null}
          {view.kind === 'rsi' ? <RsiStudio host={host} /> : null}
          {view.kind === 'xaml' ? <XamlStudio host={host} /> : null}
          {view.kind === 'csharp' ? <CSharpPanel host={host} /> : null}
          {view.kind === 'diff' ? <DiffView host={host} onBack={diffBack} /> : null}
          {view.kind === 'about' ? <AboutPanel host={host} /> : null}
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

      {settingsOpen ? <SettingsPanel host={host} onClose={() => setSettingsOpen(false)} /> : null}

      {confirm ? <ConfirmDialog confirm={confirm} onResolve={resolveConfirm} /> : null}
    </div>
  );
}
