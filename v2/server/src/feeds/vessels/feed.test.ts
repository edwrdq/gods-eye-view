import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Observation } from '@gev/shared';
import { clock, manualTimers } from '../test-utils.ts';
import { VesselsFeed, type VesselsFeedDeps, type WebSocketLike } from './feed.ts';

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  binaryType?: string;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onclose: WebSocketLike['onclose'] = null;
  sent: string[] = [];
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({});
  }
  message(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  drop() {
    this.onclose?.({});
  }
}

const MMSI = 366998410;
function pos(mmsi: number, t: number, over: Record<string, unknown> = {}, lat = 37.8, lon = -122.4) {
  return {
    MessageType: 'PositionReport',
    MetaData: { MMSI: mmsi, latitude: lat, longitude: lon, time_utc: new Date(t).toISOString().replace('T', ' ').replace('Z', ' +0000 UTC') },
    Message: { PositionReport: { UserID: mmsi, Latitude: lat, Longitude: lon, Sog: 10, Cog: 90, TrueHeading: 90, NavigationalStatus: 0, ...over } },
  };
}
const staticMsg = (mmsi: number, over: Record<string, unknown> = {}) => ({
  MessageType: 'ShipStaticData',
  MetaData: { MMSI: mmsi },
  Message: { ShipStaticData: { UserID: mmsi, Name: 'TEST SHIP@@', Type: 80, Destination: 'ROTTERDAM', ...over } },
});

function setup(over: Partial<VesselsFeedDeps> = {}) {
  FakeSocket.all = [];
  const c = clock(1_760_000_000_000);
  const stored: Observation[][] = [];
  const feed = new VesselsFeed({
    apiKey: 'key',
    WebSocket: FakeSocket as unknown as VesselsFeedDeps['WebSocket'],
    now: c.now,
    timers: manualTimers,
    store: (b) => void stored.push(b),
    ...over,
  });
  const sock = () => FakeSocket.all[FakeSocket.all.length - 1]!;
  return { feed, c, stored, sock };
}

test('without a key the feed reports needs-key and never connects', async () => {
  const { feed } = setup({ apiKey: null });
  assert.equal(feed.status().state, 'needs-key');
  feed.start();
  feed.tick();
  assert.equal(FakeSocket.all.length, 0);
  assert.equal(feed.status().state, 'needs-key');
  await feed.stop();
});

test('connects, subscribes with key/boxes/types, and goes live on the first record', () => {
  const { feed, sock } = setup({ boundingBoxes: [[[0, 0], [10, 10]]] });
  assert.equal(feed.status().state, 'off');
  feed.start();
  assert.equal(feed.status().state, 'stale'); // running, nothing yet
  const s = sock();
  assert.equal(s.url, 'wss://stream.aisstream.io/v0/stream');
  assert.equal(s.binaryType, 'arraybuffer');
  s.open();
  const sub = JSON.parse(s.sent[0]!);
  assert.equal(sub.APIKey, 'key');
  assert.deepEqual(sub.BoundingBoxes, [[[0, 0], [10, 10]]]);
  assert.deepEqual(sub.FilterMessageTypes, ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport']);
  s.message(pos(MMSI, 1_760_000_000_000));
  const st = feed.status();
  assert.equal(st.state, 'live');
  assert.equal(st.count, 1);
  assert.equal(st.source, 'AISStream');
  assert.equal(st.lastSuccess, 1_760_000_000_000);
});

test('static data merges into positions in either order and survives later position updates', () => {
  const { feed, sock, c } = setup();
  feed.start();
  sock().open();
  // position first, name arrives later
  sock().message(pos(MMSI, c.now()));
  assert.equal(feed.live.get(String(MMSI))!.props.name, undefined);
  sock().message(staticMsg(MMSI));
  let o = feed.live.get(String(MMSI))!;
  assert.equal(o.props.name, 'TEST SHIP');
  assert.equal(o.props.category, 'Tanker');
  assert.equal(o.props.destination, 'ROTTERDAM');
  // static first, then position for another vessel
  sock().message(staticMsg(111222333, { Name: 'EARLY BIRD' }));
  assert.equal(feed.live.get('111222333'), undefined);
  c.advance(1000);
  sock().message(pos(111222333, c.now()));
  assert.equal(feed.live.get('111222333')!.props.name, 'EARLY BIRD');
  // a later position keeps static props
  c.advance(1000);
  sock().message(pos(MMSI, c.now()));
  o = feed.live.get(String(MMSI))!;
  assert.equal(o.props.name, 'TEST SHIP');
  // partial static update (part B only) does not erase the name
  sock().message({ MessageType: 'StaticDataReport', MetaData: { MMSI }, Message: { StaticDataReport: { UserID: MMSI, ReportB: { ShipType: 70, CallSign: 'ABC' } } } });
  o = feed.live.get(String(MMSI))!;
  assert.equal(o.props.name, 'TEST SHIP');
  assert.equal(o.props.category, 'Cargo');
  assert.equal(o.props.callsign, 'ABC');
  // snapshots only expose compact props
  const snap = feed.live.query({ limit: 10 }).objects.find((x) => x.objectId === String(MMSI))!;
  assert.deepEqual(Object.keys(snap.props).sort(), ['category', 'name', 'navStatus']);
});

test('history rows are throttled and flushed in batches on tick', () => {
  const { feed, sock, c, stored } = setup();
  feed.start();
  sock().open();
  for (let i = 0; i < 50; i++) sock().message(pos(200000000 + i, c.now()));
  assert.equal(stored.length, 0, 'nothing written per message');
  c.advance(5000);
  feed.tick();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.length, 50);
  // repeated reports from stationary vessels inside the heartbeat are not stored
  for (let k = 0; k < 10; k++) {
    c.advance(5000);
    for (let i = 0; i < 50; i++) sock().message(pos(200000000 + i, c.now()));
    feed.tick();
  }
  assert.equal(stored.length, 1);
  // beyond the 5 min heartbeat they are
  c.advance(260_000);
  for (let i = 0; i < 50; i++) sock().message(pos(200000000 + i, c.now()));
  feed.tick();
  assert.equal(stored.length, 2);
  assert.equal(stored[1]!.length, 50);
});

