import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameBBox, primaryAction, titleIsIdentifier } from './detailActions.ts';

test('static features get Fly to; tracked objects and satellites keep Follow', () => {
  assert.equal(primaryAction('features'), 'flyto');
  assert.equal(primaryAction('tracked'), 'follow');
  assert.equal(primaryAction('orbits'), 'follow');
});

test('titles are sans except for identifiers of tracked objects', () => {
  assert.equal(titleIsIdentifier('tracked', 'KLM959', 'a1b2c3'), true);
  assert.equal(titleIsIdentifier('tracked', '244620905', '244620905'), true);
  assert.equal(titleIsIdentifier('tracked', 'MAAS TRADER', '244620905'), false);
  assert.equal(titleIsIdentifier('tracked', 'EVER', '1'), false);
  assert.equal(titleIsIdentifier('orbits', 'ISS (ZARYA)', '25544'), false);
  assert.equal(titleIsIdentifier('orbits', 'GXIBA-1', '67685'), false);
  assert.equal(titleIsIdentifier('features', 'M 5.1 - 12 km NW of Hilo, Hawaii', 'us7000'), false);
  assert.equal(titleIsIdentifier('features', 'Hurricane Ida', 'AL092021'), false);
});

test('frame box is centred on the point and scaled by layer', () => {
  const q = frameBBox('earthquakes', 10, 0);
  assert.deepEqual(q, [9.4, -0.6, 10.6, 0.6]);
  const c = frameBBox('cyclones', -60, 20);
  assert.ok(c[2] - c[0] > 12 && c[3] - c[1] === 12);
  const dateline = frameBBox('earthquakes', 179.9, 0);
  assert.ok(dateline[0] > 0 && dateline[2] < 0, 'crosses the antimeridian');
  const pole = frameBBox('earthquakes', 0, 89.8);
  assert.equal(pole[3], 90);
});
