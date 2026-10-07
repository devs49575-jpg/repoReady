import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { deleteAnalysis } from '../api/client';
import { errorMessage, formatCountdown } from '../lib/format';

/**
 * Shown on every private report: who can see it, a live countdown to auto-deletion, and
 * "Delete now". Calls `onExpired` when the countdown reaches zero.
 */
export function PrivateBanner({
  id,
  expiresAt,
  onExpired,
}: {
  id: string;
  expiresAt: string;
  onExpired: () => void;
}) {
  const navigate = useNavigate();
  const expiry = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = expiry - now;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remaining <= 0) onExpired();
  }, [remaining <= 0]); // eslint-disable-line react-hooks/exhaustive-deps -- fire once on expiry

  const onDelete = async () => {
    if (!window.confirm('Delete this private report now? This cannot be undone.')) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAnalysis(id);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Private report"
      className="flex flex-col gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-accent-800 dark:bg-accent-900/30"
    >
      <p className="text-accent-900 dark:text-accent-100">
        <strong>Private report.</strong> Only people with this link can view it. Auto-deletes in{' '}
        <time
          dateTime={expiresAt}
          className="font-mono font-semibold tabular-nums"
          aria-label={`${Math.ceil(Math.max(0, remaining) / 60_000)} minutes`}
        >
          {formatCountdown(remaining)}
        </time>
        .
      </p>
      <div className="flex items-center gap-3">
        {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-500 disabled:opacity-60 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950"
        >
          {deleting ? 'Deleting...' : 'Delete now'}
        </button>
      </div>
    </div>
  );
}
