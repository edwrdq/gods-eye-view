import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAisError, parseAisEnvelope, parseAisTime, shipCategory, staticProps } from './parse.ts';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

// Shapes from AISStream documentation / captured frames.
const positionReport = (over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: 366998410, MMSI_String: 366998410, ShipName: 'ALCATRAZ CRUISES   ', latitude: 37.8087, longitude: -122.4098, time_utc: '2026-10-02 11:59:30.318353 +0000 UTC', ...meta },
  Message: {
    PositionReport: {
      Cog: 211.4, CommunicationState: 59916, Latitude: 37.8087, Longitude: -122.4098, MessageID: 1, NavigationalStatus: 0,
      PositionAccuracy: true, Raim: false, RateOfTurn: 0, RepeatIndicator: 0, Sog: 12.3, Spare: 0, SpecialManoeuvreIndicator: 0,
      Timestamp: 30, TrueHeading: 215, UserID: 366998410, Valid: true, ...over,
    },
  },
});

test('position report: knots to m/s, heading preferred over course, status label', () => {
  const p = parseAisEnvelope(positionReport(), NOW)!;
  assert.equal(p.mmsi, '366998410');
  const o = p.position!;
  assert.equal(o.layer, 'vessels');
  assert.equal(o.objectId, '366998410');
  assert.equal(o.t, Date.UTC(2026, 9, 2, 11, 59, 30, 318));
  assert.equal(o.lat, 37.8087);
  assert.equal(o.lon, -122.4098);
  assert.equal(o.heading, 215);
  assert.ok(Math.abs(o.speed! - 12.3 * 0.514444) < 0.01);
  assert.equal(o.alt, undefined);
  assert.deepEqual(o.props, { navStatus: 'Under way using engine', cog: 211.4 });
  assert.equal(p.static, undefined);
});

test('sentinels: heading 511, speed 102.3, course 360 are dropped; heading falls back to course', () => {
  const o = parseAisEnvelope(positionReport({ TrueHeading: 511, Sog: 102.3, Cog: 90.5 }), NOW)!.position!;
  assert.equal(o.heading, 90.5);
  assert.equal(o.speed, undefined);
  const none = parseAisEnvelope(positionReport({ TrueHeading: 511, Sog: 0, Cog: 360 }), NOW)!.position!;
  assert.equal(none.heading, undefined);
  assert.equal(none.speed, 0);
  assert.equal(none.props.cog, undefined);
  // 102.2 is a real (>=102.2 kn) reading
  assert.ok(parseAisEnvelope(positionReport({ Sog: 102.2 }), NOW)!.position!.speed! > 50);
});

test('sentinels: lat 91 / lon 181 and null island yield no position (MMSI still recognised)', () => {
  for (const bad of [{ Latitude: 91 }, { Longitude: 181 }, { Latitude: 0, Longitude: 0 }, { Latitude: -91 }]) {
    const p = parseAisEnvelope(positionReport(bad, { latitude: undefined, longitude: undefined }), NOW)!;
    assert.equal(p.mmsi, '366998410');
    assert.equal(p.position, undefined, JSON.stringify(bad));
  }
});

test('position falls back to MetaData coordinates and clamps future timestamps', () => {
  const env = positionReport({ Latitude: undefined, Longitude: undefined }, { latitude: 10, longitude: 20, time_utc: '2030-01-01 00:00:00 +0000 UTC' });
  const o = parseAisEnvelope(env, NOW)!.position!;
  assert.equal(o.lat, 10);
  assert.equal(o.lon, 20);
  assert.equal(o.t, NOW + 60_000);
});

test('ShipStaticData: name, call sign, IMO, type, dimensions, destination, ETA', () => {
  const env = {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: 235012345, ShipName: 'EVER GIVEN@@@@', latitude: 30, longitude: 32, time_utc: '2026-10-02 11:00:00 +0000 UTC' },
    Message: {
      ShipStaticData: {
        CallSign: 'H3RC@@@', Destination: 'ROTTERDAM@@@@@@@@@@@', Dimension: { A: 300, B: 100, C: 20, D: 38 },
        Eta: { Day: 14, Hour: 6, Minute: 30, Month: 10 }, FixType: 1, ImoNumber: 9811000, MaximumStaticDraught: 14.5,
        MessageID: 5, Name: 'EVER GIVEN          ', Type: 70, UserID: 235012345, Valid: true,
      },
    },
  };
  const p = parseAisEnvelope(env, NOW)!;
  assert.equal(p.position, undefined);
  assert.deepEqual(p.static, {
    name: 'EVER GIVEN', callsign: 'H3RC', imo: '9811000', shipType: 70, destination: 'ROTTERDAM', eta: '10-14 06:30Z',
    length: 400, beam: 58, draught: 14.5,
  });
  assert.deepEqual(staticProps(p.static!), {
    name: 'EVER GIVEN', callsign: 'H3RC', imo: '9811000', shipType: 70, category: 'Cargo', destination: 'ROTTERDAM', eta: '10-14 06:30Z', length: 400, beam: 58, draught: 14.5,
  });
});

