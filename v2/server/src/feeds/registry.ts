import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import path from 'node:path';
import { CyclonesFeed, CYCLONES_FRESHNESS_MS } from './cyclones/feed.ts';
import { EarthquakesFeed, EARTHQUAKES_FRESHNESS_MS } from './earthquakes/feed.ts';
import { LaunchesFeed, LAUNCHES_FRESHNESS_MS } from './launches/feed.ts';
import { DEFAULT_GROUPS, SatellitesFeed, SATELLITES_FRESHNESS_MS } from './satellites/feed.ts';
import { FlightsFeed, FLIGHTS_FRESHNESS_MS } from './flights/feed.ts';
import { loadFlightsConfig } from './flights/config.ts';
import { createAdsbdbEnricher } from './flights/enrich.ts';
import { FeedManager, type FeedDefinition } from './manager.ts';
import { VesselsFeed, VESSELS_FRESHNESS_MS, type WebSocketCtor } from './vessels/feed.ts';
import type { Feed, FetchLike, Timers } from './types.ts';

/** Feeds this server can run. Layer ids come from layers.ts. */
export const FEED_DEFINITIONS: FeedDefinition[] = [
  { id: 'flights', layers: ['flights', 'military-flights'], freshnessMs: FLIGHTS_FRESHNESS_MS },
  { id: 'vessels', layers: ['vessels'], freshnessMs: VESSELS_FRESHNESS_MS },
  { id: 'earthquakes', layers: ['earthquakes'], freshnessMs: EARTHQUAKES_FRESHNESS_MS },
  { id: 'cyclones', layers: ['cyclones'], freshnessMs: CYCLONES_FRESHNESS_MS },
  { id: 'launches', layers: ['launches'], freshnessMs: LAUNCHES_FRESHNESS_MS },
  { id: 'satellites', layers: ['satellites'], freshnessMs: SATELLITES_FRESHNESS_MS },
];

/** Layer ids with a working server implementation (used for /api/config statuses). */
export function implementedLayers(enabledFeedIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const d of FEED_DEFINITIONS) if (enabledFeedIds.includes(d.id)) for (const l of d.layers) out.add(l);
  return out;
}

export interface BuildFeedsDeps {
  config: Pick<Config, 'feeds' | 'historyDays' | 'env' | 'dataDir'>;
  db: Pick<Db, 'observations' | 'features'>;
  fetch?: FetchLike;
  WebSocket?: WebSocketCtor;
  now?: () => number;
  timers?: Timers;
  log?: (msg: string) => void;
}

function parseBoxes(raw: string | undefined, log: (m: string) => void): number[][][] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v as number[][][];
  } catch {
    // fall through
  }
  log('Invalid AISSTREAM_BOUNDING_BOXES; using the whole world');
  return undefined;
}

export function buildFeedManager(deps: BuildFeedsDeps): FeedManager {
  const log = deps.log ?? ((m: string) => console.log(`[feeds] ${m}`));
  const env = deps.config.env;
  const store = (batch: Parameters<Db['observations']['insertObservations']>[0]) =>
    deps.db.observations.insertObservations(batch);
  const fetchFn: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));

  const feeds: Feed[] = [];
  for (const id of deps.config.feeds) {
    if (id === 'flights') {
      const cfg = loadFlightsConfig(env);
      for (const w of cfg.warnings) log(w);
      feeds.push(
        new FlightsFeed({
          config: cfg,
          fetch: fetchFn,
          now: deps.now,
          timers: deps.timers,
          store,
          enricher: createAdsbdbEnricher({ fetch: fetchFn, now: deps.now }),
        }),
      );
      log(
        cfg.openSky
          ? `flights: OpenSky every ${cfg.openSkyIntervalMs / 1000} s (adsb.lol areas as fallback)`
          : `flights: adsb.lol point queries (${cfg.areas.length} configured area(s) plus map viewports)`,
      );
    } else if (id === 'vessels') {
      const key = env.AISSTREAM_API_KEY?.trim() || null;
      const silence = env.AISSTREAM_SILENCE_TIMEOUT_S?.trim();
      feeds.push(
        new VesselsFeed({
          apiKey: key,
          url: env.AISSTREAM_URL?.trim() || undefined,
          WebSocket: deps.WebSocket ?? (globalThis.WebSocket as unknown as WebSocketCtor),
          now: deps.now,
          timers: deps.timers,
          store,
          boundingBoxes: parseBoxes(env.AISSTREAM_BOUNDING_BOXES, log),
          silenceReportMs: silence !== undefined && silence !== '' && Number.isFinite(Number(silence)) ? Number(silence) * 1000 : undefined,
          storeIntervalMs: env.VESSELS_STORE_INTERVAL_S ? Number(env.VESSELS_STORE_INTERVAL_S) * 1000 || undefined : undefined,
        }),
      );
      if (!key) log('vessels: AISSTREAM_API_KEY is not set; feed reports needs-key');
    } else if (id === 'earthquakes') {
      const days = Number(env.EARTHQUAKES_HISTORY_DAYS);
      feeds.push(
        new EarthquakesFeed({
          fetch: fetchFn,
          repo: deps.db.features,
          retentionDays: Number.isFinite(days) && days > 0 ? days : undefined,
          now: deps.now,
          timers: deps.timers,
          log,
        }),
      );
    } else if (id === 'cyclones') {
      feeds.push(new CyclonesFeed({ fetch: fetchFn, now: deps.now, timers: deps.timers, log }));
    } else if (id === 'launches') {
      const poll = Number(env.LAUNCHES_POLL_S);
      feeds.push(
        new LaunchesFeed({
          fetch: fetchFn,
          cacheFile: path.join(deps.config.dataDir, 'cache', 'launches.json'),
          token: env.LL2_API_TOKEN?.trim() || null,
          pollMs: Number.isFinite(poll) && poll > 0 ? poll * 1000 : undefined,
          now: deps.now,
          timers: deps.timers,
          log,
        }),
      );
    } else if (id === 'satellites') {
      const groups = (env.SATELLITE_GROUPS ?? '')
        .split(',')
        .map((g) => g.trim().toLowerCase())
        .filter((g) => /^[a-z0-9-]{1,40}$/.test(g));
      feeds.push(
        new SatellitesFeed({
          fetch: fetchFn,
          cacheDir: path.join(deps.config.dataDir, 'cache', 'celestrak'),
          groups: groups.length > 0 ? groups : DEFAULT_GROUPS,
          now: deps.now,
          timers: deps.timers,
          log,
        }),
      );
    } else {
      log(`unknown feed "${id}" in FEEDS (known: ${FEED_DEFINITIONS.map((d) => d.id).join(', ')}); ignoring`);
    }
  }

  return new FeedManager({
    feeds,
    definitions: FEED_DEFINITIONS,
    repo: deps.db.observations,
    retentionMs: deps.config.historyDays * 86_400_000,
    now: deps.now,
    timers: deps.timers,
    log,
  });
}
