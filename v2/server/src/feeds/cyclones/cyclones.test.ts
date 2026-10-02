import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Feature } from '@gev/shared';
import { clock, manualTimers } from '../test-utils.ts';
import { CyclonesFeed, CYCLONES_EXPIRY_MS, CYCLONES_FRESHNESS_MS } from './feed.ts';
import {
  assembleGeometry,
  hurricaneCategory,
  normaliseAdvisory,
  parseCurrentStorms,
  parseForecastLayer,
  parsePastPoints,
  splitAtAntimeridian,
  stormCategory,
  stormFeatures,
} from './parse.ts';

const fx = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-02T14:30:00Z');
const json = (b: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(b), { status: 200, ...init });

test('normaliseAdvisory and categories', () => {
  assert.equal(normaliseAdvisory('047a'), '47A');
  assert.equal(normaliseAdvisory('021'), '21');
  assert.equal(normaliseAdvisory('0'), '0');
  assert.equal(normaliseAdvisory('abc'), null);
  assert.equal(normaliseAdvisory(21), null);
  assert.deepEqual([63, 64, 82, 83, 96, 113, 137, 190].map(hurricaneCategory), [null, 1, 1, 2, 3, 4, 5, 5]);
  assert.equal(stormCategory('HU', 100), 'H3');
  assert.equal(stormCategory('TS', 55), 'TS');
  assert.equal(stormCategory('PTC', 30), 'PTC');
  assert.equal(stormCategory('HU', null), 'HU');
});

test('parses the real CurrentStorms.json: two Pacific storms, public advisory numbers', () => {
  const { storms, skipped } = parseCurrentStorms(fx('current-storms'));
  assert.equal(skipped, 0);
  assert.deepEqual(storms.map((s) => [s.id, s.name, s.classification, s.basin, s.advisoryNumber, s.windKt, s.pressureMb]), [
    ['ep182026', 'Rachel', 'HU', 'EP', '21', 100, 955],
    ['ep152026', 'Nolo', 'TS', 'EP', '47A', 55, 990],
  ]);
  const nolo = storms[1]!;
  assert.equal(nolo.positionAt, Date.parse('2026-10-02T12:00:00Z'));
  assert.equal(nolo.lon, -166.9);
  assert.equal(nolo.advisoryUrl, 'https://www.nhc.noaa.gov/text/HFOTCPCP2.shtml');
});

test('CurrentStorms edge cases: empty season, bad records skipped, foreign links dropped', () => {
  assert.deepEqual(parseCurrentStorms({ activeStorms: [] }), { storms: [], skipped: 0 });
  assert.throws(() => parseCurrentStorms({}), /malformed/);
  assert.throws(() => parseCurrentStorms(null), /malformed/);
  const j = fx('current-storms');
  j.activeStorms[0].id = 'xx999999';
  j.activeStorms[1].publicAdvisory.url = 'https://evil.example/text/x.shtml';
  j.activeStorms[1].intensity = 'unknown';
  const r = parseCurrentStorms(j);
  assert.equal(r.skipped, 1);
  assert.equal(r.storms.length, 1);
  assert.match(r.storms[0]!.advisoryUrl!, /^https:\/\/www\.nhc\.noaa\.gov\/text\/HFO/, 'foreign link dropped, official forecast link used');
  assert.equal(r.storms[0]!.windKt, null);
});

test('GIS layers: forecast points, track (incl. MultiLineString), cone (incl. MultiPolygon)', () => {
  const pts = parseForecastLayer(fx('gis-points'), 'points');
  assert.equal(pts.length, 18);
  assert.deepEqual(pts.filter((p) => p.stormId === 'ep182026').map((p) => p.tauHours), [0, 12, 24, 36, 48, 60, 72, 96, 120]);
  assert.equal(pts[0]!.advisoryNumber, '21');
  assert.equal(pts[0]!.windKt, 100);
  const track = parseForecastLayer(fx('gis-track'), 'track');
  assert.deepEqual(track.map((t) => [t.stormId, t.advisoryNumber, t.geometry.type]), [['ep182026', '21', 'LineString'], ['ep152026', '47A', 'MultiLineString']]);
  const cone = parseForecastLayer(fx('gis-cone'), 'cone');
  assert.deepEqual(cone.map((t) => t.geometry.type).sort(), ['MultiPolygon', 'Polygon']);
  // wrong layer kind for the data yields nothing rather than garbage
  assert.deepEqual(parseForecastLayer(fx('gis-track'), 'cone'), []);
  assert.throws(() => parseForecastLayer({ type: 'FeatureCollection', features: [], exceededTransferLimit: true }, 'cone'), /malformed/);
  assert.throws(() => parseForecastLayer({ error: { code: 400 } }, 'points'), /malformed/);
});

