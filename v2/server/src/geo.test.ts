import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approxDistanceM, bboxCentre, compass, headingDelta, inBBox, isWorld, parseBBox, wrapLon } from './geo.ts';

test('parseBBox accepts valid boxes including antimeridian', () => {
  assert.deepEqual(parseBBox('-10,20,30,40'), [-10, 20, 30, 40]);
  assert.deepEqual(parseBBox('170,-10,-170,10'), [170, -10, -170, 10]);
  assert.deepEqual(parseBBox('-180,-90,180,90'), [-180, -90, 180, 90]);
});

test('parseBBox rejects malformed input', () => {
  for (const bad of ['', '1,2,3', '1,2,3,4,5', 'a,b,c,d', '1,2,3,', '0,50,10,40', '0,-91,10,0', '0,0,10,91', '-181,0,10,10', '0,0,181,10', 'NaN,0,1,1', 'Infinity,0,1,1']) {
    assert.equal(typeof parseBBox(bad), 'string', bad);
  }
});

test('inBBox handles normal and antimeridian boxes', () => {
  assert.ok(inBBox(0, 0, [-10, -10, 10, 10]));
  assert.ok(!inBBox(11, 0, [-10, -10, 10, 10]));
  assert.ok(!inBBox(0, 11, [-10, -10, 10, 10]));
  const am: [number, number, number, number] = [170, -10, -170, 10];
  assert.ok(inBBox(175, 0, am));
  assert.ok(inBBox(-175, 0, am));
  assert.ok(inBBox(180, 0, am));
  assert.ok(!inBBox(0, 0, am));
  assert.ok(!inBBox(-169, 0, am));
});

test('isWorld', () => {
  assert.ok(isWorld([-180, -90, 180, 90]));
  assert.ok(!isWorld([-180, -80, 180, 90]));
});

test('distance, heading delta, compass, wrap, centre', () => {
  assert.ok(Math.abs(approxDistanceM(0, 0, 1, 0) - 111_320) < 5);
  // across the antimeridian: 0.2 degrees, not 359.8
  assert.ok(approxDistanceM(0, 179.9, 0, -179.9) < 25_000);
  assert.equal(headingDelta(350, 10), 20);
  assert.equal(headingDelta(10, 350), 20);
  assert.equal(headingDelta(0, 180), 180);
  assert.equal(compass(0), 'N');
  assert.equal(compass(72), 'ENE');
  assert.equal(compass(359), 'N');
  assert.equal(wrapLon(190), -170);
  assert.equal(wrapLon(-190), 170);
  const c = bboxCentre([170, -10, -170, 10]);
  assert.equal(Math.abs(c.lon), 180);
  assert.equal(c.widthDeg, 20);
});
