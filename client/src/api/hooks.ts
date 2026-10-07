import type { AnalysisDto } from '@repoready/shared';
import { useQuery } from '@tanstack/react-query';
import { ApiError, getAnalysis, getConfig, getRecent } from './client';

export const POLL_INTERVAL_MS = 2000;

function isInProgress(analysis: AnalysisDto | undefined): boolean {
  return analysis?.status === 'queued' || analysis?.status === 'running';
}

/** Fetches an analysis, polling every 2s only while it is queued or running. */
export function useAnalysis(id: string) {
  return useQuery({
    queryKey: ['analysis', id],
    queryFn: () => getAnalysis(id),
    refetchInterval: (query) => (isInProgress(query.state.data) ? POLL_INTERVAL_MS : false),
    // A 404 will not fix itself (unknown, deleted or expired report); retry anything else twice.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 2,
  });
}

/** Server feature flags (e.g. whether private repo mode is available). */
export function useServerConfig() {
  return useQuery({ queryKey: ['config'], queryFn: getConfig, staleTime: Infinity, retry: 1 });
}

/** Last finished public analyses for the home page gallery. */
export function useRecent() {
  return useQuery({ queryKey: ['recent'], queryFn: getRecent, staleTime: 30_000, retry: 1 });
}
