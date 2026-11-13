import type { ConstructionEdge, Diagnostic, StudioConfig } from '@ss14-studio/core';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { CircleAlert, Filter, ListChecks, TriangleAlert } from 'lucide-react';
import { edgeSummary, highestSeverity } from '../lib/graph';

export type StudioEdgeData = {
  edge: ConstructionEdge;
  from: string;
  index: number;
  diagnostics: Diagnostic[];
  dimmed: boolean;
  highlighted: boolean;
  edgeStyle: StudioConfig['graphEdgeStyle'];
  showSummary: boolean;
  onSelect: () => void;
};

export type StudioGraphEdge = Edge<StudioEdgeData, 'studio'>;

export function StepEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<StudioGraphEdge>) {
  const [path, labelX, labelY] =
    data?.edgeStyle === 'straight'
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : data?.edgeStyle === 'bezier'
        ? getBezierPath({
            sourceX,
            sourceY,
            targetX,
            targetY,
            sourcePosition,
            targetPosition,
            curvature: 0.32,
          })
        : getSmoothStepPath({
            sourceX,
            sourceY,
            targetX,
            targetY,
            sourcePosition,
            targetPosition,
            borderRadius: 18,
            offset: 30,
          });

  if (!data) return null;

  const severity = highestSeverity(data.diagnostics);
  const highlighted = selected || data.highlighted;
  const conditional = data.edge.conditions.length > 0;
  const tone = highlighted
    ? 'highlight'
    : severity === 'error'
      ? 'error'
      : severity === 'warning'
        ? 'warning'
        : conditional
          ? 'conditional'
          : 'normal';
  const color =
    tone === 'highlight'
      ? 'var(--studio-accent)'
      : tone === 'error'
        ? 'var(--studio-danger)'
        : tone === 'warning'
          ? 'var(--studio-warning)'
          : tone === 'conditional'
            ? 'var(--studio-accent-2)'
            : 'var(--studio-edge)';

  const summary = edgeSummary(data.edge);
  const stepCount = data.edge.steps.length;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={24}
        className={[
          'studio-edge-path',
          `tone-${tone}`,
          conditional ? 'is-conditional' : '',
          data.dimmed ? 'is-dimmed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          stroke: color,
          strokeWidth: highlighted ? 2.4 : conditional ? 1.7 : 1.5,
          strokeDasharray: conditional && !highlighted ? '7 6' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={[
            'studio-edge-label',
            `tone-${tone}`,
            highlighted ? 'selected' : '',
            data.dimmed ? 'dimmed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onClick={(event) => {
            event.stopPropagation();
            data.onSelect();
          }}
          title={`${data.from} → ${data.edge.target}: ${summary}`}
        >
          <span className={`edge-step-count ${stepCount === 0 ? 'empty' : ''}`}>
            {severity ? (
              severity === 'error' ? (
                <CircleAlert size={10} aria-hidden />
              ) : (
                <TriangleAlert size={10} aria-hidden />
              )
            ) : (
              <ListChecks size={10} aria-hidden />
            )}
            {stepCount}
          </span>
          <span className="edge-summary">{data.showSummary ? summary : `${stepCount} step${stepCount === 1 ? '' : 's'}`}</span>
          {conditional ? (
            <span className="edge-condition" title={`${data.edge.conditions.length} condition(s)`}>
              <Filter size={9} aria-hidden />
              {data.edge.conditions.length}
            </span>
          ) : null}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
