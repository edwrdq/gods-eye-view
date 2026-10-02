import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Observation } from '@gev/shared';
import { keepScore, thinToCap } from './thin.ts';

const NOW = 1_760_000_000_000;

function vessel(id: number, lon: number, lat: number, over: Partial<Observation> = {}): Observation {
  return { layer: 'vessels', objectId: String(200_000_000 + id), t: NOW - 5_000, lon, lat, props: {}, ...over };
}

/** Deterministic scatter in a box. */
function scatter(n: number, box: [number, number, number, number], idBase = 0): Observation[] {
  const out: Observation[] = [];
  let s = 12345 + idBase;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < n; i++) out.push(vessel(idBase + i, box[0] + rnd() * (box[2] - box[0]), box[1] + rnd() * (box[3] - box[1])));
  return out;
}

test('returns the input untouched when it fits', () => {
  const objs = scatter(10, [0, 0, 10, 10]);
  assert.equal(thinToCap(objs, 10, { now: NOW }), objs);
  assert.equal(thinToCap(objs, 50, { now: NOW }), objs);
});

test('returns exactly cap distinct objects', () => {
  const objs = scatter(5_000, [-180, -80, 180, 80]);
  const out = thinToCap(objs, 1_234, { now: NOW });
  assert.equal(out.length, 1_234);
  assert.equal(new Set(out.map((o) => o.objectId)).size, 1_234);
  assert.equal(thinToCap(objs, 0, { now: NOW }).length, 0);
});

test('a crowded harbour gives up objects before open sea does', () => {
  const harbour = scatter(6_000, [4.0, 51.8, 4.3, 51.95], 0); // Rotterdam-sized box
  const sea = scatter(1_500, [-60, -40, 60, 40], 100_000);
  const all = [...harbour, ...sea]; // harbour first: a first-N cap would keep only harbour
  const out = thinToCap(all, 2_000, { now: NOW });
  assert.equal(out.length, 2_000);
  const seaKept = out.filter((o) => Number(o.objectId) >= 200_100_000).length;
  const harbourKept = out.length - seaKept;
  assert.ok(seaKept >= 1_400, `open sea keeps nearly everything, kept ${seaKept}`);
  assert.ok(harbourKept <= 600, `harbour is thinned, kept ${harbourKept}`);
  assert.ok(harbourKept > 0);
});

test('the subset covers the map: every populated 20 degree block keeps something', () => {
  const objs = scatter(33_104, [-180, -75, 180, 75]);
  const out = thinToCap(objs, 20_000, { now: NOW });
  assert.equal(out.length, 20_000);
  const block = (o: Observation) => `${Math.floor((o.lon + 180) / 20)},${Math.floor((o.lat + 90) / 20)}`;
  const had = new Set(objs.map(block));
  const kept = new Set(out.map(block));
  assert.equal(kept.size, had.size);
  // roughly proportional: no block loses more than ~60% when the whole set loses 40%
  const count = (list: Observation[]) => {
    const m = new Map<string, number>();
    for (const o of list) m.set(block(o), (m.get(block(o)) ?? 0) + 1);
    return m;
  };
  const before = count(objs);
  const after = count(out);
  for (const [k, n] of before) assert.ok((after.get(k) ?? 0) >= n * 0.4, `block ${k}: ${after.get(k)} of ${n}`);
});

test('inside a crowded cell moving, named and recently updated objects win', () => {
  const spot = { lon: 4.1, lat: 51.9 };
  const crowd: Observation[] = [];
  for (let i = 0; i < 40; i++) crowd.push(vessel(i, spot.lon, spot.lat, { t: NOW - 3_600_000, speed: 0 })); // parked, old, anonymous
  const moving = vessel(900, spot.lon, spot.lat, { t: NOW - 3_600_000, speed: 6 });
  const named = vessel(901, spot.lon, spot.lat, { t: NOW - 3_600_000, speed: 0, props: { name: 'MAAS TRADER' } });
  const fresh = vessel(902, spot.lon, spot.lat, { t: NOW - 1_000, speed: 0 });
  const far = scatter(60, [-100, -50, 100, 50], 5_000);
  const out = thinToCap([...crowd, moving, named, fresh, ...far], 63, { now: NOW });
  const ids = new Set(out.map((o) => o.objectId));
  assert.equal(out.length, 63);
  for (const o of [moving, named, fresh]) assert.ok(ids.has(o.objectId), `${o.objectId} kept`);
  assert.ok(keepScore(moving, NOW) > keepScore(named, NOW));
  assert.ok(keepScore(named, NOW) > keepScore(crowd[0]!, NOW));
});

test('the choice is stable for the same input and independent of input order', () => {
  const objs = scatter(3_000, [-20, 30, 40, 70]);
  const a = thinToCap(objs, 700, { now: NOW }).map((o) => o.objectId).sort();
  const b = thinToCap([...objs].reverse(), 700, { now: NOW }).map((o) => o.objectId).sort();
  assert.deepEqual(a, b);
});

test('a bbox sizes the grid and the antimeridian is handled', () => {
  const east = scatter(1_500, [170, -10, 180, 10], 0);
  const west = scatter(1_500, [-180, -10, -170, 10], 10_000);
  const out = thinToCap([...east, ...west], 600, { bbox: [170, -10, -170, 10], now: NOW });
  assert.equal(out.length, 600);
  const e = out.filter((o) => o.lon > 0).length;
  assert.ok(e > 200 && e < 400, `both sides represented, east kept ${e}`);
});

test('33k vessels thin to 20k quickly', () => {
  const objs = scatter(33_104, [-180, -75, 180, 75]);
  const t0 = performance.now();
  const out = thinToCap(objs, 20_000, { now: NOW });
  const ms = performance.now() - t0;
  assert.equal(out.length, 20_000);
  assert.ok(ms < 400, `took ${ms.toFixed(0)} ms`);
});
