import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ElementsResponse, FeedStatus, OrbitalElements } from '@gev/shared';
import { FeedHealth } from '../health.ts';
import { getText, HttpError } from '../http.ts';
import { PollLoop } from '../poll.ts';
import { realTimers, type FeedLayer, type FetchLike, type OrbitsFeed, type Timers } from '../types.ts';
import { LAYER, parseTle, type TleEntry } from './tle.ts';

/** CelesTrak asks for at most one download per group every 2 hours. */
export const CELESTRAK_MIN_REFRESH_MS = 2 * 3_600_000;
export const SATELLITES_REFRESH_MS = 4 * 3_600_000;
export const SATELLITES_FRESHNESS_MS = 12 * 3_600_000;
export const CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php';

/** Groups served by default. Starlink (about 10 000 objects) is opt-in via SATELLITE_GROUPS. */
export const DEFAULT_GROUPS = ['stations', 'visual', 'gps-ops', 'glo-ops', 'galileo', 'beidou', 'weather', 'science', 'geo'];

export interface SatellitesFeedDeps {
  fetch: FetchLike;
  /** Directory for the per-group disk cache (raw TLE text plus metadata). */
  cacheDir: string;
  /** CelesTrak GROUP names, highest priority first (a satellite keeps its first group). */
  groups?: string[];
  refreshMs?: number;
  url?: string;
  now?: () => number;
  timers?: Timers;
  tickMs?: number;
  /** Pause between group downloads (default 2 s). */
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

interface GroupState {
  entries: TleEntry[];
  fetchedAt: number | null;
  lastModified: string | null;
  etag: string | null;
  nextDue: number;
  fails: number;
  error: string | null;
}

interface Meta {
  fetchedAt: number;
  lastModified: string | null;
  etag: string | null;
}

const toElements = (e: TleEntry, group: string): OrbitalElements => ({
  noradId: e.noradId,
  name: e.name,
  group,
  tle1: e.tle1,
  tle2: e.tle2,
  epoch: e.epoch,
});

/**
 * CelesTrak GP element sets (TLE format) for a set of groups, refreshed every
 * few hours and cached on disk so restarts never refetch. Clients propagate
 * positions themselves (SGP4).
 */
export class SatellitesFeed implements OrbitsFeed {
  readonly id = 'satellites';
  readonly freshnessMs = SATELLITES_FRESHNESS_MS;
  readonly layers: readonly FeedLayer[] = [{ id: LAYER, kind: 'orbits', storageLayer: LAYER, lookbackMs: 0 }];

  private readonly deps: SatellitesFeedDeps;
  private readonly now: () => number;
  private readonly health: FeedHealth;
  private readonly loop: PollLoop;
  private readonly groups: string[];
  private readonly refreshMs: number;
  private readonly state = new Map<string, GroupState>();
  private readonly perGroup = new Map<string, OrbitalElements[]>();
  private all: OrbitalElements[] = [];
  private loaded = false;

  constructor(deps: SatellitesFeedDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.groups = [...new Set(deps.groups ?? DEFAULT_GROUPS)];
    this.refreshMs = Math.max(deps.refreshMs ?? SATELLITES_REFRESH_MS, CELESTRAK_MIN_REFRESH_MS);
    this.health = new FeedHealth(this.now, SATELLITES_FRESHNESS_MS);
    for (const g of this.groups) this.state.set(g, { entries: [], fetchedAt: null, lastModified: null, etag: null, nextDue: 0, fails: 0, error: null });
    this.loop = new PollLoop({
      intervalMs: 60_000,
      now: this.now,
      timers: deps.timers ?? realTimers,
      tickMs: deps.tickMs,
      run: (signal) => this.round(signal),
      onError: (err) => this.health.fail(`CelesTrak: ${(err as Error).message}`),
    });
  }

  start(): void {
    if (!this.loaded) {
      this.loaded = true;
      for (const g of this.groups) this.loadCache(g);
      this.rebuild();
    }
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
      source: 'CelesTrak',
      lastSuccess: this.health.lastSuccess,
      lastError: this.health.lastError,
      count: this.all.length,
      freshnessMs: SATELLITES_FRESHNESS_MS,
    };
  }

  elements(_layer: string, group?: string): Pick<ElementsResponse, 'groups' | 'elements'> | null {
    if (group === undefined) return { groups: this.groups, elements: this.all };
    const list = this.perGroup.get(group);
    return list ? { groups: this.groups, elements: list } : null;
  }

  // ------------------------------------------------------------ disk cache

  private file(group: string, ext: 'tle' | 'json'): string {
    return path.join(this.deps.cacheDir, `${group}.${ext}`);
  }

  private loadCache(group: string): void {
    const st = this.state.get(group)!;
    try {
      const meta = JSON.parse(readFileSync(this.file(group, 'json'), 'utf8')) as Meta;
      const { entries } = parseTle(readFileSync(this.file(group, 'tle'), 'utf8'));
      if (!Number.isFinite(meta.fetchedAt) || entries.length === 0) return;
      st.entries = entries;
      st.fetchedAt = meta.fetchedAt;
      st.lastModified = meta.lastModified ?? null;
      st.etag = meta.etag ?? null;
      st.nextDue = meta.fetchedAt + this.refreshMs;
      if (this.health.lastSuccess === null || meta.fetchedAt > this.health.lastSuccess) this.health.lastSuccess = meta.fetchedAt;
    } catch {
      // no usable cache for this group yet
    }
  }

