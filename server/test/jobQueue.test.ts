import { describe, expect, it } from 'vitest';
import { JobQueue } from '../src/queue/jobQueue';
import { waitFor } from './helpers';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('JobQueue', () => {
  it('runs at most `concurrency` jobs at once, in FIFO order', async () => {
    const queue = new JobQueue(2, 10_000);
    const started: string[] = [];
    const gates = { a: deferred(), b: deferred(), c: deferred() };
    for (const id of ['a', 'b', 'c'] as const) {
      queue.enqueue(id, async () => {
        started.push(id);
        await gates[id].promise;
      });
    }
    expect(started).toEqual(['a', 'b']);
    expect(queue.stats).toEqual({ pending: 1, running: 2 });
    gates.a.resolve();
    await waitFor(() => started.length === 3);
    expect(started).toEqual(['a', 'b', 'c']);
    gates.b.resolve();
    gates.c.resolve();
    await waitFor(() => queue.stats.running === 0);
  });

  it('aborts a job that exceeds the timeout with ANALYSIS_TIMEOUT and frees the slot', async () => {
    const queue = new JobQueue(1, 50);
    let reason: unknown;
    queue.enqueue('slow', (signal) => {
      signal.addEventListener('abort', () => (reason = signal.reason));
      return new Promise(() => {}); // ignores the signal entirely
    });
    let nextRan = false;
    queue.enqueue('next', async () => {
      nextRan = true;
    });
    await waitFor(() => nextRan);
    expect(reason).toMatchObject({ code: 'ANALYSIS_TIMEOUT' });
  });

  it('cancels queued and running jobs', async () => {
    const queue = new JobQueue(1, 10_000);
    let aborted = false;
    queue.enqueue('running', (signal) => {
      signal.addEventListener('abort', () => (aborted = true));
      return new Promise(() => {});
    });
    let queuedRan = false;
    queue.enqueue('queued', async () => {
      queuedRan = true;
    });
    expect(queue.cancel('queued')).toBe(true);
    expect(queue.cancel('running')).toBe(true);
    expect(queue.cancel('unknown')).toBe(false);
    await waitFor(() => queue.stats.running === 0);
    expect(aborted).toBe(true);
    expect(queuedRan).toBe(false);
  });

  it('keeps going after a job throws', async () => {
    const queue = new JobQueue(1, 10_000);
    queue.enqueue('bad', async () => {
      throw new Error('boom');
    });
    let ran = false;
    queue.enqueue('good', async () => {
      ran = true;
    });
    await waitFor(() => ran);
  });
});