test('past points are time ordered per storm; antimeridian splitting', () => {
  const past = parsePastPoints(fx('gis-past-points'));
  assert.deepEqual([...past.keys()].sort(), ['ep152026', 'ep182026']);
  const rachel = past.get('ep182026')!;
  assert.ok(rachel.length > 5);
  assert.ok(rachel.every((p, i) => i === 0 || p.t >= rachel[i - 1]!.t));
  assert.ok(rachel[0]!.t > Date.parse('2026-09-01'));

  assert.equal(splitAtAntimeridian([[10, 0]]), null);
  assert.deepEqual(splitAtAntimeridian([[10, 0], [20, 5]]), { type: 'LineString', coordinates: [[10, 0], [20, 5]] });
  const g = splitAtAntimeridian([[170, 10], [178, 12], [-178, 14], [-170, 15]]) as { type: string; coordinates: number[][][] };
  assert.equal(g.type, 'MultiLineString');
  assert.deepEqual(g.coordinates[0]!.slice(0, 2), [[170, 10], [178, 12]]);
  assert.equal(g.coordinates[0]![2]![0], 180);
  assert.equal(g.coordinates[1]![0]![0], -180);
  assert.equal(g.coordinates[0]![2]![1], g.coordinates[1]![0]![1]);
  assert.ok(g.coordinates[0]![2]![1]! > 12 && g.coordinates[0]![2]![1]! < 14);
  const west = splitAtAntimeridian([[-170, 0], [170, 4]]) as { coordinates: number[][][] };
  assert.equal(west.coordinates[0]![1]![0], -180);
  assert.equal(west.coordinates[1]![0]![0], 180);
});

function stormsAndGeometry() {
  const { storms } = parseCurrentStorms(fx('current-storms'));
  const layers = {
    points: parseForecastLayer(fx('gis-points'), 'points'),
    track: parseForecastLayer(fx('gis-track'), 'track'),
    cone: parseForecastLayer(fx('gis-cone'), 'cone'),
  };
  return { storms, layers, past: parsePastPoints(fx('gis-past-points')) };
}

test('geometry attaches only for the matching advisory (public advisory 047A, not forecast 047)', () => {
  const { storms, layers, past } = stormsAndGeometry();
  const g = assembleGeometry(storms, layers, past);
  assert.equal(g.size, 2);
  assert.equal(g.get('ep152026')!.cone.length, 2, 'MultiPolygon cone split at the dateline');
  assert.equal(g.get('ep152026')!.forecastLine!.type, 'MultiLineString');
  // A newer status advisory must not borrow the older forecast.
  const newer = storms.map((s) => (s.id === 'ep182026' ? { ...s, advisoryNumber: '22' } : s));
  const g2 = assembleGeometry(newer, layers, null);
  assert.equal(g2.has('ep182026'), false);
  assert.equal(g2.has('ep152026'), true);
  assert.equal(g2.get('ep152026')!.pastTrack, null);
});

test('storm features: ids, parts, forecast times from the advisory, categories', () => {
  const { storms, layers, past } = stormsAndGeometry();
  const g = assembleGeometry(storms, layers, past);
  const rachel = storms[0]!;
  const fs = stormFeatures(rachel, g.get(rachel.id));
  const by = (id: string) => fs.find((f) => f.id === id)!;
  assert.deepEqual(by('ep182026:position').props, { stormId: 'ep182026', name: 'Rachel', intensityKt: 100, category: 'H3', basin: 'EP', part: 'position', movementDir: 270, movementKt: 5 });
  assert.equal(by('ep182026:position').label, 'Rachel');
  assert.equal(by('ep182026:position').t, rachel.positionAt);
  assert.equal(by('ep182026:forecast').props.part, 'forecast');
  assert.equal(by('ep182026:forecast').geometry.type, 'LineString');
  assert.equal(by('ep182026:cone').geometry.type, 'Polygon');
  assert.equal(by('ep182026:track').props.part, 'track');
  const p24 = by('ep182026:forecast:24');
  assert.equal(p24.t, rachel.issuedAt + 24 * 3_600_000);
  assert.equal(p24.props.tauHours, 24);
  assert.equal(p24.props.intensityKt, 95);
  assert.equal(p24.props.category, 'H2');
  assert.equal(p24.label, '+24 h');
  assert.equal(fs.some((f) => f.id === 'ep182026:forecast:0'), false, 'current position is not duplicated');
  // past track ends at the current position
  const track = by('ep182026:track').geometry as { coordinates: number[][] };
  assert.deepEqual(track.coordinates[track.coordinates.length - 1], [-110.4, 19.4]);
  // without geometry only the position remains
  assert.deepEqual(stormFeatures(rachel, undefined).map((f) => f.id), ['ep182026:position']);
});

