import type { BBox, FeedStatus, ObjectDetail, Observation } from '@gev/shared';
import { FeedHealth } from '../health.ts';
import { LivePicture, pickProps, type ThrottlePolicy } from '../live-picture.ts';
import { realTimers, type TrackedFeed, type FeedLayer, type FetchLike, type ObservationSink, type Timers } from '../types.ts';
import { AreaBook, areaKey, MAX_RADIUS_NM, type Area } from './areas.ts';
import type { FlightsConfig } from './config.ts';
import { buildFlightDetail } from './detail.ts';
import { noEnrichment, type Enricher } from './enrich.ts';
import { FLIGHT_COMPACT_KEYS, FLIGHT_STICKY_KEYS, LAYER, parseAdsbLol, parseOpenSky } from './parse.ts';

export const FLIGHTS_FRESHNESS_MS = 180_000;
/** Aircraft not heard from for this long leave the live picture. */
export const FLIGHTS_TIMEOUT_MS = 300_000;
export const FLIGHTS_MAX_OBJECTS = 60_000;
/**
 * Throttle defaults: 60 s heartbeat, 1 km movement, 15 degrees of turn; aircraft
 * slower than 2 m/s (taxiing or parked) are stored every 5 minutes instead.
 */
export const FLIGHTS_THROTTLE: ThrottlePolicy = {
  minIntervalMs: 60_000,
  minMoveM: 1_000,
  minHeadingDeg: 15,
  idleSpeedMps: 2,
  idleIntervalMs: 300_000,
};

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_URL = 'https://opensky-network.org/api/states/all?extended=1';
const ADSB_BASE = 'https://api.adsb.lol/v2';
const USER_AGENT = 'gods-eye-view-v2';
const MAX_BACKOFF_MS = 5 * 60_000;

class HttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  constructor(status: number, retryAfterMs: number | null, message: string) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

type Host = 'opensky' | 'adsblol';
interface Target {
  key: string;
  host: Host;
  kind: 'opensky' | 'mil' | 'area';
  area?: Area;
  intervalMs: number;
}

export interface FlightsFeedDeps {
  config: FlightsConfig;
  fetch: FetchLike;
  now?: () => number;
  timers?: Timers;
  store: ObservationSink;
  enricher?: Enricher;
  /** Scheduler resolution; due targets are picked at most this often. */
  tickMs?: number;
  /** Minimum spacing between adsb.lol requests. */
  minRequestGapMs?: number;
}

