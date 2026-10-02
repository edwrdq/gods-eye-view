import type { Feature, FeatureDetail, FeedStatus } from '@gev/shared';
import type { FeatureRepo, FeatureRow } from '../../db/features.ts';
import { FeedHealth } from '../health.ts';
import { getText } from '../http.ts';
import { PollLoop } from '../poll.ts';
import { realTimers, type FeatureQuery, type FeatureResult, type FeaturesFeed, type FeedLayer, type FetchLike, type Timers } from '../types.ts';
import { buildQuakeDetail } from './detail.ts';
import { LAYER, parseUsgs } from './parse.ts';

export const EARTHQUAKES_POLL_MS = 60_000;
/** Live if the last fetch is under five polls old. */
export const EARTHQUAKES_FRESHNESS_MS = 5 * EARTHQUAKES_POLL_MS;
export const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
/** One request, once, on an empty history: the last 30 days of M2.5+ events. */
export const USGS_BACKFILL_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson';
const BACKFILL_ATTEMPTS = 3;
const DAY_MS = 86_400_000;
/** The all_day feed is cut by event time; keep a margin against clock and publishing skew. */
const WINDOW_MARGIN_MS = 15 * 60_000;
const PRUNE_EVERY_MS = 3_600_000;

export interface EarthquakesFeedDeps {
  fetch: FetchLike;
  repo: FeatureRepo;
  /** Days of events kept in history (default 365). */
  retentionDays?: number;
  url?: string;
  /** Seed an empty history from the month feed (default true). Never runs when events are already stored. */
  backfill?: boolean;
  backfillUrl?: string;
  pollMs?: number;
  now?: () => number;
  timers?: Timers;
  tickMs?: number;
  log?: (msg: string) => void;
}

export function toFeature(r: FeatureRow): Feature {
  return {
    id: r.id,
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
    t: r.t,
    ...(r.label ? { label: r.label } : {}),
    props: r.props,
  };
}

/**
 * USGS earthquakes. The live all_day feed is polled every minute and every
 * event is upserted into the features table (newest revision wins), so queries
 * with from/to reach back past the feed's 24 h window. Events the source
 * withdraws while still inside its window are removed.
 */
export class EarthquakesFeed implements FeaturesFeed {
  readonly id = 'earthquakes';
  readonly freshnessMs = EARTHQUAKES_FRESHNESS_MS;
  readonly layers: readonly FeedLayer[] = [{ id: LAYER, kind: 'features', storageLayer: LAYER, lookbackMs: 0 }];

  private readonly deps: EarthquakesFeedDeps;
  private readonly now: () => number;
  private readonly health: FeedHealth;
  private readonly loop: PollLoop;
  private lastCount = 0;
  private lastModified: string | null = null;
  private lastPrune = 0;
  /** 'unknown' until the first poll looks at the stored history; 'done' also covers 'history already existed'. */
  private backfillState: 'unknown' | 'pending' | 'done' = 'unknown';
  private backfillTries = 0;

  constructor(deps: EarthquakesFeedDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.health = new FeedHealth(this.now, EARTHQUAKES_FRESHNESS_MS);
    this.loop = new PollLoop({
      intervalMs: deps.pollMs ?? EARTHQUAKES_POLL_MS,
      now: this.now,
      timers: deps.timers ?? realTimers,
      tickMs: deps.tickMs,
      run: (signal) => this.poll(signal),
      onError: (err) => this.health.fail(`USGS: ${(err as Error).message}`),
    });
  }

  start(): void {
    this.health.running = true;
    this.loop.start();
  }

  async stop(): Promise<void> {
    this.health.running = false;
    await this.loop.stop();
  }

  tick(): Promise<void> {
    return this.loop.tick();
  }

  idle(): Promise<void> {
    return this.loop.idle();
  }

