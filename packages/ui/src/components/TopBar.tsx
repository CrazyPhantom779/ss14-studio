import type { GraphView, ProjectInfo, WorkspaceView } from '@ss14-studio/core';
import {
  Braces,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Image as ImageIcon,
  Info,
  Layers,
  LayoutDashboard,
  PanelLeft,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { StudioLogo } from './Brand';
import { Badge, IconButton } from './ui';

interface TopBarProps {
  project: ProjectInfo | null;
  graph: GraphView | null;
  view: WorkspaceView;
  sidebarOpen: boolean;
  onDashboard: () => void;
  onRefresh: () => void;
  onSettings: () => void;
  onAbout: () => void;
  onToggleSidebar: () => void;
}

function viewLabel(view: WorkspaceView, graph: GraphView | null): string | null {
  switch (view.kind) {
    case 'dashboard':
      return null;
    case 'graph':
      return graph?.id ?? 'Construction graph';
    case 'prototype':
      return view.id;
    case 'rsi':
      return view.path.replaceAll('\\', '/').split('/').slice(-2).join('/');
    case 'xaml':
      return view.path.replaceAll('\\', '/').split('/').pop() ?? view.path;
    case 'diff':
      return view.payload.title;
    case 'about':
      return 'About';
    default:
      return null;
  }
}

function ViewIcon({ view }: { view: WorkspaceView }) {
  if (view.kind === 'prototype') return <Layers size={13} aria-hidden />;
  if (view.kind === 'rsi') return <ImageIcon size={13} aria-hidden />;
  if (view.kind === 'xaml') return <Braces size={13} aria-hidden />;
  if (view.kind === 'about') return <Info size={13} aria-hidden />;
  return null;
}

export function TopBar({
  project,
  graph,
  view,
  sidebarOpen,
  onDashboard,
  onRefresh,
  onSettings,
  onAbout,
  onToggleSidebar,
}: TopBarProps) {
  const diagnostics = (project?.errors ?? 0) + (project?.warnings ?? 0);
  const label = viewLabel(view, graph);

  return (
    <header className="studio-topbar">
      <div className="studio-topbar-left">
        <button type="button" className="studio-brand" onClick={onDashboard} title="SS14 Studio dashboard">
          <span className="studio-brand-mark">
            <StudioLogo size={26} />
          </span>
          <span className="studio-brand-text">
            <span className="studio-brand-name">
              SS14 <strong>Studio</strong>
            </span>
            <span className="studio-brand-tag">All-in-one dev suite</span>
          </span>
          <span className="studio-alpha">Alpha</span>
        </button>

        <nav className="studio-crumbs" aria-label="Breadcrumb">
          <button
            type="button"
            className={`studio-crumb ${view.kind === 'dashboard' ? 'current' : ''}`.trim()}
            onClick={onDashboard}
          >
            <LayoutDashboard size={14} aria-hidden />
            Dashboard
          </button>
          {label ? (
            <>
              <ChevronRight size={13} className="crumbs-separator" aria-hidden />
              <span className="studio-crumb current graph" title={label}>
                <ViewIcon view={view} />
                {label}
              </span>
            </>
          ) : null}
        </nav>
      </div>

      <div className="studio-topbar-actions">
        <Badge tone="warning" className="ai-badge" title="SS14 Studio is an AI-generated open-source project">
          AI-generated
        </Badge>
        {project ? (
          <button
            type="button"
            className={`studio-health ${project.errors > 0 ? 'error' : project.warnings > 0 ? 'warn' : 'ok'}`}
            onClick={onDashboard}
            title={
              diagnostics === 0
                ? 'No graph diagnostics in the workspace'
                : `${project.errors} error(s), ${project.warnings} warning(s) across the workspace`
            }
          >
            {diagnostics === 0 ? <CircleCheck size={14} aria-hidden /> : <CircleAlert size={14} aria-hidden />}
            <span>
              {diagnostics === 0
                ? 'All graphs healthy'
                : `${project.errors} errors · ${project.warnings} warnings`}
            </span>
          </button>
        ) : null}
        <div className="studio-topbar-divider" />
        <IconButton icon={RefreshCw} label="Refresh construction graph and prototype index" onClick={onRefresh} />
        <IconButton icon={Settings2} label="Open SS14 Studio display settings" onClick={onSettings} />
        <IconButton icon={Info} label="About SS14 Studio and AI disclosure" onClick={onAbout} />
        <IconButton
          icon={PanelLeft}
          label={sidebarOpen ? 'Hide browser' : 'Show browser'}
          active={sidebarOpen}
          onClick={onToggleSidebar}
        />
      </div>
    </header>
  );
}