  private saveCache(group: string, text: string, meta: Meta): void {
    try {
      mkdirSync(this.deps.cacheDir, { recursive: true });
      for (const [ext, body] of [['tle', text], ['json', JSON.stringify(meta)]] as const) {
        const f = this.file(group, ext);
        writeFileSync(`${f}.tmp`, body);
        renameSync(`${f}.tmp`, f);
      }
    } catch (err) {
      this.deps.log?.(`satellites: cache write for ${group} failed: ${(err as Error).message}`);
    }
  }

  private saveMeta(group: string, meta: Meta): void {
    try {
      mkdirSync(this.deps.cacheDir, { recursive: true });
      const f = this.file(group, 'json');
      writeFileSync(`${f}.tmp`, JSON.stringify(meta));
      renameSync(`${f}.tmp`, f);
    } catch {
      // the cached entries stay valid; only the timestamp is stale
    }
  }

  // ------------------------------------------------------------ polling

  private rebuild(): void {
    this.perGroup.clear();
    const seen = new Set<string>();
    const all: OrbitalElements[] = [];
    for (const g of this.groups) {
      const st = this.state.get(g)!;
      if (st.entries.length === 0 && st.fetchedAt === null) continue;
      this.perGroup.set(g, st.entries.map((e) => toElements(e, g)));
      for (const e of st.entries) {
        if (seen.has(e.noradId)) continue;
        seen.add(e.noradId);
        all.push(toElements(e, g));
      }
    }
    // A configured group that has never loaded is still a known group, just empty.
    for (const g of this.groups) if (!this.perGroup.has(g)) this.perGroup.set(g, []);
    this.all = all;
  }

  /** Download every group that is due, one at a time. Returns when the next group is due. */
  private async round(signal: AbortSignal): Promise<{ nextInMs: number }> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let downloaded = 0;
    let succeeded = 0;
    let firstError: string | null = null;
    for (const g of this.groups) {
      const st = this.state.get(g)!;
      if (this.now() < st.nextDue) continue;
      if (signal.aborted) break;
      if (downloaded > 0) await sleep(this.deps.gapMs ?? 2000);
      downloaded++;
      try {
        await this.fetchGroup(g, st, signal);
        succeeded++;
      } catch (err) {
        if (signal.aborted) break;
        const wait = this.failureWait(st, err);
        st.fails++;
        st.nextDue = this.now() + wait;
        st.error = `${g}: ${(err as Error).message}`;
        firstError ??= st.error;
        this.deps.log?.(`satellites: ${st.error}; retrying in ${Math.round(wait / 60_000)} min`);
      }
    }
    this.rebuild();
    // Health reflects the round: an error stays visible while cached data is served.
    if (succeeded > 0) this.health.ok(this.now());
    if (firstError !== null) this.health.fail(`CelesTrak: ${firstError}`);
    const due = Math.min(...this.groups.map((g) => this.state.get(g)!.nextDue));
    return { nextInMs: Math.max(30_000, due - this.now()) };
  }

  private failureWait(st: GroupState, err: unknown): number {
    let wait = Math.min(5 * 60_000 * 2 ** st.fails, this.refreshMs);
    if (err instanceof HttpError) {
      if (err.status === 403) wait = Math.max(wait, CELESTRAK_MIN_REFRESH_MS); // blocked: stay away
      if (err.retryAfterMs !== null) wait = Math.max(wait, Math.min(err.retryAfterMs, 6 * 3_600_000));
    }
    return wait;
  }

  private async fetchGroup(group: string, st: GroupState, signal: AbortSignal): Promise<void> {
    const url = new URL(this.deps.url ?? CELESTRAK_URL);
    url.searchParams.set('GROUP', group);
    url.searchParams.set('FORMAT', 'tle');
    const headers: Record<string, string> = { Accept: 'text/plain' };
    if (st.lastModified) headers['If-Modified-Since'] = st.lastModified;
    if (st.etag) headers['If-None-Match'] = st.etag;
    const res = await getText(this.deps.fetch, url.href, { signal, now: this.now, allow: [304], headers, timeoutMs: 60_000, maxBytes: 16 * 1024 * 1024 });
    const at = this.now();
    if (res.status === 304) {
      st.fetchedAt = at;
      st.nextDue = at + this.refreshMs;
      st.fails = 0;
      st.error = null;
      this.saveMeta(group, { fetchedAt: at, lastModified: st.lastModified, etag: st.etag });
      return;
    }
    // CelesTrak answers 200 with plain-text errors ("Invalid query", "No GP data found").
    const { entries, invalid } = parseTle(res.text);
    if (entries.length === 0) throw new Error(`no valid element sets in response (${res.text.trim().slice(0, 80) || 'empty'})`);
    if (invalid > 0) this.deps.log?.(`satellites: ${group}: dropped ${invalid} element set(s) with bad checksums or lengths`);
    st.entries = entries;
    st.fetchedAt = at;
    st.lastModified = res.headers.get('last-modified');
    st.etag = res.headers.get('etag');
    st.nextDue = at + this.refreshMs;
    st.fails = 0;
    st.error = null;
    this.saveCache(group, res.text, { fetchedAt: at, lastModified: st.lastModified, etag: st.etag });
  }
}
