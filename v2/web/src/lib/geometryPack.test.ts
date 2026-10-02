import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Feature } from '@gev/shared';
import { densify, NO_CODE, packFeatures, PATH_ALT_M, splitIds } from './geometryPack.ts';

const A = 6_378_137;

const quake = (id: string, mag: number, depthKm: number, lon: number, lat: number, t = 1000): Feature => ({
  id,
  geometry: { type: 'Point', coordinates: [lon, lat] },
  t,
  label: `M ${mag}`,
  props: { mag, depthKm, place: 'x' },
});

test('points are packed to ECEF with numeric props, sorted big first', () => {
  const pack = packFeatures('earthquakes', [quake('a', 2.1, 5, 0, 0), quake('b', 6.4, 40, 90, 0), quake('c', 4.2, 700, 0, 90)]);
  assert.equal(pack.points.count, 3);
  assert.deepEqual(splitIds(pack.points.ids), ['b', 'c', 'a']);
  assert.deepEqual(pack.points.labels.split('\n'), ['M 6.4', 'M 4.2', 'M 2.1']);
  assert.ok(Math.abs(pack.points.xyz[0]! - 0) < 1e-3 && Math.abs(pack.points.xyz[1]! - A) < 1e-3, 'b is on the +y axis');
  assert.ok(Math.abs(pack.points.xyz[5]! - 6_356_752.314) < 1, 'c is at the pole');
  assert.equal(pack.points.num[0], Math.fround(6.4));
  assert.equal(pack.points.num[1], 40);
  assert.equal(pack.points.t[0], 1000);
  assert.equal(pack.skipped, 0);
});

test('missing numbers become NaN and missing times too', () => {
  const f: Feature = { id: 'x', geometry: { type: 'Point', coordinates: [10, 10] }, props: { mag: null } };
  const pack = packFeatures('earthquakes', [f]);
  assert.ok(Number.isNaN(pack.points.num[0]!));
  assert.ok(Number.isNaN(pack.points.t[0]!));
});

test('string props become dictionary codes shared across tables', () => {
  const features: Feature[] = [
    { id: 's:position', geometry: { type: 'Point', coordinates: [-110, 19] }, label: 'Rachel', props: { part: 'position', category: 'H3', intensityKt: 100 } },
    { id: 's:forecast:12', geometry: { type: 'Point', coordinates: [-111, 19.5] }, label: '+12 h', props: { part: 'forecast', category: 'H3', tauHours: 12 } },
    { id: 's:track', geometry: { type: 'LineString', coordinates: [[-100, 12], [-105, 15], [-110, 19]] }, props: { part: 'track' } },
    { id: 's:forecast', geometry: { type: 'MultiLineString', coordinates: [[[-110, 19], [-115, 20]], [[-115, 20], [-120, 21]]] }, props: { part: 'forecast' } },
    { id: 's:cone', geometry: { type: 'Polygon', coordinates: [[[-112, 18], [-112, 21], [-108, 21], [-108, 18], [-112, 18]]] }, props: { part: 'cone' } },
  ];
  const pack = packFeatures('cyclones', features);
  assert.deepEqual([...pack.dict].sort(), ['H3', 'cone', 'forecast', 'position', 'track']);
  const code = (v: string) => pack.dict.indexOf(v);
  assert.equal(pack.points.count, 2);
  assert.equal(pack.points.code[0], code('position'));
  assert.equal(pack.points.code[1], code('H3'));
  assert.equal(pack.points.code[2], code('forecast'));
  assert.equal(pack.points.num[0], 100);
  assert.equal(pack.points.num[3], 12);
  assert.equal(pack.lines.count, 3, 'a track plus the two parts of the multi-line forecast');
  assert.deepEqual(splitIds(pack.lines.ids), ['s:track', 's:forecast', 's:forecast']);
  assert.equal(pack.dict[pack.lines.code[0]!], 'track');
  assert.equal(pack.dict[pack.lines.code[1]!], 'forecast');
  assert.equal(pack.polys.count, 1);
  assert.equal(pack.dict[pack.polys.code[0]!], 'cone');
});

