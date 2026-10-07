import type {
  AnalysisDto,
  ApiErrorBody,
  ConfigResponse,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  ErrorCode,
  RecentAnalysis,
} from '@repoready/shared';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly status: number;

  constructor(code: ErrorCode | 'NETWORK_ERROR', message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Could not reach the RepoReady server.', 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      body?.error.code ?? 'INTERNAL_ERROR',
      body?.error.message ?? `Request failed with status ${res.status}`,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Plain function, not a TanStack mutation: the token must not be kept in a query/mutation cache
 * or devtools (Addendum 01, Section 6). It is sent only in the X-GitHub-Token header of this one
 * request, never in the body, URL, storage or a query key.
 */
export function createAnalysis(
  input: CreateAnalysisRequest,
  token?: string,
): Promise<CreateAnalysisResponse> {
  return apiFetch<CreateAnalysisResponse>('/api/analyses', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: token ? { 'X-GitHub-Token': token } : undefined,
  });
}

export function getAnalysis(id: string): Promise<AnalysisDto> {
  return apiFetch<AnalysisDto>(`/api/analyses/${encodeURIComponent(id)}`);
}

export function deleteAnalysis(id: string): Promise<void> {
  return apiFetch<void>(`/api/analyses/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getConfig(): Promise<ConfigResponse> {
  return apiFetch<ConfigResponse>('/api/config');
}

export function getRecent(): Promise<RecentAnalysis[]> {
  return apiFetch<RecentAnalysis[]>('/api/analyses/recent');
}

/** Absolute URL (badges and downloads are used outside this page, e.g. in a README). */
export function absoluteApiUrl(path: string): string {
  return new URL(apiUrl(path), window.location.origin).href;
}

export function markdownUrl(id: string): string {
  return absoluteApiUrl(`/api/analyses/${encodeURIComponent(id)}/markdown`);
}

export function badgeUrl(owner: string, repo: string): string {
  return absoluteApiUrl(`/api/badge/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.svg`);
}
