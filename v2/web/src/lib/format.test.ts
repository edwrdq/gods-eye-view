import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAltitude, formatLatLon, formatLatLonHemi, wrapLon } from './format.ts';

test('wrapLon wraps into [-180, 180)', () => {
  assert.equal(wrapLon(190), -170);
  assert.equal(wrapLon(-190), 170);
  assert.equal(wrapLon(180), -180);
  assert.equal(wrapLon(0), 0);
  assert.equal(wrapLon(540), -180);
});

test('formatLatLon uses signed decimals', () => {
  assert.equal(formatLatLon(37.7749, -122.4194), '37.7749, -122.4194');
  assert.equal(formatLatLon(-33.8688, 151.2093, 2), '-33.87, 151.21');
  assert.equal(formatLatLon(10, 190, 1), '10.0, -170.0');
});

test('formatLatLonHemi adds hemisphere letters', () => {
  assert.equal(formatLatLonHemi(37.619, -122.375), '37.6190° N, 122.3750° W');
  assert.equal(formatLatLonHemi(-33.8688, 151.2093, 2), '33.87° S, 151.21° E');
});

test('formatAltitude switches units at 10 km', () => {
  assert.equal(formatAltitude(950.4), '950 m');
  assert.equal(formatAltitude(9999), '9,999 m');
  assert.equal(formatAltitude(10_000), '10 km');
  assert.equal(formatAltitude(2_840_300), '2,840 km');
  assert.equal(formatAltitude(-5), '0 m');
  assert.equal(formatAltitude(Number.NaN), '—');
});
