import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Observation } from '@gev/shared';
import { clock, jsonResponse, manualTimers } from '../test-utils.ts';
import { FlightsFeed, FLIGHTS_FRESHNESS_MS } from './feed.ts';
import { loadFlightsConfig } from './config.ts';
import type { Enricher } from './enrich.ts';

const NOW = 1_760_000_000_000;

function acRecord(hex: string, over: Record<string, unknown> = {}) {
  return { hex, type: 'adsb_icao', flight: `T${hex.toUpperCase()}`, alt_baro: 30000, gs: 400, track: 90, lat: 37.6, lon: -122.4, seen_pos: 1, ...over };
}

function setup(env: Record<string, string> = {}, routes: Record<string, (url: string, init?: RequestInit) => Response> = {}) {
  const c = clock(NOW);
  const calls: string[] = [];
  const stored: Observation[][] = [];
  const handlers = { ...routes };
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(url);
    const key = Object.keys(handlers).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    return handlers[key]!(url, init);
  };
  const feed = new FlightsFeed({
    // Timing tests below were written for a 30 s cadence; pin it (defaults are 60 s).
    config: loadFlightsConfig({ ADSB_AREA_POLL_S: '30', ADSB_MIL_POLL_S: '30', ...env }),
    fetch: fetchFn,
    now: c.now,
    timers: manualTimers,
    store: (b) => void stored.push(b),
    minRequestGapMs: 2000,
  });
  return { feed, c, calls, stored, handlers };
}

const adsbBody = (ac: unknown[], now = NOW) => jsonResponse({ now, ac });

async function step(feed: FlightsFeed, c: ReturnType<typeof clock>, ms: number) {
  c.advance(ms);
  await feed.tick();
  await feed.idle();
}

test('no credentials and no areas: only military is polled; flights is stale with an explanation', async () => {
  const { feed, calls } = setup({}, { '/v2/mil': () => adsbBody([acRecord('ae0001', { dbFlags: 1 })]) });
  feed.start();
  await feed.idle();
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.endsWith('/v2/mil'));
  const civil = feed.status('flights');
  assert.equal(civil.state, 'stale');
  assert.match(civil.lastError!, /ADSB_AREAS/);
  assert.equal(civil.count, 0);
  const mil = feed.status('military-flights');
  assert.equal(mil.state, 'live');
  assert.equal(mil.count, 1);
  assert.equal(mil.source, 'adsb.lol');
  await feed.stop();
});

test('ADSB_AREAS are polled with the 250 nm point endpoint; units reach the live picture', async () => {
  const { feed, calls, c } = setup(
    { ADSB_AREAS: '37.62,-122.38' },
    {
      '/v2/mil': () => adsbBody([]),
      '/v2/lat/37.62/lon/-122.38/dist/250': () => adsbBody([acRecord('a00001', { alt_baro: 10000, gs: 100 })]),
    },
  );
  feed.start();
  await feed.idle();
  await step(feed, c, 2500); // the second host request waits out the minimum gap
  assert.equal(calls.length, 2);
  assert.ok(calls.some((u) => u.endsWith('/lat/37.62/lon/-122.38/dist/250')));
  const o = feed.live.get('a00001')!;
  assert.ok(Math.abs(o.speed! - 51.4444) < 0.01);
  assert.ok(Math.abs(o.alt! - 3048) < 0.1);
  const st = feed.status('flights');
  assert.equal(st.state, 'live');
  assert.equal(st.source, 'adsb.lol');
  assert.equal(st.count, 1);
  assert.equal(st.freshnessMs, FLIGHTS_FRESHNESS_MS);
  await feed.stop();
});

test('areas are re-polled on their interval, not before, and requests keep a minimum gap', async () => {
  const { feed, calls, c } = setup(
    { ADSB_AREAS: '10,10;20,20' },
    { '/v2/mil': () => adsbBody([]), '/dist/250': () => adsbBody([]) },
  );
  feed.start();
  await feed.idle();
  assert.equal(calls.length, 1);
  await feed.tick(); // same instant: min gap not elapsed
  await feed.idle();
  assert.equal(calls.length, 1);
  for (let i = 0; i < 3; i++) await step(feed, c, 2100);
  assert.equal(calls.length, 3); // mil + two areas, each once
  for (let i = 0; i < 5; i++) await step(feed, c, 2100); // ~10 s: nothing is due again
  assert.equal(calls.length, 3);
  await step(feed, c, 25_000);
  await step(feed, c, 2100);
  await step(feed, c, 2100);
  assert.equal(calls.length, 6);
  await feed.stop();
});

