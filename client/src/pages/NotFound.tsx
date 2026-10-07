import { Link } from 'react-router';

export default function NotFound() {
  return (
    <section className="space-y-4 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-slate-600 dark:text-slate-400">That page does not exist.</p>
      <Link to="/" className="font-medium text-accent-600 hover:underline dark:text-accent-300">
        Back to home
      </Link>
    </section>
  );
}