test('static sentinels: unavailable ETA, zero IMO/type/dimensions are dropped', () => {
  const env = {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: 235012345 },
    Message: { ShipStaticData: { UserID: 235012345, Name: '@@@@@@@@', ImoNumber: 0, Type: 0, Eta: { Month: 0, Day: 0, Hour: 24, Minute: 60 }, Dimension: { A: 0, B: 0, C: 0, D: 0 }, Destination: '' } },
  };
  assert.equal(parseAisEnvelope(env, NOW)!.static, undefined);
  const partialEta = { ...env, Message: { ShipStaticData: { UserID: 235012345, Eta: { Month: 3, Day: 9, Hour: 24, Minute: 60 } } } };
  assert.equal(parseAisEnvelope(partialEta, NOW)!.static!.eta, '03-09');
});

test('StaticDataReport parts A and B', () => {
  const a = parseAisEnvelope({ MessageType: 'StaticDataReport', MetaData: { MMSI: 338123456 }, Message: { StaticDataReport: { UserID: 338123456, PartNumber: false, ReportA: { Name: 'SEA BREEZE@@@@@@@@', Valid: true }, ReportB: { Valid: false, ShipType: 0, CallSign: '' } } } }, NOW)!;
  assert.deepEqual(a.static, { name: 'SEA BREEZE' });
  const b = parseAisEnvelope({ MessageType: 'StaticDataReport', MetaData: { MMSI: 338123456 }, Message: { StaticDataReport: { UserID: 338123456, PartNumber: true, ReportA: { Name: '' }, ReportB: { ShipType: 37, CallSign: 'WDK1234', Dimension: { A: 8, B: 4, C: 2, D: 2 } } } } }, NOW)!;
  assert.deepEqual(b.static, { callsign: 'WDK1234', shipType: 37, length: 12, beam: 4 });
});

test('ExtendedClassBPositionReport yields both position and static', () => {
  const env = {
    MessageType: 'ExtendedClassBPositionReport',
    MetaData: { MMSI: 338000001, latitude: 40, longitude: -70, time_utc: '2026-10-02 11:59:59 +0000 UTC' },
    Message: { ExtendedClassBPositionReport: { UserID: 338000001, Latitude: 40, Longitude: -70, Sog: 5, Cog: 10, TrueHeading: 511, Name: 'LUCKY STAR@@', Type: 30 } },
  };
  const p = parseAisEnvelope(env, NOW)!;
  assert.equal(p.position!.heading, 10);
  assert.equal(p.static!.name, 'LUCKY STAR');
  assert.equal(p.static!.shipType, 30);
});

test('unrecognised or malformed envelopes are rejected', () => {
  for (const bad of [null, [], 'x', {}, { MessageType: 'AidsToNavigationReport', Message: { AidsToNavigationReport: { UserID: 123456789 } } }, { MessageType: 'PositionReport', Message: {} }, { MessageType: 'PositionReport', Message: { PositionReport: { UserID: 12 } } }, { MessageType: 'PositionReport', MetaData: {}, Message: { PositionReport: {} } }]) {
    assert.equal(parseAisEnvelope(bad, NOW), null, JSON.stringify(bad));
  }
});

test('shipCategory covers AIS type ranges', () => {
  assert.equal(shipCategory(70), 'Cargo');
  assert.equal(shipCategory(79), 'Cargo');
  assert.equal(shipCategory(84), 'Tanker');
  assert.equal(shipCategory(60), 'Passenger');
  assert.equal(shipCategory(30), 'Fishing');
  assert.equal(shipCategory(52), 'Tug or towing');
  assert.equal(shipCategory(36), 'Sailing');
  assert.equal(shipCategory(37), 'Pleasure craft');
  assert.equal(shipCategory(35), 'Military');
  assert.equal(shipCategory(45), 'High-speed craft');
  assert.equal(shipCategory(99), 'Other');
  assert.equal(shipCategory(0), undefined);
  assert.equal(shipCategory(undefined), undefined);
  assert.equal(shipCategory(150), undefined);
});

test('parseAisTime handles AISStream format and fallbacks', () => {
  assert.equal(parseAisTime('2022-12-29 18:22:32.318353 +0000 UTC', 5), Date.UTC(2022, 11, 29, 18, 22, 32, 318));
  assert.equal(parseAisTime('2022-12-29 18:22:32 +0000 UTC', 5), Date.UTC(2022, 11, 29, 18, 22, 32));
  assert.equal(parseAisTime('2022-12-29T18:22:32Z', 5), Date.UTC(2022, 11, 29, 18, 22, 32));
  assert.equal(parseAisTime('garbage', 5), 5);
  assert.equal(parseAisTime(undefined, 5), 5);
});

test('classifyAisError', () => {
  assert.equal(classifyAisError('Api Key Is Not Valid'), 'auth');
  assert.equal(classifyAisError('Unauthorized'), 'auth');
  assert.equal(classifyAisError('Too many connections'), 'rate');
  assert.equal(classifyAisError('something else'), 'transport');
});
