import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BBox, Feature, FeatureDetail, FeedStatus } from '@gev/shared';
import { inBBox, isWorld } from '../../geo.ts';
import { FeedHealth } from '../health.ts';
import { getJson } from '../http.ts';
import { PollLoop } from '../poll.ts';
import { thinGrid } from '../thin.ts';
import { realTimers, type FeatureQuery, type FeatureResult, type FeaturesFeed, type FeedLayer, type FetchLike, type Timers } from '../types.ts';
import { buildStationDetail } from './detail.ts';
import { LAYER, parseStations, stationFeature, type Station } from './parse.ts';
import { discoverServers, realDns, type ServerDeps } from './servers.ts';

const HOUR = 3_600_000;
/** The directory changes all day, but a map of where stations are does not need more than a few refreshes a day. */
export const RADIO_POLL_MS = 6 * HOUR;
export const RADIO_FRESHNESS_MS = 12 * HOUR;
/** Stations returned for one view before thinning; world zoom is thinned to this. */
export const RADIO_CAP = 1_500;
const PAGE_SIZE = 3_000;
const MAX_PAGES = 15;
const MIN_STATIONS = 200;
const CACHE_VERSION = 1;

export interface RadioFeedDeps {
  fetch: FetchLike;
  cacheFile?: string;
  /** Server discovery lookups (tests inject fakes). */
  dns?: Pick<ServerDeps, 'resolve4' | 'reverse'>;
  random?: () => number;
  now?: () => number;
  timers?: Timers;
  tickMs?: number;
  log?: (msg: string) => void;
  cap?: number;
  /** Directory page size and the smallest list worth keeping (tests). */
  pageSize?: number;
  minStations?: number;
}

interface CacheFile {
  version: number;
  fetchedAt: number;
  stations: Station[];
}

/**
 * Radio stations with a position, from the Radio Browser community directory.
 * The whole geo-located list (about 13,000) is fetched a few pages at a time
 * from one server, kept in memory and in a cache file, and refreshed every six
 * hours. Views are answered from memory; world zoom is thinned to the most
 * listened-to stations spread evenly over the map.
 */
export class RadioFeed implements FeaturesFeed {
  readonly id = 'radio';
  readonly freshnessMs = RADIO_FRESHNESS_MS;
  readonly layers: readonly FeedLayer[] = [{ id: LAYER, kind: 'features', storageLayer: LAYER, lookbackMs: 0 }];

  private readonly deps: RadioFeedDeps;
  private readonly now: () => number;
  private readonly health: FeedHealth;
  private readonly loop: PollLoop;
  private stations: Station[] = [];
  private byId = new Map<string, Station>();
  private worldCache: FeatureResult | null = null;
  private loaded = false;
  private initialDelayMs = 0;
  /** Directory requests made (for tests). */
  requests = 0;

