import type { DepsInfo, PeopleInfo } from '@repoready/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DepsSection } from './DepsSection';
import { PeopleSection } from './PeopleSection';

const deps: DepsInfo = {
  lockfileUsed: true,
  approximate: false,
  totalPackages: 120,
  directPackages: 12,
  skippedPackages: 0,
  vulnerabilities: [
    {
      id: 'GHSA-p6mc-m468-83gw',
      aliases: ['CVE-2020-8203'],
      package: 'lodash',
      version: '4.17.15',
      severity: 'high',
      summary: 'Prototype Pollution in lodash',
      fixedIn: '4.17.19',
      url: 'https://osv.dev/vulnerability/GHSA-p6mc-m468-83gw',
    },
  ],
  outdated: [{ name: 'react', current: '18.3.1', latest: '19.0.0', type: 'major' }],
  counts: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
  notes: [],
};

describe('DepsSection', () => {
  it('shows severity counts, vulnerabilities with links, and outdated packages', () => {
    render(<DepsSection result={{ ok: true, data: deps }} />);
    expect(screen.getByText('1 high')).toBeInTheDocument();
    expect(screen.getByText('120 packages checked, 12 direct')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /GHSA-p6mc-m468-83gw/ });
    expect(link).toHaveAttribute('href', deps.vulnerabilities[0]!.url);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('4.17.19')).toBeInTheDocument();
    expect(screen.getByText('18.3.1 → 19.0.0')).toBeInTheDocument();
    expect(screen.queryByText(/approximated/)).not.toBeInTheDocument();
  });

  it('shows the approximate banner and notes without a lockfile', () => {
    render(
      <DepsSection
        result={{
          ok: true,
          data: { ...deps, lockfileUsed: false, approximate: true, notes: ['A note'] },
        }}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(/approximated from the ranges/);
    expect(screen.getByText('• A note')).toBeInTheDocument();
  });

  it('collapses long vulnerability lists', async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      ...deps.vulnerabilities[0]!,
      id: `GHSA-${i}`,
    }));
    render(<DepsSection result={{ ok: true, data: { ...deps, vulnerabilities: many } }} />);
    expect(screen.getAllByRole('link', { name: /GHSA-\d+/ })).toHaveLength(10);
    await userEvent.click(screen.getByRole('button', { name: 'Show all 14 vulnerabilities' }));
    expect(screen.getAllByRole('link', { name: /GHSA-\d+/ })).toHaveLength(14);
  });

  it('degrades to an inline note when the lookup failed', () => {
    render(
      <DepsSection
        result={{ ok: false, error: 'Could not check vulnerabilities: OSV.dev did not respond' }}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(/OSV\.dev did not respond/);
  });
});

describe('PeopleSection', () => {
  const people: PeopleInfo = {
    contributors: [{ login: 'ann', avatarUrl: 'https://avatars.example/ann.png', commits: 40 }],
    byFolder: [{ folder: 'src', people: [{ login: 'bob', commits: 7 }] }],
    lastCommitAt: new Date().toISOString(),
  };

  it('lists contributors and who to ask per folder', () => {
    render(<PeopleSection result={{ ok: true, data: people }} />);
    expect(screen.getByText(/Last commit/)).toHaveTextContent('just now');
    expect(screen.getByRole('link', { name: 'ann, 40 commits' })).toHaveAttribute(
      'href',
      'https://github.com/ann',
    );
    const whoToAsk = screen.getByText('Who to ask').parentElement!;
    expect(within(whoToAsk).getByText('src/')).toBeInTheDocument();
    expect(within(whoToAsk).getByRole('link', { name: /bob/ })).toBeInTheDocument();
  });

  it('handles empty data', () => {
    render(
      <PeopleSection
        result={{ ok: true, data: { contributors: [], byFolder: [], lastCommitAt: null } }}
      />,
    );
    expect(screen.getByText('No contributor data available.')).toBeInTheDocument();
  });
});