interface Routes {
  status?: () => Response;
  gis?: Partial<Record<'5' | '6' | '7' | '10', () => Response>>;
}
function setup(r: Routes = {}) {
  const c = clock(NOW);
  const calls: string[] = [];
  const route: Routes = { status: () => json(fx('current-storms')), gis: {}, ...r };
  const defaults: Record<string, () => Response> = {
    '5': () => json(fx('gis-points')),
    '6': () => json(fx('gis-track')),
    '7': () => json(fx('gis-cone')),
    '10': () => json(fx('gis-past-points')),
  };
  const feed = new CyclonesFeed({
    fetch: async (url) => {
      calls.push(url);
      if (url.includes('CurrentStorms.json')) return route.status!();
      const m = url.match(/MapServer\/(\d+)\/query/);
      const h = m && ((route.gis as any)[m[1]!] ?? defaults[m[1]!]);
      if (!h) throw new Error(`unexpected ${url}`);
      return h();
    },
    now: c.now,
    timers: manualTimers,
  });
  return { feed, c, calls };
}

test('polls status then forecast layers and past track; serves features; count is storms', async () => {
  const { feed, calls } = setup();
  feed.start();
  await feed.idle();
  assert.equal(calls.length, 5);
  assert.equal(calls[0], 'https://www.nhc.noaa.gov/CurrentStorms.json');
  assert.ok(calls[1]!.includes('/MapServer/5/query?') && calls[1]!.includes('f=geojson'));
  assert.ok(decodeURIComponent(calls[4]!.replaceAll('+', ' ')).includes("idp_source IN ('EP182026_pts','EP152026_pts')"));
  const st = feed.status();
  assert.equal(st.state, 'live');
  assert.equal(st.count, 2);
  assert.equal(st.lastError, null);
  assert.equal(st.freshnessMs, CYCLONES_FRESHNESS_MS);
  const r = feed.features('cyclones', { limit: 1000 });
  assert.equal(r.truncated, false);
  assert.equal(r.features.length, 12 + 13);
  assert.equal(new Set(r.features.map((f) => f.id)).size, r.features.length);
  await feed.stop();
});

test('empty season is live with zero features and fetches no GIS layers', async () => {
  const { feed, calls } = setup({ status: () => json({ activeStorms: [], lastUpdated: '2026-02-01' }) });
  feed.start();
  await feed.idle();
  assert.equal(calls.length, 1);
  const st = feed.status();
  assert.equal(st.state, 'live');
  assert.equal(st.count, 0);
  assert.equal(st.lastError, null);
  assert.deepEqual(feed.features('cyclones', { limit: 10 }), { features: [], truncated: false });
  await feed.stop();
});

test('bbox filtering includes lines and cones, handles the antimeridian, and caps with truncation', async () => {
  const { feed } = setup();
  feed.start();
  await feed.idle();
  const ids = (bbox: [number, number, number, number]) => new Set(feed.features('cyclones', { bbox, limit: 1000 }).features.map((f) => f.id.split(':')[0]));
  assert.deepEqual([...ids([-125, 10, -100, 30])], ['ep182026']);
  assert.deepEqual([...ids([-170, 20, -160, 30])], ['ep152026']);
  // Nolo's forecast track and cone run through the dateline
  const dateline = feed.features('cyclones', { bbox: [175, 20, -175, 30], limit: 1000 }).features;
  assert.ok(dateline.some((f) => f.id === 'ep152026:cone'));
  assert.ok(dateline.some((f) => f.id === 'ep152026:forecast'));
  assert.ok(dateline.every((f) => f.id.startsWith('ep152026')));
  assert.equal(ids([0, -60, 20, -50]).size, 0);
  const capped = feed.features('cyclones', { limit: 5 });
  assert.equal(capped.features.length, 5);
  assert.equal(capped.truncated, true);
  await feed.stop();
});

test('a requested `to` before the advisory hides that storm (no history is kept)', async () => {
  const { feed } = setup();
  feed.start();
  await feed.idle();
  const hide = feed.features('cyclones', { to: Date.parse('2026-10-02T10:00:00Z'), limit: 1000 }).features;
  assert.ok(hide.length > 0 && hide.every((f) => f.id.startsWith('ep182026')), 'Nolo (12:00Z) hidden, Rachel (09:00Z) shown');
  assert.equal(feed.features('cyclones', { to: Date.parse('2026-10-01T00:00:00Z'), limit: 1000 }).features.length, 0);
  assert.ok(feed.features('cyclones', { from: 0, to: NOW, limit: 1000 }).features.length > 20);
  await feed.stop();
});

