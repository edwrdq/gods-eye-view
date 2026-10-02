import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Feature, FeatureDetail, FeedStatus, PropValue } from '@gev/shared';
import { inBBox } from '../../geo.ts';
import { FeedHealth } from '../health.ts';
import { getJson, getText, HttpError } from '../http.ts';
import { PollLoop } from '../poll.ts';
import { thinGrid } from '../thin.ts';
import { realTimers, type FeatureQuery, type FeatureResult, type FeaturesFeed, type FeedLayer, type FetchLike, type Timers } from '../types.ts';
import { isPublicHttpsUrl } from '../url.ts';
import { buildStationDetail } from './detail.ts';
import {
  parseCatalogue,
  parseDiscovery,
  parseStationInformation,
  parseStationStatus,
  parseVehicleTypes,
  stationReading,
  type CatalogueSystem,
  type Discovery,
  type StationInfo,
  type StationStatus,
  type VehicleTypes,
} from './gbfs.ts';
import { mergeCatalogue, parseIndex, selectSystems, viewSpan, type IndexedSystem } from './systems.ts';

export const LAYER = 'bikeshare';
export const CATALOGUE_URL = 'https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv';
export const INDEX_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../static-data/gbfs/systems.json');

const MIN = 60_000;
const HOUR = 3_600_000;
/** The catalogue changes a few times a week; once a day is plenty. */
export const CATALOGUE_POLL_MS = 24 * HOUR;
/**
 * The feed reports "live" while the catalogue is current: stations are fetched
 * only for the area being looked at, so there is no background cadence to be late against.
 */
export const BIKESHARE_FRESHNESS_MS = 36 * HOUR;

/** station_information is nearly static: never refetched sooner than 3 h, whatever a feed's ttl says, nor kept more than 48 h. */
export const INFO_MIN_MS = 3 * HOUR;
export const INFO_MAX_MS = 48 * HOUR;
/** station_status: the feed's own ttl, but at least 60 s (feeds that say 0 mean "always fresh", not "hit me every second") and at most 2 min, so a view never shows older counts. */
export const STATUS_MIN_MS = MIN;
export const STATUS_MAX_MS = 2 * MIN;

/** A view wider or taller than this (degrees) gets no stations: that is a country, not a city. */
export const MAX_VIEW_DEG = 12;
/** Systems fetched for one view. */
export const MAX_SYSTEMS = 6;
/** Stations returned for one view before thinning. */
export const STATION_CAP = 4_000;
/** Fetches in flight at once, and per host. */
export const MAX_CONCURRENT = 4;
export const MAX_PER_HOST = 2;
/** A view waits this long for operators; what is late keeps loading and is there on the next request. */
export const VIEW_DEADLINE_MS = 9_000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const RETRY_MIN_MS = 2 * MIN;
const RETRY_MAX_MS = 30 * MIN;
const CACHE_VERSION = 1;

interface Timed {
  at: number;
  expires: number;
}

interface SystemState {
  sys: IndexedSystem;
  discovery?: Discovery & Timed;
  info?: Timed & { stations: StationInfo[]; byId: Map<string, StationInfo>; vehicles?: VehicleTypes };
  status?: Timed & { byId: Map<string, StationStatus> };
  inflight?: Promise<void>;
  fails: number;
  retryAt: number;
  lastError: string | null;
  /** The operator publishes no bicycles (car sharing, scooters): left alone. */
  notBikes: boolean;
}

export interface BikeshareDeps {
  fetch: FetchLike;
  /** File to keep the last catalogue in, so a restart does not refetch it. */
  cacheFile?: string;
  catalogueUrl?: string;
  /** Override the bundled systems index (tests). */
  index?: unknown;
  now?: () => number;
  timers?: Timers;
  tickMs?: number;
  log?: (msg: string) => void;
  deadlineMs?: number;
  maxSystems?: number;
  stationCap?: number;
}

class Semaphore {
  private free: number;
  private readonly waiting: Array<() => void> = [];
  constructor(n: number) {
    this.free = n;
  }
  async acquire(): Promise<() => void> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
    };
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Bikeshare stations from the operators' GBFS feeds. A view asks for the systems
 * it overlaps (chosen from the bundled index), and only those are fetched, each
 * through a small cache: station_information for hours, station_status for about
 * a minute, both honouring the feed's ttl. Failed systems back off and keep
 * serving what they last returned.
 */
export class BikeshareFeed implements FeaturesFeed {
  readonly id = 'bikeshare';
  readonly freshnessMs = BIKESHARE_FRESHNESS_MS;
  readonly layers: readonly FeedLayer[] = [{ id: LAYER, kind: 'features', storageLayer: LAYER, lookbackMs: 0 }];

