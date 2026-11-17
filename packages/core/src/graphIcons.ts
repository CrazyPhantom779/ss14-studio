/**
 * Graph and prototype icon enrichment.
 *
 * Construction graphs frequently omit an `entity:` on a node because the
 * entity is dynamic (a circuit board selects the final computer) or because
 * the node name is already the entity id. Resolving those requires the full
 * prototype index, so the host calls these helpers after indexing.
 */
import type { ConstructionGraph, ConstructionNode } from './model.js';

export interface GraphIconResolver {
  /** True when an entity prototype with this id exists. */
  hasEntity(id: string): boolean;
  /** Circuit-board variants for a board component type. */
  boardTargets(component: string): { board: string; entity: string }[];
}

function boardComponentForContainer(container: string | null | undefined): string | null {
  switch (container) {
    case 'machine_board':
    case 'machineBoard':
      return 'MachineBoard';
    case 'desktop_board':
    case 'desktopBoard':
      return 'DesktopBoard';
    case 'board':
      return 'ComputerBoard';
    default:
      return null;
  }
}

function incomingBoardComponent(graph: ConstructionGraph, node: ConstructionNode): string | null {
  for (const source of graph.nodes) {
    for (const edge of source.edges) {
      if (edge.target !== node.name) continue;
      for (const step of edge.steps) {
        const component = step.fields.component;
        if (typeof component === 'string' && /Board$/.test(component)) {
          return component;
        }
      }
    }
  }
  return null;
}

function boardComponentForNode(graph: ConstructionGraph, node: ConstructionNode): string | null {
  const container =
    typeof node.entityFields?.container === 'string'
      ? node.entityFields.container
      : null;
  return (
    boardComponentForContainer(container) ?? incomingBoardComponent(graph, node)
  );
}

/**
 * Fill `iconEntities` on every node that can be resolved to one or more
 * prototypes. Mutates and returns the graph.
 */
export function enrichGraphIcons(
  graph: ConstructionGraph,
  resolver: GraphIconResolver,
): ConstructionGraph {
  for (const node of graph.nodes) {
    const icons: string[] = [];
    if (node.entity && node.entityType !== 'BoardNodeEntity') {
      icons.push(node.entity);
    }
    if (node.entityType === 'BoardNodeEntity') {
      const component = boardComponentForNode(graph, node);
      if (component) {
        icons.push(...resolver.boardTargets(component).map((target) => target.entity));
      }
    }
    if (icons.length === 0) {
      const component = boardComponentForNode(graph, node);
      if (component) {
        // The board was just inserted on the incoming edge; show every board
        // variant (the actual board is chosen by the player).
        icons.push(...resolver.boardTargets(component).map((target) => target.board));
      }
    }
    if (icons.length === 0 && resolver.hasEntity(node.name)) {
      icons.push(node.name);
    }
    if (icons.length > 0) {
      node.iconEntities = [...new Set(icons)];
    }
  }
  return graph;
}

/**
 * Resolve the entity a construction recipe builds at `targetNode`.
 *
 * Returns null when the node has no static entity and no board variants.
 */
export function constructionDisplayEntity(
  graph: ConstructionGraph,
  targetNode: string,
  resolver: GraphIconResolver,
): string | null {
  const node = graph.nodes.find((candidate) => candidate.name === targetNode);
  if (!node) return null;
  if (node.entity) return node.entity;
  if (node.entityType === 'BoardNodeEntity') {
    const component = boardComponentForNode(graph, node);
    if (!component) return null;
    return resolver.boardTargets(component)[0]?.entity ?? null;
  }
  if (resolver.hasEntity(node.name)) return node.name;
  return null;
}
