import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Feature, FeatureDetail, FeedStatus } from '@gev/shared';
import { inBBox } from '../../geo.ts';
import { FeedHealth } from '../health.ts';
import { getJson } from '../http.ts';
import { PollLoop } from '../poll.ts';
import { realTimers, type FeatureQuery, type FeatureResult, type FeaturesFeed, type FeedLayer, type FetchLike, type Timers } from '../types.ts';
import { buildLaunchDetail } from './detail.ts';
import { launchFeature, LAYER, parseLaunches, type LaunchRecord } from './parse.ts';

/** Launch Library 2 allows 15 anonymous requests an hour; one poll per 30 minutes uses 2. */
export const LAUNCHES_POLL_MS = 30 * 60_000;
export const LAUNCHES_MIN_POLL_MS = 15 * 60_000;
export const LAUNCHES_FRESHNESS_MS = 3 * 3_600_000;
export const LL2_URL = 'https://ll.thespacedevs.com/2.3.0/launches/';
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const CACHE_VERSION = 1;

export interface LaunchesFeedDeps {
  fetch: FetchLike;
  /** File to keep the last good response in, so restarts do not refetch. */
  cacheFile?: string;
  /** Optional LL2 API token (higher rate limit). */
  token?: string | null;
  url?: string;
  pollMs?: number;
  now?: () => number;
  timers?: Timers;
  tickMs?: number;
  log?: (msg: string) => void;
}

interface CacheFile {
  version: number;
  fetchedAt: number;
  launches: LaunchRecord[];
}

/**
 * Upcoming and recent launches (30 days either side) from Launch Library 2.
 * Pads are Points; LL2 does not supply trajectories so none are drawn. The last
 * good response is cached on disk and served through outages and rate limits.
 */
export class LaunchesFeed implements FeaturesFeed {
  readonly id = 'launches';
  readonly freshnessMs = LAUNCHES_FRESHNESS_MS;
  readonly layers: readonly FeedLayer[] = [{ id: LAYER, kind: 'features', storageLayer: LAYER, lookbackMs: 0 }];

  private readonly deps: LaunchesFeedDeps;
  private readonly now: () => number;
  private readonly health: FeedHealth;
  private readonly loop: PollLoop;
  private readonly pollMs: number;
  private launches: LaunchRecord[] = [];
  private featureList: Feature[] = [];
  private byId = new Map<string, LaunchRecord>();
  private loaded = false;
  private initialDelayMs = 0;

  constructor(deps: LaunchesFeedDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.pollMs = Math.max(deps.pollMs ?? LAUNCHES_POLL_MS, LAUNCHES_MIN_POLL_MS);
    this.health = new FeedHealth(this.now, LAUNCHES_FRESHNESS_MS);
    this.loop = new PollLoop({
      intervalMs: this.pollMs,
      now: this.now,
      timers: deps.timers ?? realTimers,
      tickMs: deps.tickMs,
      maxBackoffMs: this.pollMs * 2,
      run: (signal) => this.poll(signal),
      onError: (err) => this.health.fail(`Launch Library 2: ${(err as Error).message}`),
    });
  }

  start(): void {
    if (!this.loaded) {
      this.loaded = true;
      this.loadCache();
    }
    this.health.running = true;
    this.loop.start(this.initialDelayMs);
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
      source: 'Launch Library 2',
      lastSuccess: this.health.lastSuccess,
      lastError: this.health.lastError,
      count: this.launches.length,
      freshnessMs: LAUNCHES_FRESHNESS_MS,
    };
  }

  private setLaunches(list: LaunchRecord[]): void {
    this.launches = [...list].sort((a, b) => a.net - b.net);
    this.featureList = this.launches.map(launchFeature);
    this.byId = new Map(this.launches.map((l) => [l.id, l]));
  }

  private loadCache(): void {
    const file = this.deps.cacheFile;
    if (!file) return;
    try {
      const c = JSON.parse(readFileSync(file, 'utf8')) as CacheFile;
      if (c.version !== CACHE_VERSION || !Number.isFinite(c.fetchedAt) || !Array.isArray(c.launches)) return;
      this.setLaunches(c.launches);
      this.health.lastSuccess = c.fetchedAt; // served as-is until the next poll is due
      this.initialDelayMs = Math.max(0, c.fetchedAt + this.pollMs - this.now());
    } catch {
      // first run, or an unreadable cache: fetch normally
    }
  }

  private saveCache(fetchedAt: number): void {
    const file = this.deps.cacheFile;
    if (!file) return;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, fetchedAt, launches: this.launches } satisfies CacheFile));
      renameSync(tmp, file);
    } catch (err) {
      this.deps.log?.(`launches: cache write failed: ${(err as Error).message}`);
    }
  }

  private async poll(signal: AbortSignal): Promise<void> {
    const at = this.now();
    const u = new URL(this.deps.url ?? LL2_URL);
    u.searchParams.set('net__gte', new Date(at - WINDOW_DAYS * DAY_MS).toISOString());
    u.searchParams.set('net__lte', new Date(at + WINDOW_DAYS * DAY_MS).toISOString());
    u.searchParams.set('ordering', 'net');
    u.searchParams.set('limit', '100');
    u.searchParams.set('mode', 'detailed');
    const token = this.deps.token?.trim();
    const json = await getJson(this.deps.fetch, u.href, {
      signal,
      now: this.now,
      timeoutMs: 40_000,
      maxBytes: 16 * 1024 * 1024,
      headers: token ? { Authorization: `Token ${token}` } : {},
    });
    const { launches, skipped } = parseLaunches(json);
    if (skipped > 0) this.deps.log?.(`launches: skipped ${skipped} launch(es) without a time or pad position`);
    const total = (json as { count?: unknown }).count;
    if (typeof total === 'number' && total > 100) this.deps.log?.(`launches: ${total} launches in window, showing the first 100`);
    this.setLaunches(launches);
    this.saveCache(at);
    this.health.ok(at);
  }


  features(_layer: string, q: FeatureQuery): FeatureResult {
    const out: Feature[] = [];
    let truncated = false;
    for (const f of this.featureList) {
      const t = f.t!;
      if ((q.from !== undefined && t < q.from) || (q.to !== undefined && t > q.to)) continue;
      if (q.bbox) {
        const c = (f.geometry as { coordinates: number[] }).coordinates;
        if (!inBBox(c[0]!, c[1]!, q.bbox)) continue;
      }
      if (out.length >= q.limit) {
        truncated = true;
        break;
      }
      out.push(f);
    }
    return { features: out, truncated };
  }

  async featureDetail(_layer: string, featureId: string): Promise<FeatureDetail | null> {
    const l = this.byId.get(featureId);
    return l ? buildLaunchDetail(l, this.now()) : null;
  }
}
