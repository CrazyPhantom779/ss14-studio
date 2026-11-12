import type { GraphView, ProjectInfo } from '@ss14-studio/core';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  LayoutDashboard,
  PanelLeft,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { StudioLogo } from './Brand';
import { IconButton } from './ui';

interface TopBarProps {
  project: ProjectInfo | null;
  graph: GraphView | null;
  sidebarOpen: boolean;
  onDashboard: () => void;
  onRefresh: () => void;
  onSettings: () => void;
  onToggleSidebar: () => void;
}

export function TopBar({
  project,
  graph,
  sidebarOpen,
  onDashboard,
  onRefresh,
  onSettings,
  onToggleSidebar,
}: TopBarProps) {
  const diagnostics = (project?.errors ?? 0) + (project?.warnings ?? 0);

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
            <span className="studio-brand-tag">Construction atlas</span>
          </span>
          <span className="studio-alpha">Alpha</span>
        </button>

        <nav className="studio-crumbs" aria-label="Breadcrumb">
          <button
            type="button"
            className={`studio-crumb ${graph ? '' : 'current'}`.trim()}
            onClick={onDashboard}
          >
            <LayoutDashboard size={14} aria-hidden />
            Dashboard
          </button>
          {graph ? (
            <>
              <ChevronRight size={13} className="crumbs-separator" aria-hidden />
              <span className="studio-crumb current graph" title={graph.id}>
                {graph.id}
              </span>
            </>
          ) : null}
        </nav>
      </div>

      <div className="studio-topbar-actions">
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
        <IconButton icon={RefreshCw} label="Refresh construction graph index" onClick={onRefresh} />
        <IconButton icon={Settings2} label="Open SS14 Studio settings" onClick={onSettings} />
        <IconButton
          icon={PanelLeft}
          label={sidebarOpen ? 'Hide graph browser' : 'Show graph browser'}
          active={sidebarOpen}
          onClick={onToggleSidebar}
        />
      </div>
    </header>
  );
}
