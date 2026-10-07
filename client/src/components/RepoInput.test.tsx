import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/sampleAnalysis';
import { RepoInput } from './RepoInput';

const TOKEN = 'github_pat_TESTSECRET0123456789';

const seen = { location: '' };
function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    seen.location = `${loc.pathname}${loc.search}${loc.hash}`;
  }, [loc]);
  return null;
}

/** Fake API: /api/config plus a configurable POST /api/analyses. */
function mockApi(options: { privateMode?: boolean; create?: () => Response } = {}) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/api/config') {
      return jsonResponse({
        privateModeEnabled: options.privateMode ?? false,
        privateReportTtlMinutes: 60,
      });
    }
    return (
      options.create?.() ??
      jsonResponse({ id: 'abc', status: 'queued', visibility: 'public', expiresAt: null }, 202)
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderInput() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <LocationSpy />
        <Routes>
          <Route path="/" element={<RepoInput />} />
          <Route path="/r/:id" element={<p>report page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

function postCalls(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/analyses') as unknown as [
    string,
    RequestInit,
  ][];
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('RepoInput (public)', () => {
  it('shows an inline error for an invalid URL and does not call the API', async () => {
    const fetchMock = mockApi();
    renderInput();
    const input = screen.getByLabelText(/github repository url/i);
    await userEvent.type(input, 'https://gitlab.com/a/b');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/enter a github repository/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(postCalls(fetchMock)).toHaveLength(0);
  });

  it('starts an analysis and navigates to the report', async () => {
    const fetchMock = mockApi();
    renderInput();
    await userEvent.type(screen.getByLabelText(/github repository url/i), 'expressjs/cors');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(await screen.findByText('report page')).toBeInTheDocument();
    const [, init] = postCalls(fetchMock)[0]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ repoUrl: 'expressjs/cors' });
    expect(init.headers).not.toHaveProperty('X-GitHub-Token');
  });

  it('shows the server error message when the API rejects the repo', async () => {
    mockApi({
      create: () =>
        jsonResponse({ error: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' } }, 404),
    });
    renderInput();
    await userEvent.type(screen.getByLabelText(/github repository url/i), 'acme/missing');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Repository not found.');
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
  });

  it('runs an example repo with one click', async () => {
    mockApi();
    renderInput();
    await userEvent.click(screen.getByRole('button', { name: 'expressjs/cors' }));
    expect(await screen.findByText('report page')).toBeInTheDocument();
  });
});

describe('RepoInput (private mode, Addendum 01)', () => {
  it('hides the private option when the server disables it', async () => {
    const fetchMock = mockApi({ privateMode: false });
    renderInput();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/config', expect.anything()));
    expect(screen.queryByRole('checkbox', { name: 'Private repository' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/github token/i)).not.toBeInTheDocument();
  });

  it('shows a password-type token field only after ticking "Private repository"', async () => {
    mockApi({ privateMode: true });
    renderInput();
    const toggle = await screen.findByRole('checkbox', { name: 'Private repository' });
    expect(screen.queryByLabelText(/github token/i)).not.toBeInTheDocument();
    await userEvent.click(toggle);
    const tokenInput = screen.getByLabelText(/github token/i);
    expect(tokenInput).toHaveAttribute('type', 'password');
    expect(tokenInput).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByText(/never saved/)).toHaveTextContent(/kept in memory for 60 minutes/);
    expect(screen.getByText(/Contents/)).toBeInTheDocument();
  });

  it('validates the token before sending anything', async () => {
    const fetchMock = mockApi({ privateMode: true });
    renderInput();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Private repository' }));
    await userEvent.type(screen.getByLabelText(/github repository url/i), 'acme/secret');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/paste a github token/i);
    await userEvent.type(screen.getByLabelText(/github token/i), 'not a token!');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/does not look like a github token/i);
    expect(postCalls(fetchMock)).toHaveLength(0);
  });

  it('sends the token only in the header, then clears it from state, URL and storage', async () => {
    const fetchMock = mockApi({
      privateMode: true,
      create: () =>
        jsonResponse({ error: { code: 'SSO_REQUIRED', message: 'SSO required.' } }, 403),
    });
    const { client } = renderInput();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Private repository' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /skip dependency lookups/i }));
    await userEvent.type(screen.getByLabelText(/github repository url/i), 'acme/secret');
    await userEvent.type(screen.getByLabelText(/github token/i), TOKEN);
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    // Friendly, actionable error for SSO.
    expect(await screen.findByRole('alert')).toHaveTextContent(/authorize it for the organization/);

    const [url, init] = postCalls(fetchMock)[0]!;
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>)['X-GitHub-Token']).toBe(TOKEN);
    expect(JSON.parse(String(init.body))).toEqual({
      repoUrl: 'acme/secret',
      skipExternalLookups: true,
    });

    // Cleared from the input (state) even though the request failed...
    expect(screen.getByLabelText(/github token/i)).toHaveValue('');
    // ...and never written anywhere else.
    expect(seen.location).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    expect(document.cookie).not.toContain(TOKEN);
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => [q.queryKey, q.state.data]),
      ),
    ).not.toContain(TOKEN);
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(TOKEN);
  });

  it('navigates to the private report on success with the token cleared', async () => {
    mockApi({
      privateMode: true,
      create: () =>
        jsonResponse(
          {
            id: 'p_V1StGXR8_Z5jdHi6B-myTV1StGXR8_Z5',
            status: 'queued',
            visibility: 'private',
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          },
          202,
        ),
    });
    renderInput();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Private repository' }));
    await userEvent.type(screen.getByLabelText(/github repository url/i), 'acme/secret');
    await userEvent.type(screen.getByLabelText(/github token/i), TOKEN);
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(await screen.findByText('report page')).toBeInTheDocument();
    expect(seen.location).toBe('/r/p_V1StGXR8_Z5jdHi6B-myTV1StGXR8_Z5');
  });
});
