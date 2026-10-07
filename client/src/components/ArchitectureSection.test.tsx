import type { ArchitectureInfo } from '@repoready/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { circularNodeIds, layoutGraph } from '../lib/graphLayout';
import { ArchitectureSection } from './ArchitectureSection';

const arch: ArchitectureInfo = {
  level: 'file',
  analyzedFiles: 5,
  nodes: [
    { id: 'src/index.js', label: 'index.js', folder: 'src', imports: 1, importedBy: 0 },
    { id: 'src/a.js', label: 'a.js', folder: 'src', imports: 1, importedBy: 2 },
    { id: 'src/b.js', label: 'b.js', folder: 'src', imports: 1, importedBy: 1 },
    { id: 'src/c.js', label: 'c.js', folder: 'src', imports: 1, importedBy: 1 },
    { id: 'src/unused.js', label: 'unused.js', folder: 'src', imports: 0, importedBy: 0 },
  ],
  edges: [
    { source: 'src/index.js', target: 'src/a.js', circular: false },
    { source: 'src/a.js', target: 'src/b.js', circular: true },
    { source: 'src/b.js', target: 'src/c.js', circular: true },
    { source: 'src/c.js', target: 'src/a.js', circular: true },
  ],
  circular: [['src/a.js', 'src/b.js', 'src/c.js']],
  orphans: ['src/unused.js'],
  truncated: false,
};

describe('ArchitectureSection', () => {
  it('summarizes the graph and lists each cycle as a closed loop', () => {
    render(<ArchitectureSection result={{ ok: true, data: arch }} />);
    expect(screen.getByText('5 files analyzed')).toBeInTheDocument();
    expect(screen.getByText('1 circular dependency')).toBeInTheDocument();
    expect(screen.getByText('src/a.js → src/b.js → src/c.js → src/a.js')).toBeInTheDocument();
    expect(screen.getByText('Files nobody imports (1)')).toBeInTheDocument();
  });

  it('collapses long cycle lists', async () => {
    const circular = Array.from({ length: 8 }, (_, i) => [`src/x${i}.js`, `src/y${i}.js`]);
    render(<ArchitectureSection result={{ ok: true, data: { ...arch, circular } }} />);
    expect(screen.getAllByText(/^src\/x\d\.js → /)).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: 'Show all 8 cycles' }));
    expect(screen.getAllByText(/^src\/x\d\.js → /)).toHaveLength(8);
  });

  it('explains folder-level and truncated graphs', () => {
    render(
      <ArchitectureSection
        result={{
          ok: true,
          data: { ...arch, level: 'folder', analyzedFiles: 900, truncated: true },
        }}
      />,
    );
    expect(screen.getByText(/900 files, so the graph groups them by folder/)).toBeInTheDocument();
    expect(screen.getByText(/most connected nodes are shown/)).toBeInTheDocument();
  });

  it('lets you search for a file and see what it imports and what imports it', async () => {
    render(<ArchitectureSection result={{ ok: true, data: arch }} />);
    const search = await screen.findByLabelText('Search files in the graph');
    await userEvent.type(search, 'a.js');
    const results = screen.getByRole('list', { name: 'Search results' });
    await userEvent.click(within(results).getByRole('button', { name: 'src/a.js' }));

    const panel = screen.getByRole('complementary', { name: 'Details for src/a.js' });
    expect(within(panel).getByText('Imports (1)')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'src/b.js' })).toBeInTheDocument();
    expect(within(panel).getByText('Imported by (2)')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'src/index.js' })).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('can filter the graph to circular dependencies only', async () => {
    render(<ArchitectureSection result={{ ok: true, data: arch }} />);
    const toggle = await screen.findByRole('checkbox', { name: 'Show circular only' });
    expect(screen.getByRole('figure', { name: /5 nodes and 4 edges/ })).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByRole('figure', { name: /3 nodes and 3 edges/ })).toBeInTheDocument();
  });

  it('shows an inline error when the analyzer failed', () => {
    render(
      <ArchitectureSection result={{ ok: false, error: 'Architecture analysis timed out' }} />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('Architecture analysis timed out');
  });
});

describe('graph layout', () => {
  it('positions every node left to right', () => {
    const pos = layoutGraph(arch.nodes, arch.edges);
    expect(pos).toHaveLength(5);
    const x = Object.fromEntries(pos.map((p) => [p.id, p.x]));
    expect(x['src/index.js']!).toBeLessThan(x['src/a.js']!);
  });

  it('collects nodes on circular edges', () => {
    expect([...circularNodeIds(arch.edges)].sort()).toEqual(['src/a.js', 'src/b.js', 'src/c.js']);
  });
});
