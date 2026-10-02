import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiError, FeedsResponse, HistoryRange, LayerSnapshot, ObjectDetail, Observation, Track } from '@gev/shared';
import { createApp } from './app.ts';
import { openDb, type Db } from './db/index.ts';
import { loadFlightsConfig } from './feeds/flights/config.ts';
import { FlightsFeed } from './feeds/flights/feed.ts';
import { FeedManager } from './feeds/manager.ts';
import { FEED_DEFINITIONS } from './feeds/registry.ts';
import { clock, jsonResponse, manualTimers } from './feeds/test-utils.ts';
import { VesselsFeed, type VesselsFeedDeps } from './feeds/vessels/feed.ts';
import { buildLayers } from './layers.ts';

const T0 = 1_760_000_000_000;
const MIN = 60_000;

class NullSocket {
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  send() {}
  close() {}
}

function setup(opts: { vessels?: 'key' | 'nokey' | 'disabled'; maxSnapshotObjects?: number } = {}) {
  const c = clock(T0);
  const db: Db = openDb(':memory:');
  const feeds: (FlightsFeed | VesselsFeed)[] = [];
  const flights = new FlightsFeed({
    config: loadFlightsConfig({}),
    fetch: async () => jsonResponse({ now: c.now(), ac: [] }),
    now: c.now,
    timers: manualTimers,
    store: (b) => db.observations.insertObservations(b),
  });
  feeds.push(flights);
  let vessels: VesselsFeed | undefined;
  if (opts.vessels !== 'disabled') {
    vessels = new VesselsFeed({
      apiKey: opts.vessels === 'nokey' ? null : 'k',
      WebSocket: NullSocket as unknown as VesselsFeedDeps['WebSocket'],
      now: c.now,
      timers: manualTimers,
      store: (b) => db.observations.insertObservations(b),
    });
    feeds.push(vessels);
  }
  const manager = new FeedManager({ feeds, definitions: FEED_DEFINITIONS, repo: db.observations, retentionMs: 7 * 86_400_000, now: c.now, timers: manualTimers });
  const app = createApp({
    clientConfig: { googleMapsApiKey: null, cesiumIonToken: null, layers: buildLayers({}) },
    geocoder: { search: async () => [] },
    dbStatus: () => ({ path: ':memory:', sizeBytes: 0 }),
    version: 'test',
    now: c.now,
    feeds: manager,
    observations: db.observations,
    maxSnapshotObjects: opts.maxSnapshotObjects,
  });
  const get = async <T>(path: string): Promise<{ status: number; body: T }> => {
    const res = await app.request(path);
    return { status: res.status, body: (await res.json()) as T };
  };
  return { app, c, db, flights, vessels, manager, get };
}

function flight(id: string, over: Partial<Observation> = {}): Observation {
  return { layer: 'flights', objectId: id, t: T0, lon: -122.4, lat: 37.6, alt: 10000, heading: 90, speed: 200, props: { callsign: id.toUpperCase(), onGround: false }, ...over };
}

test('GET /api/feeds lists every implemented layer with its state', async () => {
  const { get, flights } = setup({ vessels: 'nokey' });
  let { body } = await get<FeedsResponse>('/api/feeds');
  assert.deepEqual(body.feeds.map((f) => [f.layer, f.state]), [
    ['flights', 'off'],
    ['military-flights', 'off'],
    ['vessels', 'needs-key'],
    ['earthquakes', 'off'],
    ['cyclones', 'off'],
    ['launches', 'off'],
    ['satellites', 'off'],
    ['submarine-cables', 'off'],
    ['datacenters', 'off'],
    ['installations', 'off'],
    ['bikeshare', 'off'],
    ['radio', 'off'],
  ]);
  flights.start();
  await flights.idle();
  ({ body } = await get<FeedsResponse>('/api/feeds'));
  assert.equal(body.feeds[0]!.state, 'stale'); // running, no area to poll yet
  assert.equal(body.feeds[1]!.state, 'live'); // military poll succeeded
  await flights.stop();
});

test('disabled feeds report off and layers they serve answer 409', async () => {
  const { get } = setup({ vessels: 'disabled' });
  const feeds = (await get<FeedsResponse>('/api/feeds')).body.feeds;
  assert.equal(feeds.find((f) => f.layer === 'vessels')!.state, 'off');
  const r = await get<ApiError>('/api/layers/vessels/snapshot');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /not enabled/);
});

