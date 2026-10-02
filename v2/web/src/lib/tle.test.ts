import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tleChecksum, tleSummary } from './tle.ts';

const ISS1 = '1 25544U 98067A   26275.01380287  .00003738  00000+0  76743-4 0  9992';
const ISS2 = '2 25544  51.6312 131.4121 0006946 211.9293 148.1275 15.48707684588318';

test('orbital figures come straight from the element set', () => {
  const s = tleSummary(ISS1, ISS2)!;
  assert.equal(s.inclinationDeg, 51.6312);
  assert.ok(Math.abs(s.periodMin - 1440 / 15.48707684) < 1e-6);
  assert.ok(s.periodMin > 92 && s.periodMin < 94);
  assert.ok(s.perigeeKm > 380 && s.perigeeKm < 440, `perigee ${s.perigeeKm}`);
  assert.ok(s.apogeeKm > s.perigeeKm && s.apogeeKm - s.perigeeKm < 15);
  assert.equal(s.designator, '98067A');
  assert.ok(Math.abs(s.eccentricity - 0.0006946) < 1e-9);
});

test('a geostationary set has a 24 h period and a 35,786 km altitude', () => {
  const s = tleSummary('1 99999U 24001A   26275.00000000  .00000000  00000-0  00000-0 0  9990', '2 99999   0.0500 100.0000 0001000 000.0000 000.0000  1.00272000    10')!;
  assert.ok(Math.abs(s.periodMin - 1436.07) < 0.2);
  assert.ok(Math.abs(s.perigeeKm - 35_786) < 20, `perigee ${s.perigeeKm}`);
});

test('garbage returns null instead of NaN figures', () => {
  assert.equal(tleSummary('x', 'y'), null);
});

test('checksum counts digits and minus signs', () => {
  assert.equal(tleChecksum(ISS1), ISS1.charCodeAt(68) - 48);
  assert.equal(tleChecksum(ISS2), ISS2.charCodeAt(68) - 48);
});
