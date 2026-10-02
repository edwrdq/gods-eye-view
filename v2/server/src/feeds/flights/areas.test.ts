import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AreaBook, coverPoints, parseAreas } from './areas.ts';
import { clock } from '../test-utils.ts';

test('parseAreas accepts several separators and reports invalid pairs', () => {
  assert.deepEqual(parseAreas('37.62,-122.38; 51.47,-0.45').areas, [
    { lat: 37.62, lon: -122.38 },
    { lat: 51.47, lon: -0.45 },
  ]);
  assert.deepEqual(parseAreas('[[1,2],[3,4]]').areas.length, 2);
  assert.deepEqual(parseAreas('').areas, []);
  assert.deepEqual(parseAreas(undefined).areas, []);
  const bad = parseAreas('95,10;10,200;5,5');
  assert.deepEqual(bad.areas, [{ lat: 5, lon: 5 }]);
  assert.equal(bad.invalid.length, 2);
  assert.equal(parseAreas('1,2,3').invalid.length, 1);
});

test('coverPoints: small box -> one centre point rounded to 0.25 degrees; big box capped', () => {
  assert.deepEqual(coverPoints([-122.6, 37.5, -122.2, 37.8]), [{ lat: 37.75, lon: -122.5 }]);
  const wide = coverPoints([-60, -40, 60, 60], 4);
  assert.equal(wide.length, 4);
  assert.equal(new Set(wide.map((p) => `${p.lat},${p.lon}`)).size, 4);
});

test('coverPoints handles the antimeridian', () => {
  const pts = coverPoints([177, -2, -179, 2]);
  assert.equal(pts.length, 1);
  assert.ok(Math.abs(pts[0]!.lon) >= 178.9);
});

test('AreaBook: static areas persist, viewports expire after the TTL and the list is bounded', () => {
  const c = clock(0);
  const book = new AreaBook([{ lat: 1, lon: 2 }], c.now, 10 * 60_000, 3);
  assert.equal(book.touch([10, 10, 10.2, 10.2]), true);
  assert.equal(book.touch([10, 10, 10.2, 10.2]), false);
  assert.equal(book.active().length, 2);
  c.advance(9 * 60_000);
  book.touch([10, 10, 10.2, 10.2]); // refresh
  c.advance(2 * 60_000);
  assert.equal(book.active().length, 2); // refreshed one survives
  c.advance(9 * 60_000);
  assert.deepEqual(book.active(), [{ lat: 1, lon: 2 }]);
  for (let i = 0; i < 6; i++) book.touch([20 + i * 10, 0, 20.2 + i * 10, 0.2]);
  assert.equal(book.active().length, 1 + 3);
});
