import { Link } from 'react-router';
import { AlertIcon } from './icons';

export function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div
      role="alert"
      className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm dark:border-red-900/60 dark:bg-slate-900"
    >
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
        <AlertIcon className="h-5 w-5" />
      </div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{message}</p>
      <Link
        to="/"
        className="mt-5 inline-flex items-center rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        Try another repo
      </Link>
    </div>
  );
}
