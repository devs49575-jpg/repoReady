import { Link, Route, Routes } from 'react-router';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import Report from './pages/Report';

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-3">
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-accent-500"
          >
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            RepoReady
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/r/:id" element={<Report />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:text-slate-400 dark:border-slate-800">
        RepoReady reads repository files only; it never runs their code.
      </footer>
    </div>
  );
}
