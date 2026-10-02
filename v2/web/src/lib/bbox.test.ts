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
