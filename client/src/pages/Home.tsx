import { RecentList } from '../components/RecentList';
import { RepoInput } from '../components/RepoInput';

const FEATURES = [
  { title: 'How to run', text: 'Install, env and start commands, ready to copy.' },
  { title: 'Environment', text: 'Every env var the code reads, checked against .env.example.' },
  { title: 'Stack', text: 'Frameworks, databases, tooling and package manager.' },
  { title: 'Health checklist', text: 'README, CI, tests, linting, lockfile and more.' },
  { title: 'Architecture', text: 'An import graph with circular dependencies highlighted.' },
  { title: 'Dependencies', text: 'Known vulnerabilities and outdated packages.' },
];

export default function Home() {
  return (
    <div className="space-y-14">
      <section className="mx-auto max-w-2xl space-y-6 pt-6 text-center sm:pt-12">
        <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Paste a repo, get the onboarding doc nobody wrote.
        </h1>
        <p className="text-lg text-pretty text-slate-600 dark:text-slate-400">
          RepoReady reads a GitHub repository (public, or private with a read-only token) and turns
          it into a briefing for new developers: how to run it, what it needs and where the risks
          are.
        </p>
        <RepoInput />
      </section>

      <RecentList />

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="sr-only">
          What you get
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
