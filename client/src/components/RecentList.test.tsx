import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/sampleAnalysis';
import { RecentList } from './RecentList';

function renderWith(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(body)),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RecentList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('RecentList', () => {
  it('links to recent public reports with their scores', async () => {
    renderWith([
      { id: 'a1', fullName: 'expressjs/cors', score: 78, createdAt: new Date().toISOString() },
      { id: 'b2', fullName: 'acme/old', score: null, createdAt: new Date().toISOString() },
    ]);
    const link = await screen.findByRole('link', { name: /expressjs\/cors/ });
    expect(link).toHaveAttribute('href', '/r/a1');
    expect(link).toHaveTextContent('78/100');
    expect(screen.getByRole('link', { name: /acme\/old/ })).toHaveTextContent('no score');
  });

  it('renders nothing when there are no analyses yet', async () => {
    const { container } = renderWith([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
