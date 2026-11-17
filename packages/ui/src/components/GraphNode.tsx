import type { CSSProperties } from 'react';
import type { ConstructionNode, Diagnostic, StudioConfig } from '@ss14-studio/core';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { CircleAlert, Flag, GitBranch, ListChecks, TriangleAlert } from 'lucide-react';
import {
  highestSeverity,
  initialsFor,
  nodeAccent,
} from '../lib/graph';
import { SpriteFrame, type SpriteFrameSource } from './SpritePreview';

export type StudioNodeData = {
  model: ConstructionNode;
  isStart: boolean;
  diagnostics: Diagnostic[];
  incoming: number;
  steps: number;
  conditions: number;
  dimmed: boolean;
  highlighted: boolean;
  sprite: SpriteFrameSource | null;
  /** Prototypes whose sprites can be shown for this node, primary first. */
  iconEntities: string[];
  /** Entity opened by double-clicking the node. */
  primaryEntity: string | null;
  config: StudioConfig;
};

export type StudioGraphNode = Node<StudioNodeData, 'studio'>;

function accentFor(
  model: ConstructionNode,
  isStart: boolean,
  mode: StudioConfig['graphNodeAccent'],
  primaryEntity: string | null,
) {
  if (mode === 'mono') {
    return {
      hue: 192,
      color: 'hsl(192 48% 64%)',
      soft: 'hsl(192 48% 64% / 0.14)',
      gradient: 'linear-gradient(135deg, hsl(192 48% 58%) 0%, hsl(212 46% 48%) 100%)',
    };
  }
  if (mode === 'kind') {
    return nodeAccent(
      primaryEntity ? `kind:${primaryEntity}` : `kind:${model.name}`,
      isStart,
    );
  }
  return nodeAccent(model.name, isStart);
}

export function GraphNode({ data, selected }: NodeProps<StudioGraphNode>) {
  const {
    model,
    isStart,
    diagnostics,
    incoming,
    steps,
    conditions,
    dimmed,
    highlighted,
    sprite,
    iconEntities,
    primaryEntity,
    config,
  } = data;
  const accent = accentFor(model, isStart, config.graphNodeAccent, primaryEntity);
  const severity = highestSeverity(diagnostics);
  const label = primaryEntity ?? model.entity ?? model.name;
  const initials = initialsFor(label);
  const showSprite = Boolean(sprite && config.graphSprites);
  const variants = iconEntities.length;

  return (
    <div
      className={[
        'studio-node',
        isStart ? 'is-start' : '',
        selected ? 'is-selected' : '',
        dimmed ? 'is-dimmed' : '',
        highlighted ? 'is-highlighted' : '',
        severity ? `has-${severity}` : '',
        config.graphCompact ? 'is-compact' : '',
        showSprite ? 'has-sprite' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--node-accent': accent.color,
          '--node-accent-soft': accent.soft,
          '--node-accent-gradient': accent.gradient,
        } as CSSProperties
      }
      title={model.name}
    >
      <span className="node-corner top-left" aria-hidden />
      <span className="node-corner top-right" aria-hidden />
      <span className="node-corner bottom-left" aria-hidden />
      <span className="node-corner bottom-right" aria-hidden />
      <div className="node-accent-line" aria-hidden />

      <Handle type="target" position={Position.Left} className="studio-handle" />
      <Handle type="source" position={Position.Right} className="studio-handle" />

      <header className="node-head">
        <span className={`node-glyph ${showSprite ? 'with-sprite' : ''}`} style={{ background: accent.gradient }}>
          {showSprite && sprite ? (
            <SpriteFrame sheet={sprite} size={config.graphCompact ? 24 : 30} title={label} />
          ) : isStart ? (
            <Flag size={14} aria-hidden />
          ) : (
            <span>{initials}</span>
          )}
          {variants > 1 ? <span className="node-variant-badge" title={`${variants} sprite variants`}>+{variants - 1}</span> : null}
        </span>
        <div className="node-heading">
          <span className="node-name">{model.name}</span>
          {config.graphEntityIds && !config.graphCompact ? (
            <span className="node-entity" title={iconEntities.length > 0 ? iconEntities.join('\n') : 'Inherited entity'}>
              {label}
              {variants > 1 ? <em className="node-variant-count"> · {variants} variants</em> : null}
            </span>
          ) : null}
        </div>
        {isStart ? <span className="node-start-badge">START</span> : null}
        {severity ? (
          <span className={`node-diagnostic ${severity}`} title={`${diagnostics.length} diagnostic(s)`}>
            {severity === 'error' ? <CircleAlert size={12} aria-hidden /> : <TriangleAlert size={12} aria-hidden />}
            {diagnostics.length}
          </span>
        ) : null}
      </header>

      {config.graphStats && !config.graphCompact ? (
        <div className="node-chips">
          <span title="Outgoing edges">
            <GitBranch size={11} aria-hidden />
            {model.edges.length}
          </span>
          <span title="Construction steps">
            <ListChecks size={11} aria-hidden />
            {steps}
          </span>
          {conditions > 0 ? <span className="condition-chip">{conditions} cond.</span> : null}
          {variants > 1 ? <span className="variant-chip" title={iconEntities.join('\n')}>{variants} variants</span> : null}
          {incoming > 0 ? <span className="incoming-chip">{incoming} in</span> : null}
        </div>
      ) : null}

      {!config.graphCompact ? (
        <footer className="node-foot">
          {model.actions.length > 0 ? (
            <span>
              {model.actions.length} action{model.actions.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span>no actions</span>
          )}
          {model.doNotReplaceInheritingEntities ? <span className="node-lock">fixed entity</span> : null}
        </footer>
      ) : null}
    </div>
  );
}
