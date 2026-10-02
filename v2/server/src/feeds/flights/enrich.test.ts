import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, jsonResponse } from '../test-utils.ts';
import { createAdsbdbEnricher, parseAircraft, parseRoute } from './enrich.ts';
import { buildFlightDetail } from './detail.ts';
import type { Observation } from '@gev/shared';

const aircraftJson = {
  response: {
    aircraft: {
      type: '737-900ER',
      icao_type: 'B739',
      manufacturer: 'Boeing',
      registration: 'N77520',
      registered_owner: 'United Airlines',
      registered_owner_country_name: 'United States',
    },
  },
};
const routeJson = {
  response: {
    flightroute: {
      callsign: 'UAL1523',
      airline: { name: 'United Airlines' },
      origin: { iata_code: 'SFO', icao_code: 'KSFO', municipality: 'San Francisco', name: 'San Francisco International Airport' },
      destination: { iata_code: 'DEN', icao_code: 'KDEN', municipality: 'Denver' },
    },
  },
};

test('adsbdb parsers', () => {
  assert.deepEqual(parseAircraft(aircraftJson), {
    typeCode: 'B739',
    typeName: 'Boeing 737-900ER',
    registration: 'N77520',
    owner: 'United Airlines',
    country: 'United States',
  });
  assert.equal(parseAircraft({ response: 'unknown aircraft' }), null);
  const r = parseRoute(routeJson)!;
  assert.equal(r.origin.code, 'SFO');
  assert.equal(r.origin.name, 'San Francisco');
  assert.equal(r.airline, 'United Airlines');
  assert.equal(parseRoute({ response: { flightroute: { origin: {} } } }), null);
});

test('enricher caches hits and 404s for 24 h, coalesces concurrent calls, and expires', async () => {
  const c = clock();
  let calls = 0;
  const urls: string[] = [];
  const e = createAdsbdbEnricher({
    now: c.now,
    fetch: async (url) => {
      calls++;
      urls.push(url);
      if (url.includes('/aircraft/a9f3c1')) return jsonResponse(aircraftJson);
      return new Response('{}', { status: 404 });
    },
  });
  const [a, b] = await Promise.all([e.aircraft('a9f3c1'), e.aircraft('a9f3c1')]);
  assert.equal(calls, 1);
  assert.equal(a!.typeCode, 'B739');
  assert.equal(b!.typeCode, 'B739');
  assert.equal(await e.aircraft('a9f3c1'), a);
  assert.equal(await e.route('NOPE12'), null);
  assert.equal(await e.route('nope12'), null); // normalised + negative-cached
  assert.equal(calls, 2);
  assert.ok(urls[1]!.endsWith('/v0/callsign/NOPE12'));
  c.advance(25 * 3600_000);
  await e.aircraft('a9f3c1');
  assert.equal(calls, 3);
});

test('enricher never throws: network errors and bad statuses give null and retry later', async () => {
  const c = clock();
  let mode: 'throw' | '500' | 'ok' = 'throw';
  let calls = 0;
  const e = createAdsbdbEnricher({
    now: c.now,
    fetch: async () => {
      calls++;
      if (mode === 'throw') throw new Error('offline');
      if (mode === '500') return new Response('', { status: 500 });
      return jsonResponse(aircraftJson);
    },
  });
  assert.equal(await e.aircraft('a9f3c1'), null);
  assert.equal(await e.aircraft('a9f3c1'), null); // within failure pause: no new request
  assert.equal(calls, 1);
  c.advance(61_000);
  mode = '500';
  assert.equal(await e.aircraft('a9f3c1'), null);
  c.advance(61_000);
  mode = 'ok';
  assert.equal((await e.aircraft('a9f3c1'))!.registration, 'N77520');
  // invalid keys never hit the network
  const before = calls;
  assert.equal(await e.aircraft('not-hex'), null);
  assert.equal(await e.route('bad callsign!'), null);
  assert.equal(calls, before);
});

test('enricher lookup is bounded by the LRU size', async () => {
  const c = clock();
  let calls = 0;
  const e = createAdsbdbEnricher({ now: c.now, max: 2, fetch: async () => (calls++, jsonResponse(aircraftJson)) });
  await e.aircraft('000001');
  await e.aircraft('000002');
  await e.aircraft('000003'); // evicts 000001
  await e.aircraft('000002');
  assert.equal(calls, 3);
  await e.aircraft('000001');
  assert.equal(calls, 4);
});

const obs: Observation = {
  layer: 'flights', objectId: 'a9f3c1', t: Date.UTC(2026, 9, 2, 4, 19, 43), lon: -122.2874, lat: 37.7213, alt: 11391.9, heading: 72.4, speed: 240.8,
  props: { callsign: 'UAL1523', registration: 'N77520', typeCode: 'B739', altBaro: 11277.6, vrate: 0, squawk: '4521', posSrc: 'adsb', src: 'adsb.lol', category: 'Large' },
};

test('flight detail mirrors the design mock sections and formats units', () => {
  const d = buildFlightDetail(obs, { aircraft: parseAircraft(aircraftJson), route: parseRoute(routeJson) }, false);
  const by = (t: string) => Object.fromEntries(d.sections.find((s) => s.title === t)!.rows.map((r) => [r.label, r]));
  const pos = by('Position');
  assert.equal(pos.Latitude!.value, '37.7213° N');
  assert.equal(pos.Longitude!.value, '122.2874° W');
  assert.equal(pos.Altitude!.value, '11,278 m');
  assert.equal(pos.Altitude!.hint, 'FL370 · barometric');
  assert.equal(pos['Ground speed']!.value, '468 kt');
  assert.equal(pos['Ground speed']!.hint, '867 km/h');
  assert.equal(pos.Heading!.value, '072°');
  assert.equal(pos.Heading!.hint, 'ENE');
  assert.equal(pos['Vertical rate']!.hint, 'level');
  const ac = by('Aircraft');
  assert.equal(ac.Registration!.value, 'N77520');
  assert.equal(ac.Type!.value, 'Boeing 737-900ER');
  assert.equal(ac.Type!.hint, 'B739');
  assert.equal(ac['ICAO address']!.value, 'A9F3C1');
  assert.equal(by('Source').Received!.value, '2026-10-02 04:19:43Z');
  assert.equal(by('Source').Position!.hint, 'not estimated');
  assert.equal(by('Route').Origin!.value, 'San Francisco');
  assert.equal(d.title, 'UAL1523');
  assert.equal(d.subtitle, 'Boeing 737-900ER · N77520 · United Airlines');
});

test('flight detail copes with sparse observations (no enrichment, on ground, no callsign)', () => {
  const sparse: Observation = { layer: 'flights', objectId: '4ca7b5', t: 0, lon: 6.1, lat: -50.2, props: { onGround: true } };
  const d = buildFlightDetail(sparse, { aircraft: null, route: null }, true);
  assert.equal(d.title, '4CA7B5');
  assert.equal(d.subtitle, null);
  const rows = d.sections.flatMap((s) => s.rows);
  assert.ok(rows.some((r) => r.label === 'Altitude' && r.value === 'On ground'));
  assert.ok(rows.some((r) => r.label === 'Latitude' && r.value === '50.2000° S'));
  assert.ok(d.sections.every((s) => s.rows.length > 0));
  assert.ok(rows.every((r) => r.value !== undefined && r.value !== ''));
});