  constructor(deps: RadioFeedDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.health = new FeedHealth(this.now, RADIO_FRESHNESS_MS);
    this.loop = new PollLoop({
      intervalMs: RADIO_POLL_MS,
      now: this.now,
      timers: deps.timers ?? realTimers,
      tickMs: deps.tickMs,
      maxBackoffMs: RADIO_POLL_MS,
      run: (signal) => this.poll(signal),
      onError: (err) => this.health.fail(`Radio Browser: ${(err as Error).message}`),
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
      source: 'Radio Browser',
      lastSuccess: this.health.lastSuccess,
      lastError: this.health.lastError,
      count: this.stations.length,
      freshnessMs: RADIO_FRESHNESS_MS,
    };
  }

  private setStations(list: Station[]): void {
    this.stations = list;
    this.byId = new Map(list.map((s) => [s.id, s]));
    this.worldCache = null;
  }

  private loadCache(): void {
    const file = this.deps.cacheFile;
    if (!file) return;
    try {
      const c = JSON.parse(readFileSync(file, 'utf8')) as CacheFile;
      if (c.version !== CACHE_VERSION || !Number.isFinite(c.fetchedAt) || !Array.isArray(c.stations) || c.stations.length < (this.deps.minStations ?? MIN_STATIONS)) return;
      this.setStations(c.stations);
      this.health.lastSuccess = c.fetchedAt; // served as-is until the next refresh is due
      this.initialDelayMs = Math.max(0, c.fetchedAt + RADIO_POLL_MS - this.now());
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
      writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, fetchedAt, stations: this.stations } satisfies CacheFile));
      renameSync(tmp, file);
    } catch (err) {
      this.deps.log?.(`radio: cache write failed: ${(err as Error).message}`);
    }
  }

  private async poll(signal: AbortSignal): Promise<void> {
    const at = this.now();
    const servers = await discoverServers(
      { resolve4: this.deps.dns?.resolve4 ?? realDns.resolve4, reverse: this.deps.dns?.reverse ?? realDns.reverse, fetch: this.deps.fetch, random: this.deps.random },
      this.deps.log,
    );
    if (servers.length === 0) throw new Error('no Radio Browser server found');
    const pageSize = this.deps.pageSize ?? PAGE_SIZE;
    let si = 0;
    const all: Station[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ has_geo_info: 'true', hidebroken: 'true', order: 'name', limit: String(pageSize), offset: String(page * pageSize) });
      let json: unknown;
      let lastErr: unknown;
      for (let k = 0; k < servers.length && json === undefined; k++) {
        const origin = servers[(si + k) % servers.length]!;
        try {
          this.requests++;
          json = await getJson(this.deps.fetch, `${origin}/json/stations/search?${q}`, { signal, now: this.now, timeoutMs: 60_000, maxBytes: 24 * 1024 * 1024 });
          si = (si + k) % servers.length; // stay on the server that answered
        } catch (err) {
          lastErr = err;
          if (signal.aborted) throw err;
        }
      }
      if (json === undefined) throw lastErr instanceof Error ? lastErr : new Error('every Radio Browser server failed');
      if (!Array.isArray(json)) throw new Error('unexpected directory answer');
      const parsed = parseStations(json);
      skipped += parsed.skipped;
      for (const s of parsed.stations) {
        if (seen.has(s.id)) continue; // offset paging can repeat a station when the directory changes between pages
        seen.add(s.id);
        all.push(s);
      }
      if (json.length < pageSize) break;
    }
    if (all.length < (this.deps.minStations ?? MIN_STATIONS)) throw new Error(`only ${all.length} usable stations; keeping the previous list`);
    this.setStations(all);
    this.saveCache(at);
    this.health.ok(at);
    this.deps.log?.(`radio: ${all.length} stations (${skipped} unusable skipped) from ${servers[si]}`);
  }

  features(_layer: string, q: FeatureQuery): FeatureResult {
    const world = !q.bbox || isWorld(q.bbox);
    const cap = Math.max(0, Math.min(this.deps.cap ?? RADIO_CAP, q.limit));
    if (world && this.worldCache && this.worldCache.features.length <= cap) return this.worldCache;
    const view: BBox | undefined = world ? undefined : q.bbox;
    let hits = view ? this.stations.filter((s) => inBBox(s.lon, s.lat, view)) : this.stations;
    let truncated = false;
    if (hits.length > cap) {
      hits = thinGrid(hits, cap, view, { lon: (s) => s.lon, lat: (s) => s.lat, score: (s) => s.clicks + s.votes, id: (s) => s.id });
      truncated = true;
    }
    // Most listened-to last, so a client that draws in order puts them on top.
    const features: Feature[] = hits
      .slice()
      .sort((a, b) => a.clicks - b.clicks || (a.id < b.id ? 1 : -1))
      .map((s) => stationFeature(s));
    const result = { features, truncated };
    if (world) this.worldCache = result;
    return result;
  }

  async featureDetail(_layer: string, featureId: string): Promise<FeatureDetail | null> {
    const s = this.byId.get(featureId);
    return s ? buildStationDetail(s, this.health.lastSuccess) : null;
  }
}
