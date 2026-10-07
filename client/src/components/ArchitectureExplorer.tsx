import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ArchitectureInfo } from '@repoready/shared';
import { useId, useMemo, useState } from 'react';
import { NODE_HEIGHT, NODE_WIDTH, circularNodeIds, layoutGraph } from '../lib/graphLayout';
import { XIcon } from './icons';

const MAX_SEARCH_RESULTS = 8;

/** Interactive graph: search, "circular only" filter, and a side panel for the selected node. */
export default function ArchitectureExplorer({ arch }: { arch: ArchitectureInfo }) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [circularOnly, setCircularOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const inCycle = useMemo(() => circularNodeIds(arch.edges), [arch.edges]);
  const visibleNodes = useMemo(
    () => (circularOnly ? arch.nodes.filter((n) => inCycle.has(n.id)) : arch.nodes),
    [arch.nodes, circularOnly, inCycle],
  );
  const visibleEdges = useMemo(
    () => (circularOnly ? arch.edges.filter((e) => e.circular) : arch.edges),
    [arch.edges, circularOnly],
  );
  const positions = useMemo(
    () => layoutGraph(visibleNodes, visibleEdges),
    [visibleNodes, visibleEdges],
  );

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? visibleNodes.filter((n) => n.id.toLowerCase().includes(q)) : []),
    [visibleNodes, q],
  );
  const matchIds = useMemo(() => new Set(matches.map((m) => m.id)), [matches]);

  const flowNodes: Node[] = useMemo(() => {
    const posById = new Map(positions.map((p) => [p.id, p]));
    return visibleNodes.map((n) => {
      const pos = posById.get(n.id)!;
      const highlighted = matchIds.has(n.id);
      const isSelected = n.id === selected;
      return {
        id: n.id,
        position: { x: pos.x, y: pos.y },
        data: { label: n.fileCount ? `${n.label} (${n.fileCount})` : n.label },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        selected: isSelected,
        connectable: false,
        ariaLabel: `${n.id}: imports ${n.imports}, imported by ${n.importedBy}`,
        style: {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          fontSize: 12,
          padding: '8px 10px',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          borderColor: isSelected
            ? '#4f46e5'
            : highlighted
              ? '#6366f1'
              : inCycle.has(n.id)
                ? '#ef4444'
                : undefined,
          borderWidth: isSelected || highlighted ? 2 : 1,
          opacity: q && !highlighted ? 0.35 : 1,
        },
      };
    });
  }, [visibleNodes, positions, matchIds, selected, inCycle, q]);

  const flowEdges: Edge[] = useMemo(
    () =>
      visibleEdges.map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        animated: e.circular,
        label: arch.level === 'folder' && e.weight ? String(e.weight) : undefined,
        markerEnd: { type: MarkerType.ArrowClosed, color: e.circular ? '#ef4444' : '#94a3b8' },
        style: { stroke: e.circular ? '#ef4444' : '#94a3b8', strokeWidth: e.circular ? 2 : 1 },
      })),
    [visibleEdges, arch.level],
  );

  const selectedNode = selected ? arch.nodes.find((n) => n.id === selected) : undefined;
  const importsOf = selected
    ? arch.edges.filter((e) => e.source === selected).map((e) => e.target)
    : [];
  const importedByOf = selected
    ? arch.edges.filter((e) => e.target === selected).map((e) => e.source)
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={searchId} className="sr-only">
          Search files in the graph
        </label>
        <input
          id={searchId}
          type="search"
          placeholder={arch.level === 'folder' ? 'Search folders...' : 'Search files...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={circularOnly}
            onChange={(e) => setCircularOnly(e.target.checked)}
            disabled={inCycle.size === 0}
            className="h-4 w-4 accent-accent-600"
          />
          Show circular only
        </label>
      </div>

      {q && (
        <div aria-live="polite" className="text-sm">
          {matches.length === 0 ? (
            <p className="text-slate-500 dark:text-slate-400">No matches.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" aria-label="Search results">
              {matches.slice(0, MAX_SEARCH_RESULTS).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(m.id)}
                    className="rounded-md border border-slate-200 px-2 py-0.5 font-mono text-xs hover:border-accent-500 focus-visible:outline-2 focus-visible:outline-accent-500 dark:border-slate-700"
                  >
                    {m.id}
                  </button>
                </li>
              ))}
              {matches.length > MAX_SEARCH_RESULTS && (
                <li className="self-center text-xs text-slate-500 dark:text-slate-400">
                  and {matches.length - MAX_SEARCH_RESULTS} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* The details panel overlays the graph so opening it never resizes the canvas. */}
      <div className="relative">
        <div
          className="h-[28rem] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
          role="figure"
          aria-label={`Dependency graph with ${visibleNodes.length} nodes and ${visibleEdges.length} edges`}
        >
          <ReactFlow
            // Remount when the filter changes so fitView frames the nodes that are left.
            key={circularOnly ? 'circular' : 'all'}
            nodes={flowNodes}
            edges={flowEdges}
            onNodeClick={(_e, node) => setSelected(node.id)}
            onPaneClick={() => setSelected(null)}
            nodesConnectable={false}
            nodesDraggable
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.05}
            onlyRenderVisibleElements={visibleNodes.length > 150}
            colorMode="system"
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {selectedNode && (
          <aside
            aria-label={`Details for ${selectedNode.id}`}
            className="absolute top-2 right-2 bottom-2 z-10 w-[min(18rem,calc(100%-1rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white/95 p-3 text-sm shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-mono text-xs font-semibold break-all">{selectedNode.id}</h3>
              <button
                type="button"
                aria-label="Close details"
                onClick={() => setSelected(null)}
                className="rounded p-0.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <XIcon />
              </button>
            </div>
            {selectedNode.fileCount !== undefined && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {selectedNode.fileCount} files
              </p>
            )}
            <NodeList title="Imports" ids={importsOf} onSelect={setSelected} />
            <NodeList title="Imported by" ids={importedByOf} onSelect={setSelected} />
          </aside>
        )}
      </div>
    </div>
  );
}

function NodeList({
  title,
  ids,
  onSelect,
}: {
  title: string;
  ids: string[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">
        {title} ({ids.length})
      </h4>
      {ids.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">None</p>
      ) : (
        <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
          {ids.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                className="w-full truncate rounded px-1 py-0.5 text-left font-mono text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                title={id}
              >
                {id}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
