import { Hono } from 'hono';
import { compress } from 'hono/compress';
import type {
  ApiError,
  BBox,
  ClientConfig,
  FeedsResponse,
  GeocodeResponse,
  HealthResponse,
  HistoryRange,
  LayerSnapshot,
  ObjectDetail,
  Observation,
  Track,
} from '@gev/shared';
import type { ObservationRepo } from './db/observations.ts';
import type { FeedManager } from './feeds/manager.ts';
import { GeocodeUnavailableError, type Geocoder } from './geocode.ts';
import { parseBBox } from './geo.ts';
import { layerIds } from './layers.ts';

export interface AppDeps {
  /** Browser-safe config served verbatim at /api/config. */
  clientConfig: ClientConfig;
  geocoder: Geocoder;
  dbStatus: () => HealthResponse['db'];
  version: string;
  now?: () => number;
  feeds: FeedManager;
  observations: Pick<ObservationRepo, 'latestPerObject' | 'latestFor' | 'trackPoints' | 'timeRange'>;
  /** Snapshot cap; default 20 000. */
  maxSnapshotObjects?: number;
}

const MAX_QUERY_LENGTH = 200;
export const MAX_SNAPSHOT_OBJECTS = 20_000;
export const MAX_TRACK_POINTS = 5_000;
const DEFAULT_TRACK_MS = 6 * 3600_000;
const MAX_OBJECT_ID_LENGTH = 64;

