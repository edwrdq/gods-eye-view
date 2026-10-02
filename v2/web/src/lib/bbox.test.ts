import assert from 'node:assert/strict';
import { test } from 'node:test';
import { altitudeForBBox, altitudeToFitGlobe, altitudeForKind, clampAltitude, normalizeBBox } from './bbox.ts';

test('normalizeBBox keeps an ordinary box', () => {
  const b = normalizeBBox([-123, 37, -122, 38]);
  assert.equal(b.lonSpan, 1);
  assert.equal(b.latSpan, 1);
  assert.equal(b.centerLon, -122.5);
  assert.equal(b.centerLat, 37.5);
  assert.equal(b.east, -122);
});

test('normalizeBBox unwraps an antimeridian-crossing box', () => {
  const b = normalizeBBox([170, -20, -170, -10]);
  assert.equal(b.lonSpan, 20);
  assert.equal(b.east, 190);
  assert.equal(b.centerLon, -180);
  assert.equal(b.centerLat, -15);
});

test('normalizeBBox centre wraps back into range', () => {
  const b = normalizeBBox([175, 0, -165, 10]);
  assert.equal(b.lonSpan, 20);
  assert.ok(b.centerLon >= -180 && b.centerLon < 180);
  assert.equal(b.centerLon, 175 + 10 - 360);
});

test('normalizeBBox swaps reversed latitudes and clamps', () => {
  const b = normalizeBBox([0, 95, 10, -95]);
  assert.equal(b.south, -90);
  assert.equal(b.north, 90);
});

test('altitudeForBBox grows with extent and respects the minimum', () => {
  const small = altitudeForBBox(normalizeBBox([-122.5, 37.7, -122.4, 37.8]), { aspect: 1.6 });
  const big = altitudeForBBox(normalizeBBox([-130, 30, -110, 45]), { aspect: 1.6 });
  assert.ok(big > small * 10);
  const tiny = altitudeForBBox(normalizeBBox([0, 0, 0.0001, 0.0001]), { aspect: 1.6 });
  assert.equal(tiny, 1500);
});

test('altitudeForBBox does not depend on which side of the antimeridian', () => {
  const a = altitudeForBBox(normalizeBBox([170, 0, -170, 10]), { aspect: 1.6 });
  const b = altitudeForBBox(normalizeBBox([-10, 0, 10, 10]), { aspect: 1.6 });
  assert.ok(Math.abs(a - b) < 1);
});

test('altitudeForBBox is capped for global boxes', () => {
  const a = altitudeForBBox(normalizeBBox([-180, -90, 180, 90]), { aspect: 1.6 });
  assert.equal(a, clampAltitude(Infinity));
});

test('altitudeForKind orders by granularity', () => {
  assert.ok(altitudeForKind('address') < altitudeForKind('coordinates'));
  assert.ok(altitudeForKind('coordinates') < altitudeForKind('poi'));
  assert.ok(altitudeForKind('poi') < altitudeForKind('place'));
});

test('altitudeToFitGlobe fits the tighter axis', () => {
  const wide = altitudeToFitGlobe({ aspect: 1.6, fovY: 0.69 });
  const tall = altitudeToFitGlobe({ aspect: 0.5, fovY: 1.047 });
  assert.ok(wide > 10_000_000 && wide < 30_000_000);
  assert.ok(tall > 5_000_000 && tall < 30_000_000);
  // Looser fill means the camera sits closer.
  assert.ok(altitudeToFitGlobe({ aspect: 1.6, fovY: 0.69, fill: 0.95 }) < wide);
});

import { bboxContains, bboxFromRectangle, bboxHasPoint, bboxParam } from './bbox.ts';

const rad = (d: number) => (d * Math.PI) / 180;
const rect = (w: number, s: number, e: number, n: number) => ({ west: rad(w), south: rad(s), east: rad(e), north: rad(n) });

test('bboxFromRectangle pads a normal view', () => {
  const b = bboxFromRectangle(rect(-10, 40, 10, 50), 0.25)!;
  assert.ok(Math.abs(b[0] - -15) < 1e-9);
  assert.ok(Math.abs(b[2] - 15) < 1e-9);
  assert.ok(Math.abs(b[1] - 37.5) < 1e-9);
  assert.ok(Math.abs(b[3] - 52.5) < 1e-9);
});

test('bboxFromRectangle keeps west > east across the antimeridian', () => {
  const b = bboxFromRectangle(rect(170, -10, -170, 10), 0)!;
  assert.ok(Math.abs(b[0] - 170) < 1e-9);
  assert.ok(Math.abs(b[2] - -170) < 1e-9);
  assert.ok(b[0] > b[2]);
  const padded = bboxFromRectangle(rect(170, -10, -170, 10), 0.25)!;
  assert.ok(Math.abs(padded[0] - 165) < 1e-9);
  assert.ok(Math.abs(padded[2] - -165) < 1e-9);
});

test('padding wraps over the antimeridian instead of leaving [-180, 180]', () => {
  const b = bboxFromRectangle(rect(-179, 0, -160, 10), 0.25)!;
  assert.ok(b[0] > 170 && b[0] <= 180);
  assert.ok(Math.abs(b[2] - -155.25) < 1e-9);
});

test('bboxFromRectangle returns null for world-sized or missing views', () => {
  assert.equal(bboxFromRectangle(undefined), null);
  assert.equal(bboxFromRectangle(rect(-180, -90, 180, 90)), null);
  assert.equal(bboxFromRectangle(rect(-130, -60, 130, 60)), null);
  assert.equal(bboxFromRectangle({ west: Number.NaN, south: 0, east: 0, north: 0 }), null);
});

test('bboxFromRectangle clamps latitude', () => {
  const b = bboxFromRectangle(rect(0, 80, 20, 90), 0.5)!;
  assert.equal(b[3], 90);
});

test('bboxParam rounds to 4 decimals', () => {
  assert.equal(bboxParam([-10.123456, 1, 10.5, 2.00001]), '-10.1235,1,10.5,2');
});

test('bboxContains handles null, nesting and the antimeridian', () => {
  assert.equal(bboxContains(null, [0, 0, 1, 1]), true);
  assert.equal(bboxContains(null, null), true);
  assert.equal(bboxContains([0, 0, 1, 1], null), false);
  assert.equal(bboxContains([-20, -20, 20, 20], [-10, -10, 10, 10]), true);
  assert.equal(bboxContains([-20, -20, 20, 20], [-10, -10, 30, 10]), false);
  assert.equal(bboxContains([-20, -20, 20, 20], [-10, -30, 10, 10]), false);
  assert.equal(bboxContains([160, -20, -160, 20], [170, 0, -170, 10]), true);
  assert.equal(bboxContains([160, -20, -160, 20], [150, 0, -170, 10]), false);
  assert.equal(bboxContains([160, -20, -160, 20], [-175, 0, -165, 10]), true);
});

test('bboxHasPoint handles the antimeridian', () => {
  assert.equal(bboxHasPoint([170, 0, -170, 10], 175, 5), true);
  assert.equal(bboxHasPoint([170, 0, -170, 10], -175, 5), true);
  assert.equal(bboxHasPoint([170, 0, -170, 10], 0, 5), false);
  assert.equal(bboxHasPoint([170, 0, -170, 10], 175, 15), false);
  assert.equal(bboxHasPoint(null, 1, 1), true);
});

import { bboxArea } from './bbox.ts';

test('bboxArea compares views', () => {
  assert.equal(bboxArea(null), 64800);
  assert.equal(bboxArea([0, 0, 10, 10]), 100);
  assert.equal(bboxArea([170, 0, -170, 10]), 200);
});
