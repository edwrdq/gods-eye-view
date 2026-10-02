import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FeaturesResponse } from '@gev/shared';
import { createApp } from './app.ts';
import { openDb } from './db/index.ts';
import type { FeatureRow } from './db/features.ts';
import { EarthquakesFeed } from './feeds/earthquakes/feed.ts';
import { FeedManager } from './feeds/manager.ts';
import { FEED_DEFINITIONS } from './feeds/registry.ts';
import { clock, manualTimers } from './feeds/test-utils.ts';
import { buildLayers } from './layers.ts';

const NOW = Date.parse('2026-10-02T14:30:00Z');
const DAY = 86_400_000;

// The earthquake history is the biggest features layer: about 300 events a day,
// kept for a year by default.
test('perf: /features over a year of earthquake history (110k events) stays fast', async () => {
  const c = clock(NOW);
  const db = openDb(':memory:');
  const rows: FeatureRow[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 110_000; i++) {
    const mag = Math.round((1 + rnd() ** 3 * 6) * 10) / 10;
    const t = NOW - Math.floor(rnd() * 365 * DAY);
    rows.push({
      id: `ev${i}`,
      t,
      updated: t,
      lon: rnd() * 360 - 180,
      lat: rnd() * 160 - 80,
      rank: mag,
      label: `M ${mag.toFixed(1)}`,
      props: { mag, depthKm: Math.round(rnd() * 600), place: `${Math.round(rnd() * 200)} km N of Somewhere, Region`, tsunami: false, alert: null, type: 'earthquake' },
      extra: { magType: 'ml', status: 'reviewed', net: 'us' },
    });
  }
  db.features.upsertMany('earthquakes', rows);
  const feed = new EarthquakesFeed({ fetch: async () => new Response('{}'), repo: db.features, now: c.now, timers: manualTimers });
  const manager = new FeedManager({ feeds: [feed], definitions: FEED_DEFINITIONS, repo: db.observations, retentionMs: DAY, now: c.now, timers: manualTimers });
  feed.start();
  const app = createApp({
    clientConfig: { googleMapsApiKey: null, cesiumIonToken: null, layers: buildLayers({}) },
    geocoder: { search: async () => [] },
    dbStatus: () => ({ path: ':memory:', sizeBytes: 0 }),
    version: 'test',
    now: c.now,
    feeds: manager,
    observations: db.observations,
  });

  const time = async (q: string) => {
    const t0 = performance.now();
    const res = await app.request(`/api/layers/earthquakes/features${q}`);
    const bytes = (await res.arrayBuffer()).byteLength;
    return { ms: performance.now() - t0, bytes, status: res.status };
  };
  const day = await time('');
  const year = await time(`?from=${NOW - 365 * DAY}`);
  const bbox = await time(`?from=${NOW - 365 * DAY}&bbox=-125,30,-110,45`);
  const body = (await (await app.request(`/api/layers/earthquakes/features?from=0`)).json()) as FeaturesResponse;
  console.log(
    `# perf earthquakes: 24 h ${day.ms.toFixed(0)} ms (${(day.bytes / 1024).toFixed(0)} KiB), 1 y capped ${year.ms.toFixed(0)} ms (${(year.bytes / 1024).toFixed(0)} KiB, ${body.features.length} features, truncated ${body.truncated}), 1 y bbox ${bbox.ms.toFixed(0)} ms`,
  );
  assert.equal(day.status, 200);
  assert.equal(body.truncated, true);
  assert.equal(body.features.length, 20_000);
  assert.ok(day.ms < 300, `24 h took ${day.ms} ms`);
  assert.ok(year.ms < 1500, `year took ${year.ms} ms`);
  assert.ok(bbox.ms < 500, `bbox took ${bbox.ms} ms`);
  await feed.stop();
});
