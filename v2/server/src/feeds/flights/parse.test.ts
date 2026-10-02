import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adsbPositionSource, parseAdsbLol, parseOpenSky } from './parse.ts';

// Shapes copied from real api.adsb.lol/v2 responses (trimmed).
const ADSB_NOW = 1_759_378_783_123;
const adsbPayload = {
  ac: [
    {
      hex: 'A9F3C1',
      type: 'adsb_icao',
      flight: 'UAL1523 ',
      r: 'N77520',
      t: 'B739',
      desc: 'BOEING 737-900ER',
      ownOp: 'UNITED AIRLINES INC',
      alt_baro: 37000,
      alt_geom: 37375,
      gs: 468.2,
      track: 72.4,
      baro_rate: 64,
      squawk: '4521',
      emergency: 'none',
      category: 'A3',
      lat: 37.7213,
      lon: -122.2874,
      seen_pos: 0.4,
      seen: 0.2,
      dbFlags: 0,
    },
    { hex: 'a1b2c3', type: 'adsb_icao', flight: 'N123AB  ', alt_baro: 'ground', gs: 8.5, track: 281.25, lat: 37.62, lon: -122.38, seen_pos: 1.5, category: 'A1' },
    { hex: 'abc123', type: 'mode_s', alt_baro: 3000, seen: 12.1 }, // no position
    { hex: 'ae1234', type: 'adsb_icao', flight: 'RCH871', t: 'C17', alt_baro: 25000, gs: 400, track: 359.96, lat: 40, lon: -100, dbFlags: 1, seen_pos: 3, alt_geom: 25100, geom_rate: -1200 },
    { hex: '~2a3b4c', type: 'tisb_other', lat: 10, lon: 10, alt_baro: 500 },
    { hex: 'dead01', lat: 95, lon: 10 }, // invalid latitude
    { lat: 1, lon: 1 }, // no hex
    null,
  ],
  msg: 'No error',
  now: ADSB_NOW,
  total: 8,
};

test('adsb.lol: units, ids, and prop mapping', () => {
  const out = parseAdsbLol(adsbPayload, 0);
  assert.deepEqual(out.map((o) => o.objectId), ['a9f3c1', 'a1b2c3', 'ae1234', '~2a3b4c']);
  const ual = out[0]!;
  assert.equal(ual.layer, 'flights');
  assert.equal(ual.t, ADSB_NOW - 400);
  assert.equal(ual.lat, 37.7213);
  assert.equal(ual.lon, -122.2874);
  // geometric altitude preferred (ellipsoid height): 37375 ft = 11392.5 m
  assert.ok(Math.abs(ual.alt! - 37375 * 0.3048) < 0.06);
  assert.ok(Math.abs(ual.speed! - 468.2 * 0.514444) < 0.01); // m/s
  assert.equal(ual.heading, 72.4);
  assert.deepEqual(ual.props, {
    callsign: 'UAL1523',
    registration: 'N77520',
    typeCode: 'B739',
    category: 'Large',
    onGround: false,
    squawk: '4521',
    typeName: 'BOEING 737-900ER',
    operator: 'UNITED AIRLINES INC',
    altBaro: 11277.6,
    altGeom: 11391.9,
    vrate: 0.33,
    posSrc: 'adsb',
    src: 'adsb.lol',
  });
});

test('adsb.lol: on-ground aircraft have no altitude and are flagged', () => {
  const g = parseAdsbLol(adsbPayload, 0)[1]!;
  assert.equal(g.alt, undefined);
  assert.equal(g.props.onGround, true);
  assert.equal(g.props.altBaro, undefined);
  assert.equal(g.props.category, 'Light');
  assert.equal(g.t, ADSB_NOW - 1500);
  assert.equal(g.heading, 281.3); // rounded to 0.1
});

test('adsb.lol: dbFlags bit 0 marks military; heading wraps; barometric fallback; negative vertical rate', () => {
  const m = parseAdsbLol(adsbPayload, 0)[2]!;
  assert.equal(m.props.military, true);
  assert.equal(m.heading, 0); // 359.96 rounds to 360 -> wrapped
  assert.ok(Math.abs(m.props.vrate as number - -1200 * 0.00508) < 0.01);
  const tis = parseAdsbLol(adsbPayload, 0)[3]!;
  assert.equal(tis.objectId, '~2a3b4c');
  assert.ok(Math.abs(tis.alt! - 500 * 0.3048) < 0.1);
  assert.equal(tis.props.posSrc, 'tisb');
  assert.equal(tis.props.military, undefined);
});

