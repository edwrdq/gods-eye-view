import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OrbitalElements } from '@gev/shared';
import { buildSatelliteDetail, groupLabel } from './satDetail.ts';

const el: OrbitalElements = {
  noradId: '25544',
  name: 'ISS (ZARYA)',
  group: 'stations',
  tle1: '1 25544U 98067A   26275.01380287  .00003738  00000+0  76743-4 0  9992',
  tle2: '2 25544  51.6312 131.4121 0006946 211.9293 148.1275 15.48707684588318',
  epoch: Date.UTC(2026, 9, 2, 0, 19, 52),
};
const now = el.epoch + 3 * 3_600_000;

const row = (d: ReturnType<typeof buildSatelliteDetail>, title: string, label: string) => d.sections.find((s) => s.title === title)?.rows.find((r) => r.label === label);

test('satellite detail has position, orbit, identity and source sections in that order', () => {
  const d = buildSatelliteDetail(el, { lon: 12.5, lat: -41.2, alt: 418_000, speedKms: 7.66 }, now, now);
  assert.deepEqual(d.sections.map((s) => s.title), ['Position', 'Orbit', 'Identity', 'Source']);
  assert.equal(d.title, 'ISS (ZARYA)');
  assert.equal(d.subtitle, 'NORAD 25544 · Space stations');
  assert.equal(row(d, 'Position', 'Altitude')?.value, '418 km');
  assert.equal(row(d, 'Position', 'Speed')?.value, '7.66 km/s');
  assert.equal(row(d, 'Orbit', 'Inclination')?.value, '51.63°');
  assert.match(String(row(d, 'Orbit', 'Period')?.value), /^93\.0 min$/);
  assert.equal(row(d, 'Identity', 'NORAD ID')?.value, '25544');
  assert.equal(row(d, 'Identity', 'Designator')?.value, '98067A');
  assert.equal(row(d, 'Source', 'Elements')?.hint, 'epoch 3 h old');
  assert.equal(d.observation.props.epoch, el.epoch);
  assert.equal(d.live, true);
});

test('a satellite that no longer propagates still shows its elements', () => {
  const d = buildSatelliteDetail(el, null, now, now);
  assert.equal(row(d, 'Position', 'Position')?.value, 'Not available');
  assert.ok(d.sections.some((s) => s.title === 'Orbit'));
});

test('group names are plain words', () => {
  assert.equal(groupLabel('gps-ops'), 'GPS');
  assert.equal(groupLabel('starlink'), 'Starlink');
  assert.equal(groupLabel('mystery'), 'mystery');
});
