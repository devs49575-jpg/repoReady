import { AppError } from '../utils/errors';

export type JobRunner = (signal: AbortSignal) => Promise<void>;

interface Job {
  id: string;
  run: JobRunner;
}

/**
 * In-memory FIFO with fixed concurrency. Each running job gets an AbortSignal that fires on the
 * overall timeout or on cancel(). Runners must handle their own errors (they record them in the
 * store); anything they throw is swallowed here so one job never stalls the queue.
 */
export class JobQueue {
  private readonly pending: Job[] = [];
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly concurrency: number,
    private readonly timeoutMs: number,
  ) {}

  enqueue(id: string, run: JobRunner): void {
    this.pending.push({ id, run });
    this.drain();
  }

  /** Removes a queued job or aborts a running one. Returns false if the id is unknown. */
  cancel(
    id: string,
    reason: unknown = new AppError('ANALYSIS_FAILED', 'The analysis was cancelled.'),
  ): boolean {
    const index = this.pending.findIndex((j) => j.id === id);
    if (index !== -1) {
      this.pending.splice(index, 1);
      return true;
    }
    const controller = this.running.get(id);
    if (!controller) return false;
    controller.abort(reason);
    return true;
  }

  get stats(): { pending: number; running: number } {
    return { pending: this.pending.length, running: this.running.size };
  }

  private drain(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      void this.start(job);
    }
  }

  private async start(job: Job): Promise<void> {
    const controller = new AbortController();
    this.running.set(job.id, controller);
    const timer = setTimeout(() => {
      controller.abort(
        new AppError('ANALYSIS_TIMEOUT', 'The analysis took too long and was stopped.'),
      );
    }, this.timeoutMs);
    try {
      await raceAbort(job.run(controller.signal), controller.signal);
    } catch {
      // The runner records its own failure; a runner that ignores the signal still frees its slot.
    } finally {
      clearTimeout(timer);
      this.running.delete(job.id);
      this.drain();
    }
  }
}

/** Resolves/rejects with `promise`, or rejects with the abort reason as soon as `signal` fires. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}
