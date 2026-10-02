import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Observation } from '@gev/shared';
import { openDb } from './index.ts';

function obs(over: Partial<Observation> = {}): Observation {
  return { layer: 'flights', objectId: 'aaa111', t: 1000, lon: 10, lat: 20, props: {}, ...over };
}

function seeded() {
  const db = openDb(':memory:');
  db.observations.insertObservations([
    obs({ objectId: 'a', t: 1000, lon: 0, lat: 0 }),
    obs({ objectId: 'a', t: 2000, lon: 1, lat: 1, alt: 100, props: { k: 1 } }),
    obs({ objectId: 'a', t: 3000, lon: 2, lat: 2 }),
    obs({ objectId: 'b', t: 1500, lon: 179, lat: 5 }),
    obs({ objectId: 'c', t: 2500, lon: -179, lat: 5 }),
    obs({ objectId: 'd', t: 100, lon: 0, lat: 0 }), // too old for most windows
    obs({ layer: 'vessels', objectId: 'a', t: 2600, lon: 50, lat: 50 }),
  ]);
  return db;
}

test('latestPerObject returns the newest row per object within the window', () => {
  const db = seeded();
  const rows = db.observations.latestPerObject({ layer: 'flights', from: 500, to: 2600 });
  const byId = Object.fromEntries(rows.map((r) => [r.objectId, r]));
  assert.deepEqual(Object.keys(byId).sort(), ['a', 'b', 'c']);
  assert.equal(byId.a!.t, 2000);
  assert.deepEqual(byId.a!.props, { k: 1 });
  assert.equal(byId.a!.alt, 100);
  assert.ok(!('id' in byId.a!), 'internal row id must not leak');
  
  db.close();
});

test('latestPerObject applies bbox to the latest position, not to older ones', () => {
  const db = seeded();
  // a was at (0,0) at t=1000 but is at (1,1) at t=2000; a box around (0,0) must not return it.
  const old = db.observations.latestPerObject({ layer: 'flights', from: 0, to: 2000, bbox: [-0.5, -0.5, 0.5, 0.5] });
  assert.deepEqual(old.map((r) => r.objectId), ['d']);
  const now = db.observations.latestPerObject({ layer: 'flights', from: 500, to: 3000, bbox: [1.5, 1.5, 3, 3] });
  assert.deepEqual(now.map((r) => r.objectId), ['a']);
  db.close();
});

test('latestPerObject supports antimeridian boxes', () => {
  const db = seeded();
  const rows = db.observations.latestPerObject({ layer: 'flights', from: 0, to: 3000, bbox: [170, 0, -170, 10] });
  assert.deepEqual(rows.map((r) => r.objectId).sort(), ['b', 'c']);
  db.close();
});

test('latestFor honours the at bound and layer', () => {
  const db = seeded();
  assert.equal(db.observations.latestFor('flights', 'a')!.t, 3000);
  assert.equal(db.observations.latestFor('flights', 'a', 2500)!.t, 2000);
  assert.equal(db.observations.latestFor('flights', 'a', 500), undefined);
  assert.equal(db.observations.latestFor('vessels', 'a')!.lon, 50);
  assert.equal(db.observations.latestFor('flights', 'zzz'), undefined);
  db.close();
});

test('trackPoints are oldest-first and thinned to the cap keeping the ends', () => {
  const db = openDb(':memory:');
  const batch: Observation[] = [];
  for (let i = 0; i < 100; i++) batch.push(obs({ objectId: 'x', t: i * 10, lon: i, lat: 0, alt: i % 2 ? 5 : undefined }));
  db.observations.insertObservations(batch);
  const all = db.observations.trackPoints('flights', 'x', 0, 10_000, 1000);
  assert.equal(all.length, 100);
  assert.deepEqual(all[0], [0, 0, 0, null]);
  assert.deepEqual(all[1], [10, 1, 0, 5]);
  const thin = db.observations.trackPoints('flights', 'x', 0, 10_000, 10);
  assert.equal(thin.length, 10);
  assert.equal(thin[0]![0], 0);
  assert.equal(thin[9]![0], 990);
  assert.ok(thin.every((p, i) => i === 0 || p[0] > thin[i - 1]![0]));
  assert.equal(db.observations.trackPoints('flights', 'x', 200, 300, 1000).length, 11);
  db.close();
});

test('timeRange spans all layers; empty db gives nulls', () => {
  const db = openDb(':memory:');
  assert.deepEqual(db.observations.timeRange(), { from: null, to: null });
  db.observations.insertObservations([obs({ t: 5 }), obs({ layer: 'vessels', t: 9 })]);
  assert.deepEqual(db.observations.timeRange(), { from: 5, to: 9 });
  db.close();
});

test('pruneBefore can run in chunks and keeps the R*Tree in sync', () => {
  const db = openDb(':memory:');
  const batch: Observation[] = [];
  for (let i = 0; i < 25; i++) batch.push(obs({ objectId: `o${i}`, t: i }));
  db.observations.insertObservations(batch);
  assert.equal(db.observations.pruneBefore(20, 10), 10);
  assert.equal(db.observations.pruneBefore(20, 10), 10);
  assert.equal(db.observations.pruneBefore(20, 10), 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM observations').get()!.n, 5);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM observations_rtree').get()!.n, 5);
  db.close();
});

test('migration 2 adds the time index used by range and prune queries', () => {
  const db = openDb(':memory:');
  const plan = db.raw.prepare('EXPLAIN QUERY PLAN SELECT MIN(t) FROM observations').all() as { detail: string }[];
  assert.ok(plan.some((p) => p.detail.includes('observations_t')), JSON.stringify(plan));
  db.close();
});