test('snapshot error semantics: 404 unknown layer, 409 not ready / needs key, 400 bad params', async () => {
  const { get, flights } = setup({ vessels: 'nokey' });
  assert.equal((await get('/api/layers/nope/snapshot')).status, 404);
  assert.equal((await get('/api/layers/fires/features')).status, 409); // planned layer
  const nokey = await get<ApiError>('/api/layers/vessels/snapshot');
  assert.equal(nokey.status, 409);
  assert.match(nokey.body.error, /API key/);
  assert.equal((await get('/api/layers/flights/snapshot')).status, 409); // not started -> off
  flights.start();
  await flights.idle();
  for (const q of ['bbox=1,2,3', 'bbox=a,b,c,d', 'bbox=0,50,10,40', 'bbox=0,-95,10,0', 'bbox=-200,0,10,10', 'at=abc', 'at=-5']) {
    const r = await get<ApiError>(`/api/layers/flights/snapshot?${q}`);
    assert.equal(r.status, 400, q);
    assert.ok(r.body.error);
  }
  assert.equal((await get('/api/layers/flights/objects/abc/track?from=5&to=1')).status, 400);
  assert.equal((await get('/api/layers/flights/objects/abc?at=x')).status, 400);
  assert.equal((await get('/api/layers/nope/objects/abc')).status, 404);
  assert.equal((await get('/api/layers/nope/objects/abc/track')).status, 404);
  await flights.stop();
});

test('live snapshot: whole world, bbox, antimeridian, civil/military split, compact props', async () => {
  const { get, flights } = setup();
  flights.start();
  await flights.idle();
  flights.live.upsert(flight('sfo001'));
  flights.live.upsert(flight('fij001', { lon: 179.5, lat: -17 }));
  flights.live.upsert(flight('tka001', { lon: -179.5, lat: -17 }));
  flights.live.upsert(flight('mil001', { props: { callsign: 'RCH1', military: true, altBaro: 1234, src: 'x' } }));

  const all = (await get<LayerSnapshot>('/api/layers/flights/snapshot')).body;
  assert.equal(all.layer, 'flights');
  assert.equal(all.historical, false);
  assert.equal(all.at, T0);
  assert.equal(all.truncated, false);
  assert.deepEqual(all.objects.map((o) => o.objectId).sort(), ['fij001', 'sfo001', 'tka001']);
  assert.equal(all.feed.layer, 'flights');
  assert.equal(all.feed.count, 3);

  const sf = (await get<LayerSnapshot>('/api/layers/flights/snapshot?bbox=-123,37,-122,38')).body;
  assert.deepEqual(sf.objects.map((o) => o.objectId), ['sfo001']);

  const am = (await get<LayerSnapshot>('/api/layers/flights/snapshot?bbox=170,-30,-170,0')).body;
  assert.deepEqual(am.objects.map((o) => o.objectId).sort(), ['fij001', 'tka001']);

  const mil = (await get<LayerSnapshot>('/api/layers/military-flights/snapshot')).body;
  assert.deepEqual(mil.objects.map((o) => o.objectId), ['mil001']);
  assert.deepEqual(mil.objects[0]!.props, { callsign: 'RCH1', military: true }); // detail-only props are not in snapshots
  assert.equal(mil.feed.layer, 'military-flights');
  await flights.stop();
});

test('snapshot is capped and flagged truncated', async () => {
  const { get, flights } = setup({ maxSnapshotObjects: 5 });
  flights.start();
  await flights.idle();
  for (let i = 0; i < 12; i++) flights.live.upsert(flight(`a${String(i).padStart(5, '0')}`));
  const r = (await get<LayerSnapshot>('/api/layers/flights/snapshot')).body;
  assert.equal(r.objects.length, 5);
  assert.equal(r.truncated, true);
  assert.equal(r.total, 12);
  const exact = setup({ maxSnapshotObjects: 12 });
  exact.flights.start();
  await exact.flights.idle();
  for (let i = 0; i < 12; i++) exact.flights.live.upsert(flight(`a${i}`));
  const whole = (await exact.get<LayerSnapshot>('/api/layers/flights/snapshot')).body;
  assert.equal(whole.truncated, false);
  assert.equal(whole.total, 12);
});

test('a capped snapshot is spread over the map, not the first N objects', async () => {
  const { get, flights } = setup({ maxSnapshotObjects: 10 });
  flights.start();
  await flights.idle();
  // A crowd at one airport arrives first, then eight aircraft far apart.
  for (let i = 0; i < 60; i++) flights.live.upsert(flight(`c${String(i).padStart(5, '0')}`, { lon: 4.76, lat: 52.31 }));
  for (let i = 0; i < 8; i++) flights.live.upsert(flight(`s${String(i).padStart(5, '0')}`, { lon: -150 + i * 40, lat: -50 + i * 15 }));
  const r = (await get<LayerSnapshot>('/api/layers/flights/snapshot')).body;
  assert.equal(r.truncated, true);
  assert.equal(r.total, 68);
  assert.equal(r.objects.length, 10);
  const spread = r.objects.filter((o) => o.objectId.startsWith('s'));
  assert.equal(spread.length, 8);
  await flights.stop();
});

