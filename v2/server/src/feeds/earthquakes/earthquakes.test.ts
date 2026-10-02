import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../../db/index.ts';
import { clock, manualTimers } from '../test-utils.ts';
import { buildQuakeDetail } from './detail.ts';
import { EarthquakesFeed, EARTHQUAKES_FRESHNESS_MS, USGS_URL } from './feed.ts';
import { parseUsgs, quakeLabel } from './parse.ts';

type Json = { metadata: { generated: number; count: number }; features: Array<{ id: string; properties: Record<string, any>; geometry: { type: string; coordinates: number[] } }> };
const fixture = (): Json => JSON.parse(readFileSync(new URL('./fixtures/usgs-all-day.json', import.meta.url), 'utf8'));
const GENERATED = fixture().metadata.generated;
const HOUR = 3_600_000;
const body = (j: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(j), { status: 200, ...init });

test('parses a real USGS all_day payload: labels, depth, flags and detail-only fields', () => {
  const snap = parseUsgs(fixture());
  assert.equal(snap.rows.length, 11);
  assert.equal(snap.skipped, 0);
  assert.equal(snap.generated, GENERATED);
  const gizo = snap.rows.find((r) => r.id === 'us6000tyzl')!;
  assert.deepEqual([gizo.lon, gizo.lat], [158.0215, -8.9326]);
  assert.equal(gizo.label, 'M 5.1');
  assert.deepEqual(gizo.props, { mag: 5.1, depthKm: 10, place: '159 km SE of Gizo, Solomon Islands', tsunami: false, alert: null, type: 'earthquake' });
  assert.equal(gizo.extra.magType, 'mb');
  assert.equal(gizo.extra.status, 'reviewed');
  assert.equal(gizo.updated, 1790917177040);
  // non-earthquake events are kept and typed
  assert.deepEqual(snap.rows.filter((r) => r.props.type !== 'earthquake').map((r) => r.props.type).sort(), ['explosion', 'explosion', 'quarry blast']);
  // negative depth (above sea level) is preserved
  assert.ok(snap.rows.some((r) => (r.props.depthKm as number) < 0));
  assert.equal(quakeLabel(4.6), 'M 4.6');
  assert.equal(quakeLabel(5), 'M 5.0');
});

test('edge cases: null magnitude, bad coordinates, duplicates and flags', () => {
  const j = fixture();
  const f = j.features;
  f[0]!.properties.mag = null;
  f[1]!.geometry.coordinates = [200, 10, 5];
  f[2]!.geometry.coordinates = [10];
  f[3]!.id = f[4]!.id; // duplicate id keeps the first
  f[5]!.properties.tsunami = 1;
  f[5]!.properties.alert = 'orange';
  f[6]!.properties.alert = 'purple'; // unknown PAGER value
  f[6]!.geometry.coordinates = [10, 20]; // depth missing
  f[7]!.properties.mag = 12; // impossible
  f[8]!.properties.time = null;
  const snap = parseUsgs(j);
  assert.equal(snap.skipped, 6);
  assert.equal(snap.rows.length, 5);
  const byId = new Map(snap.rows.map((r) => [r.id, r]));
  assert.equal(byId.get(f[5]!.id)!.props.tsunami, true);
  assert.equal(byId.get(f[5]!.id)!.props.alert, 'orange');
  assert.equal(byId.get(f[6]!.id)!.props.alert, null);
  assert.equal(byId.get(f[6]!.id)!.props.depthKm, null);
  assert.throws(() => parseUsgs({ features: 'x' }), /malformed/);
  assert.throws(() => parseUsgs(null), /malformed/);
  assert.deepEqual(parseUsgs({ features: [] }).rows, []);
});

function setup(responses: Array<() => Response | Promise<Response>>, opts: { retentionDays?: number } = {}) {
  const c = clock(GENERATED + 60_000);
  const db = openDb(':memory:');
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  let i = 0;
  const feed = new EarthquakesFeed({
    fetch: async (url, init) => {
      calls.push({ url, headers: init!.headers as Record<string, string> });
      return responses[Math.min(i++, responses.length - 1)]!();
    },
    repo: db.features,
    now: c.now,
    timers: manualTimers,
    ...opts,
  });
  return { feed, c, db, calls };
}

test('polls the USGS day feed, stores events, serves features with the 24 h default window', async () => {
  const { feed, db, calls } = setup([() => body(fixture())]);
  assert.equal(feed.status().state, 'off');
  feed.start();
  await feed.idle();
  assert.equal(calls[0]!.url, USGS_URL);
  assert.match(calls[0]!.headers['User-Agent']!, /gods-eye-view/);
  const st = feed.status();
  assert.equal(st.state, 'live');
  assert.equal(st.count, 11);
  assert.equal(st.source, 'USGS');
  assert.equal(st.freshnessMs, EARTHQUAKES_FRESHNESS_MS);
  assert.equal(db.features.count('earthquakes'), 11);

  const r = feed.features('earthquakes', { limit: 100 });
  assert.equal(r.truncated, false);
  assert.equal(r.features.length, 11);
  assert.equal(r.features[0]!.props.mag, 5.1); // biggest first
  assert.equal(r.features[0]!.geometry.type, 'Point');
  assert.equal((r.features[0]!.geometry as { coordinates: number[] }).coordinates.length, 2);
  assert.ok(r.features.every((f) => f.t! > GENERATED + 60_000 - 24 * HOUR));
  await feed.stop();
  assert.equal(feed.status().state, 'off');
});

