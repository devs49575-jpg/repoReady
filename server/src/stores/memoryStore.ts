import { PRIVATE_ID_PREFIX } from '@repoready/shared';
import { nanoid } from 'nanoid';
import type { AnalysisPatch, AnalysisStore, NewAnalysis, StoredAnalysis } from './types';

export interface MemoryStoreOptions {
  ttlMinutes: number;
  maxEntries: number;
  sweepIntervalMs?: number;
  now?: () => number; // injectable clock for tests
}

/**
 * Private reports (Addendum 01, 5.4). Lives only in this process's memory: never written to
 * MongoDB or disk, lost on restart, not shared between instances (run a single instance).
 * Ids are `p_` + nanoid(32): unguessable, and the only way to reach a report.
 */
export class MemoryAnalysisStore implements AnalysisStore {
  readonly visibility = 'private' as const;
  private readonly entries = new Map<string, StoredAnalysis>();
  private readonly timer: NodeJS.Timeout;
  private readonly now: () => number;

  constructor(private readonly options: MemoryStoreOptions) {
    this.now = options.now ?? Date.now;
    this.timer = setInterval(() => this.sweep(), options.sweepIntervalMs ?? 60_000);
    this.timer.unref();
  }

  async create(doc: NewAnalysis): Promise<StoredAnalysis> {
    this.sweep();
    // Oldest first: Map iteration order is insertion order.
    while (this.entries.size >= this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const now = this.now();
    const stored: StoredAnalysis = {
      ...doc,
      id: `${PRIVATE_ID_PREFIX}${nanoid(32)}`,
      visibility: 'private',
      status: 'queued',
      error: null,
      report: null,
      scoreTotal: null,
      createdAt: new Date(now),
      startedAt: null,
      finishedAt: null,
      expiresAt: new Date(now + this.options.ttlMinutes * 60_000),
    };
    this.entries.set(stored.id, stored);
    return stored;
  }

  async get(id: string): Promise<StoredAnalysis | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    // Expired entries count as missing even before the sweep removes them.
    if (entry.expiresAt.getTime() <= this.now()) {
      this.entries.delete(id);
      return null;
    }
    return entry;
  }

  async update(id: string, patch: AnalysisPatch): Promise<void> {
    const entry = await this.get(id);
    // A deleted or expired report stays gone; a still-running job writes into nothing.
    if (entry) this.entries.set(id, { ...entry, ...patch });
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  /** Removes expired entries. Runs every minute and before each create. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt.getTime() <= now) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }

  /** For tests: the store's whole contents, as they would be serialized. */
  dump(): string {
    return JSON.stringify([...this.entries.values()]);
  }

  close(): void {
    clearInterval(this.timer);
  }
}
