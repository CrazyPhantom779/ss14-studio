import { getIncoming, reachableNodes } from './analyze.js';
import type { ConstructionGraph, Diagnostic } from './model.js';

function diag(
  graph: ConstructionGraph,
  diagnostic: Omit<Diagnostic, 'line'> & { line?: number },
): Diagnostic {
  return {
    ...diagnostic,
    line: diagnostic.line ?? graph.line,
  };
}

export function validateGraph(graph: ConstructionGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!graph.id.trim()) {
    diagnostics.push(
      diag(graph, {
        severity: 'error',
        code: 'graph.id.empty',
        message: 'Construction graph has no id.',
      }),
    );
  }

  if (!graph.start.trim()) {
    diagnostics.push(
      diag(graph, {
        severity: 'error',
        code: 'graph.start.empty',
        message: 'Construction graph has no start node.',
      }),
    );
  }

  if (graph.nodes.length === 0) {
    diagnostics.push(
      diag(graph, {
        severity: 'error',
        code: 'graph.empty',
        message: 'Construction graph has no nodes.',
      }),
    );
    return diagnostics;
  }

  const names = new Map<string, number>();
  for (const node of graph.nodes) {
    names.set(node.name, (names.get(node.name) ?? 0) + 1);
  }
  for (const [name, count] of names) {
    if (count > 1) {
      const node = graph.nodes.filter((candidate) => candidate.name === name)[1]!;
      diagnostics.push({
        severity: 'error',
        code: 'node.duplicate',
        message: `Node "${name}" is defined ${count} times.`,
        line: node.line,
        span: node.span,
        node: name,
      });
    }
  }

  if (graph.start && !names.has(graph.start)) {
    diagnostics.push(
      diag(graph, {
        severity: 'error',
        code: 'graph.start.missing',
        message: `Start node "${graph.start}" does not exist.`,
      }),
    );
  }

  for (const node of graph.nodes) {
    const edgeTargets = new Map<string, number>();
    node.edges.forEach((edge, index) => {
      if (!names.has(edge.target)) {
        diagnostics.push({
          severity: 'error',
          code: 'edge.target.missing',
          message: `Node "${node.name}" has an edge to missing node "${edge.target}".`,
          line: edge.line,
          span: edge.span,
          node: node.name,
          edge: { from: node.name, to: edge.target, index },
        });
      }

      edgeTargets.set(edge.target, (edgeTargets.get(edge.target) ?? 0) + 1);

      if (edge.target === node.name) {
        diagnostics.push({
          severity: 'warning',
          code: 'edge.self',
          message: `Node "${node.name}" has an edge to itself.`,
          line: edge.line,
          span: edge.span,
          node: node.name,
          edge: { from: node.name, to: edge.target, index },
        });
      }

      if (edge.steps.length === 0) {
        diagnostics.push({
          severity: 'warning',
          code: 'edge.steps.empty',
          message: `Edge "${node.name}" → "${edge.target}" has no steps.`,
          line: edge.line,
          span: edge.span,
          node: node.name,
          edge: { from: node.name, to: edge.target, index },
        });
      }

      edge.steps.forEach((step, stepIndex) => {
        if (step.kind === 'unknown') {
          diagnostics.push({
            severity: 'warning',
            code: 'step.unknown',
            message: `Edge "${node.name}" → "${edge.target}" has an unrecognized step. It may need a fork-specific type.`,
            line: step.span.line,
            span: step.span,
            node: node.name,
            edge: { from: node.name, to: edge.target, index },
            stepIndex,
          });
        }
      });
    });

    for (const [target, count] of edgeTargets) {
      if (count > 1) {
        diagnostics.push({
          severity: 'warning',
          code: 'edge.duplicate',
          message: `Node "${node.name}" has ${count} edges to "${target}".`,
          line: node.line,
          span: node.span,
          node: node.name,
        });
      }
    }

    if (node.edges.length === 0 && node.name !== graph.start) {
      const incoming = getIncoming(graph, node.name);
      if (incoming.length === 0) {
        diagnostics.push({
          severity: 'warning',
          code: 'node.isolated',
          message: `Node "${node.name}" has no incoming or outgoing edges.`,
          line: node.line,
          span: node.span,
          node: node.name,
        });
      }
    }
  }

  if (graph.start && names.has(graph.start)) {
    const reachable = reachableNodes(graph);
    for (const node of graph.nodes) {
      if (!reachable.has(node.name)) {
        diagnostics.push({
          severity: 'warning',
          code: 'node.unreachable',
          message: `Node "${node.name}" cannot be reached from the start node.`,
          line: node.line,
          span: node.span,
          node: node.name,
        });
      }
    }
  }

  for (const node of graph.nodes) {
    for (const [index, action] of node.actions.entries()) {
      if (!action.type) {
        diagnostics.push({
          severity: 'warning',
          code: 'action.untyped',
          message: `Node "${node.name}" has an action without a !type tag.`,
          line: action.span.line,
          span: action.span,
          node: node.name,
        });
      }
      void index;
    }
    for (const edge of node.edges) {
      for (const condition of edge.conditions) {
        if (!condition.type) {
          diagnostics.push({
            severity: 'warning',
            code: 'condition.untyped',
            message: `Edge "${node.name}" → "${edge.target}" has a condition without a !type tag.`,
            line: condition.span.line,
            span: condition.span,
            node: node.name,
          });
        }
      }
    }
  }

  return diagnostics;
}