  private readonly deps: BikeshareDeps;
  private readonly now: () => number;
  private readonly health: FeedHealth;
  private readonly loop: PollLoop;
  private readonly timers: Timers;
  private readonly global = new Semaphore(MAX_CONCURRENT);
  private readonly hosts = new Map<string, Semaphore>();
  private readonly states = new Map<string, SystemState>();
  private indexed: IndexedSystem[] = [];
  private systems: IndexedSystem[] = [];
  private indexReady = false;
  private catalogueAt: number | null = null;
  private initialDelayMs = 0;
  private loaded = false;
  /** Upstream requests made, by kind (for tests and the log). */
  readonly requests = { catalogue: 0, discovery: 0, information: 0, status: 0, vehicleTypes: 0 };

  constructor(deps: BikeshareDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? realTimers;
    this.health = new FeedHealth(this.now, BIKESHARE_FRESHNESS_MS);
    this.loop = new PollLoop({
      intervalMs: CATALOGUE_POLL_MS,
      now: this.now,
      timers: this.timers,
      tickMs: deps.tickMs,
      maxBackoffMs: 6 * HOUR,
      run: (signal) => this.refreshCatalogue(signal),
      onError: (err) => {
        this.deps.log?.(`bikeshare: catalogue refresh failed: ${(err as Error).message}`);
        // The bundled list keeps working; say so rather than turn the whole layer red.
        if (this.catalogueAt === null) this.health.fail(`Systems catalogue unavailable (${(err as Error).message}); using the bundled list`);
      },
    });
  }