test('a browser viewport hint adds an area that is polled promptly and expires after 10 minutes', async () => {
  const { feed, calls, c } = setup({}, { '/v2/mil': () => adsbBody([]), '/dist/250': () => adsbBody([acRecord('b00001', { lat: 51.5, lon: -0.1 })]) });
  feed.start();
  await feed.idle();
  feed.hint('flights', [-0.5, 51.3, 0.3, 51.7]);
  feed.hint('military-flights', [100, 0, 101, 1]); // ignored: only the civil layer drives areas
  await step(feed, c, 2500);
  assert.ok(calls.some((u) => u.includes('/lat/51.5/lon/') && u.endsWith('/dist/250')), calls.join('\n'));
  assert.equal(feed.live.size, 1);
  const before = calls.length;
  await step(feed, c, 11 * 60_000);
  await step(feed, c, 2500);
  assert.ok(calls.slice(before).every((u) => u.endsWith('/v2/mil')), 'expired viewport is no longer polled');
  await feed.stop();
});

test('military: /v2/mil rows are flagged, split by layer, and the flag is sticky across civil updates', async () => {
  const { feed, c } = setup(
    { ADSB_AREAS: '1,1' },
    {
      '/v2/mil': () => adsbBody([acRecord('ae0001', { t: 'C17', r: '05-5140' })], c.now()),
      '/dist/250': () => adsbBody([acRecord('ae0001', { lat: 37.61 }), acRecord('a00002')], c.now()),
    },
  );
  feed.start();
  await feed.idle();
  await step(feed, c, 2500);
  const mil = feed.live.query({ include: feed.layers[1]!.include, limit: 10 }).objects;
  assert.deepEqual(mil.map((o) => o.objectId), ['ae0001']);
  const civil = feed.live.query({ include: feed.layers[0]!.include, limit: 10 }).objects;
  assert.deepEqual(civil.map((o) => o.objectId), ['a00002']);
  // civil poll updated the same aircraft without a military flag: still military, registration kept
  assert.equal(feed.live.get('ae0001')!.lat, 37.61);
  assert.equal(feed.live.get('ae0001')!.props.military, true);
  assert.equal(feed.live.get('ae0001')!.props.registration, '05-5140');
  assert.equal(feed.status('flights').count, 1);
  assert.equal(feed.status('military-flights').count, 1);
  await feed.stop();
});

test('history rows are written in one batch per poll with throttling', async () => {
  let t = NOW;
  const { feed, c, stored } = setup({ ADSB_AREAS: '1,1' }, {
    '/v2/mil': () => adsbBody([], t),
    '/dist/250': () => adsbBody([acRecord('a00001', { seen_pos: 0 }), acRecord('a00002', { seen_pos: 0 })], t),
  });
  feed.start();
  await feed.idle();
  await step(feed, c, 2500);
  t = c.now();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.length, 2);
  assert.deepEqual(Object.keys(stored[0]![0]!.props).sort(), ['callsign', 'category', 'onGround'].filter((k) => k !== 'category' || 'category' in stored[0]![0]!.props));
  // 32 s later: stationary, same heading -> throttled, no new batch
  await step(feed, c, 30_000);
  t = c.now();
  await step(feed, c, 2500);
  assert.equal(stored.length, 1);
  // after 60 s since the stored point the next update is written
  await step(feed, c, 30_000);
  t = c.now();
  await step(feed, c, 2500);
  assert.equal(stored.length, 2);
  assert.equal(stored[1]!.length, 2);
  await feed.stop();
});

test('failed polls: error state with backoff, recovery returns to live', async () => {
  let fail = true;
  const { feed, c, calls } = setup({ ADSB_AREAS: '1,1' }, {
    '/v2/mil': () => adsbBody([]),
    '/dist/250': () => (fail ? new Response('boom', { status: 503 }) : adsbBody([acRecord('a00001', { seen_pos: 0 })], c.now())),
  });
  feed.start();
  await feed.idle();
  await step(feed, c, 2500);
  let st = feed.status('flights');
  assert.equal(st.state, 'error');
  assert.match(st.lastError!, /HTTP 503/);
  const n = calls.length;
  await step(feed, c, 10_000); // backoff (60 s) not elapsed
  assert.equal(calls.filter((u) => u.includes('/dist/250')).length, 1, `calls after ${n}`);
  fail = false;
  await step(feed, c, 60_000);
  await step(feed, c, 2500);
  st = feed.status('flights');
  assert.equal(st.state, 'live');
  assert.equal(st.lastError, null);
  assert.equal(st.count, 1);
  await feed.stop();
});

