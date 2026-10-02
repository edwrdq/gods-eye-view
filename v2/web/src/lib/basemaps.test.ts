import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BASE_MAPS,
  availability,
  defaultBaseMap,
  GIBS_FIRST_DATE,
  gibsDateForTime,
  gibsDefaultDate,
  parseChoice,
  serializeChoice,
  validateGibsDate,
} from './basemaps.ts';

const none = { googleMapsApiKey: null, cesiumIonToken: null };
const ion = { googleMapsApiKey: null, cesiumIonToken: 'tok' };
const google = { googleMapsApiKey: 'k', cesiumIonToken: null };

test('option ids are unique', () => {
  assert.equal(new Set(BASE_MAPS.map((o) => o.id)).size, BASE_MAPS.length);
});

test('availability explains missing keys', () => {
  assert.equal(availability('esri', none).available, true);
  const g = availability('google-3d', none);
  assert.equal(g.available, false);
  assert.match(g.note ?? '', /GOOGLE_MAPS_API_KEY/);
  assert.equal(availability('google-3d', ion).available, true);
  assert.equal(availability('google-3d', google).note, null);
  assert.equal(availability('ion-aerial', google).available, false);
  assert.equal(availability('ion-aerial', ion).available, true);
});

test('default follows the keys', () => {
  assert.equal(defaultBaseMap(none), 'esri');
  assert.equal(defaultBaseMap(ion), 'ion-aerial');
  assert.equal(defaultBaseMap(google), 'google-3d');
  assert.equal(defaultBaseMap({ googleMapsApiKey: ' ', cesiumIonToken: ' ' }), 'esri');
});

test('stored choice round-trips', () => {
  const c = { id: 's2-2016' as const, buildings: false, flatTerrain: true };
  assert.deepEqual(parseChoice(serializeChoice(c), none), c);
});

test('stored choice falls back when missing, malformed, stale or unavailable', () => {
  assert.equal(parseChoice(null, none).id, 'esri');
  assert.equal(parseChoice('{nope', none).id, 'esri');
  assert.equal(parseChoice(JSON.stringify({ v: 0, id: 'osm' }), none).id, 'esri');
  assert.equal(parseChoice(JSON.stringify({ v: 1, id: 'bogus' }), none).id, 'esri');
  assert.equal(parseChoice(serializeChoice({ id: 'google-3d', buildings: false, flatTerrain: false }), none).id, 'esri');
  assert.equal(parseChoice(serializeChoice({ id: 'google-3d', buildings: false, flatTerrain: false }), ion).id, 'google-3d');
});

test('buildings overlay needs an ion token', () => {
  const raw = serializeChoice({ id: 'osm', buildings: true, flatTerrain: false });
  assert.equal(parseChoice(raw, none).buildings, false);
  assert.equal(parseChoice(raw, ion).buildings, true);
});

test('GIBS default is yesterday UTC', () => {
  assert.equal(gibsDefaultDate(new Date('2026-10-02T00:30:00Z')), '2026-10-01');
  assert.equal(gibsDefaultDate(new Date('2026-03-01T23:59:00Z')), '2026-02-28');
});

test('GIBS date validation', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  assert.equal(validateGibsDate('2026-10-01', now), '2026-10-01');
  assert.equal(validateGibsDate('2026-10-02', now), null); // today is incomplete
  assert.equal(validateGibsDate('2015-11-23', now), null);
  assert.equal(validateGibsDate('2026-02-30', now), null);
  assert.equal(validateGibsDate('yesterday', now), null);
});

test('gibsDateForTime maps a viewed instant to its UTC day inside the archive', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  assert.equal(gibsDateForTime(Date.parse('2026-10-01T23:59:59Z'), now), '2026-10-01');
  assert.equal(gibsDateForTime(Date.parse('2026-09-28T00:00:00Z'), now), '2026-09-28');
  // Today's mosaic is incomplete: hold at the latest complete day.
  assert.equal(gibsDateForTime(Date.parse('2026-10-02T08:00:00Z'), now), '2026-10-01');
  assert.equal(gibsDateForTime(Date.parse('2010-01-01T00:00:00Z'), now), GIBS_FIRST_DATE);
});