  start(): void {
    if (!this.loaded) {
      this.loaded = true;
      this.loadIndex();
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

  /** Systems this server can serve (after merging the catalogue and the index). */
  get systemCount(): number {
    return this.systems.length;
  }

  private stationCount(): number {
    let n = 0;
    for (const s of this.states.values()) n += s.info?.stations.length ?? 0;
    return n;
  }

  status(layer: string = LAYER): FeedStatus {
    return {
      layer,
      state: this.health.state(),
      source: 'GBFS operator feeds',
      lastSuccess: this.health.lastSuccess,
      lastError: this.health.lastError,
      count: this.stationCount(),
      freshnessMs: BIKESHARE_FRESHNESS_MS,
    };
  }

  // ---------------------------------------------------------------- catalogue and index

  private loadIndex(): void {
    try {
      const json = this.deps.index ?? JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
      const idx = parseIndex(json);
      this.indexed = idx.systems;
      this.systems = idx.systems;
      this.indexReady = idx.systems.length > 0;
      if (!this.indexReady) this.health.fail('The bundled bikeshare systems index is empty');
      this.deps.log?.(`bikeshare: ${idx.systems.length} systems in the bundled index (built ${idx.generatedAt.slice(0, 10) || 'unknown'})`);
    } catch (err) {
      this.health.fail(`Bundled bikeshare systems index unavailable: ${(err as Error).message}`);
      this.deps.log?.(`bikeshare: ${(err as Error).message}`);
    }
  }

  private loadCache(): void {
    const file = this.deps.cacheFile;
    if (!file) return;
    try {
      const c = JSON.parse(readFileSync(file, 'utf8')) as { version: number; fetchedAt: number; systems: CatalogueSystem[] };
      if (c.version !== CACHE_VERSION || !Number.isFinite(c.fetchedAt) || !Array.isArray(c.systems) || c.systems.length === 0) return;
      this.applyCatalogue(c.systems, c.fetchedAt);
      this.initialDelayMs = Math.max(0, c.fetchedAt + CATALOGUE_POLL_MS - this.now());
    } catch {
      // first run, or an unreadable cache: fetch normally
    }
  }

  private saveCache(systems: CatalogueSystem[], fetchedAt: number): void {
    const file = this.deps.cacheFile;
    if (!file) return;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, fetchedAt, systems }));
      renameSync(tmp, file);
    } catch (err) {
      this.deps.log?.(`bikeshare: cache write failed: ${(err as Error).message}`);
    }
  }

  private applyCatalogue(catalogue: CatalogueSystem[], at: number): void {
    const m = mergeCatalogue(this.indexed, catalogue);
    this.systems = m.systems;
    this.catalogueAt = at;
    this.health.ok(at);
    this.deps.log?.(`bikeshare: catalogue ${catalogue.length} systems; ${m.systems.length} are docked bike systems the index locates, ${m.unlocated} others (free-floating fleets, or added since the index was built), ${m.retired} retired`);
  }

  private async refreshCatalogue(signal: AbortSignal): Promise<void> {
    const at = this.now();
    this.requests.catalogue++;
    const { text } = await getText(this.deps.fetch, this.deps.catalogueUrl ?? CATALOGUE_URL, { signal, now: this.now, timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024 });
    const { systems } = parseCatalogue(text);
    if (systems.length < 50) throw new Error(`catalogue has only ${systems.length} usable systems`);
    this.applyCatalogue(systems, at);
    this.saveCache(systems, at);
  }

  // ---------------------------------------------------------------- upstream access

  private hostLimit(url: string): Semaphore {
    const host = new URL(url).hostname;
    let s = this.hosts.get(host);
    if (!s) this.hosts.set(host, (s = new Semaphore(MAX_PER_HOST)));
    return s;
  }

  private async fetchJson(url: string): Promise<{ json: unknown; ttlMs: number | null }> {
    if (!isPublicHttpsUrl(url)) throw new Error('feed address is not a public https URL');
    const releaseHost = await this.hostLimit(url).acquire();
    const release = await this.global.acquire();
    try {
      const json = await getJson(this.deps.fetch, url, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_BODY_BYTES, now: this.now });
      const ttl = (json as { ttl?: unknown } | null)?.ttl;
      return { json, ttlMs: typeof ttl === 'number' && Number.isFinite(ttl) && ttl >= 0 ? ttl * 1000 : null };
    } finally {
      release();
      releaseHost();
    }
  }

  private state(sys: IndexedSystem): SystemState {
    let s = this.states.get(sys.id);
    if (!s) this.states.set(sys.id, (s = { sys, fails: 0, retryAt: 0, lastError: null, notBikes: false }));
    else s.sys = sys;
    return s;
  }

  /** Bring one system's cache up to date. Concurrent callers share one run; errors are recorded, not thrown. */
  private refresh(ss: SystemState): Promise<void> {
    if (ss.inflight) return ss.inflight;
    const t = this.now();
    if (ss.notBikes || t < ss.retryAt) return Promise.resolve();
    const infoDue = !ss.info || t >= ss.info.expires;
    const statusDue = !ss.status || t >= ss.status.expires;
    if (!infoDue && !statusDue) return Promise.resolve();
    const run = (async () => {
      try {
        if (infoDue) await this.loadInformation(ss);
        if (!ss.notBikes && (statusDue || !ss.status)) await this.loadStatus(ss);
        ss.fails = 0;
        ss.lastError = null;
        this.health.ok(this.now());
      } catch (err) {
        ss.fails++;
        const wait = err instanceof HttpError && err.retryAfterMs !== null ? err.retryAfterMs : RETRY_MIN_MS * 2 ** Math.min(ss.fails - 1, 4);
        ss.retryAt = this.now() + clamp(wait, RETRY_MIN_MS, RETRY_MAX_MS);
        ss.lastError = (err as Error).message;
        this.deps.log?.(`bikeshare: ${ss.sys.name} (${ss.sys.id}): ${ss.lastError}; retrying in ${Math.round((ss.retryAt - this.now()) / MIN)} min`);
      } finally {
        ss.inflight = undefined;
      }
    })();
    ss.inflight = run;
    return run;
  }

  private async loadInformation(ss: SystemState): Promise<void> {
    if (!ss.discovery || this.now() >= ss.discovery.expires) {
      this.requests.discovery++;
      const { json, ttlMs } = await this.fetchJson(ss.sys.discoveryUrl);
      const d = parseDiscovery(json, ss.sys.discoveryUrl);
      if (!d?.stationInformation || !d.stationStatus) throw new Error('no station_information / station_status in gbfs.json');
      const at = this.now();
      ss.discovery = { ...d, at, expires: at + clamp(ttlMs ?? 0, INFO_MIN_MS, INFO_MAX_MS) };
    }
    let vehicles = ss.info?.vehicles;
    if (ss.discovery.vehicleTypes && !vehicles) {
      try {
        this.requests.vehicleTypes++;
        vehicles = parseVehicleTypes((await this.fetchJson(ss.discovery.vehicleTypes)).json);
        if (!vehicles.bikes) {
          ss.notBikes = true;
          this.deps.log?.(`bikeshare: ${ss.sys.name} rents no bicycles; ignoring it`);
          return;
        }
      } catch {
        // optional: without it e-bikes may be unknown
      }
    }
    this.requests.information++;
    const { json, ttlMs } = await this.fetchJson(ss.discovery.stationInformation!);
    const parsed = parseStationInformation(json);
    if (parsed.stations.length === 0) throw new Error('station_information has no usable stations');
    const at = this.now();
    ss.info = {
      at,
      expires: at + clamp(ttlMs ?? 0, INFO_MIN_MS, INFO_MAX_MS),
      stations: parsed.stations,
      byId: new Map(parsed.stations.map((s) => [s.id, s])),
      vehicles,
    };
  }

  private async loadStatus(ss: SystemState): Promise<void> {
    this.requests.status++;
    const { json, ttlMs } = await this.fetchJson(ss.discovery!.stationStatus!);
    const { status } = parseStationStatus(json, ss.info?.vehicles);
    if (status.size === 0) throw new Error('station_status has no stations');
    const at = this.now();
    ss.status = { at, expires: at + clamp(ttlMs ?? 0, STATUS_MIN_MS, STATUS_MAX_MS), byId: status };
  }

  // ---------------------------------------------------------------- serving

  async features(_layer: string, q: FeatureQuery): Promise<FeatureResult> {
    const view = q.bbox;
    if (!view) return { features: [], truncated: true };
    const span = viewSpan(view);
    if (span.lon > MAX_VIEW_DEG || span.lat > MAX_VIEW_DEG) return { features: [], truncated: true };
    if (!this.indexReady) return { features: [], truncated: false };

    const { chosen, total } = selectSystems(this.systems, view, this.deps.maxSystems ?? MAX_SYSTEMS);
    const states = chosen.map((s) => this.state(s));
    await this.waitFor(states.map((s) => this.refresh(s)));

    const cap = Math.min(q.limit, this.deps.stationCap ?? STATION_CAP);
    let truncated = total > chosen.length;
    const out: Feature[] = [];
    let failed = 0;
    for (const ss of states) {
      if (ss.notBikes) continue;
      if (!ss.info) {
        if (ss.lastError !== null) failed++;
        continue;
      }
      for (const st of ss.info.stations) {
        if (!inBBox(st.lon, st.lat, view)) continue;
        const f = this.feature(ss, st);
        if (f) out.push(f);
      }
    }
    if (failed > 0 && failed === states.length) this.health.fail(`No bikeshare system answered (${states[0]?.lastError ?? 'unknown error'})`);
    let features = out;
    if (features.length > cap) {
      features = thinGrid(features, cap, view, {
        lon: (f) => (f.geometry as { coordinates: number[] }).coordinates[0]!,
        lat: (f) => (f.geometry as { coordinates: number[] }).coordinates[1]!,
        // Stations that carry traffic (more docks) first; ties by id keep the chosen set stable.
        score: (f) => (typeof f.props.capacity === 'number' ? f.props.capacity : 0),
        id: (f) => f.id,
      });
      truncated = true;
    }
    return { features, truncated };
  }

  /** Wait for the loads, but not past the view deadline; late ones finish in the background. */
  private async waitFor(loads: Promise<void>[]): Promise<void> {
    if (loads.length === 0) return;
    let timer: unknown;
    const late = new Promise<void>((resolve) => {
      timer = this.timers.setTimeout(resolve, this.deps.deadlineMs ?? VIEW_DEADLINE_MS);
    });
    try {
      await Promise.race([Promise.all(loads), late]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  private feature(ss: SystemState, st: StationInfo): Feature | null {
    const id = `${ss.sys.id}:${st.id}`;
    if (id.length > 64) return null; // the detail route takes ids up to 64 characters
    const stat = ss.status?.byId.get(st.id);
    const r = stationReading(st, stat);
    const props: Record<string, PropValue> = { name: st.name, system: ss.sys.name, state: r.state };
    if (stat?.bikes != null) props.bikes = stat.bikes;
    if (stat?.ebikes != null) props.ebikes = stat.ebikes;
    if (stat?.docks != null) props.docks = stat.docks;
    if (r.capacity !== null) props.capacity = r.capacity;
    if (r.fill !== null) props.fill = r.fill;
    if (stat?.reportedAt != null) props.reported = stat.reportedAt;
    const f: Feature = { id, geometry: { type: 'Point', coordinates: [st.lon, st.lat] }, label: st.name, props };
    const t = stat?.reportedAt ?? ss.status?.at;
    if (t !== undefined) f.t = t;
    return f;
  }

  async featureDetail(_layer: string, featureId: string): Promise<FeatureDetail | null> {
    // System ids may contain ':'; try each split point.
    for (let i = featureId.indexOf(':'); i > 0; i = featureId.indexOf(':', i + 1)) {
      const ss = this.states.get(featureId.slice(0, i));
      const st = ss?.info?.byId.get(featureId.slice(i + 1));
      if (ss && st) {
        const stat = ss.status?.byId.get(st.id);
        return buildStationDetail({
          feature: this.feature(ss, st)!,
          system: ss.sys,
          station: st,
          status: stat,
          reading: stationReading(st, stat),
          fetchedAt: ss.status?.at ?? null,
          now: this.now(),
        });
      }
    }
    return null;
  }
}