test('adsb.lol: military endpoint flag applies to all rows; seconds-style now is accepted', () => {
  const out = parseAdsbLol({ now: 1_759_378_783, ac: [{ hex: 'AE0001', lat: 1, lon: 2, seen_pos: 1 }] }, 0, { military: true });
  assert.equal(out[0]!.props.military, true);
  assert.equal(out[0]!.t, 1_759_378_783_000 - 1000);
});

test('adsb.lol: missing now falls back to the supplied clock; junk payloads yield nothing', () => {
  assert.equal(parseAdsbLol({ ac: [{ hex: 'a', lat: 1, lon: 2 }] }, 5000)[0]!.t, 5000);
  assert.deepEqual(parseAdsbLol(null, 0), []);
  assert.deepEqual(parseAdsbLol({ ac: 'x' }, 0), []);
  assert.deepEqual(parseAdsbLol({}, 0), []);
});

test('adsb.lol: output JSON has no undefined/null props', () => {
  for (const o of parseAdsbLol(adsbPayload, 0)) {
    for (const v of Object.values(o.props)) assert.ok(v !== undefined && v !== null);
    assert.ok(!JSON.stringify(o).includes('null'));
  }
});

test('adsbPositionSource', () => {
  assert.equal(adsbPositionSource('adsb_icao_nt'), 'adsb');
  assert.equal(adsbPositionSource('mlat'), 'mlat');
  assert.equal(adsbPositionSource('adsr_icao'), 'adsb');
  assert.equal(adsbPositionSource('adsc'), 'adsc');
  assert.equal(adsbPositionSource(undefined), undefined);
});

// OpenSky /states/all?extended=1 vectors: SI units already.
const openskyPayload = {
  time: 1_759_378_780,
  states: [
    ['a9f3c1', 'UAL1523 ', 'United States', 1_759_378_779, 1_759_378_780, -122.2874, 37.7213, 11277.6, false, 240.8, 72.4, 0.3, null, 11392.5, '4521', false, 0, 4],
    ['4ca7b5', 'RYR8XY  ', 'Ireland', null, 1_759_378_770, 6.1, 50.2, null, true, 12.5, 180, null, null, null, null, false, 0, 0],
    ['3c6444', null, 'Germany', 1_759_378_700, 1_759_378_701, null, null, null, false, null, null, null, null, null, null, false, 0, 0],
    ['abcdef', 'TEST', 'X', 1_759_378_780, 1_759_378_780, 10, 20, 9000, false, 200, 450, -5.5, null, null, '', false, 2, 8],
    'junk',
  ],
};

test('OpenSky: SI values are kept, ids lowercased, categories and sources mapped', () => {
  const out = parseOpenSky(openskyPayload, 0);
  assert.deepEqual(out.map((o) => o.objectId), ['a9f3c1', '4ca7b5', 'abcdef']);
  const [ual, ryr, other] = out;
  assert.equal(ual!.t, 1_759_378_779_000);
  assert.equal(ual!.alt, 11392.5); // geometric preferred
  assert.equal(ual!.speed, 240.8);
  assert.equal(ual!.heading, 72.4);
  assert.equal(ual!.props.callsign, 'UAL1523');
  assert.equal(ual!.props.category, 'Large');
  assert.equal(ual!.props.country, 'United States');
  assert.equal(ual!.props.posSrc, 'adsb');
  assert.equal(ual!.props.vrate, 0.3);
  assert.equal(ual!.props.src, 'OpenSky Network');
  assert.equal(ryr!.t, 1_759_378_770_000); // falls back to last_contact
  assert.equal(ryr!.alt, undefined);
  assert.equal(ryr!.props.onGround, true);
  assert.equal(other!.heading, 90); // 450 wraps
  assert.equal(other!.alt, 9000); // barometric when geometric missing
  assert.equal(other!.props.posSrc, 'mlat');
  assert.equal(other!.props.category, 'Rotorcraft');
  assert.equal(other!.props.squawk, undefined); // empty squawk dropped
});

test('OpenSky: junk payloads yield nothing', () => {
  assert.deepEqual(parseOpenSky({ time: 1, states: null }, 0), []);
  assert.deepEqual(parseOpenSky(undefined, 0), []);
});
