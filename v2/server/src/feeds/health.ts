import type { FeedState } from '@gev/shared';

/** Tracks success/failure times and derives the contract's FeedState. */
export class FeedHealth {
  lastSuccess: number | null = null;
  lastError: string | null = null;
  private lastErrorAt = 0;
  running = false;
  needsKey = false;

  private readonly now: () => number;
  readonly freshnessMs: number;

  constructor(now: () => number, freshnessMs: number) {
    this.now = now;
    this.freshnessMs = freshnessMs;
  }

  ok(at: number = this.now()): void {
    this.lastSuccess = at;
    this.lastError = null;
  }

  fail(message: string): void {
    this.lastError = message;
    this.lastErrorAt = this.now();
  }

  /** Note an informational condition without marking an attempt as failed. */
  state(): FeedState {
    if (this.needsKey) return 'needs-key';
    if (!this.running) return 'off';
    if (this.lastError !== null && this.lastErrorAt >= (this.lastSuccess ?? 0)) return 'error';
    if (this.lastSuccess === null) return 'stale';
    return this.now() - this.lastSuccess > this.freshnessMs ? 'stale' : 'live';
  }
}