/** Parse an optional epoch-ms query value. Returns undefined when absent, null when invalid. */
function epochParam(raw: string | undefined): number | undefined | null {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const app = new Hono();
  // Snapshots run to megabytes of JSON; gzip cuts them roughly tenfold.
  app.use('/api/*', compress());

  const fail = (message: string): ApiError => ({ error: message });

  app.get('/api/health', (c) => {
    const body: HealthResponse = {
      ok: true,
      version: deps.version,
      uptimeS: Math.round((now() - startedAt) / 1000),
      db: deps.dbStatus(),
    };
    return c.json(body);
  });

  app.get('/api/config', (c) => c.json(deps.clientConfig));

  app.get('/api/geocode', async (c) => {
    const query = (c.req.query('q') ?? '').trim();
    if (!query) return c.json(fail('Query parameter q is required'), 400);
    if (query.length > MAX_QUERY_LENGTH) {
      return c.json(fail(`Query parameter q must be at most ${MAX_QUERY_LENGTH} characters`), 400);
    }
    try {
      const results = await deps.geocoder.search(query, c.req.raw.signal);
      const body: GeocodeResponse = { query, results };
      return c.json(body);
    } catch (err) {
      if (err instanceof GeocodeUnavailableError) return c.json(fail(err.message), 502);
      throw err;
    }
  });

  app.get('/api/feeds', (c) => {
    const body: FeedsResponse = { feeds: deps.feeds.statuses() };
    return c.json(body);
  });

  type Gate =
    | { ok: true; feed: Extract<ReturnType<FeedManager['resolve']>, { kind: 'ok' }> }
    | { ok: false; status: 404 | 409; message: string };

  /** 404 for layers that do not exist, 409 for layers that exist but cannot serve data now. */
  function gate(layerId: string): Gate {
    const r = deps.feeds.resolve(layerId);
    if (r.kind === 'ok') return { ok: true, feed: r };
    if (r.kind === 'unknown') {
      return layerIds.has(layerId)
        ? { ok: false, status: 409, message: `Layer ${layerId} is not available yet` }
        : { ok: false, status: 404, message: `Unknown layer: ${layerId}` };
    }
    const why = r.status.state === 'needs-key' ? 'needs an API key (see /api/config)' : 'is not enabled on this server';
    return { ok: false, status: 409, message: `Layer ${layerId} ${why}` };
  }

  const maxObjects = deps.maxSnapshotObjects ?? MAX_SNAPSHOT_OBJECTS;

  app.get('/api/layers/:id/snapshot', (c) => {
    const layerId = c.req.param('id');
    const g = gate(layerId);
    if (!g.ok) return c.json(fail(g.message), g.status);

    let bbox: BBox | undefined;
    const rawBBox = c.req.query('bbox');
    if (rawBBox !== undefined && rawBBox !== '') {
      const parsed = parseBBox(rawBBox);
      if (typeof parsed === 'string') return c.json(fail(parsed), 400);
      bbox = parsed;
    }
    const at = epochParam(c.req.query('at'));
    if (at === null) return c.json(fail('Query parameter at must be epoch milliseconds'), 400);

    const { feed, layer } = g.feed;
    let objects: Observation[];
    let truncated: boolean;
    if (at === undefined) {
      if (bbox) feed.hint?.(layerId, bbox);
      ({ objects, truncated } = feed.live.query({ bbox, include: layer.include, limit: maxObjects }));
    } else {
      const rows = deps.observations.latestPerObject({
        layer: layer.storageLayer,
        from: at - layer.lookbackMs,
        to: at,
        bbox,
      });
      objects = layer.include ? rows.filter(layer.include) : rows;
      truncated = objects.length > maxObjects;
      if (truncated) objects.length = maxObjects;
    }
    const body: LayerSnapshot = {
      layer: layerId,
      at: at ?? now(),
      historical: at !== undefined,
      feed: g.feed.status,
      objects,
      truncated,
    };
    return c.json(body);
  });

  function validObjectId(id: string): boolean {
    return id.length > 0 && id.length <= MAX_OBJECT_ID_LENGTH;
  }

  app.get('/api/layers/:id/objects/:objectId', async (c) => {
    const layerId = c.req.param('id');
    const objectId = c.req.param('objectId');
    const g = gate(layerId);
    if (!g.ok) return c.json(fail(g.message), g.status);
    const at = epochParam(c.req.query('at'));
    if (at === null) return c.json(fail('Query parameter at must be epoch milliseconds'), 400);
    if (!validObjectId(objectId)) return c.json(fail('Object not found'), 404);

    const { feed, layer } = g.feed;
    const obs =
      at === undefined
        ? (feed.live.get(objectId) ?? deps.observations.latestFor(layer.storageLayer, objectId))
        : deps.observations.latestFor(layer.storageLayer, objectId, at);
    if (!obs) return c.json(fail('Object not found'), 404);
    const body: ObjectDetail = await feed.detail(layerId, obs, at !== undefined);
    body.live = at === undefined && feed.live.get(objectId) !== undefined;
    return c.json(body);
  });

  app.get('/api/layers/:id/objects/:objectId/track', (c) => {
    const layerId = c.req.param('id');
    const objectId = c.req.param('objectId');
    const g = gate(layerId);
    if (!g.ok) return c.json(fail(g.message), g.status);
    const toRaw = epochParam(c.req.query('to'));
    const fromRaw = epochParam(c.req.query('from'));
    if (toRaw === null || fromRaw === null) {
      return c.json(fail('Query parameters from and to must be epoch milliseconds'), 400);
    }
    const to = toRaw ?? now();
    const from = fromRaw ?? to - DEFAULT_TRACK_MS;
    if (from > to) return c.json(fail('Query parameter from must not be after to'), 400);
    if (!validObjectId(objectId)) return c.json(fail('Object not found'), 404);

    const { feed, layer } = g.feed;
    const points = deps.observations.trackPoints(layer.storageLayer, objectId, from, to, MAX_TRACK_POINTS);
    // The throttle may not have stored the newest live position yet; include it.
    const liveObs = feed.live.get(objectId);
    const last = points[points.length - 1];
    if (liveObs && liveObs.t >= from && liveObs.t <= to && (!last || liveObs.t > last[0])) {
      points.push([liveObs.t, liveObs.lon, liveObs.lat, liveObs.alt ?? null]);
    }
    const body: Track = { layer: layerId, objectId, points };
    return c.json(body);
  });

  app.get('/api/history/range', (c) => {
    const { from, to } = deps.observations.timeRange();
    const body: HistoryRange = { from, to, retentionMs: deps.feeds.retentionMs };
    return c.json(body);
  });

  app.notFound((c) =>
    c.req.path.startsWith('/api') ? c.json(fail('Not found'), 404) : c.text('Not found', 404),
  );

  app.onError((err, c) => {
    console.error(err);
    return c.req.path.startsWith('/api')
      ? c.json(fail('Internal server error'), 500)
      : c.text('Internal server error', 500);
  });

  return app;
}
