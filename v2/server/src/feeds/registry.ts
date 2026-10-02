import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
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
];

/** Layer ids with a working server implementation (used for /api/config statuses). */
export function implementedLayers(enabledFeedIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const d of FEED_DEFINITIONS) if (enabledFeedIds.includes(d.id)) for (const l of d.layers) out.add(l);
  return out;
}

export interface BuildFeedsDeps {
  config: Pick<Config, 'feeds' | 'historyDays' | 'env'>;
  db: Pick<Db, 'observations'>;
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
