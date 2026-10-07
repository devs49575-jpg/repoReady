import { parseRepoInput } from '@repoready/shared';
import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { createAnalysis } from '../api/client';
import { useServerConfig } from '../api/hooks';
import { EXAMPLE_REPOS } from '../lib/examples';
import { errorMessage } from '../lib/format';
import { SpinnerIcon } from './icons';

// Same loose shape the server accepts (classic and fine-grained tokens).
const TOKEN_SHAPE = /^[A-Za-z0-9_]{20,255}$/;

export function RepoInput() {
  const navigate = useNavigate();
  const config = useServerConfig();
  const ids = { input: useId(), error: useId(), token: useId(), tokenError: useId() };
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const privateAvailable = config.data?.privateModeEnabled === true;
  const ttl = config.data?.privateReportTtlMinutes ?? 60;
  const [isPrivate, setIsPrivate] = useState(false);
  // The token lives only in this component's state and is cleared right after submit.
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [skipLookups, setSkipLookups] = useState(false);
  const usePrivate = privateAvailable && isPrivate;

  const submit = async (repoUrl: string) => {
    if (!parseRepoInput(repoUrl)) {
      setError('Enter a GitHub repository like owner/repo or https://github.com/owner/repo.');
      return;
    }
    let sendToken: string | undefined;
    if (usePrivate) {
      const t = token.trim();
      if (!t) return setTokenError('Paste a GitHub token with read access to this repository.');
      if (!TOKEN_SHAPE.test(t)) {
        return setTokenError('That does not look like a GitHub token (letters, digits and _).');
      }
      sendToken = t;
    }
    setError(null);
    setTokenError(null);
    setSubmitting(true);
    // Clear the token from state immediately; it is only passed along for this one request.
    setToken('');
    try {
      const created = await createAnalysis(
        usePrivate
          ? { repoUrl: repoUrl.trim(), skipExternalLookups: skipLookups }
          : { repoUrl: repoUrl.trim() },
        sendToken,
      );
      navigate(`/r/${created.id}`);
    } catch (err) {
      setError(errorMessage(err, usePrivate));
      setSubmitting(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(value);
  };

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={ids.input} className="sr-only">
            GitHub repository URL
          </label>
          <input
            id={ids.input}
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="https://github.com/owner/repo"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? ids.error : undefined}
            disabled={submitting}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-base shadow-sm placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 focus:outline-none disabled:opacity-60 aria-invalid:border-red-500 dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-5 py-3 font-medium text-white shadow-sm hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:opacity-70"
          >
            {submitting && <SpinnerIcon />}
            {submitting ? 'Starting...' : 'Analyze'}
          </button>
        </div>
        <p
          id={ids.error}
          role={error ? 'alert' : undefined}
          className="mt-2 min-h-5 text-left text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>

        {privateAvailable && (
          <div className="mt-1 text-left">
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => {
                  setIsPrivate(e.target.checked);
                  if (!e.target.checked) setToken('');
                }}
                disabled={submitting}
                className="h-4 w-4 accent-accent-600"
              />
              Private repository
            </label>

            {isPrivate && (
              <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
                <div>
                  <label htmlFor={ids.token} className="mb-1 block font-medium">
                    GitHub token (read-only)
                  </label>
                  <input
                    id={ids.token}
                    type="password"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="github_pat_..."
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      if (tokenError) setTokenError(null);
                    }}
                    aria-invalid={tokenError ? true : undefined}
                    aria-describedby={tokenError ? ids.tokenError : undefined}
                    disabled={submitting}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 focus:outline-none aria-invalid:border-red-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                  {tokenError && (
                    <p
                      id={ids.tokenError}
                      role="alert"
                      className="mt-1 text-red-600 dark:text-red-400"
                    >
                      {tokenError}
                    </p>
                  )}
                </div>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={skipLookups}
                    onChange={(e) => setSkipLookups(e.target.checked)}
                    disabled={submitting}
                    className="mt-0.5 h-4 w-4 accent-accent-600"
                  />
                  <span>Skip dependency lookups (no package names leave this server)</span>
                </label>

                <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  Your token is sent over HTTPS, used only while your repo is analyzed, and never
                  saved. The report is kept in memory for {ttl} minute{ttl === 1 ? '' : 's'} and
                  then deleted. No one can browse it without the link.
                </p>

                <details className="text-slate-600 dark:text-slate-400">
                  <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                    How do I create a read-only token?
                  </summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>
                      On GitHub: Settings, Developer settings, Personal access tokens, Fine-grained
                      tokens, Generate new token.
                    </li>
                    <li>
                      Resource owner: the owner of the repo. Repository access: “Only select
                      repositories”, then pick the one repo.
                    </li>
                    <li>
                      Permissions: <strong>Contents</strong> (read-only) and{' '}
                      <strong>Metadata</strong> (read-only). Nothing else.
                    </li>
                    <li>Choose a short expiry (for example 7 days), then copy the token here.</li>
                    <li>
                      Organization repos: an org admin may need to approve fine-grained tokens, and
                      orgs with SAML SSO require authorizing the token.
                    </li>
                  </ol>
                </details>
              </div>
            )}
          </div>
        )}
      </form>

      {!usePrivate && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span>Try:</span>
          {EXAMPLE_REPOS.map((repo) => (
            <button
              key={repo}
              type="button"
              disabled={submitting}
              onClick={() => {
                setValue(repo);
                void submit(repo);
              }}
              className="rounded-full border border-slate-200 px-3 py-1 font-mono text-xs text-slate-700 hover:border-accent-500 hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-accent-500 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:text-accent-200"
            >
              {repo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
