import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, sampleAnalysis, sampleReport } from '../test/sampleAnalysis';
import Report from './Report';

function renderReport(response: Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response.clone()),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/r/6ac40249fcf86d85661fe088']}>
        <Routes>
          <Route path="/r/:id" element={<Report />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Report page', () => {
  it('shows the progress stepper while the analysis runs', async () => {
    renderReport(
      jsonResponse(
        sampleAnalysis({
          status: 'running',
          step: 'Scanning environment variables',
          progress: 55,
          report: null,
        }),
      ),
    );
    const bar = await screen.findByRole('progressbar', { name: /analysis progress/i });
    expect(bar).toHaveAttribute('aria-valuenow', '55');
    const current = screen.getByText('Scanning environment variables').closest('li');
    expect(current).toHaveAttribute('aria-current', 'step');
  });

  it('renders the finished report, with a failed section as an inline card', async () => {
    renderReport(jsonResponse(sampleAnalysis()));
    expect(await screen.findByRole('heading', { name: /acme\/widget/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /readiness score 64 out of 100: okay/i })).toBeVisible();

    // Working sections render normally...
    const howToRun = screen.getByRole('region', { name: 'How to run' });
    expect(within(howToRun).getByRole('button', { name: 'Copy command: npm ci' })).toBeVisible();
    const env = screen.getByRole('region', { name: 'Environment' });
    expect(within(env).getByText('SECRET')).toBeVisible();
    expect(
      within(env).getByRole('button', { name: /copy missing variables/i }),
    ).toBeInTheDocument();

    // Sharing: Markdown download and badge for public reports.
    expect(screen.getByRole('link', { name: 'Download Markdown' })).toHaveAttribute(
      'href',
      `${window.location.origin}/api/analyses/6ac40249fcf86d85661fe088/markdown`,
    );
    expect(
      screen.getByRole('button', { name: 'Copy badge Markdown for your README' }),
    ).toBeInTheDocument();

    // ...while a section with ok:false shows an inline error instead of breaking the page.
    const arch = screen.getByRole('region', { name: 'Architecture' });
    expect(within(arch).getByRole('note')).toHaveTextContent(/unavailable.*not analyzed yet/i);
  });

  it('survives a report where every analyzer failed', async () => {
    const broken = {
      ...sampleReport,
      stack: { ok: false as const, error: 'boom' },
      howToRun: { ok: false as const, error: 'boom' },
      env: { ok: false as const, error: 'boom' },
      checklist: { ok: false as const, error: 'boom' },
      score: { ok: false as const, error: 'boom' },
    };
    renderReport(jsonResponse(sampleAnalysis({ report: broken })));
    expect(await screen.findByRole('heading', { name: /acme\/widget/ })).toBeInTheDocument();
    expect(screen.getAllByRole('note').length).toBeGreaterThanOrEqual(8);
  });

  it('shows the error state for a failed analysis', async () => {
    renderReport(
      jsonResponse(
        sampleAnalysis({
          status: 'failed',
          report: null,
          error: {
            code: 'ANALYSIS_TIMEOUT',
            message: 'The analysis took too long and was stopped.',
          },
        }),
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/took too long/);
    expect(screen.getByRole('link', { name: 'Try another repo' })).toHaveAttribute('href', '/');
  });

  it('shows not found for an unknown id', async () => {
    renderReport(
      jsonResponse({ error: { code: 'NOT_FOUND', message: 'Analysis not found.' } }, 404),
    );
    expect(await screen.findByRole('heading', { name: 'Report not found' })).toBeInTheDocument();
  });
});