test('moored vessels (speed ~0) are stored every 15 minutes, moving ones every 5', () => {
  const { feed, sock, c, stored } = setup();
  feed.start();
  sock().open();
  const report = () => {
    sock().message(pos(111111111, c.now(), { Sog: 0, Cog: 360, TrueHeading: 511 }));
    sock().message(pos(222222222, c.now(), { Sog: 8 }));
    feed.tick();
  };
  report();
  assert.equal(stored[0]!.length, 2);
  for (let i = 0; i < 4; i++) {
    c.advance(3 * 60_000);
    report();
  } // 12 min: the mover was written at 6 and 12 min, the moored vessel not yet
  const ids = stored.slice(1).flat().map((o) => o.objectId);
  assert.deepEqual(ids, ['222222222', '222222222']);
  c.advance(4 * 60_000);
  report(); // 16 min since the first write
  assert.ok(stored.flat().some((o, i) => i > 0 && o.objectId === '111111111'));
});

test('vessels expire after 30 minutes without reports', () => {
  const { feed, sock, c } = setup();
  feed.start();
  sock().open();
  sock().message(pos(MMSI, c.now()));
  sock().message(pos(111222333, c.now()));
  c.advance(20 * 60_000);
  sock().message(pos(111222333, c.now()));
  c.advance(11 * 60_000);
  feed.tick();
  assert.equal(feed.live.get(String(MMSI)), undefined);
  assert.ok(feed.live.get('111222333'));
});

test('invalid positions never reach the live picture, but the feed counts as alive', () => {
  const { feed, sock, c } = setup();
  feed.start();
  sock().open();
  sock().message(pos(MMSI, c.now(), { Latitude: 91, Longitude: 181 }, undefined, undefined));
  assert.equal(feed.live.size, 0);
  assert.equal(feed.status().state, 'live');
  sock().message('not json');
  sock().message({ MessageType: 'Unknown' });
  assert.equal(feed.live.size, 0);
});

