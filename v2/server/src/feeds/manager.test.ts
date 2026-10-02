import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FeedStatus } from '@gev/shared';
import { openDb } from '../db/index.ts';
import { FeedManager } from './manager.ts';
import { FEED_DEFINITIONS, buildFeedManager, implementedLayers } from './registry.ts';
import { clock, jsonResponse, manualTimers, obs } from './test-utils.ts';
import { loadConfig } from '../config.ts';
import { buildLayers } from '../layers.ts';
import type { TrackedFeed } from './types.ts';

function fakeFeed(id: string, layers: string[], events: string[]): TrackedFeed {
  return {
    id,
    freshnessMs: 1000,
    layers: layers.map((l) => ({ id: l, storageLayer: l, lookbackMs: 1 })),
    live: undefined as never,
    start: () => void events.push(`start ${id}`),
    stop: async () => void events.push(`stop ${id}`),
    status: (l = layers[0]!): FeedStatus => ({ layer: l, state: 'live', source: 'x', lastSuccess: 0, lastError: null, count: 0, freshnessMs: 1000 }),
    detail: async () => {
      throw new Error('unused');
    },
  };
}

test('manager starts and stops feeds; disabled definitions report off; resolve distinguishes cases', async () => {
  const events: string[] = [];
  const db = openDb(':memory:');
  const m = new FeedManager({
    feeds: [fakeFeed('flights', ['flights', 'military-flights'], events)],
    definitions: FEED_DEFINITIONS,
    repo: db.observations,
    retentionMs: 1000,
    timers: manualTimers,
  });
  m.start();
  assert.deepEqual(events, ['start flights']);
  assert.deepEqual(m.statuses().map((s) => `${s.layer}:${s.state}`), ['flights:live', 'military-flights:live', 'vessels:off', 'earthquakes:off', 'cyclones:off', 'launches:off', 'satellites:off', 'submarine-cables:off', 'datacenters:off', 'installations:off']);
  assert.equal(m.resolve('flights').kind, 'ok');
  assert.equal(m.resolve('vessels').kind, 'off');
  assert.equal(m.resolve('fires').kind, 'unknown');
  await m.stop();
  assert.deepEqual(events, ['start flights', 'stop flights']);
});

test('hourly pruning removes history older than HISTORY_DAYS, in chunks', async () => {
  const c = clock(10 * 86_400_000);
  const db = openDb(':memory:');
  const rows = [];
  for (let i = 0; i < 25; i++) rows.push(obs({ objectId: `old${i}`, t: c.now() - 8 * 86_400_000 + i }));
  for (let i = 0; i < 5; i++) rows.push(obs({ objectId: `new${i}`, t: c.now() - 6 * 86_400_000 + i }));
  db.observations.insertObservations(rows);
  const logs: string[] = [];
  const m = new FeedManager({
    feeds: [],
    definitions: [],
    repo: db.observations,
    retentionMs: 7 * 86_400_000,
    now: c.now,
    timers: manualTimers,
    pruneChunk: 10,
    log: (s) => void logs.push(s),
  });
  m.start();
  assert.equal(manualTimers.intervals.length, 1, 'hourly timer registered');
  assert.equal(await m.prune(), 25);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM observations').get()!.n, 5);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM observations_rtree').get()!.n, 5);
  assert.match(logs[0]!, /pruned 25/);
  // concurrent calls share one run
  const [a, b] = [m.prune(), m.prune()];
  assert.equal(a, b);
  await a;
  await m.stop();
  assert.equal(manualTimers.intervals.length, 0);
});

test('registry builds feeds from FEEDS: default flights+vessels, unknown ignored, key-less vessels need a key', async () => {
  const db = openDb(':memory:');
  const logs: string[] = [];
  const c = clock();
  const base = { db, fetch: async () => jsonResponse({ ac: [] }), now: c.now, timers: manualTimers, log: (s: string) => void logs.push(s) };
  const m = buildFeedManager({ ...base, config: loadConfig({ FEEDS: 'flights, vessels,bogus' }) });
  assert.ok(logs.some((l) => l.includes('unknown feed "bogus"')));
  assert.deepEqual(m.statuses().map((s) => `${s.layer}:${s.state}`), ['flights:off', 'military-flights:off', 'vessels:needs-key', 'earthquakes:off', 'cyclones:off', 'launches:off', 'satellites:off', 'submarine-cables:off', 'datacenters:off', 'installations:off']);
  m.start();
  assert.equal(m.statuses().find((s) => s.layer === 'vessels')!.state, 'needs-key');
  assert.equal(m.statuses().find((s) => s.layer === 'flights')!.state, 'stale');
  await m.stop();

  const only = buildFeedManager({ ...base, config: loadConfig({ FEEDS: 'flights' }) });
  assert.equal(only.statuses().find((s) => s.layer === 'vessels')!.state, 'off');
  const none = buildFeedManager({ ...base, config: loadConfig({ FEEDS: '' }) });
  assert.equal(none.statuses().find((s) => s.layer === 'vessels')!.state, 'needs-key'); // '' means default
});

test('/api/config layer statuses reflect enabled feeds and keys', () => {
  const status = (env: Record<string, string>, feeds: string[], id: string) =>
    buildLayers(env, implementedLayers(feeds)).find((l) => l.id === id)!.status;
  assert.equal(status({}, ['flights', 'vessels'], 'flights'), 'available');
  assert.equal(status({}, ['flights', 'vessels'], 'military-flights'), 'available');
  assert.equal(status({}, ['flights', 'vessels'], 'vessels'), 'needs-key');
  assert.equal(status({ AISSTREAM_API_KEY: 'k' }, ['flights', 'vessels'], 'vessels'), 'available');
  assert.equal(status({ AISSTREAM_API_KEY: 'k' }, ['flights'], 'vessels'), 'disabled');
  assert.equal(status({}, ['flights'], 'satellites'), 'disabled');
  assert.equal(status({}, ['flights', 'satellites', 'earthquakes'], 'satellites'), 'available');
  assert.equal(status({}, ['flights', 'satellites', 'earthquakes'], 'cyclones'), 'disabled');
  assert.equal(status({}, ['flights'], 'fires'), 'needs-key');
  assert.equal(status({}, ['flights'], 'cctv'), 'planned');
});
