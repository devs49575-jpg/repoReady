import { Graph, layout } from '@dagrejs/dagre';
import type { ArchitectureInfo } from '@repoready/shared';

export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 38;

export interface Positioned {
  id: string;
  x: number; // top-left, as React Flow expects
  y: number;
}

/** Left-to-right dagre layout. Pure, so it can be memoized and tested. */
export function layoutGraph(
  nodes: ArchitectureInfo['nodes'],
  edges: ArchitectureInfo['edges'],
): Positioned[] {
  const g = new Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 70, marginx: 10, marginy: 10 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) if (e.source !== e.target) g.setEdge(e.source, e.target);
  layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id) as { x: number; y: number };
    return { id: n.id, x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
  });
}

/** Node ids that take part in at least one circular edge. */
export function circularNodeIds(edges: ArchitectureInfo['edges']): Set<string> {
  const ids = new Set<string>();
  for (const e of edges) {
    if (e.circular) {
      ids.add(e.source);
      ids.add(e.target);
    }
  }
  return ids;
}
