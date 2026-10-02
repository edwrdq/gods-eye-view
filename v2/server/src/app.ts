import { Hono } from 'hono';
import { compress } from 'hono/compress';
import type {
  ApiError,
  BBox,
  ClientConfig,
  ElementsResponse,
  FeedStatus,
  FeatureDetail,
  FeaturesResponse,
  FeedsResponse,
  GeocodeResponse,
  HealthResponse,
  HistoryRange,
  LayerKind,
  LayerSnapshot,
  ObjectDetail,
  Observation,
  Track,
} from '@gev/shared';
import type { ObservationRepo } from './db/observations.ts';
import type { FeedManager } from './feeds/manager.ts';
import { GeocodeUnavailableError, type Geocoder } from './geocode.ts';
import { parseBBox } from './geo.ts';
import { layerKinds } from './layers.ts';
import { isFeaturesFeed, isOrbitsFeed, type Feed, type FeedLayer, type TrackedFeed } from './feeds/types.ts';

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
  /** Features cap per response; default 20 000. */
  maxFeatures?: number;
}

const MAX_QUERY_LENGTH = 200;
export const MAX_SNAPSHOT_OBJECTS = 20_000;
export const MAX_FEATURES = 20_000;
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
    | { ok: true; feed: Feed; layer: FeedLayer; status: FeedStatus }
    | { ok: false; status: 404 | 409; message: string };

  const ENDPOINT: Record<LayerKind, string> = {
    tracked: '/snapshot, /objects and /track',
    features: '/features',
    orbits: '/elements',
  };

  /**
   * 404 for layers that do not exist or are served by a different endpoint
   * family (`kind`), 409 for layers of the right kind that cannot serve data now.
   */
  function gate(layerId: string, kind: LayerKind): Gate {
    const actual = layerKinds.get(layerId);
    if (actual === undefined) return { ok: false, status: 404, message: `Unknown layer: ${layerId}` };
    if (actual !== kind) {
      return {
        ok: false,
        status: 404,
        message: `Layer ${layerId} is a ${actual} layer; use /api/layers/${layerId}${ENDPOINT[actual]} (not ${ENDPOINT[kind]})`,
      };
    }
    const r = deps.feeds.resolve(layerId);
    if (r.kind === 'ok') return { ok: true, feed: r.feed, layer: r.layer, status: r.status };
    if (r.kind === 'unknown') return { ok: false, status: 409, message: `Layer ${layerId} is not available yet` };
    const why = r.status.state === 'needs-key' ? 'needs an API key (see /api/config)' : 'is not enabled on this server';
    return { ok: false, status: 409, message: `Layer ${layerId} ${why}` };
  }

  const maxObjects = deps.maxSnapshotObjects ?? MAX_SNAPSHOT_OBJECTS;

  app.get('/api/layers/:id/snapshot', (c) => {
    const layerId = c.req.param('id');
    const g = gate(layerId, 'tracked');
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

    const { layer } = g;
    const feed = g.feed as TrackedFeed;
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
      feed: g.status,
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
    const g = gate(layerId, 'tracked');
    if (!g.ok) return c.json(fail(g.message), g.status);
    const at = epochParam(c.req.query('at'));
    if (at === null) return c.json(fail('Query parameter at must be epoch milliseconds'), 400);
    if (!validObjectId(objectId)) return c.json(fail('Object not found'), 404);

    const { layer } = g;
    const feed = g.feed as TrackedFeed;
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
    const g = gate(layerId, 'tracked');
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

    const { layer } = g;
    const feed = g.feed as TrackedFeed;
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

  const maxFeatures = deps.maxFeatures ?? MAX_FEATURES;

  app.get('/api/layers/:id/features', (c) => {
    const layerId = c.req.param('id');
    const g = gate(layerId, 'features');
    if (!g.ok) return c.json(fail(g.message), g.status);

    let bbox: BBox | undefined;
    const rawBBox = c.req.query('bbox');
    if (rawBBox !== undefined && rawBBox !== '') {
      const parsed = parseBBox(rawBBox);
      if (typeof parsed === 'string') return c.json(fail(parsed), 400);
      bbox = parsed;
    }
    const from = epochParam(c.req.query('from'));
    const to = epochParam(c.req.query('to'));
    if (from === null || to === null) return c.json(fail('Query parameters from and to must be epoch milliseconds'), 400);
    if (from !== undefined && to !== undefined && from > to) return c.json(fail('Query parameter from must not be after to'), 400);
    if (!isFeaturesFeed(g.feed)) return c.json(fail(`Layer ${layerId} has no features`), 404);

    const { features, truncated } = g.feed.features(layerId, { bbox, from, to, limit: maxFeatures });
    const body: FeaturesResponse = { layer: layerId, feed: g.feed.status(layerId), features, truncated };
    return c.json(body);
  });

  app.get('/api/layers/:id/features/:featureId', async (c) => {
    const layerId = c.req.param('id');
    const featureId = c.req.param('featureId');
    const g = gate(layerId, 'features');
    if (!g.ok) return c.json(fail(g.message), g.status);
    if (!validObjectId(featureId) || !isFeaturesFeed(g.feed)) return c.json(fail('Feature not found'), 404);
    const body: FeatureDetail | null = await g.feed.featureDetail(layerId, featureId);
    if (!body) return c.json(fail('Feature not found'), 404);
    return c.json(body);
  });

  app.get('/api/layers/:id/elements', (c) => {
    const layerId = c.req.param('id');
    const g = gate(layerId, 'orbits');
    if (!g.ok) return c.json(fail(g.message), g.status);
    const group = c.req.query('group');
    if (group !== undefined && group !== '' && !/^[A-Za-z0-9-]{1,40}$/.test(group)) {
      return c.json(fail('Query parameter group must be a group name such as stations'), 400);
    }
    if (!isOrbitsFeed(g.feed)) return c.json(fail(`Layer ${layerId} has no elements`), 404);
    const found = g.feed.elements(layerId, group === '' ? undefined : group);
    if (!found) return c.json(fail(`Unknown group: ${group}`), 404);
    const body: ElementsResponse = { layer: layerId, feed: g.feed.status(layerId), ...found };
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
