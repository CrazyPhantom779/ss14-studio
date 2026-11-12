import type { CSSProperties } from 'react';
import type { ConstructionNode, Diagnostic } from '@ss14-studio/core';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { CircleAlert, Flag, GitBranch, ListChecks, TriangleAlert } from 'lucide-react';
import {
  highestSeverity,
  initialsFor,
  nodeAccent,
} from '../lib/graph';

export type StudioNodeData = {
  model: ConstructionNode;
  isStart: boolean;
  diagnostics: Diagnostic[];
  incoming: number;
  steps: number;
  conditions: number;
  dimmed: boolean;
  highlighted: boolean;
};

export type StudioGraphNode = Node<StudioNodeData, 'studio'>;

export function GraphNode({ data, selected }: NodeProps<StudioGraphNode>) {
  const { model, isStart, diagnostics, incoming, steps, conditions, dimmed, highlighted } = data;
  const accent = nodeAccent(model.name, isStart);
  const severity = highestSeverity(diagnostics);
  const initials = initialsFor(model.entity ?? model.name);

  return (
    <div
      className={[
        'studio-node',
        isStart ? 'is-start' : '',
        selected ? 'is-selected' : '',
        dimmed ? 'is-dimmed' : '',
        highlighted ? 'is-highlighted' : '',
        severity ? `has-${severity}` : '',
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
        <span className="node-glyph" style={{ background: accent.gradient }}>
          {isStart ? <Flag size={14} aria-hidden /> : <span>{initials}</span>}
        </span>
        <div className="node-heading">
          <span className="node-name">{model.name}</span>
          <span className="node-entity" title={model.entity ?? 'Inherited entity'}>
            {model.entity ?? 'inherited entity'}
          </span>
        </div>
        {isStart ? <span className="node-start-badge">START</span> : null}
        {severity ? (
          <span className={`node-diagnostic ${severity}`} title={`${diagnostics.length} diagnostic(s)`}>
            {severity === 'error' ? <CircleAlert size={12} aria-hidden /> : <TriangleAlert size={12} aria-hidden />}
            {diagnostics.length}
          </span>
        ) : null}
      </header>

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
        {incoming > 0 ? <span className="incoming-chip">{incoming} in</span> : null}
      </div>

      <footer className="node-foot">
        {model.actions.length > 0 ? <span>{model.actions.length} action{model.actions.length === 1 ? '' : 's'}</span> : <span>no actions</span>}
        {model.doNotReplaceInheritingEntities ? <span className="node-lock">fixed entity</span> : null}
      </footer>
    </div>
  );
}