test('revisions: the newest update wins; an older copy never overwrites; withdrawn events disappear', async () => {
  const first = fixture();
  const second = fixture();
  const target = second.features[0]!;
  target.properties.mag = 5.6;
  target.properties.updated += 120_000;
  target.properties.alert = 'yellow';
  target.properties.felt = 321;
  const stale = fixture(); // an out-of-order older copy
  stale.features[0]!.properties.mag = 4.0;
  const withdrawn = second.features.splice(-1)[0]!; // USGS deleted it
  const { feed, c, db } = setup([() => body(first), () => body(second), () => body(stale)]);
  feed.start();
  await feed.idle();
  assert.equal(db.features.get('earthquakes', target.id)!.props.mag, 5.1);
  assert.ok(db.features.get('earthquakes', withdrawn.id));

  c.advance(60_000);
  await feed.tick();
  const r = db.features.get('earthquakes', target.id)!;
  assert.equal(r.props.mag, 5.6);
  assert.equal(r.label, 'M 5.6');
  assert.equal(r.props.alert, 'yellow');
  assert.equal(r.extra.felt, 321);
  assert.equal(db.features.get('earthquakes', withdrawn.id), null);
  assert.equal(db.features.count('earthquakes'), 10);

  c.advance(60_000);
  await feed.tick();
  assert.equal(db.features.get('earthquakes', target.id)!.props.mag, 5.6, 'older revision ignored');
  await feed.stop();
});