test('path tables: starts are consistent and every vertex lies just above the surface', () => {
  const pack = packFeatures('cyclones', [
    { id: 'l', geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] }, props: { part: 'track' } },
    { id: 'm', geometry: { type: 'LineString', coordinates: [[0, 10], [0, 12]] }, props: { part: 'track' } },
  ]);
  const { lines } = pack;
  assert.equal(lines.starts.length, lines.count + 1);
  assert.equal(lines.starts[0], 0);
  assert.equal(lines.starts[lines.count], lines.xyz.length / 3);
  assert.equal(lines.xyz.length / 3, 21 + 5, '10 degrees at 0.5 degree steps = 21 vertices; 2 degrees = 5');
  for (let v = 0; v < lines.starts[1]!; v++) {
    const r = Math.hypot(lines.xyz[3 * v]!, lines.xyz[3 * v + 1]!, lines.xyz[3 * v + 2]!);
    assert.ok(Math.abs(r - (A + PATH_ALT_M)) < 1, 'equator radius plus the lift');
  }
});

test('rings are closed and densified; an already closed ring is not closed twice', () => {
  const open: Feature = { id: 'p', geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]] }, props: {} };
  const closed: Feature = { id: 'q', geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }, props: {} };
  const a = packFeatures('x', [open]).polys;
  const b = packFeatures('x', [closed]).polys;
  assert.equal(a.xyz.length, b.xyz.length);
  const n = a.xyz.length / 3;
  assert.deepEqual([...a.xyz.slice(0, 3)], [...a.xyz.slice(3 * (n - 1))]);
});

test('densify takes the short way across the antimeridian and never leaves a long gap', () => {
  const out = densify([179, 10, -179, 10], 0.5);
  assert.equal(out.length / 2, 5);
  const lons = out.filter((_, i) => i % 2 === 0);
  for (let i = 1; i < lons.length; i++) {
    let d = lons[i]! - lons[i - 1]!;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    assert.ok(Math.abs(d) <= 0.5 + 1e-9);
  }
  assert.deepEqual(densify([0, 0], 0.5), [0, 0]);
});

test('unusable geometry is counted, not thrown on', () => {
  const bad: Feature[] = [
    { id: '1', geometry: { type: 'Point', coordinates: [Number.NaN, 0] }, props: {} },
    { id: '2', geometry: { type: 'Point', coordinates: [0, 120] }, props: {} },
    { id: '3', geometry: { type: 'LineString', coordinates: [[0, 0], [Number.NaN, 1]] }, props: {} },
    { id: '4', geometry: { type: 'Polygon', coordinates: [] }, props: {} },
    { id: '5', geometry: { type: 'Point', coordinates: [1, 1] }, props: {} },
  ];
  const pack = packFeatures('x', bad);
  assert.equal(pack.skipped, 4);
  assert.equal(pack.points.count, 1);
  assert.equal(pack.lines.count, 0);
  assert.equal(pack.polys.count, 0);
});

test('launches: upcoming pads are packed last so they draw on top', () => {
  const mk = (id: string, status: string): Feature => ({ id, geometry: { type: 'Point', coordinates: [0, 0] }, props: { status, net: 5 } });
  const pack = packFeatures('launches', [mk('up', 'upcoming'), mk('ok', 'success'), mk('bad', 'failure'), mk('ok2', 'success')]);
  assert.deepEqual(splitIds(pack.points.ids), ['ok', 'ok2', 'bad', 'up']);
  assert.equal(pack.points.num[0], 5);
  assert.notEqual(pack.points.code[0], NO_CODE);
});

test('an empty response packs to empty tables', () => {
  const pack = packFeatures('cyclones', []);
  assert.equal(pack.points.count + pack.lines.count + pack.polys.count, 0);
  assert.equal(pack.points.ids, '');
  assert.deepEqual([...pack.lines.starts], [0]);
  assert.deepEqual(splitIds(''), []);
});
