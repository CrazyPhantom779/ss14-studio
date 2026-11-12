import { useMemo, useState } from 'react';
import type { Diagnostic } from '@ss14-studio/core';
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Crosshair,
  ExternalLink,
  Info,
  TriangleAlert,
} from 'lucide-react';
import type { StudioSelection } from '../lib/selection';

interface ValidationTrayProps {
  diagnostics: Diagnostic[];
  selection: StudioSelection | null;
  onOpen: (diagnostic: Diagnostic) => void;
}

function matchesSelection(diagnostic: Diagnostic, selection: StudioSelection): boolean {
  if (selection.kind === 'node') return diagnostic.node === selection.node;
  return (
    diagnostic.edge?.from === selection.from &&
    diagnostic.edge.index === selection.index
  );
}

export function ValidationTray({ diagnostics, selection, onOpen }: ValidationTrayProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectionOnly, setSelectionOnly] = useState(false);

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const infos = diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length;

  const visible = useMemo(() => {
    if (!selection || !selectionOnly) return diagnostics;
    return diagnostics.filter((diagnostic) => matchesSelection(diagnostic, selection));
  }, [diagnostics, selection, selectionOnly]);

  if (diagnostics.length === 0) {
    return (
      <div className="validation-tray healthy">
        <div className="validation-bar static">
          <span className="validation-health">
            <CircleCheck size={15} aria-hidden />
            No diagnostics
          </span>
          <span className="validation-sub">Every node, edge and step in this graph is valid.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`validation-tray ${expanded ? 'expanded' : ''}`}>
      <div className="validation-bar">
        <button
          type="button"
          className="validation-toggle"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <ChevronDown size={14} className={expanded ? 'rotated' : ''} aria-hidden />
          <span className="validation-title">Diagnostics</span>
          {errors > 0 ? (
            <span className="validation-count error">
              <CircleAlert size={12} aria-hidden />
              {errors}
            </span>
          ) : null}
          {warnings > 0 ? (
            <span className="validation-count warning">
              <TriangleAlert size={12} aria-hidden />
              {warnings}
            </span>
          ) : null}
          {infos > 0 ? (
            <span className="validation-count info">
              <Info size={12} aria-hidden />
              {infos}
            </span>
          ) : null}
          {errors + warnings + infos === 0 ? (
            <span className="validation-count ok">
              <CircleCheck size={12} aria-hidden />
              clean
            </span>
          ) : null}
        </button>
        <div className="validation-actions">
          {selection ? (
            <button
              type="button"
              className={`validation-filter ${selectionOnly ? 'active' : ''}`}
              onClick={() => {
                setSelectionOnly((current) => !current);
                setExpanded(true);
              }}
              title="Show only diagnostics for the current selection"
            >
              <Crosshair size={12} aria-hidden />
              Selection
            </button>
          ) : null}
          <span className="validation-hint">
            {expanded ? 'Click a row to reveal the YAML' : 'Review issues found while indexing'}
          </span>
        </div>
      </div>
      {expanded ? (
        <div className="validation-list">
          {visible.length === 0 ? (
            <div className="validation-empty">
              <CircleCheck size={18} aria-hidden />
              <span>
                {selectionOnly
                  ? 'The current selection has no diagnostics.'
                  : 'No diagnostics match this filter.'}
              </span>
            </div>
          ) : (
            visible.map((diagnostic, index) => (
              <button
                type="button"
                className={`validation-row ${diagnostic.severity}`}
                key={`${diagnostic.code}-${diagnostic.line}-${index}`}
                onClick={() => onOpen(diagnostic)}
                title="Open this location in the YAML file"
              >
                <span className="validation-icon">
                  {diagnostic.severity === 'error' ? (
                    <CircleAlert size={14} aria-hidden />
                  ) : diagnostic.severity === 'warning' ? (
                    <TriangleAlert size={14} aria-hidden />
                  ) : (
                    <Info size={14} aria-hidden />
                  )}
                </span>
                <span className="validation-message">{diagnostic.message}</span>
                <span className="validation-code">{diagnostic.code}</span>
                <span className="validation-line">Ln {diagnostic.line}</span>
                <ExternalLink size={12} className="validation-open" aria-hidden />
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