test('state goes stale when no poll succeeds within the freshness window, and objects time out', async () => {
  let ok = true;
  const { feed, c } = setup({ ADSB_AREAS: '1,1' }, {
    '/v2/mil': () => adsbBody([]),
    '/dist/250': () => (ok ? adsbBody([acRecord('a00001', { seen_pos: 0 })], c.now()) : new Response('', { status: 500 })),
  });
  feed.start();
  await feed.idle();
  await step(feed, c, 2500);
  assert.equal(feed.status('flights').state, 'live');
  ok = false;
  // 200 s of failures; the failure marks error even though old data is still held
  for (let i = 0; i < 8; i++) await step(feed, c, 25_000);
  assert.equal(feed.status('flights').state, 'error');
  assert.equal(feed.live.size, 1); // 5 min timeout not reached yet
  for (let i = 0; i < 5; i++) await step(feed, c, 25_000);
  assert.equal(feed.live.size, 0);
  await feed.stop();
});

test('a 429 pauses the host for Retry-After and does not hammer', async () => {
  let n = 0;
  const { feed, c } = setup({ ADSB_AREAS: '1,1' }, {
    '/v2/mil': () => adsbBody([]),
    '/dist/250': () => {
      n++;
      return new Response('slow down', { status: 429, headers: { 'retry-after': '90' } });
    },
  });
  feed.start();
  await feed.idle();
  await step(feed, c, 2500);
  assert.equal(n, 1);
  for (let i = 0; i < 8; i++) await step(feed, c, 10_000); // 80 s: mil would be due but host is cooling
  assert.equal(n, 1);
  assert.equal(feed.status('flights').state, 'error');
  await feed.stop();
});

test('OpenSky with credentials: token, global poll, units, fallback areas not used while healthy', async () => {
  let tokenCalls = 0;
  const body = {
    time: Math.floor(NOW / 1000),
    states: [['a9f3c1', 'UAL1523 ', 'United States', Math.floor(NOW / 1000), Math.floor(NOW / 1000), -122.2874, 37.7213, 11277.6, false, 240.8, 72.4, 0, null, 11392.5, '4521', false, 0, 4]],
  };
  let auth = '';
  const { feed, c, calls } = setup(
    { OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'sec', ADSB_AREAS: '1,1' },
    {
      'auth.opensky-network.org': () => {
        tokenCalls++;
        return jsonResponse({ access_token: 'tok', expires_in: 1800 });
      },
      'states/all?extended=1': (_u, init) => {
        auth = String((init?.headers as Record<string, string>).Authorization);
        return jsonResponse(body, { headers: { 'x-rate-limit-remaining': '3900' } });
      },
      '/v2/mil': () => adsbBody([]),
    },
  );
  feed.start();
  await feed.idle();
  assert.equal(auth, 'Bearer tok');
  const o = feed.live.get('a9f3c1')!;
  assert.equal(o.speed, 240.8);
  assert.equal(o.alt, 11392.5);
  assert.equal(feed.status('flights').source, 'OpenSky');
  assert.equal(feed.status('flights').state, 'live');
  await step(feed, c, 2500);
  await step(feed, c, 2500);
  assert.ok(!calls.some((u) => u.includes('/dist/250')), 'adsb.lol area fallback unused while OpenSky is healthy');
  await step(feed, c, 90_000);
  assert.equal(tokenCalls, 1); // token reused
  assert.equal(calls.filter((u) => u.includes('states/all')).length, 2);
  await feed.stop();
});

test('OpenSky failure falls back to adsb.lol areas; 429 honours the rate-limit header', async () => {
  const { feed, c, calls } = setup(
    { OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'sec', ADSB_AREAS: '1,1' },
    {
      'auth.opensky-network.org': () => jsonResponse({ access_token: 'tok', expires_in: 1800 }),
      'states/all': () => new Response('', { status: 429, headers: { 'x-rate-limit-retry-after-seconds': '600' } }),
      '/v2/mil': () => adsbBody([]),
      '/dist/250': () => adsbBody([acRecord('a00001', { seen_pos: 0 })], c.now()),
    },
  );
  feed.start();
  await feed.idle();
  await step(feed, c, 2500);
  await step(feed, c, 2500);
  assert.ok(calls.some((u) => u.includes('/dist/250')), 'fell back to adsb.lol');
  assert.equal(feed.status('flights').source, 'adsb.lol');
  assert.equal(feed.live.size, 1);
  const opensky = () => calls.filter((u) => u.includes('states/all')).length;
  assert.equal(opensky(), 1);
  for (let i = 0; i < 20; i++) await step(feed, c, 25_000); // ~8 min < 600 s cooldown
  assert.equal(opensky(), 1);
  await feed.stop();
});