test('a bbox snapshot registers the viewport as an area of interest', async () => {
  const { get, flights } = setup();
  flights.start();
  await flights.idle();
  const before = flights.status('flights').lastError;
  assert.match(before!, /No area/);
  await get('/api/layers/flights/snapshot?bbox=-123,37,-122,38');
  assert.equal(flights.status('flights').lastError, null);
  await flights.stop();
});

test('historical snapshot: latest per object at or before `at` inside the lookback window', async () => {
  const { get, db, flights } = setup();
  flights.start();
  await flights.idle();
  db.observations.insertObservations([
    flight('aaa', { t: T0 - 20 * MIN, lon: -120 }), // outside 15 min window of at=T0
    flight('bbb', { t: T0 - 10 * MIN, lon: -121 }),
    flight('bbb', { t: T0 - 5 * MIN, lon: -122 }),
    flight('bbb', { t: T0 + 5 * MIN, lon: -123 }), // after `at`
    flight('ccc', { t: T0 - MIN, lon: 10, lat: 10 }),
    flight('mil', { t: T0 - MIN, props: { military: true, callsign: 'RCH' } }),
  ]);
  const r = (await get<LayerSnapshot>(`/api/layers/flights/snapshot?at=${T0}`)).body;
  assert.equal(r.historical, true);
  assert.equal(r.at, T0);
  const by = Object.fromEntries(r.objects.map((o) => [o.objectId, o]));
  assert.deepEqual(Object.keys(by).sort(), ['bbb', 'ccc']);
  assert.equal(by.bbb!.lon, -122);
  assert.ok(!('id' in by.bbb!));

  const boxed = (await get<LayerSnapshot>(`/api/layers/flights/snapshot?at=${T0}&bbox=-125,0,-100,50`)).body;
  assert.deepEqual(boxed.objects.map((o) => o.objectId), ['bbb']);

  const later = (await get<LayerSnapshot>(`/api/layers/flights/snapshot?at=${T0 + 6 * MIN}`)).body;
  assert.equal(later.objects.find((o) => o.objectId === 'bbb')!.lon, -123);

  const mil = (await get<LayerSnapshot>(`/api/layers/military-flights/snapshot?at=${T0}`)).body;
  assert.deepEqual(mil.objects.map((o) => o.objectId), ['mil']);
  await flights.stop();
});

test('historical lookback is 60 minutes for vessels; the cap applies to history too', async () => {
  const { get, db, vessels } = setup({ maxSnapshotObjects: 2 });
  vessels!.start();
  db.observations.insertObservations([
    { layer: 'vessels', objectId: '111111111', t: T0 - 50 * MIN, lon: 1, lat: 1, props: { name: 'A' } },
    { layer: 'vessels', objectId: '222222222', t: T0 - 70 * MIN, lon: 1, lat: 1, props: {} },
  ]);
  const r = (await get<LayerSnapshot>(`/api/layers/vessels/snapshot?at=${T0}`)).body;
  assert.deepEqual(r.objects.map((o) => o.objectId), ['111111111']);
  db.observations.insertObservations(['333333333', '444444444', '555555555'].map((id) => ({ layer: 'vessels', objectId: id, t: T0, lon: 2, lat: 2, props: {} })));
  const capped = (await get<LayerSnapshot>(`/api/layers/vessels/snapshot?at=${T0}`)).body;
  assert.equal(capped.objects.length, 2);
  assert.equal(capped.truncated, true);
  assert.equal(capped.total, 4);
});

