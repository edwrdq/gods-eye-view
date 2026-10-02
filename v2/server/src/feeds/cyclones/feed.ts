import type { Feature, FeatureDetail, FeedStatus } from '@gev/shared';
import { geometryIntersects } from '../../geo.ts';
import { FeedHealth } from '../health.ts';
import { getJson } from '../http.ts';
import { PollLoop } from '../poll.ts';
import { realTimers, type FeatureQuery, type FeatureResult, type FeaturesFeed, type FeedLayer, type FetchLike, type Timers } from '../types.ts';
import { buildStormDetail } from './detail.ts';
import {
  assembleGeometry,
  type ForecastLayers,
  LAYER,
  parseCurrentStorms,
  parseForecastLayer,
  parsePastPoints,
  stormFeatures,
  type StormGeometry,
  type StormStatus,
} from './parse.ts';

export const CYCLONES_POLL_MS = 15 * 60_000;
export const CYCLONES_FRESHNESS_MS = 40 * 60_000;
/** Without a successful poll for this long, stored storms are no longer shown. */
export const CYCLONES_EXPIRY_MS = 12 * 3_600_000;
export const STATUS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
export const GIS_URL = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer';

const FORECAST_LAYERS = [
  { id: 5, kind: 'points' as const, fields: 'idp_source,advisnum,tau,maxwind,gust' },
  { id: 6, kind: 'track' as const, fields: 'idp_source,advisnum' },
  { id: 7, kind: 'cone' as const, fields: 'idp_source,advisnum' },
];
const PAST_POINTS_LAYER = 10;

export interface CyclonesFeedDeps {
  fetch: FetchLike;
  statusUrl?: string;
  gisUrl?: string;
  pollMs?: number;
  now?: () => number;
  timers?: Timers;
  tickMs?: number;
  log?: (msg: string) => void;
}

interface StormState {
  status: StormStatus;
  geometry: StormGeometry | undefined;
  features: Feature[];
}

/**
 * NOAA NHC / CPHC active tropical cyclones (Atlantic, eastern and central North
 * Pacific). Positions come from CurrentStorms.json; forecast points, track,
 * cone and past track from the NHC tropical weather summary MapServer. Having
 * no active storms is the normal off-season state and reports 'live'.
 */
export class CyclonesFeed implements FeaturesFeed {
  readonly id = 'cyclones';
  readonly freshnessMs = CYCLONES_FRESHNESS_MS;
  readonly layers: readonly FeedLayer[] = [{ id: LAYER, kind: 'features', storageLayer: LAYER, lookbackMs: 0 }];

  private readonly deps: CyclonesFeedDeps;
  private readonly now: () => number;
  private readonly health: FeedHealth;
  private readonly loop: PollLoop;
  private storms = new Map<string, StormState>();
  private partialNote: string | null = null;

  constructor(deps: CyclonesFeedDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.health = new FeedHealth(this.now, CYCLONES_FRESHNESS_MS);
    this.loop = new PollLoop({
      intervalMs: deps.pollMs ?? CYCLONES_POLL_MS,
      now: this.now,
      timers: deps.timers ?? realTimers,
      tickMs: deps.tickMs,
      run: (signal) => this.poll(signal),
      onError: (err) => this.health.fail(`NHC: ${(err as Error).message}`),
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
      source: 'NOAA NHC',
      lastSuccess: this.health.lastSuccess,
      lastError: this.health.lastError ?? this.partialNote,
      count: this.visible().length,
      freshnessMs: CYCLONES_FRESHNESS_MS,
    };
  }

  private visible(): StormState[] {
    const last = this.health.lastSuccess;
    if (last === null || this.now() - last > CYCLONES_EXPIRY_MS) return [];
    return [...this.storms.values()];
  }

  private async poll(signal: AbortSignal): Promise<void> {
    const opts = { signal, now: this.now, timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 };
    const { storms, skipped } = parseCurrentStorms(await getJson(this.deps.fetch, this.deps.statusUrl ?? STATUS_URL, opts));
    if (skipped > 0) this.deps.log?.(`cyclones: skipped ${skipped} unusable storm record(s)`);

    const gis = this.deps.gisUrl ?? GIS_URL;
    const query = (layer: number, fields: string, where: string) =>
      `${gis}/${layer}/query?${new URLSearchParams({ where, outFields: fields, outSR: '4326', geometryPrecision: '4', f: 'geojson' })}`;

    let layers: ForecastLayers | null = null;
    let past: ReturnType<typeof parsePastPoints> | null = null;
    let note: string | null = null;
    if (storms.length > 0) {
      // Sequential and small: this is a handful of requests every 15 minutes.
      try {
        const got: ForecastLayers = { points: [], track: [], cone: [] };
        for (const l of FORECAST_LAYERS) {
          got[l.kind] = parseForecastLayer(await getJson(this.deps.fetch, query(l.id, l.fields, '1=1'), opts), l.kind);
        }
        layers = got;
      } catch (err) {
        if (signal.aborted) throw err;
        note = `Forecast track and cone unavailable (${(err as Error).message}); showing positions`;
      }
      try {
        const where = `idp_source IN (${storms.map((s) => `'${s.id.toUpperCase()}_pts'`).join(',')})`;
        past = parsePastPoints(await getJson(this.deps.fetch, query(PAST_POINTS_LAYER, 'idp_source,dtg,intensity', where), opts));
      } catch (err) {
        if (signal.aborted) throw err;
        note ??= `Past track unavailable (${(err as Error).message})`;
      }
    }

    const fresh = layers ? assembleGeometry(storms, layers, past) : new Map<string, StormGeometry>();
    const next = new Map<string, StormState>();
    for (const status of storms) {
      let geometry = fresh.get(status.id);
      const prev = this.storms.get(status.id)?.geometry;
      if (!layers && prev && prev.advisoryNumber === status.advisoryNumber) geometry = prev; // keep the last good shapes
      if (geometry && !past && prev?.pastTrack) geometry = { ...geometry, pastTrack: prev.pastTrack };
      next.set(status.id, { status, geometry, features: stormFeatures(status, geometry) });
    }
    this.storms = next;
    this.partialNote = note;
    this.health.ok(this.now());
  }

  features(_layer: string, q: FeatureQuery): FeatureResult {
    const out: Feature[] = [];
    let truncated = false;
    for (const st of this.visible()) {
      // No history is kept: a view of the past hides storms we did not know of yet.
      if (q.to !== undefined && q.to < st.status.positionAt) continue;
      for (const f of st.features) {
        if (q.bbox && !geometryIntersects(f.geometry, q.bbox)) continue;
        if (out.length >= q.limit) {
          truncated = true;
          continue;
        }
        out.push(f);
      }
    }
    return { features: out, truncated };
  }

  async featureDetail(_layer: string, featureId: string): Promise<FeatureDetail | null> {
    const stormId = featureId.split(':')[0]!;
    const st = this.visible().find((s) => s.status.id === stormId);
    const feature = st?.features.find((f) => f.id === featureId);
    return st && feature ? buildStormDetail(st.status, st.geometry, feature, this.now()) : null;
  }
}