  status(layer: string = LAYER): FeedStatus {
    return {
      layer,
      state: this.health.state(),
      source: 'USGS',
      lastSuccess: this.health.lastSuccess,
      lastError: this.health.lastError,
      count: this.lastCount,
      freshnessMs: EARTHQUAKES_FRESHNESS_MS,
    };
  }

  private async poll(signal: AbortSignal): Promise<void> {
    const res = await getText(this.deps.fetch, this.deps.url ?? USGS_URL, {
      signal,
      now: this.now,
      allow: [304],
      headers: { Accept: 'application/geo+json, application/json', ...(this.lastModified ? { 'If-Modified-Since': this.lastModified } : {}) },
    });
    const at = this.now();
    if (res.status === 304) {
      this.health.ok(at);
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new Error('malformed JSON response');
    }
    const snap = parseUsgs(json);
    const repo = this.deps.repo;
    // Decide before the first insert: only a history that is empty right now is seeded.
    if (this.backfillState === 'unknown') this.backfillState = this.deps.backfill !== false && repo.count(LAYER) === 0 ? 'pending' : 'done';
    repo.upsertMany(LAYER, snap.rows);
    if (snap.rows.length > 0) {
      const generated = snap.generated ?? at;
      repo.deleteMissingSince(LAYER, generated - DAY_MS + WINDOW_MARGIN_MS, new Set(snap.rows.map((r) => r.id)));
    }
    this.lastCount = snap.rows.length;
    this.lastModified = res.headers.get('last-modified');
    this.health.ok(at);
    if (this.backfillState === 'pending') await this.backfill(signal, at);
    if (at - this.lastPrune > PRUNE_EVERY_MS) {
      this.lastPrune = at;
      try {
        const n = repo.pruneBefore(LAYER, at - (this.deps.retentionDays ?? 365) * DAY_MS);
        if (n > 0) this.deps.log?.(`earthquakes: pruned ${n} events past retention`);
      } catch (err) {
        this.deps.log?.(`earthquakes: prune failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Seed an empty history with the past month so the time slider has something
   * to show on day one. One request; a failure is retried on the next polls (a
   * few times) because the history is still empty of anything older. Upsert
   * only: nothing is ever deleted, and newer revisions already stored win.
   */
  private async backfill(signal: AbortSignal, at: number): Promise<void> {
    this.backfillTries++;
    try {
      const res = await getText(this.deps.fetch, this.deps.backfillUrl ?? USGS_BACKFILL_URL, {
        signal,
        now: this.now,
        timeoutMs: 60_000,
        headers: { Accept: 'application/geo+json, application/json' },
      });
      let json: unknown;
      try {
        json = JSON.parse(res.text);
      } catch {
        throw new Error('malformed JSON response');
      }
      const cutoff = at - (this.deps.retentionDays ?? 365) * DAY_MS;
      const rows = parseUsgs(json).rows.filter((r) => r.t >= cutoff);
      const written = this.deps.repo.upsertMany(LAYER, rows);
      this.backfillState = 'done';
      this.deps.log?.(`earthquakes: seeded history with ${written} events from the past month`);
    } catch (err) {
      if (this.backfillTries >= BACKFILL_ATTEMPTS) this.backfillState = 'done';
      this.deps.log?.(`earthquakes: history backfill failed (${this.backfillTries}/${BACKFILL_ATTEMPTS}): ${(err as Error).message}`);
    }
  }

  features(_layer: string, q: FeatureQuery): FeatureResult {
    const to = q.to ?? this.now();
    const from = q.from ?? to - DAY_MS;
    const { rows, truncated } = this.deps.repo.query(LAYER, { from, to, bbox: q.bbox, limit: q.limit });
    return { features: rows.map(toFeature), truncated };
  }

  async featureDetail(_layer: string, featureId: string): Promise<FeatureDetail | null> {
    const r = this.deps.repo.get(LAYER, featureId);
    return r ? buildQuakeDetail(r, this.now()) : null;
  }
}
