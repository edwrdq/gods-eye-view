import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiError, ClientConfig, GeocodeResponse, HealthResponse } from '@gev/shared';
import { createApp } from './app.ts';
import { GeocodeUnavailableError, type Geocoder } from './geocode.ts';
import { buildLayers } from './layers.ts';
import { openDb } from './db/index.ts';
import { FeedManager } from './feeds/manager.ts';

function setup(geocoder?: Partial<Geocoder>) {
  let t = 1_000_000;
  const clientConfig: ClientConfig = { googleMapsApiKey: 'g', cesiumIonToken: null, layers: buildLayers({}) };
  const calls: string[] = [];
  const db = openDb(':memory:');
  const feeds = new FeedManager({ feeds: [], definitions: [], repo: db.observations, retentionMs: 1000 });
  const app = createApp({
    feeds,
    observations: db.observations,
    clientConfig,
    geocoder: {
      search: geocoder?.search ?? (async (q) => {
        calls.push(q);
        return [{ label: q, lon: 1, lat: 2, kind: 'place', source: 'photon' }];
      }),
    },
    dbStatus: () => ({ path: '/tmp/x.db', sizeBytes: 42 }),
    version: '1.2.3',
    now: () => t,
  });
  return { app, calls, advance: (ms: number) => (t += ms) };
}

test('GET /api/health', async () => {
  const { app, advance } = setup();
  advance(5400);
  const res = await app.request('/api/health');
  assert.equal(res.status, 200);
  const body = (await res.json()) as HealthResponse;
  assert.deepEqual(body, { ok: true, version: '1.2.3', uptimeS: 5, db: { path: '/tmp/x.db', sizeBytes: 42 } });
});

test('GET /api/config exposes only browser-safe fields', async () => {
  const { app } = setup();
  const body = (await (await app.request('/api/config')).json()) as ClientConfig;
  assert.deepEqual(Object.keys(body).sort(), ['cesiumIonToken', 'googleMapsApiKey', 'layers']);
  assert.equal(body.googleMapsApiKey, 'g');
  assert.ok(body.layers.length > 0);
});

test('GET /api/geocode returns results and trims the query', async () => {
  const { app, calls } = setup();
  const res = await app.request('/api/geocode?q=%20austin%20');
  assert.equal(res.status, 200);
  const body = (await res.json()) as GeocodeResponse;
  assert.equal(body.query, 'austin');
  assert.equal(body.results.length, 1);
  assert.deepEqual(calls, ['austin']);
});

test('GET /api/geocode validates q', async () => {
  const { app, calls } = setup();
  for (const url of ['/api/geocode', '/api/geocode?q=', '/api/geocode?q=%20%20', `/api/geocode?q=${'a'.repeat(201)}`]) {
    const res = await app.request(url);
    assert.equal(res.status, 400, url);
    assert.equal(typeof ((await res.json()) as ApiError).error, 'string');
  }
  assert.equal((await app.request(`/api/geocode?q=${'a'.repeat(200)}`)).status, 200);
  assert.equal(calls.length, 1);
});

test('geocode provider outage maps to 502 JSON', async () => {
  const { app } = setup({ search: async () => { throw new GeocodeUnavailableError(); } });
  const res = await app.request('/api/geocode?q=x');
  assert.equal(res.status, 502);
  assert.ok(((await res.json()) as ApiError).error);
});

test('unknown /api path is a JSON 404; unexpected errors are JSON 500', async () => {
  const { app } = setup({ search: async () => { throw new Error('secret detail'); } });
  const nf = await app.request('/api/nope');
  assert.equal(nf.status, 404);
  assert.deepEqual(await nf.json(), { error: 'Not found' });

  const origError = console.error;
  console.error = () => {};
  try {
    const res = await app.request('/api/geocode?q=x');
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Internal server error' });
  } finally {
    console.error = origError;
  }
});
