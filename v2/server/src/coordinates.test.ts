import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinateResult, parseCoordinates } from './coordinates.ts';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-4;

function expectCoords(q: string, lat: number, lon: number) {
  const c = parseCoordinates(q);
  assert.ok(c, `should parse: ${q}`);
  assert.ok(close(c.lat, lat) && close(c.lon, lon), `${q} -> ${JSON.stringify(c)}`);
}

test('decimal pairs', () => {
  expectCoords('30.2672, -97.7431', 30.2672, -97.7431);
  expectCoords('30.2672 -97.7431', 30.2672, -97.7431);
  expectCoords('30.2672;-97.7431', 30.2672, -97.7431);
  expectCoords('  -33.86,151.21  ', -33.86, 151.21);
  expectCoords('+10, +20', 10, 20);
  expectCoords('.5, .5', 0.5, 0.5);
  expectCoords('30.5° , -97.5°', 30.5, -97.5);
});

test('hemisphere letters, either side and either order', () => {
  expectCoords('30.2672 N, 97.7431 W', 30.2672, -97.7431);
  expectCoords('N30.2672 W97.7431', 30.2672, -97.7431);
  expectCoords('30.2672N 97.7431W', 30.2672, -97.7431);
  expectCoords('97.7431 W, 30.2672 N', 30.2672, -97.7431);
  expectCoords('S 33.86 E 151.21', -33.86, 151.21);
  expectCoords('33.86s, 151.21e', -33.86, 151.21);
});

test('degrees minutes seconds', () => {
  expectCoords(`30°16'01.9"N 97°44'35.2"W`, 30 + 16 / 60 + 1.9 / 3600, -(97 + 44 / 60 + 35.2 / 3600));
  expectCoords(`30°16'01.9"N, 97°44'35.2"W`, 30.267194, -97.743111);
  expectCoords(`N 30°16'01.9" W 97°44'35.2"`, 30.267194, -97.743111);
  expectCoords(`30°16.5'N 97°44.5'W`, 30.275, -97.741667);
  expectCoords(`30° N 97° W`, 30, -97);
  expectCoords(`30°16′01.9″N 97°44′35.2″W`, 30.267194, -97.743111);
  expectCoords(`-30°16'01.9", 97°44'35.2"`, -30.267194, 97.743111);
});

test('rejects invalid input', () => {
  for (const q of [
    '', ' ', 'Austin', '12', '12junk, 34oops', '91, 0', '0, 181', '-91, 0',
    '30N, 40N', '30E, 40W', 'N30 S40', '-40N, 10E', '40NN, 10E', 'N40N, 10E',
    '1,2,3', '1 2 3', '30.5.5, 10', `30°61'N 97°W`, `30°16'61"N 97°W`,
    `30'16"N 97W`, 'lat 30 lon 97', '30,', ',30', 'NaN, 5', 'Infinity, 5', '1e3, 2',
  ]) {
    assert.equal(parseCoordinates(q), null, `should reject: ${JSON.stringify(q)}`);
  }
});

test('boundary values accepted', () => {
  expectCoords('90, 180', 90, 180);
  expectCoords('-90, -180', -90, -180);
});

test('coordinateResult shape', () => {
  const r = coordinateResult('30.2672, -97.7431');
  assert.ok(r);
  assert.equal(r.kind, 'coordinates');
  assert.equal(r.source, 'local');
  assert.equal(r.label, '30.2672° N, 97.7431° W');
  assert.deepEqual(r.bbox?.map((n) => Number(n.toFixed(3))), [-97.758, 30.252, -97.728, 30.282]);
  assert.equal(coordinateResult('Austin'), null);
});

test('coordinateResult clamps at poles and wraps at the antimeridian', () => {
  const pole = coordinateResult('89.999, 10');
  assert.equal(pole?.bbox?.[3], 90);
  const dateline = coordinateResult('0, 179.999');
  assert.ok(dateline?.bbox);
  assert.ok(dateline.bbox[0] > dateline.bbox[2], 'west > east means wrapped');
});