test('OpenSky auth failure is reported', async () => {
  const { feed } = setup(
    { OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'bad' },
    {
      'auth.opensky-network.org': () => jsonResponse({ error_description: 'Invalid client credentials' }, { status: 401 }),
      '/v2/mil': () => adsbBody([]),
    },
  );
  feed.start();
  await feed.idle();
  const st = feed.status('flights');
  assert.equal(st.state, 'error');
  assert.match(st.lastError!, /Invalid client credentials/);
  await feed.stop();
});

test('detail works without enrichment and uses the enricher when available', async () => {
  const { feed } = setup({}, { '/v2/mil': () => adsbBody([]) });
  const o: Observation = {
    layer: 'flights', objectId: 'a9f3c1', t: NOW, lon: -122.2874, lat: 37.7213, alt: 11391.9, heading: 72.4, speed: 240.8,
    props: { callsign: 'UAL1523', registration: 'N77520', typeCode: 'B739', altBaro: 11277.6, squawk: '4521', posSrc: 'adsb', src: 'adsb.lol' },
  };
  const plain = await feed.detail('flights', o, false);
  assert.equal(plain.layer, 'flights');
  assert.equal(plain.title, 'UAL1523');
  assert.deepEqual(plain.sections.map((s) => s.title), ['Position', 'Aircraft', 'Source']);

  const enricher: Enricher = {
    aircraft: async () => ({ typeCode: 'B739', typeName: 'Boeing 737-900ER', registration: 'N77520', owner: null, country: null }),
    route: async () => ({ airline: 'United Airlines', origin: { code: 'SFO', name: 'San Francisco' }, destination: { code: 'DEN', name: 'Denver' } }),
  };
  const feed2 = new FlightsFeed({ config: loadFlightsConfig({}), fetch: async () => adsbBody([]), now: clock(NOW).now, timers: manualTimers, store: () => {}, enricher });
  const rich = await feed2.detail('military-flights', o, true);
  assert.equal(rich.layer, 'military-flights');
  assert.equal(rich.subtitle, 'Boeing 737-900ER · N77520 · United Airlines');
  assert.deepEqual(rich.sections.map((s) => s.title), ['Position', 'Aircraft', 'Route', 'Source']);
  assert.deepEqual(rich.sources, ['adsb.lol', 'adsbdb']);

  const throwing: Enricher = { aircraft: async () => { throw new Error('x'); }, route: async () => { throw new Error('y'); } };
  const feed3 = new FlightsFeed({ config: loadFlightsConfig({}), fetch: async () => adsbBody([]), now: clock(NOW).now, timers: manualTimers, store: () => {}, enricher: throwing });
  assert.equal((await feed3.detail('flights', o, false)).title, 'UAL1523');
});

test('config: intervals clamp to the OpenSky credit budget and politeness floors', () => {
  const cfg = loadFlightsConfig({ OPENSKY_POLL_S: '30', ADSB_AREA_POLL_S: '2', ADSB_MIL_POLL_S: 'abc', ADSB_AREAS: '1,2;99,0' });
  assert.equal(cfg.openSkyIntervalMs, 87_000);
  assert.equal(cfg.areaIntervalMs, 30_000);
  assert.equal(cfg.milIntervalMs, 60_000);
  assert.equal(cfg.areas.length, 1);
  assert.equal(cfg.warnings.length, 4);
  const def = loadFlightsConfig({});
  assert.equal(def.openSkyIntervalMs, 90_000);
  assert.equal(def.openSky, null);
  assert.equal(loadFlightsConfig({ OPENSKY_CLIENT_ID: 'a', OPENSKY_CLIENT_SECRET: 'b' }).openSky!.clientId, 'a');
  assert.equal(loadFlightsConfig({ OPENSKY_CLIENT_ID: 'a' }).openSky, null);
});