function retryAfter(res: Response): number | null {
  const raw = res.headers.get('x-rate-limit-retry-after-seconds') ?? res.headers.get('retry-after');
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

export class FlightsFeed implements TrackedFeed {
  readonly id = 'flights';
  readonly freshnessMs = FLIGHTS_FRESHNESS_MS;
  readonly layers: readonly FeedLayer[] = [
    { id: 'flights', storageLayer: LAYER, lookbackMs: 15 * 60_000, include: (o) => o.props.military !== true },
    { id: 'military-flights', storageLayer: LAYER, lookbackMs: 15 * 60_000, include: (o) => o.props.military === true },
  ];
  readonly live: LivePicture;

  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly enricher: Enricher;
  private readonly areas: AreaBook;
  private readonly civil: FeedHealth;
  private readonly mil: FeedHealth;
  private readonly targetState = new Map<string, { nextDue: number; fails: number }>();
  private readonly busy: Record<Host, boolean> = { opensky: false, adsblol: false };
  private readonly cooldownUntil: Record<Host, number> = { opensky: 0, adsblol: 0 };
  private lastAdsbRequestAt = -Infinity;
  private token: { value: string; expires: number } | null = null;
  private openSkyIntervalMs: number;
  private lastSource: string | null = null;
  private timer: unknown = null;
  private abort = new AbortController();
  private inflight = new Set<Promise<unknown>>();

  private readonly deps: FlightsFeedDeps;

  constructor(deps: FlightsFeedDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? realTimers;
    this.enricher = deps.enricher ?? noEnrichment;
    this.civil = new FeedHealth(this.now, FLIGHTS_FRESHNESS_MS);
    this.mil = new FeedHealth(this.now, FLIGHTS_FRESHNESS_MS);
    this.areas = new AreaBook(deps.config.areas, this.now);
    this.openSkyIntervalMs = deps.config.openSkyIntervalMs;
    this.live = new LivePicture({
      timeoutMs: FLIGHTS_TIMEOUT_MS,
      maxObjects: FLIGHTS_MAX_OBJECTS,
      throttle: { ...FLIGHTS_THROTTLE, minIntervalMs: deps.config.storeIntervalMs },
      now: this.now,
      compactProps: (p) => pickProps(p, FLIGHT_COMPACT_KEYS),
    });
  }

  start(): void {
    if (this.timer !== null) return;
    this.civil.running = true;
    this.mil.running = true;
    this.abort = new AbortController();
    this.timer = this.timers.setInterval(() => void this.tick(), this.deps.tickMs ?? 1000);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.civil.running = false;
    this.mil.running = false;
    this.abort.abort();
    await Promise.allSettled([...this.inflight]);
    this.flush();
  }

  /** Resolves when no poll is in flight. */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  hint(layer: string, bbox: BBox): void {
    if (layer !== 'flights') return;
    this.areas.touch(bbox);
  }

  status(layer: string = 'flights'): FeedStatus {
    const military = layer === 'military-flights';
    const health = military ? this.mil : this.civil;
    const include = this.layers.find((l) => l.id === layer)?.include;
    let lastError = health.lastError;
    if (!military && lastError === null && !this.usesOpenSky() && this.areas.active().length === 0) {
      lastError = 'No area to poll yet: set ADSB_AREAS or open the map over a region';
    }
    return {
      layer,
      state: health.state(),
      source: military ? 'adsb.lol' : (this.lastSource ?? (this.usesOpenSky() ? 'OpenSky' : 'adsb.lol')),
      lastSuccess: health.lastSuccess,
      lastError,
      count: this.live.count(include),
      freshnessMs: FLIGHTS_FRESHNESS_MS,
    };
  }

  async detail(layer: string, obs: Observation, historical: boolean): Promise<ObjectDetail> {
    const callsign = typeof obs.props.callsign === 'string' ? obs.props.callsign : '';
    const [aircraft, route] = await Promise.all([
      this.enricher.aircraft(obs.objectId).catch(() => null),
      callsign ? this.enricher.route(callsign).catch(() => null) : Promise.resolve(null),
    ]);
    return { ...buildFlightDetail(obs, { aircraft, route }, historical), layer };
  }

  // ------------------------------------------------------------ scheduling

  private usesOpenSky(): boolean {
    return this.deps.config.openSky !== null;
  }

  /** OpenSky counts as failing after a failed attempt, or when its data went stale. */
  private openSkyFailing(): boolean {
    const st = this.targetState.get('opensky');
    if (!st) return false;
    if (st.fails > 0) return true;
    return this.civilOpenSkyLast !== null && this.now() - this.civilOpenSkyLast > this.openSkyIntervalMs * 2.5;
  }
  private civilOpenSkyLast: number | null = null;

  private desiredTargets(): Target[] {
    const cfg = this.deps.config;
    const out: Target[] = [];
    if (this.usesOpenSky()) {
      out.push({ key: 'opensky', host: 'opensky', kind: 'opensky', intervalMs: this.openSkyIntervalMs });
    }
    out.push({ key: 'mil', host: 'adsblol', kind: 'mil', intervalMs: cfg.milIntervalMs });
    if (!this.usesOpenSky() || this.openSkyFailing()) {
      for (const area of this.areas.active()) {
        out.push({ key: `area:${areaKey(area)}`, host: 'adsblol', kind: 'area', area, intervalMs: cfg.areaIntervalMs });
      }
    }
    return out;
  }

  /** One scheduler step: poll at most one due target per upstream host. */
  async tick(): Promise<void> {
    await Promise.all((['opensky', 'adsblol'] as const).map((h) => this.runHost(h)));
  }

  private async runHost(host: Host): Promise<void> {
    if (this.busy[host] || this.timer === null) return;
    const now = this.now();
    if (now < this.cooldownUntil[host]) return;
    if (host === 'adsblol' && now - this.lastAdsbRequestAt < (this.deps.minRequestGapMs ?? 2000)) return;

    let pick: Target | null = null;
    let pickDue = Infinity;
    for (const t of this.desiredTargets()) {
      if (t.host !== host) continue;
      const due = this.targetState.get(t.key)?.nextDue ?? 0;
      if (due <= now && due < pickDue) {
        pick = t;
        pickDue = due;
      }
    }
    if (!pick) return;

    this.busy[host] = true;
    const run = this.poll(pick).finally(() => {
      this.busy[host] = false;
      this.inflight.delete(run);
    });
    this.inflight.add(run);
    await run;
  }

  private async poll(target: Target): Promise<void> {
    const start = this.now();
    if (target.host === 'adsblol') this.lastAdsbRequestAt = start;
    const health = target.kind === 'mil' ? this.mil : this.civil;
    try {
      let obs: Observation[];
      let source: string;
      if (target.kind === 'opensky') {
        obs = await this.fetchOpenSky();
        source = 'OpenSky';
        this.civilOpenSkyLast = this.now();
      } else if (target.kind === 'mil') {
        obs = parseAdsbLol(await this.getJson(`${ADSB_BASE}/mil`), this.now(), { military: true });
        source = 'adsb.lol';
      } else {
        const a = target.area!;
        obs = parseAdsbLol(
          await this.getJson(`${ADSB_BASE}/lat/${a.lat}/lon/${a.lon}/dist/${MAX_RADIUS_NM}`),
          this.now(),
        );
        source = 'adsb.lol';
      }
      this.ingest(obs);
      health.ok();
      if (target.kind !== 'mil') this.lastSource = source;
      this.targetState.set(target.key, { nextDue: this.now() + target.intervalMs, fails: 0 });
    } catch (err) {
      if (this.timer === null) return; // stopping
      const prevFails = this.targetState.get(target.key)?.fails ?? 0;
      const fails = prevFails + 1;
      let wait = Math.min(target.intervalMs * 2 ** fails, MAX_BACKOFF_MS);
      if (err instanceof HttpError) {
        if (err.status === 429) {
          const cd = Math.min(Math.max(err.retryAfterMs ?? 60_000 * 2 ** (fails - 1), 30_000), 30 * 60_000);
          this.cooldownUntil[target.host] = this.now() + cd;
          wait = Math.max(wait, cd);
        }
        if (err.status === 401 && target.kind === 'opensky') this.token = null;
      }
      this.targetState.set(target.key, { nextDue: this.now() + wait, fails });
      const label = target.kind === 'opensky' ? 'OpenSky' : 'adsb.lol';
      health.fail(`${label}: ${(err as Error).message}`);
    } finally {
      this.live.expire();
      this.flush();
    }
  }

  // ------------------------------------------------------------ ingest

  private ingest(batch: Observation[]): void {
    const now = this.now();
    for (const o of batch) {
      if (now - o.t > FLIGHTS_TIMEOUT_MS) continue;
      const prev = this.live.get(o.objectId);
      if (prev) {
        for (const k of FLIGHT_STICKY_KEYS) {
          const v = prev.props[k];
          if (o.props[k] === undefined && v !== undefined) o.props[k] = v;
        }
      }
      this.live.upsert(o);
    }
  }

  private flush(): void {
    const rows = this.live.takePending();
    if (rows.length === 0) return;
    try {
      this.deps.store(rows);
    } catch (err) {
      console.error('[flights] history write failed:', (err as Error).message);
      this.live.requeue(rows);
    }
  }

  // ------------------------------------------------------------ upstreams

  private async getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const res = await this.deps.fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20_000)]),
    });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      throw new HttpError(res.status, retryAfter(res), `HTTP ${res.status}`);
    }
    this.lastHeaders = res.headers;
    return res.json();
  }
  private lastHeaders: Headers | null = null;

  private async accessToken(): Promise<string> {
    const creds = this.deps.config.openSky!;
    if (this.token && this.now() < this.token.expires - 60_000) return this.token.value;
    const res = await this.deps.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(creds.clientId)}&client_secret=${encodeURIComponent(creds.clientSecret)}`,
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)]),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
    if (!res.ok || !body?.access_token) {
      throw new HttpError(res.status, null, `OAuth failed: ${body?.error_description ?? `HTTP ${res.status}`}`);
    }
    const ttl = Number.isFinite(body.expires_in) ? Number(body.expires_in) : 1800;
    this.token = { value: body.access_token, expires: this.now() + ttl * 1000 };
    return this.token.value;
  }

  private async fetchOpenSky(): Promise<Observation[]> {
    const token = await this.accessToken();
    const json = await this.getJson(OPENSKY_URL, { Authorization: `Bearer ${token}` });
    // Stretch the interval as the daily credit budget thins (tiers from the original app).
    const remaining = Number(this.lastHeaders?.get('x-rate-limit-remaining'));
    const base = this.deps.config.openSkyIntervalMs;
    if (Number.isFinite(remaining)) {
      this.openSkyIntervalMs = remaining > 1200 ? base : remaining > 400 ? Math.max(base, 180_000) : Math.max(base, 300_000);
    }
    return parseOpenSky(json, this.now());
  }
}
