import type { FeedStatus } from '@gev/shared';
import type { ObservationRepo } from '../db/observations.ts';
import { realTimers, type Feed, type FeedLayer, type Timers } from './types.ts';

/** Layers the server has an implementation for, whether or not the feed is enabled. */
export interface FeedDefinition {
  id: string;
  layers: string[];
  freshnessMs: number;
}

export interface FeedManagerOptions {
  feeds: Feed[];
  /** Every implemented feed (enabled or not), so disabled ones can report 'off'. */
  definitions: FeedDefinition[];
  repo: Pick<ObservationRepo, 'pruneBefore'>;
  retentionMs: number;
  now?: () => number;
  timers?: Timers;
  pruneEveryMs?: number;
  /** Rows deleted per pruning transaction (the loop yields between chunks). */
  pruneChunk?: number;
  log?: (msg: string) => void;
}

export type Resolved =
  | { kind: 'unknown' }
  | { kind: 'off'; status: FeedStatus }
  | { kind: 'ok'; feed: Feed; layer: FeedLayer; status: FeedStatus };

export class FeedManager {
  private readonly now: () => number;
  private readonly timers: Timers;
  private pruneTimer: unknown = null;
  private pruning: Promise<number> | null = null;
  private stopped = false;

  private readonly opts: FeedManagerOptions;

  constructor(opts: FeedManagerOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? realTimers;
  }

  get retentionMs(): number {
    return this.opts.retentionMs;
  }

  start(): void {
    this.stopped = false;
    for (const f of this.opts.feeds) f.start();
    if (this.pruneTimer === null) {
      this.pruneTimer = this.timers.setInterval(() => void this.prune(), this.opts.pruneEveryMs ?? 3_600_000);
      // First pass shortly after boot catches up on data left from a previous run.
      this.timers.setTimeout(() => void this.prune(), 30_000);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pruneTimer !== null) this.timers.clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    await Promise.allSettled(this.opts.feeds.map((f) => f.stop()));
    await this.pruning?.catch(() => {});
  }

  /** Delete history older than the retention window, in chunks. Returns rows removed. */
  prune(): Promise<number> {
    if (this.pruning) return this.pruning;
    const cutoff = this.now() - this.opts.retentionMs;
    const chunk = this.opts.pruneChunk ?? 50_000;
    const run = (async () => {
      let total = 0;
      try {
        for (;;) {
          const n = this.opts.repo.pruneBefore(cutoff, chunk);
          total += n;
          if (n < chunk || this.stopped) break;
          await new Promise<void>((r) => setImmediate(r)); // let requests through
        }
        if (total > 0) this.opts.log?.(`pruned ${total} observations older than ${new Date(cutoff).toISOString()}`);
      } catch (err) {
        this.opts.log?.(`prune failed: ${(err as Error).message}`);
      }
      return total;
    })().finally(() => {
      this.pruning = null;
    });
    this.pruning = run;
    return run;
  }

  /** Status of every implemented layer. */
  statuses(): FeedStatus[] {
    const out: FeedStatus[] = [];
    for (const def of this.opts.definitions) {
      const feed = this.opts.feeds.find((f) => f.id === def.id);
      for (const layer of def.layers) {
        out.push(feed ? feed.status(layer) : offStatus(layer, def.freshnessMs));
      }
    }
    return out;
  }

  resolve(layerId: string): Resolved {
    for (const feed of this.opts.feeds) {
      const layer = feed.layers.find((l) => l.id === layerId);
      if (layer) {
        const status = feed.status(layerId);
        if (status.state === 'off' || status.state === 'needs-key') return { kind: 'off', status };
        return { kind: 'ok', feed, layer, status };
      }
    }
    const def = this.opts.definitions.find((d) => d.layers.includes(layerId));
    if (def) return { kind: 'off', status: offStatus(layerId, def.freshnessMs) };
    return { kind: 'unknown' };
  }
}

export function offStatus(layer: string, freshnessMs: number): FeedStatus {
  return { layer, state: 'off', source: null, lastSuccess: null, lastError: null, count: 0, freshnessMs };
}
