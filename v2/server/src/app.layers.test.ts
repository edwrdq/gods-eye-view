import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiError, ElementsResponse, FeatureDetail, FeaturesResponse, FeedsResponse } from '@gev/shared';
import { createApp } from './app.ts';
import { openDb } from './db/index.ts';
import { CablesFeed } from './feeds/cables/feed.ts';
import { CyclonesFeed } from './feeds/cyclones/feed.ts';
import { DatacentersFeed } from './feeds/datacenters/feed.ts';
import { InstallationsFeed } from './feeds/installations/feed.ts';
import { EarthquakesFeed } from './feeds/earthquakes/feed.ts';
import { LaunchesFeed } from './feeds/launches/feed.ts';
import { FeedManager } from './feeds/manager.ts';
import { FEED_DEFINITIONS, implementedLayers } from './feeds/registry.ts';
import { SatellitesFeed } from './feeds/satellites/feed.ts';
import { clock, manualTimers } from './feeds/test-utils.ts';
import type { Feed } from './feeds/types.ts';
import { buildLayers, layerKinds } from './layers.ts';

const fx = (rel: string) => readFileSync(new URL(`./feeds/${rel}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-02T14:30:00Z');

function setup(opts: { enabled?: string[]; maxFeatures?: number; storms?: boolean } = {}) {
  const enabled = new Set(opts.enabled ?? ['earthquakes', 'cyclones', 'launches', 'satellites']);
  const c = clock(NOW);
  const db = openDb(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-app-'));
  const fetchFn = async (url: string): Promise<Response> => {
    if (url.includes('earthquake.usgs.gov')) return new Response(fx('earthquakes/fixtures/usgs-all-day.json'));
    if (url.includes('CurrentStorms.json')) return new Response(opts.storms === false ? '{"activeStorms":[]}' : fx('cyclones/fixtures/current-storms.json'));
    if (url.includes('/MapServer/5/')) return new Response(fx('cyclones/fixtures/gis-points.json'));
    if (url.includes('/MapServer/6/')) return new Response(fx('cyclones/fixtures/gis-track.json'));
    if (url.includes('/MapServer/7/')) return new Response(fx('cyclones/fixtures/gis-cone.json'));
    if (url.includes('/MapServer/10/')) return new Response(fx('cyclones/fixtures/gis-past-points.json'));
    if (url.includes('thespacedevs')) return new Response(fx('launches/fixtures/ll2-launches.json'));
    if (url.includes('celestrak')) return new Response(fx('satellites/fixtures/stations.tle'));
    throw new Error(`unexpected ${url}`);
  };
  const base = { fetch: fetchFn, now: c.now, timers: manualTimers };
  const feeds: Array<Feed & { idle(): Promise<void> }> = [];
  if (enabled.has('earthquakes')) feeds.push(new EarthquakesFeed({ ...base, repo: db.features }));
  if (enabled.has('cyclones')) feeds.push(new CyclonesFeed(base));
  if (enabled.has('launches')) feeds.push(new LaunchesFeed(base));
  if (enabled.has('cables')) feeds.push(Object.assign(new CablesFeed({ now: c.now }), { idle: async () => {} }));
  if (enabled.has('datacenters')) feeds.push(Object.assign(new DatacentersFeed({ now: c.now }), { idle: async () => {} }));
  if (enabled.has('installations')) feeds.push(Object.assign(new InstallationsFeed({ now: c.now }), { idle: async () => {} }));
  if (enabled.has('satellites')) feeds.push(new SatellitesFeed({ ...base, cacheDir: dir, groups: ['stations', 'visual'], sleep: async () => {} }));
  const manager = new FeedManager({ feeds, definitions: FEED_DEFINITIONS, repo: db.observations, retentionMs: 86_400_000, now: c.now, timers: manualTimers });
  const app = createApp({
    clientConfig: { googleMapsApiKey: null, cesiumIonToken: null, layers: buildLayers({}, implementedLayers([...enabled])) },
    geocoder: { search: async () => [] },
    dbStatus: () => ({ path: ':memory:', sizeBytes: 0 }),
    version: 'test',
    now: c.now,
    feeds: manager,
    observations: db.observations,
    maxFeatures: opts.maxFeatures,
  });
  const get = async <T>(p: string): Promise<{ status: number; body: T }> => {
    const res = await app.request(p);
    return { status: res.status, body: (await res.json()) as T };
  };
  return {
    get,
    c,
    feeds,
    manager,
    async startAll() {
      manager.start();
      await Promise.all(feeds.map((f) => f.idle()));
    },
    async cleanup() {
      await manager.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('feed layer kinds agree with the layer catalog', async () => {
  const s = setup();
  try {
    for (const f of s.feeds) for (const l of f.layers) assert.equal(l.kind, layerKinds.get(l.id), l.id);
  } finally {
    await s.cleanup();
  }
});

test('/api/feeds lists the new layers with their freshness windows', async () => {
  const s = setup({ enabled: ['earthquakes', 'launches'] });
  try {
    await s.startAll();
    const { body } = await s.get<FeedsResponse>('/api/feeds');
    const by = new Map(body.feeds.map((f) => [f.layer, f]));
    assert.equal(by.get('earthquakes')!.state, 'live');
    assert.equal(by.get('earthquakes')!.count, 11);
    assert.equal(by.get('earthquakes')!.freshnessMs, 300_000);
    assert.equal(by.get('launches')!.state, 'live');
    assert.equal(by.get('launches')!.freshnessMs, 3 * 3_600_000);
    assert.equal(by.get('cyclones')!.state, 'off');
    assert.equal(by.get('cyclones')!.freshnessMs, 40 * 60_000);
    assert.equal(by.get('satellites')!.state, 'off');
    assert.equal(by.get('satellites')!.freshnessMs, 12 * 3_600_000);
  } finally {
    await s.cleanup();
  }
});

test('/api/config statuses: enabled feeds are available, others disabled', () => {
  const layers = (enabled: string[]) => new Map(buildLayers({}, implementedLayers(enabled)).map((l) => [l.id, l]));
  const some = layers(['earthquakes', 'satellites']);
  assert.equal(some.get('earthquakes')!.status, 'available');
  assert.equal(some.get('satellites')!.status, 'available');
  assert.equal(some.get('launches')!.status, 'disabled');
  assert.equal(some.get('cyclones')!.status, 'disabled');
  assert.equal(some.get('earthquakes')!.kind, 'features');
  assert.equal(some.get('satellites')!.kind, 'orbits');
  const all = layers(['flights', 'vessels', 'earthquakes', 'cyclones', 'launches', 'satellites']);
  for (const id of ['earthquakes', 'cyclones', 'launches', 'satellites']) assert.equal(all.get(id)!.status, 'available', id);
});

test('GET /features: default window, bbox incl. antimeridian, from/to, cap and truncation', async () => {
  const s = setup({ enabled: ['earthquakes'], maxFeatures: 4 });
  try {
    await s.startAll();
    const world = (await s.get<FeaturesResponse>('/api/layers/earthquakes/features')).body;
    assert.equal(world.layer, 'earthquakes');
    assert.equal(world.feed.layer, 'earthquakes');
    assert.equal(world.feed.state, 'live');
    assert.equal(world.features.length, 4);
    assert.equal(world.truncated, true);
    assert.ok(world.features.slice(0, 3).every((f) => f.props.mag === 5.1), 'cap keeps the largest events first');

    const solomon = (await s.get<FeaturesResponse>('/api/layers/earthquakes/features?bbox=150,-20,-170,0')).body;
    assert.equal(solomon.truncated, false);
    assert.ok(solomon.features.length >= 3);
    assert.ok(solomon.features.every((f) => (f.geometry as any).coordinates[0] > 150 || (f.geometry as any).coordinates[0] < -170));
    const none = (await s.get<FeaturesResponse>('/api/layers/earthquakes/features?bbox=-10,-10,10,10')).body;
    assert.deepEqual(none.features, []);

    const to = NOW - 3 * 86_400_000;
    assert.equal((await s.get<FeaturesResponse>(`/api/layers/earthquakes/features?to=${to}`)).body.features.length, 0);
    assert.equal((await s.get<FeaturesResponse>(`/api/layers/earthquakes/features?from=0&to=${NOW}&bbox=-180,-90,180,90`)).body.features.length, 4);

    for (const q of ['bbox=1,2,3', 'bbox=0,50,10,40', 'from=x', 'to=-1', 'from=10&to=5']) {
      const r = await s.get<ApiError>(`/api/layers/earthquakes/features?${q}`);
      assert.equal(r.status, 400, q);
      assert.ok(r.body.error);
    }
  } finally {
    await s.cleanup();
  }
});

test('GET /features/:id returns FeatureDetail, 404 for unknown ids', async () => {
  const s = setup();
  try {
    await s.startAll();
    const d = await s.get<FeatureDetail>('/api/layers/earthquakes/features/us6000tyzl');
    assert.equal(d.status, 200);
    assert.equal(d.body.featureId, 'us6000tyzl');
    assert.ok(d.body.sections.length >= 3);
    assert.match(d.body.url!, /usgs\.gov/);
    assert.equal((await s.get('/api/layers/earthquakes/features/nope')).status, 404);
    assert.equal((await s.get('/api/layers/earthquakes/features/' + 'x'.repeat(100))).status, 404);

    const storm = await s.get<FeatureDetail>('/api/layers/cyclones/features/ep182026:forecast:24');
    assert.equal(storm.status, 200);
    assert.equal(storm.body.title, 'Hurricane Rachel');
    const launch = await s.get<FeatureDetail>('/api/layers/launches/features/63181269-b125-4c36-951c-c9bd9bbc4b55');
    assert.equal(launch.status, 200);
    assert.equal(launch.body.title, 'Starlink Group 15-23');
  } finally {
    await s.cleanup();
  }
});

test('cyclones and launches serve features; no storms is a normal, live, empty answer', async () => {
  const s = setup({ storms: false });
  try {
    await s.startAll();
    const empty = await s.get<FeaturesResponse>('/api/layers/cyclones/features');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.features, []);
    assert.equal(empty.body.feed.state, 'live');
    assert.equal(empty.body.truncated, false);
    const launches = await s.get<FeaturesResponse>('/api/layers/launches/features?bbox=-125,30,-115,40');
    assert.ok(launches.body.features.length >= 1);
    assert.equal(launches.body.features[0]!.props.part, 'pad');
  } finally {
    await s.cleanup();
  }
});

test('GET /elements: all groups, one group, unknown group 404, invalid group 400', async () => {
  const s = setup();
  try {
    await s.startAll();
    const all = await s.get<ElementsResponse>('/api/layers/satellites/elements');
    assert.equal(all.status, 200);
    assert.equal(all.body.layer, 'satellites');
    assert.deepEqual(all.body.groups, ['stations', 'visual']);
    assert.equal(all.body.elements.length, 20);
    assert.equal(all.body.feed.state, 'live');
    const one = await s.get<ElementsResponse>('/api/layers/satellites/elements?group=visual');
    assert.equal(one.body.elements.length, 20);
    assert.ok(one.body.elements.every((e) => e.group === 'visual'));
    const empty = await s.get<ElementsResponse>('/api/layers/satellites/elements?group=');
    assert.equal(empty.body.elements.length, 20);
    const unknown = await s.get<ApiError>('/api/layers/satellites/elements?group=nope');
    assert.equal(unknown.status, 404);
    assert.match(unknown.body.error, /Unknown group/);
    assert.equal((await s.get('/api/layers/satellites/elements?group=a%20b')).status, 400);
  } finally {
    await s.cleanup();
  }
});

test('requests for the wrong kind of layer are 404 and say which endpoint to use', async () => {
  const s = setup();
  try {
    await s.startAll();
    const snap = await s.get<ApiError>('/api/layers/earthquakes/snapshot');
    assert.equal(snap.status, 404);
    assert.match(snap.body.error, /features layer/);
    assert.match(snap.body.error, /\/api\/layers\/earthquakes\/features/);
    for (const p of ['/api/layers/earthquakes/objects/abc', '/api/layers/cyclones/objects/abc/track', '/api/layers/launches/snapshot', '/api/layers/satellites/snapshot']) {
      assert.equal((await s.get(p)).status, 404, p);
    }
    const sat = await s.get<ApiError>('/api/layers/satellites/snapshot');
    assert.match(sat.body.error, /elements/);
    const fl = await s.get<ApiError>('/api/layers/flights/features');
    assert.equal(fl.status, 404);
    assert.match(fl.body.error, /tracked layer/);
    assert.equal((await s.get('/api/layers/flights/elements')).status, 404);
    assert.equal((await s.get('/api/layers/earthquakes/elements')).status, 404);
    assert.equal((await s.get('/api/layers/satellites/features')).status, 404);
    assert.equal((await s.get('/api/layers/nope/features')).status, 404);
    assert.equal((await s.get('/api/layers/nope/elements')).status, 404);
  } finally {
    await s.cleanup();
  }
});

test('disabled feeds and planned layers answer 409', async () => {
  const s = setup({ enabled: ['earthquakes'] });
  try {
    await s.startAll();
    const off = await s.get<ApiError>('/api/layers/cyclones/features');
    assert.equal(off.status, 409);
    assert.match(off.body.error, /not enabled/);
    assert.equal((await s.get('/api/layers/launches/features/abc')).status, 409);
    assert.equal((await s.get('/api/layers/satellites/elements')).status, 409);
    const planned = await s.get<ApiError>('/api/layers/fires/features');
    assert.equal(planned.status, 409);
    assert.match(planned.body.error, /not available yet/);
    assert.equal((await s.get('/api/layers/earthquakes/features')).status, 200);
  } finally {
    await s.cleanup();
  }
});

test('static infrastructure layers: features, bbox, truncation, detail, and 409 when not enabled', async () => {
  const s = setup({ enabled: ['cables', 'datacenters', 'installations'] });
  try {
    await s.startAll();
    const feeds = (await s.get<FeedsResponse>('/api/feeds')).body.feeds;
    for (const id of ['submarine-cables', 'datacenters', 'installations']) assert.equal(feeds.find((f) => f.layer === id)!.state, 'live', id);

    const dc = await s.get<FeaturesResponse>('/api/layers/datacenters/features?bbox=-77.7,38.9,-77.3,39.1');
    assert.equal(dc.status, 200);
    assert.equal(dc.body.truncated, false);
    assert.ok(dc.body.features.length > 20);
    const first = dc.body.features[0]!;
    const detail = await s.get<FeatureDetail>(`/api/layers/datacenters/features/${first.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.featureId, first.id);
    assert.equal(detail.body.sections.at(-1)!.title, 'Source');

    const world = await s.get<FeaturesResponse>('/api/layers/installations/features');
    assert.equal(world.body.truncated, true);
    assert.equal(world.body.features.length, 3000);
    // the app-level cap still applies on top of the layer's own
    const capped = setup({ enabled: ['installations'], maxFeatures: 50 });
    try {
      await capped.startAll();
      const r = await capped.get<FeaturesResponse>('/api/layers/installations/features');
      assert.equal(r.body.features.length, 50);
      assert.equal(r.body.truncated, true);
    } finally {
      await capped.cleanup();
    }

    const cables = await s.get<FeaturesResponse>('/api/layers/submarine-cables/features?bbox=-76.5,36.5,-75,37.5');
    assert.ok(cables.body.features.some((f) => f.id === 'cable:marea' && f.geometry.type === 'MultiLineString'));
    const cd = await s.get<FeatureDetail>('/api/layers/submarine-cables/features/cable:marea');
    assert.equal(cd.status, 200);
    assert.match(cd.body.sources.join(' '), /TeleGeography/);

    assert.equal((await s.get<ApiError>('/api/layers/installations/features/nope')).status, 404);
    assert.equal((await s.get<ApiError>('/api/layers/installations/snapshot')).status, 404); // features-kind layer
    assert.equal((await s.get<ApiError>('/api/layers/datacenters/features?bbox=1,2,3')).status, 400);
  } finally {
    await s.cleanup();
  }
  const off = setup({ enabled: ['earthquakes'] });
  try {
    assert.equal((await off.get<ApiError>('/api/layers/datacenters/features')).status, 409);
  } finally {
    await off.cleanup();
  }
});
