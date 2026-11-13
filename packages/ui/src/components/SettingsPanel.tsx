import type { StudioConfig } from '@ss14-studio/core';
import {
  BookOpen,
  Boxes,
  Eye,
  GitBranch,
  Info,
  LayoutDashboard,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import type { StudioHost } from '../lib/host';
import { Badge, Button, IconButton } from './ui';

interface SettingsPanelProps {
  host: StudioHost;
  onClose: () => void;
}

const TOGGLES: {
  key: keyof StudioConfig;
  label: string;
  hint: string;
  group: string;
}[] = [
  { key: 'graphSprites', label: 'Entity sprites', hint: 'Show each construction node’s entity sprite.', group: 'Graph canvas' },
  { key: 'graphEntityIds', label: 'Entity prototype ids', hint: 'Show the entity prototype under each node name.', group: 'Graph canvas' },
  { key: 'graphStats', label: 'Node statistics', hint: 'Edges, steps, conditions and incoming counts.', group: 'Graph canvas' },
  { key: 'graphEdgeSteps', label: 'Edge step summaries', hint: 'Describe the first construction steps on every edge.', group: 'Graph canvas' },
  { key: 'graphPathHighlight', label: 'Path highlighting', hint: 'Dim unrelated nodes and trace the path from start.', group: 'Graph canvas' },
  { key: 'graphCompact', label: 'Compact nodes', hint: 'Hide footers and chips for dense graphs.', group: 'Graph canvas' },
  { key: 'graphMinimap', label: 'Minimap', hint: 'Show the canvas minimap.', group: 'Graph panels' },
  { key: 'graphLegend', label: 'Canvas legend', hint: 'Show the node/edge legend.', group: 'Graph panels' },
  { key: 'graphControls', label: 'Zoom controls', hint: 'Show React Flow zoom and fit buttons.', group: 'Graph panels' },
  { key: 'showGrid', label: 'Blueprint grid', hint: 'Dotted drafting grid behind the graph.', group: 'Graph panels' },
  { key: 'animations', label: 'Animations', hint: 'Canvas transitions, spinners and sprite playback.', group: 'Behaviour' },
  { key: 'prototypeCompact', label: 'Compact prototype rows', hint: 'Tighter rows in the prototype explorer.', group: 'Prototypes' },
  { key: 'prototypeShowResolved', label: 'Resolved values by default', hint: 'Show inherited values in the component table.', group: 'Prototypes' },
  { key: 'autoSidePreview', label: 'Auto side preview', hint: 'Open the matching studio beside graph/XAML editors when they become active.', group: 'Editor integration' },
  { key: 'defaultGraphEditor', label: 'Default graph viewer', hint: 'Automatically reveal SS14 Studio when a construction graph YAML opens.', group: 'Editor integration' },
];

export function SettingsPanel({ host, onClose }: SettingsPanelProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = [...new Set(TOGGLES.map((toggle) => toggle.group))];

  return (
    <div className="studio-drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="studio-drawer settings-drawer" role="dialog" aria-label="SS14 Studio display settings">
        <header className="studio-drawer-head">
          <div>
            <div className="section-eyebrow">Personalise</div>
            <h2>
              <Settings2 size={18} aria-hidden />
              Studio display settings
            </h2>
            <p>These settings are saved to your VS Code workspace configuration.</p>
          </div>
          <IconButton icon={X} label="Close settings" onClick={onClose} />
        </header>

        <div className="studio-drawer-body">
          {groups.map((group) => (
            <section className="settings-group" key={group}>
              <header>
                {group === 'Graph canvas' ? <Boxes size={14} aria-hidden /> : group === 'Graph panels' ? <LayoutDashboard size={14} aria-hidden /> : group === 'Behaviour' ? <Sparkles size={14} aria-hidden /> : group === 'Prototypes' ? <Eye size={14} aria-hidden /> : <GitBranch size={14} aria-hidden />}
                <h3>{group}</h3>
              </header>
              {TOGGLES.filter((toggle) => toggle.group === group).map((toggle) => (
                <label className="settings-toggle" key={toggle.key}>
                  <span>
                    <strong>{toggle.label}</strong>
                    <em>{toggle.hint}</em>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(host.config[toggle.key])}
                    onChange={(event) => host.saveConfig({ [toggle.key]: event.target.checked })}
                  />
                </label>
              ))}
            </section>
          ))}

          <section className="settings-group">
            <header>
              <SlidersHorizontal size={14} aria-hidden />
              <h3>Blueprint style</h3>
            </header>
            <label className="settings-select">
              <span>
                <strong>Blueprint intensity</strong>
                <em>Grid and glow strength.</em>
              </span>
              <select
                value={host.config.blueprintIntensity}
                onChange={(event) =>
                  host.saveConfig({ blueprintIntensity: event.target.value as StudioConfig['blueprintIntensity'] })
                }
              >
                <option value="subtle">Subtle</option>
                <option value="balanced">Balanced</option>
                <option value="bold">Bold</option>
              </select>
            </label>
            <label className="settings-select">
              <span>
                <strong>Edge style</strong>
                <em>How construction paths are drawn.</em>
              </span>
              <select
                value={host.config.graphEdgeStyle}
                onChange={(event) =>
                  host.saveConfig({ graphEdgeStyle: event.target.value as StudioConfig['graphEdgeStyle'] })
                }
              >
                <option value="bezier">Bezier</option>
                <option value="step">Smooth step</option>
                <option value="straight">Straight</option>
              </select>
            </label>
            <label className="settings-select">
              <span>
                <strong>Node accent</strong>
                <em>Colour derivation for node cards.</em>
              </span>
              <select
                value={host.config.graphNodeAccent}
                onChange={(event) =>
                  host.saveConfig({ graphNodeAccent: event.target.value as StudioConfig['graphNodeAccent'] })
                }
              >
                <option value="hash">Stable hash</option>
                <option value="kind">Entity id</option>
                <option value="mono">Monochrome</option>
              </select>
            </label>
          </section>

          <section className="settings-note">
            <Info size={15} aria-hidden />
            <div>
              <strong>Everything is optional</strong>
              <span>
                SS14 Studio never replaces your text editor. Preview panels open only when you ask
                for them, unless you enable auto side preview above.
              </span>
            </div>
          </section>
        </div>

        <footer className="studio-drawer-foot">
          <Button icon={BookOpen} onClick={host.openDocs}>
            Documentation
          </Button>
          <Button variant="primary" onClick={host.openSettings}>
            Open VS Code settings
          </Button>
        </footer>
      </aside>
    </div>
  );
}
