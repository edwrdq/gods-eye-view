import { HttpError } from './http.ts';
import { realTimers, type Timers } from './types.ts';

export interface PollLoopOptions {
  intervalMs: number;
  /** Delay before the first attempt (default 0). */
  initialDelayMs?: number;
  now?: () => number;
  timers?: Timers;
  /** How often due-ness is checked (default 1 s; the actual cadence is intervalMs). */
  tickMs?: number;
  /** Largest failure backoff, excluding a server-provided Retry-After (default max(interval, 10 min)). */
  maxBackoffMs?: number;
  /** One poll. Throw to signal failure. May return a custom delay until the next poll. */
  run(signal: AbortSignal): Promise<{ nextInMs?: number } | void>;
  onError(err: unknown): void;
}

const MAX_RETRY_AFTER_MS = 60 * 60_000;

/**
 * Polls on an interval with exponential backoff on failure. HTTP 429/5xx with
 * Retry-After wait at least that long. Scheduling uses an injectable clock and
 * timers; tests drive it by calling tick().
 */
export class PollLoop {
  private readonly opts: PollLoopOptions;
  private readonly now: () => number;
  private readonly timers: Timers;
  private timer: unknown = null;
  private abort = new AbortController();
  private running: Promise<void> | null = null;
  nextDue = 0;
  fails = 0;

  constructor(opts: PollLoopOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? realTimers;
  }

  get active(): boolean {
    return this.timer !== null;
  }

  start(initialDelayMs: number = this.opts.initialDelayMs ?? 0): void {
    if (this.timer !== null) return;
    this.abort = new AbortController();
    this.nextDue = this.now() + initialDelayMs;
    this.timer = this.timers.setInterval(() => void this.tick(), this.opts.tickMs ?? 1000);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.abort.abort();
    await this.running?.catch(() => {});
  }

  /** Make the next tick poll immediately. */
  pollSoon(): void {
    this.nextDue = 0;
  }

  /** Resolves when no poll is in flight. */
  async idle(): Promise<void> {
    while (this.running) await this.running.catch(() => {});
  }

  /** Poll if due and idle. Resolves when that poll finishes. */
  tick(): Promise<void> {
    if (this.timer === null || this.running || this.now() < this.nextDue) return this.running ?? Promise.resolve();
    const run = this.poll().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async poll(): Promise<void> {
    try {
      const res = await this.opts.run(this.abort.signal);
      this.fails = 0;
      this.nextDue = this.now() + ((res && res.nextInMs) || this.opts.intervalMs);
    } catch (err) {
      if (this.timer === null) return; // stopping
      this.fails++;
      const base = Math.min(this.opts.intervalMs, 60_000);
      const cap = this.opts.maxBackoffMs ?? Math.max(this.opts.intervalMs, 600_000);
      let wait = Math.min(base * 2 ** (this.fails - 1), cap);
      if (err instanceof HttpError && err.retryAfterMs !== null) {
        wait = Math.max(wait, Math.min(err.retryAfterMs, MAX_RETRY_AFTER_MS));
      }
      this.nextDue = this.now() + wait;
      this.opts.onError(err);
    }
  }
}
