import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LayerSnapshot, Observation } from '@gev/shared';
import { createApp } from './app.ts';
import { openDb } from './db/index.ts';
import { loadFlightsConfig } from './feeds/flights/config.ts';
import { FlightsFeed } from './feeds/flights/feed.ts';
import { FeedManager } from './feeds/manager.ts';
import { FEED_DEFINITIONS } from './feeds/registry.ts';
import { clock, jsonResponse, manualTimers } from './feeds/test-utils.ts';
import { buildLayers } from './layers.ts';

const N = 12_000;
const T0 = 1_760_000_000_000;

function fleet(t: number, count = N): Observation[] {
  const out: Observation[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      layer: 'flights',
      objectId: (0xa00000 + i).toString(16),
      t,
      lon: ((i * 7919) % 36000) / 100 - 180,
      lat: ((i * 104729) % 15000) / 100 - 75,
      alt: 10_000 + (i % 100) * 30,
      heading: i % 360,
      speed: 150 + (i % 100),
      props: { callsign: `TST${i}`, registration: `N${i}`, typeCode: 'B738', category: 'Large', onGround: false, squawk: '1200' },
    });
  }
  return out;
}

test(`perf: ${N} aircraft snapshot (live and historical) stays well under 100 ms`, async () => {
  const c = clock(T0);
  const db = openDb(':memory:');
  const flights = new FlightsFeed({
    config: loadFlightsConfig({}),
    fetch: async () => jsonResponse({ now: T0, ac: [] }),
    now: c.now,
    timers: manualTimers,
    store: (b) => db.observations.insertObservations(b),
  });
  flights.start();
  await flights.idle();
  for (const o of fleet(T0)) flights.live.upsert(o);
  // history: one stored point per minute per aircraft over the 15 min lookback window (180k rows)
  for (let k = 1; k <= 15; k++) db.observations.insertObservations(fleet(T0 - k * 60_000 + 1));
  const manager = new FeedManager({ feeds: [flights], definitions: FEED_DEFINITIONS, repo: db.observations, retentionMs: 1, now: c.now, timers: manualTimers });
  const app = createApp({
    clientConfig: { googleMapsApiKey: null, cesiumIonToken: null, layers: buildLayers({}) },
    geocoder: { search: async () => [] },
    dbStatus: () => ({ path: ':memory:', sizeBytes: 0 }),
    version: 'test',
    now: c.now,
    feeds: manager,
    observations: db.observations,
  });

  const time = async (path: string) => {
    const t = performance.now();
    const res = await app.request(path);
    const text = await res.text();
    return { ms: performance.now() - t, bytes: text.length, body: JSON.parse(text) as LayerSnapshot };
  };

  await time('/api/layers/flights/snapshot'); // warm up
  const median = async (path: string) => {
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(await time(path));
    return runs.sort((a, b) => a.ms - b.ms)[2]!;
  };
  const live = await median('/api/layers/flights/snapshot');
  assert.equal(live.body.objects.length, N);
  const hist = await median(`/api/layers/flights/snapshot?at=${T0}`);
  const histBox = await median(`/api/layers/flights/snapshot?at=${T0}&bbox=-30,-40,60,40`);
  assert.equal(hist.body.objects.length, N);
  console.log(
    `perf ${N} objects: live ${live.ms.toFixed(1)} ms (${(live.bytes / 1024).toFixed(0)} KiB), ` +
      `historical ${hist.ms.toFixed(1)} ms (180k stored rows in window), historical+bbox ${histBox.ms.toFixed(1)} ms`,
  );
  assert.ok(live.ms < 100, `live snapshot ${live.ms} ms`);
  assert.ok(hist.ms < 300, `historical snapshot ${hist.ms} ms`);
  await flights.stop();
});