test('GIS outage: positions still shown with a note; last good shapes kept for the same advisory', async () => {
  let fail = false;
  const { feed, c } = setup({
    gis: {
      '5': () => (fail ? new Response('down', { status: 500 }) : json(fx('gis-points'))),
      '6': () => json(fx('gis-track')),
      '7': () => json(fx('gis-cone')),
    },
  });
  feed.start();
  await feed.idle();
  const full = feed.features('cyclones', { limit: 1000 }).features.length;
  fail = true;
  c.advance(15 * 60_000);
  await feed.tick();
  let st = feed.status();
  assert.equal(st.state, 'live', 'status feed worked');
  assert.match(st.lastError!, /Forecast track and cone unavailable/);
  assert.equal(feed.features('cyclones', { limit: 1000 }).features.length, full, 'same advisory: shapes retained');

  await feed.stop();
});

test('new advisory without GIS data shows the position alone, never an older forecast', async () => {
  let advisory = '021';
  let gisDown = false;
  const { feed, c } = setup({
    status: () => {
      const j = fx('current-storms');
      j.activeStorms[0].publicAdvisory.advNum = advisory;
      return json(j);
    },
    gis: {
      '5': () => (gisDown ? new Response('x', { status: 503 }) : json(fx('gis-points'))),
    },
  });
  feed.start();
  await feed.idle();
  advisory = '022';
  gisDown = true;
  c.advance(15 * 60_000);
  await feed.tick();
  const rachel = feed.features('cyclones', { limit: 1000 }).features.filter((f) => f.id.startsWith('ep182026'));
  assert.deepEqual(rachel.map((f) => f.id), ['ep182026:position']);
  await feed.stop();
});

test('status outage keeps storms until the expiry, then clears them; recovery returns to live', async () => {
  let down = false;
  const { feed, c } = setup({ status: () => (down ? new Response('x', { status: 502 }) : json(fx('current-storms'))) });
  feed.start();
  await feed.idle();
  down = true;
  c.advance(15 * 60_000);
  await feed.tick();
  assert.equal(feed.status().state, 'error');
  assert.match(feed.status().lastError!, /HTTP 502/);
  assert.ok(feed.features('cyclones', { limit: 1000 }).features.length > 0, 'cached storms still served');
  c.advance(CYCLONES_EXPIRY_MS);
  assert.equal(feed.features('cyclones', { limit: 1000 }).features.length, 0);
  assert.equal(feed.status().count, 0);
  down = false;
  for (let i = 0; i < 6; i++) {
    c.advance(10 * 60_000);
    await feed.tick();
  }
  assert.equal(feed.status().state, 'live');
  assert.ok(feed.features('cyclones', { limit: 1000 }).features.length > 0);
  await feed.stop();
});

test('malformed status payload is an error and keeps previous storms', async () => {
  let bad = false;
  const { feed, c } = setup({ status: () => (bad ? json({ nope: true }) : json(fx('current-storms'))) });
  feed.start();
  await feed.idle();
  bad = true;
  c.advance(15 * 60_000);
  await feed.tick();
  assert.equal(feed.status().state, 'error');
  assert.match(feed.status().lastError!, /malformed NHC/);
  assert.equal(feed.status().count, 2);
  await feed.stop();
});

test('detail for any part of a storm: current conditions, forecast list, links, CPHC attribution', async () => {
  const { feed } = setup();
  feed.start();
  await feed.idle();
  const d = (await feed.featureDetail('cyclones', 'ep182026:forecast:48'))!;
  assert.equal(d.featureId, 'ep182026:forecast:48');
  assert.equal(d.feature.id, 'ep182026:forecast:48');
  assert.equal(d.title, 'Hurricane Rachel');
  assert.equal(d.subtitle, 'Eastern North Pacific · EP182026');
  assert.equal(d.url, 'https://www.nhc.noaa.gov/text/MIATCPEP3.shtml');
  assert.deepEqual(d.sources, ['NOAA NHC']);
  const cur = new Map(d.sections.find((s) => s.title === 'Current')!.rows.map((r) => [r.label, r]));
  assert.equal(cur.get('Sustained wind')!.value, '100 kt');
  assert.equal(cur.get('Sustained wind')!.hint, '115 mph · 185 km/h');
  assert.equal(cur.get('Central pressure')!.value, '955 mb');
  assert.equal(cur.get('Movement')!.value, 'W (270°) at 5 kt');
  assert.equal(cur.get('Advisory')!.value, '#21');
  const fc = d.sections.find((s) => s.title === 'Forecast')!.rows;
  assert.equal(fc[0]!.label, 'Cone');
  assert.ok(fc.some((r) => r.label === '+120 h'));
  const nolo = (await feed.featureDetail('cyclones', 'ep152026:cone:1'))!;
  assert.deepEqual(nolo.sources, ['NOAA NHC', 'NOAA CPHC']);
  assert.equal(await feed.featureDetail('cyclones', 'ep182026:nothing'), null);
  assert.equal(await feed.featureDetail('cyclones', 'al012026:position'), null);
  await feed.stop();
});