test('history reaches beyond the live window: from/to queries return events that left the feed', async () => {
  const day1 = fixture();
  const day2 = { metadata: { ...day1.metadata, generated: GENERATED + 30 * HOUR }, features: day1.features.slice(0, 2).map((f) => ({ ...f, id: `${f.id}x`, properties: { ...f.properties, time: GENERATED + 29 * HOUR, updated: GENERATED + 29 * HOUR } })) };
  const { feed, c } = setup([() => body(day1), () => body(day2)]);
  feed.start();
  await feed.idle();
  c.set(GENERATED + 30 * HOUR);
  await feed.tick();
  // Events from day 1 are older than the day-2 feed window but stay in history.
  const now24 = feed.features('earthquakes', { limit: 100 });
  assert.equal(now24.features.length, 2, 'default window is the last 24 h');
  const past = feed.features('earthquakes', { from: GENERATED - 24 * HOUR, to: GENERATED + HOUR, limit: 100 });
  assert.equal(past.features.length, 11);
  const all = feed.features('earthquakes', { from: 0, limit: 100 });
  assert.equal(all.features.length, 13);
  // `to` alone: 24 h ending at `to`
  const ending = feed.features('earthquakes', { to: GENERATED, limit: 100 });
  assert.equal(ending.features.length, 11);
  // bbox + cap
  const capped = feed.features('earthquakes', { from: 0, bbox: [-180, -90, 180, 90], limit: 3 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.features.length, 3);
  const solomon = feed.features('earthquakes', { from: 0, bbox: [150, -20, -170, 0], limit: 100 });
  assert.ok(solomon.features.length >= 3 && solomon.features.every((f) => f.props.place && /Solomon|Lata|Gizo/.test(String(f.props.place))));
  await feed.stop();
});

test('errors: HTTP failure keeps data and backs off; Retry-After is honoured; 304 counts as success', async () => {
  const lastModified = 'Fri, 02 Oct 2026 14:22:08 GMT';
  const { feed, c, calls, db } = setup([
    () => body(fixture(), { headers: { 'last-modified': lastModified } }),
    () => new Response(null, { status: 304 }),
    () => new Response('busy', { status: 503, headers: { 'retry-after': '300' } }),
    () => new Response('<html>', { status: 200 }),
    () => body(fixture()),
  ]);
  feed.start();
  await feed.idle();
  assert.equal(calls[0]!.headers['If-Modified-Since'], undefined);
  c.advance(60_000);
  await feed.tick();
  assert.equal(calls[1]!.headers['If-Modified-Since'], lastModified);
  assert.equal(feed.status().state, 'live');
  assert.equal(feed.status().lastSuccess, c.now());

  c.advance(60_000);
  await feed.tick();
  let st = feed.status();
  assert.equal(st.state, 'error');
  assert.match(st.lastError!, /HTTP 503/);
  assert.equal(st.count, 11, 'previous data still served');
  assert.equal(feed.features('earthquakes', { from: 0, limit: 50 }).features.length, 11);
  c.advance(299_000);
  await feed.tick();
  assert.equal(calls.length, 3, 'waits out Retry-After');
  c.advance(1_000);
  await feed.tick();
  assert.equal(calls.length, 4);
  assert.match(feed.status().lastError!, /malformed JSON/);
  assert.equal(db.features.count('earthquakes'), 11, 'a bad payload deletes nothing');
  c.advance(10 * 60_000);
  await feed.tick();
  st = feed.status();
  assert.equal(st.state, 'live');
  assert.equal(st.lastError, null);
  await feed.stop();
});

test('an unusually quiet feed (zero events) is live and does not wipe history', async () => {
  const empty = { metadata: { generated: GENERATED + HOUR }, features: [] };
  const { feed, c, db } = setup([() => body(fixture()), () => body(empty)]);
  feed.start();
  await feed.idle();
  c.advance(60_000);
  await feed.tick();
  assert.equal(feed.status().state, 'live');
  assert.equal(feed.status().count, 0);
  assert.equal(db.features.count('earthquakes'), 11);
  await feed.stop();
});

test('staleness: data older than the freshness window reports stale', async () => {
  const { feed, c } = setup([() => body(fixture())]);
  feed.start();
  await feed.idle();
  c.advance(EARTHQUAKES_FRESHNESS_MS + 1);
  assert.equal(feed.status().state, 'stale');
  await feed.stop();
});

test('retention prunes events older than the configured days', async () => {
  const old = fixture();
  old.features = old.features.slice(0, 2);
  const { feed, c, db } = setup([() => body(fixture()), () => body({ metadata: { generated: GENERATED + 3 * 86_400_000 }, features: [fixture().features[0]] })], { retentionDays: 2 });
  feed.start();
  await feed.idle();
  c.set(GENERATED + 3 * 86_400_000);
  // jump past the hourly prune gate
  await feed.tick();
  assert.ok(db.features.count('earthquakes') <= 1, `old events pruned, got ${db.features.count('earthquakes')}`);
  await feed.stop();
});

test('detail: sections, relative time, PAGER, tsunami flag semantics and event link', async () => {
  const j = fixture();
  const f = j.features[0]!;
  f.properties.alert = 'orange';
  f.properties.felt = 1204;
  f.properties.cdi = 6.2;
  f.properties.mmi = 6.8;
  f.properties.tsunami = 1;
  const { feed, c } = setup([() => body(j)]);
  feed.start();
  await feed.idle();
  const d = (await feed.featureDetail('earthquakes', f.id))!;
  assert.equal(d.layer, 'earthquakes');
  assert.equal(d.featureId, f.id);
  assert.equal(d.title, 'M 5.1 earthquake');
  assert.equal(d.subtitle, '159 km SE of Gizo, Solomon Islands');
  assert.equal(d.url, `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`);
  assert.deepEqual(d.sources, ['USGS Earthquake Hazards Program']);
  const rows = new Map(d.sections.flatMap((s) => s.rows).map((r) => [r.label, r]));
  assert.equal(rows.get('Magnitude')!.value, '5.1');
  assert.equal(rows.get('Magnitude')!.hint, 'mb');
  assert.equal(rows.get('Depth')!.value, '10.0 km');
  assert.equal(rows.get('Felt reports')!.value, 1204);
  assert.equal(rows.get('PAGER alert')!.value, 'ORANGE');
  assert.match(rows.get('PAGER alert')!.hint!, /significant damage/);
  assert.equal(rows.get('Tsunami flag')!.value, 'Set');
  assert.match(rows.get('Tsunami flag')!.hint!, /does not mean a tsunami occurred/);
  assert.match(rows.get('Time (UTC)')!.value as string, /^2026-10-02 \d\d:\d\d:\d\dZ$/);
  assert.match(rows.get('Time (UTC)')!.hint!, /h .*ago|min ago/);
  assert.equal(rows.get('Event ID')!.value, f.id);
  assert.equal(await feed.featureDetail('earthquakes', 'nope'), null);
  c.advance(0);
  await feed.stop();
});

test('detail still renders sparse events (no felt/network fields)', () => {
  const r = parseUsgs({ features: [{ id: 'xx1', properties: { mag: 2.5, time: 1000, updated: 1000, place: null, tsunami: 0 }, geometry: { type: 'Point', coordinates: [1, 2] } }] }).rows[0]!;
  const d = buildQuakeDetail(r, 2000);
  assert.equal(d.title, 'M 2.5 earthquake');
  assert.equal(d.subtitle, null);
  assert.ok(d.url!.endsWith('/xx1'));
  const labels = d.sections.flatMap((s) => s.rows.map((x) => x.label));
  assert.ok(!labels.includes('Felt reports'));
  assert.ok(labels.includes('Coordinates'));
});
