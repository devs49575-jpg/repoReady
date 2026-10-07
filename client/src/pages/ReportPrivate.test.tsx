import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatCountdown } from '../lib/format';
import { jsonResponse, sampleAnalysis, sampleReport } from '../test/sampleAnalysis';
import Report from './Report';

const PRIVATE_ID = 'p_V1StGXR8_Z5jdHi6B-myTV1StGXR8_Z5';

function privateAnalysis(minutesLeft = 42) {
  const expiresAt = new Date(Date.now() + minutesLeft * 60_000).toISOString();
  return sampleAnalysis({
    id: PRIVATE_ID,
    visibility: 'private',
    expiresAt,
    report: {
      ...sampleReport,
      privacy: { visibility: 'private', expiresAt, externalLookups: false },
    },
  });
}

function renderAt(id: string, handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init).clone());
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/r/${id}`]}>
        <Routes>
          <Route path="/r/:id" element={<Report />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // React removes its hoisted <meta> tags itself on unmount; removing them here breaks React.
});

describe('private report page', () => {
  it('shows the private banner with a countdown and the privacy line', async () => {
    renderAt(PRIVATE_ID, () => jsonResponse(privateAnalysis(42)));
    const banner = await screen.findByRole('region', { name: 'Private report' });
    expect(banner).toHaveTextContent(/Only people with this link can view it/);
    expect(within(banner).getByText(/^4[12]:\d\d$/)).toBeInTheDocument();
    expect(screen.getByText(/Dependency lookups were skipped/)).toBeInTheDocument();
    // Public-sharing actions are hidden; Copy link stays.
    expect(screen.queryByRole('button', { name: /badge/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link to this report' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download Markdown' })).toBeInTheDocument();
  });

  it('adds noindex and no-referrer meta tags', async () => {
    renderAt(PRIVATE_ID, () => jsonResponse(privateAnalysis()));
    await screen.findByRole('region', { name: 'Private report' });
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    );
  });

  it('"Delete now" confirms, calls DELETE and goes home', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = renderAt(PRIVATE_ID, (_url, init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : jsonResponse(privateAnalysis()),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Delete now' }));
    expect(await screen.findByText('home page')).toBeInTheDocument();
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(del?.[0]).toBe(`/api/analyses/${PRIVATE_ID}`);
  });

  it('does nothing if the deletion is not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = renderAt(PRIVATE_ID, () => jsonResponse(privateAnalysis()));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete now' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('explains that an expired or deleted private report is gone', async () => {
    renderAt(PRIVATE_ID, () =>
      jsonResponse(
        { error: { code: 'REPORT_NOT_FOUND', message: 'This report has expired or was deleted.' } },
        404,
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This private report has expired or was deleted. Run the analysis again.',
    );
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });

  it('shows no banner or meta tags for public reports', async () => {
    renderAt('6ac40249fcf86d85661fe088', () => jsonResponse(sampleAnalysis()));
    await screen.findByRole('heading', { name: /acme\/widget/ });
    expect(screen.queryByRole('region', { name: 'Private report' })).not.toBeInTheDocument();
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
    expect(screen.queryByText(/Privacy:/)).not.toBeInTheDocument();
  });
});

describe('formatCountdown', () => {
  it('formats MM:SS and clamps at zero', () => {
    expect(formatCountdown(59 * 60_000 + 5_000)).toBe('59:05');
    expect(formatCountdown(61 * 60_000)).toBe('61:00');
    expect(formatCountdown(-1)).toBe('00:00');
  });
});