test('object detail: live uses full props; `at` uses history; missing object is 404', async () => {
  const { get, db, flights } = setup();
  flights.start();
  await flights.idle();
  flights.live.upsert(flight('a9f3c1', { props: { callsign: 'UAL1523', altBaro: 11277.6, typeCode: 'B739' } }));
  const live = await get<ObjectDetail>('/api/layers/flights/objects/a9f3c1');
  assert.equal(live.status, 200);
  assert.equal(live.body.title, 'UAL1523');
  assert.equal(live.body.layer, 'flights');
  assert.equal(live.body.observation.props.altBaro, 11277.6);
  assert.ok(live.body.sections.length >= 3);

  db.observations.insertObservations([flight('a9f3c1', { t: T0 - 30 * MIN, lon: -100, props: { callsign: 'OLD1' } })]);
  const hist = await get<ObjectDetail>(`/api/layers/flights/objects/a9f3c1?at=${T0 - 10 * MIN}`);
  assert.equal(hist.status, 200);
  assert.equal(hist.body.title, 'OLD1');
  assert.equal(hist.body.observation.lon, -100);
  assert.equal((await get(`/api/layers/flights/objects/a9f3c1?at=${T0 - 40 * MIN}`)).status, 404);
  assert.equal((await get('/api/layers/flights/objects/zzzzzz')).status, 404);

  // an object that already left the live picture falls back to its last stored point
  flights.live.expire();
  const gone = await get<ObjectDetail>('/api/layers/flights/objects/a9f3c1?at=' + T0);
  assert.equal(gone.status, 200);
  await flights.stop();
});

test('military aircraft are reachable through both layers by id', async () => {
  const { get, flights } = setup();
  flights.start();
  await flights.idle();
  flights.live.upsert(flight('ae0001', { props: { callsign: 'RCH871', military: true } }));
  const d = await get<ObjectDetail>('/api/layers/military-flights/objects/ae0001');
  assert.equal(d.status, 200);
  assert.equal(d.body.layer, 'military-flights');
  assert.equal((await get('/api/layers/flights/objects/ae0001')).status, 200);
  await flights.stop();
});

test('track: oldest first, default 6 h window, explicit range, live tail appended, capped', async () => {
  const { get, db, flights } = setup();
  flights.start();
  await flights.idle();
  const rows: Observation[] = [];
  for (let i = 0; i < 20; i++) rows.push(flight('trk', { t: T0 - (20 - i) * 30 * MIN, lon: i, lat: 0, alt: undefined }));
  rows.push(flight('trk', { t: T0 - 8 * 3600_000 }));
  db.observations.insertObservations(rows);
  const def = (await get<Track>('/api/layers/flights/objects/trk/track')).body;
  assert.equal(def.layer, 'flights');
  assert.equal(def.objectId, 'trk');
  // 6 h = 12 half-hour steps (inclusive of the boundary) among the stored rows
  assert.equal(def.points.length, 12);
  assert.ok(def.points.every((p, i) => i === 0 || p[0] > def.points[i - 1]![0]));
  assert.deepEqual(def.points[0]!.slice(1), [8, 0, null]);
  const ranged = (await get<Track>(`/api/layers/flights/objects/trk/track?from=${T0 - 10 * 3600_000}&to=${T0 - 7 * 3600_000}`)).body;
  assert.equal(ranged.points.length, 8); // 10 h .. 7 h inclusive, every 30 min, plus one extra row at 8 h
  // newest live position is added when the throttle has not stored it
  flights.live.upsert(flight('trk', { t: T0, lon: 99, lat: 1, alt: 5000 }));
  const withTail = (await get<Track>('/api/layers/flights/objects/trk/track')).body;
  assert.deepEqual(withTail.points[withTail.points.length - 1], [T0, 99, 1, 5000]);
  // unknown objects have an empty track rather than an error
  assert.deepEqual((await get<Track>('/api/layers/flights/objects/nobody/track')).body.points, []);
  await flights.stop();
});

test('GET /api/history/range', async () => {
  const { get, db, manager } = setup();
  assert.deepEqual((await get<HistoryRange>('/api/history/range')).body, { from: null, to: null, retentionMs: 7 * 86_400_000 });
  db.observations.insertObservations([flight('a', { t: 100 }), { layer: 'vessels', objectId: '1', t: 900, lon: 1, lat: 1, props: {} }]);
  assert.deepEqual((await get<HistoryRange>('/api/history/range')).body, { from: 100, to: 900, retentionMs: 7 * 86_400_000 });
  assert.equal(manager.retentionMs, 7 * 86_400_000);
});

test('snapshot JSON is compact: no nulls or undefined, no internal ids', async () => {
  const { app, flights } = setup();
  flights.start();
  await flights.idle();
  flights.live.upsert({ layer: 'flights', objectId: 'x1', t: T0, lon: 1, lat: 2, props: { callsign: 'A', onGround: true } });
  const text = await (await app.request('/api/layers/flights/snapshot')).text();
  const objects = text.slice(text.indexOf('"objects"'));
  assert.ok(!objects.includes('null') && !objects.includes('undefined') && !objects.includes('"id"'), objects);
  assert.ok(text.includes('"objects":[{"layer":"flights","objectId":"x1","t":' + T0));
  await flights.stop();
});