test('binary frames (ArrayBuffer) are decoded', () => {
  const { feed, sock, c } = setup();
  feed.start();
  sock().open();
  const bytes = new TextEncoder().encode(JSON.stringify(pos(MMSI, c.now())));
  sock().onmessage!({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  assert.equal(feed.live.size, 1);
});

test('reconnects with a backoff ladder after drops, and resets it after data', () => {
  const { feed, sock, c } = setup();
  feed.start();
  assert.equal(FakeSocket.all.length, 1);
  sock().drop(); // attempt 0 -> wait 5 s
  assert.equal(feed.status().state, 'error');
  c.advance(4000);
  feed.tick();
  assert.equal(FakeSocket.all.length, 1);
  c.advance(1500);
  feed.tick();
  assert.equal(FakeSocket.all.length, 2);
  sock().drop(); // 15 s
  c.advance(14_000);
  feed.tick();
  assert.equal(FakeSocket.all.length, 2);
  c.advance(1500);
  feed.tick();
  assert.equal(FakeSocket.all.length, 3);
  sock().drop(); // 60 s
  c.advance(59_000);
  feed.tick();
  assert.equal(FakeSocket.all.length, 3);
  c.advance(2000);
  feed.tick();
  assert.equal(FakeSocket.all.length, 4);
  sock().open();
  sock().message(pos(MMSI, c.now()));
  assert.equal(feed.status().state, 'live');
  sock().drop(); // ladder reset -> 5 s again
  c.advance(5500);
  feed.tick();
  assert.equal(FakeSocket.all.length, 5);
});

test('auth error frame: error state, socket closed, retried only after an hour', () => {
  const { feed, sock, c } = setup();
  feed.start();
  const s = sock();
  s.open();
  s.message({ error: 'Api Key Is Not Valid' });
  assert.equal(s.closed, true);
  const st = feed.status();
  assert.equal(st.state, 'error');
  assert.match(st.lastError!, /Api Key Is Not Valid/);
  c.advance(30 * 60_000);
  feed.tick();
  assert.equal(FakeSocket.all.length, 1);
  c.advance(31 * 60_000);
  feed.tick();
  assert.equal(FakeSocket.all.length, 2);
});

test('rate-limit error frame waits five minutes', () => {
  const { feed, sock, c } = setup();
  feed.start();
  sock().open();
  sock().message({ error: 'Too many connections' });
  c.advance(4 * 60_000);
  feed.tick();
  assert.equal(FakeSocket.all.length, 1);
  c.advance(61_000);
  feed.tick();
  assert.equal(FakeSocket.all.length, 2);
});

test('silence watchdog: reports after 120 s, recycles the socket after 300 s, ignores the old socket', () => {
  const { feed, sock, c } = setup();
  feed.start();
  const first = sock();
  first.open();
  first.message(pos(MMSI, c.now()));
  c.advance(100_000);
  feed.tick();
  assert.equal(feed.status().state, 'live');
  c.advance(30_000); // 130 s of silence
  feed.tick();
  assert.match(feed.status().lastError!, /No AIS records/);
  assert.equal(feed.status().state, 'error');
  assert.equal(FakeSocket.all.length, 1);
  c.advance(180_000); // 310 s > 300 s
  feed.tick();
  assert.equal(first.closed, true);
  assert.equal(FakeSocket.all.length, 1); // paused briefly before reconnecting
  c.advance(5500);
  feed.tick();
  assert.equal(FakeSocket.all.length, 2);
  // late events from the abandoned socket are ignored
  first.message(pos(999000111, c.now()));
  first.drop();
  assert.equal(feed.live.get('999000111'), undefined);
  assert.equal(FakeSocket.all.length, 2);
  sock().open();
  sock().message(pos(MMSI, c.now()));
  assert.equal(feed.status().state, 'live');
});

test('silence watchdog can be disabled', () => {
  const { feed, sock, c } = setup({ silenceReportMs: 0 });
  feed.start();
  sock().open();
  c.advance(3_600_000);
  feed.tick();
  assert.equal(FakeSocket.all.length, 1);
  assert.equal(sock().closed, false);
});

test('live picture is capped at 50 000 vessels', () => {
  const { feed, sock, c } = setup();
  feed.start();
  sock().open();
  for (let i = 0; i < 50_010; i++) sock().message(pos(100000000 + i, c.now(), {}, (i % 170) - 85, (i % 350) - 175));
  assert.equal(feed.live.size, 50_000);
  assert.equal(feed.live.get('100000000'), undefined);
  assert.ok(feed.live.get('100050009'));
});

test('stop closes the socket, flushes pending history and reports off', async () => {
  const { feed, sock, c, stored } = setup();
  feed.start();
  const s = sock();
  s.open();
  s.message(pos(MMSI, c.now()));
  await feed.stop();
  assert.equal(s.closed, true);
  assert.equal(stored.length, 1);
  assert.equal(feed.status().state, 'off');
});

test('vessel detail sections', async () => {
  const { feed, sock, c } = setup();
  feed.start();
  sock().open();
  sock().message(staticMsg(MMSI, { Dimension: { A: 200, B: 50, C: 10, D: 20 }, ImoNumber: 9000001, CallSign: 'XYZ', Eta: { Month: 10, Day: 14, Hour: 6, Minute: 30 }, MaximumStaticDraught: 12.5 }));
  sock().message(pos(MMSI, c.now(), { Sog: 12.3, Cog: 211.4, TrueHeading: 215 }));
  const d = await feed.detail('vessels', feed.live.get(String(MMSI))!, false);
  assert.equal(d.title, 'TEST SHIP');
  assert.equal(d.subtitle, 'Tanker · to ROTTERDAM');
  assert.deepEqual(d.sections.map((s) => s.title), ['Position', 'Vessel', 'Voyage', 'Source']);
  const flat = Object.fromEntries(d.sections.flatMap((s) => s.rows).map((r) => [r.label, r]));
  assert.equal(flat['Speed over ground']!.value, '12.3 kt');
  assert.equal(flat['Course over ground']!.value, '211°');
  assert.equal(flat.Heading!.value, '215°');
  assert.equal(flat.MMSI!.value, String(MMSI));
  assert.equal(flat.Length!.value, '250 m');
  assert.equal(flat.Beam!.value, '30 m');
  assert.equal(flat.ETA!.value, '10-14 06:30Z');
  assert.equal(flat.Status!.value, 'Under way using engine');
  // unnamed vessels fall back to MMSI
  const bare = await feed.detail('vessels', { layer: 'vessels', objectId: '123456789', t: 0, lon: 0, lat: 1, props: {} }, true);
  assert.equal(bare.title, 'MMSI 123456789');
});
