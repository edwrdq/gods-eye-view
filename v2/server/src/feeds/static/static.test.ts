import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { BBox } from '@gev/shared';
import { CablesFeed, CABLES_DIR } from '../cables/feed.ts';
import { parseCables, splitLandingName } from '../cables/parse.ts';
import { DatacentersFeed, DATACENTERS_DIR } from '../datacenters/feed.ts';
import { datacenterRank, parseDatacenters } from '../datacenters/parse.ts';
import { InstallationsFeed, INSTALLATIONS_DIR } from '../installations/feed.ts';
import { installationRank, parseInstallations } from '../installations/parse.ts';
import { haversineKm, lineLengthKm, ringInfo } from './geom.ts';
import { SpatialIndex } from './spatial-index.ts';
import { STATIC_DATA_DIR } from './static-feed.ts';
import { readFileSync } from 'node:fs';

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = (n: string) => readFileSync(path.join(FX, n), 'utf8');

/** A data dir shaped like static-data/ holding the small real-shaped fixtures. */
function fixtureDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-static-'));
  for (const d of [CABLES_DIR, DATACENTERS_DIR, INSTALLATIONS_DIR]) mkdirSync(path.join(dir, d));
  copyFileSync(path.join(FX, 'cable-geo.json'), path.join(dir, CABLES_DIR, 'cable-geo.json'));
  copyFileSync(path.join(FX, 'landing-point-geo.json'), path.join(dir, CABLES_DIR, 'landing-point-geo.json'));
  writeFileSync(path.join(dir, CABLES_DIR, 'source.json'), JSON.stringify({ downloaded_at: '2026-05-24' }));
  copyFileSync(path.join(FX, 'datacenters.geojsonl'), path.join(dir, DATACENTERS_DIR, 'datacenters.geojsonl'));
  copyFileSync(path.join(FX, 'military-names.json'), path.join(dir, INSTALLATIONS_DIR, 'names.json'));
  return dir;
}

const NOW = Date.parse('2026-10-02T12:00:00Z');
const coords = (f: { geometry: { coordinates: unknown } }) => f.geometry.coordinates as [number, number];

// ---------------------------------------------------------------- spatial index and geometry

test('spatial index: returns each entry once, in insertion order, for boxes inside, across cells and over the antimeridian', () => {
  const idx = new SpatialIndex<string>(10);
  idx.add('london', [[-0.1, 51.5, -0.1, 51.5]]);
  idx.add('tokyo', [[139.7, 35.7, 139.7, 35.7]]);
  idx.add('fiji', [[179.9, -17.8, 179.9, -17.8]]);
  idx.add('samoa', [[-172.1, -13.8, -172.1, -13.8]]);
  // A line registered under two part boxes (each part is hit once).
  idx.add('cable', [[-60, 40, -30, 45], [-30, 45, 0, 51]]);
  assert.deepEqual(idx.query([-5, 50, 5, 55]), ['london', 'cable']);
  assert.deepEqual(idx.query([-45, 41, -35, 44]), ['cable']);
  assert.deepEqual(idx.query([170, -30, -170, 0]), ['fiji', 'samoa']); // crosses the antimeridian
  assert.deepEqual(idx.query([100, -80, 120, -70]), []);
  assert.equal(idx.query().length, 5);
  assert.equal(idx.query([-180, -90, 180, 90]).length, 5);
  assert.deepEqual(idx.query([-5, 50, 5, 55]), ['london', 'cable'], 'a second query is not poisoned by the first');
});

test('geometry helpers: haversine, line length and ring centroid/area', () => {
  assert.ok(Math.abs(haversineKm(0, 0, 0, 1) - 111.2) < 0.2);
  assert.ok(Math.abs(haversineKm(179.5, 0, -179.5, 0) - 111.2) < 0.2, 'distance across the antimeridian');
  assert.ok(Math.abs(lineLengthKm([[0, 0], [0, 1], [0, 2]]) - 222.4) < 0.5);
  // 100 m x 100 m square at 52 N, wound the other way round too.
  const dLon = 100 / (111_320 * Math.cos((52 * Math.PI) / 180));
  const dLat = 100 / 110_574;
  const sq = [[5, 52], [5 + dLon, 52], [5 + dLon, 52 + dLat], [5, 52 + dLat], [5, 52]];
  const a = ringInfo(sq)!;
  assert.ok(Math.abs(a.areaM2 - 10_000) < 100, `area ${a.areaM2}`);
  assert.ok(Math.abs(a.lon - (5 + dLon / 2)) < 1e-6 && Math.abs(a.lat - (52 + dLat / 2)) < 1e-6);
  assert.ok(Math.abs(ringInfo([...sq].reverse())!.areaM2 - 10_000) < 100);
  assert.equal(ringInfo([]), null);
  assert.equal(ringInfo([[1, 1], [1, 1], [1, 1]])!.areaM2, 0); // degenerate: falls back to the point
});

// ---------------------------------------------------------------- submarine cables

test('cables: parses real-shaped TeleGeography files, derives landings from route ends and route length', () => {
  const ds = parseCables(JSON.parse(fx('cable-geo.json')), JSON.parse(fx('landing-point-geo.json')));
  assert.equal(ds.skipped, 0);
  assert.equal(ds.cables.length, 4, 'five source features, 2Africa appears twice and is merged');
  const marea = ds.cables.find((c) => c.slug === 'marea')!;
  assert.equal(marea.name, 'MAREA');
  assert.equal(marea.parts.length, 1);
  assert.ok(marea.lengthKm > 6000 && marea.lengthKm < 7500, `MAREA ${marea.lengthKm} km`);
  assert.deepEqual([...marea.landingSlugs].sort(), ['bilbao-spain', 'virginia-beach-va-united-states']);
  const vb = ds.landings.find((l) => l.slug === 'virginia-beach-va-united-states')!;
  assert.equal(vb.place, 'Virginia Beach, VA');
  assert.equal(vb.country, 'United States');
  assert.ok(vb.cableSlugs.includes('marea'));
  // coordinates are rounded to 4 decimals
  assert.ok(marea.parts[0]!.every(([lon, lat]) => Math.abs(lon * 1e4 - Math.round(lon * 1e4)) < 1e-6 && Math.abs(lat * 1e4 - Math.round(lat * 1e4)) < 1e-6));
  // a branched cable has several parts, and the TBD flag survives
  assert.equal(ds.cables.find((c) => c.slug === '2africa')!.parts.length, 14 + 38, 'parts of both 2Africa features');
  assert.equal(ds.landings.find((l) => l.slug === 'castlefreke-ireland')!.tbd, true);
});

test('cables: splitLandingName and malformed input', () => {
  assert.deepEqual(splitLandingName('Nybor, Denmark'), { place: 'Nybor', country: 'Denmark' });
  assert.deepEqual(splitLandingName('Virginia Beach, VA, United States'), { place: 'Virginia Beach, VA', country: 'United States' });
  assert.deepEqual(splitLandingName('Atlantis'), { place: 'Atlantis', country: null });
  assert.throws(() => parseCables({}, { features: [] }), /malformed/);
  const bad = parseCables(
    { features: [
      { properties: { id: 'a', name: 'A' }, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] } },
      { properties: { id: 'a', name: 'dup' }, geometry: { type: 'MultiLineString', coordinates: [[[2, 2], [3, 3]]] } },
      { properties: { id: 'b', name: 'B' }, geometry: { type: 'MultiLineString', coordinates: [[[0, 0]]] } },
      { properties: { name: 'no id' }, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] } },
      { properties: { id: 'c', name: 'C' }, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [400, 1]]] } },
    ] },
    { features: [{ properties: { id: 'l', name: 'L, X' }, geometry: { type: 'Point', coordinates: [0, 0] } }, { properties: { id: 'm' }, geometry: { type: 'Point', coordinates: [0, 0] } }] },
  );
  assert.equal(bad.cables.length, 1);
  assert.equal(bad.landings.length, 1);
  assert.equal(bad.skipped, 4);
  assert.equal(bad.cables[0]!.parts.length, 2, 'same id merges into one cable with both parts');
  assert.deepEqual(bad.cables[0]!.landingSlugs, ['l']);
});

test('cables feed: lines + landing points, bbox queries, thinning of landing points only, detail', async () => {
  const dir = fixtureDir();
  try {
    const feed = new CablesFeed({ dataDir: dir, now: () => NOW });
    assert.equal(feed.status().state, 'off');
    feed.start();
    const st = feed.status();
    assert.equal(st.state, 'live');
    assert.equal(st.source, 'TeleGeography Submarine Cable Map');
    assert.equal(st.count, 4 + 78);
    assert.equal(st.lastSuccess, Date.parse('2026-05-24T00:00:00Z'));

    const all = feed.features('submarine-cables', { limit: 20_000 });
    assert.equal(all.truncated, false);
    assert.equal(all.features.filter((f) => f.geometry.type === 'MultiLineString').length, 4);
    assert.equal(all.features.filter((f) => f.geometry.type === 'Point').length, 78);
    assert.equal(all.features[0]!.geometry.type, 'MultiLineString', 'lines first, points after');

    // Virginia Beach area: MAREA's line (its part box touches it) and the landing point.
    const box: BBox = [-76.5, 36.5, -75, 37.5];
    const near = feed.features('submarine-cables', { bbox: box, limit: 20_000 });
    const ids = near.features.map((f) => f.id);
    assert.ok(ids.includes('cable:marea'));
    assert.ok(ids.includes('landing:virginia-beach-va-united-states'));
    assert.ok(!ids.includes('landing:bilbao-spain'));
    assert.ok(near.features.length < all.features.length);

    // Empty ocean far from everything.
    assert.equal(feed.features('submarine-cables', { bbox: [-140, -60, -130, -55], limit: 100 }).features.filter((f) => f.id.startsWith('landing:')).length, 0);

    // A tight point cap thins landings evenly but keeps every cable, and flags truncated.
    const thin = new CablesFeed({ dataDir: dir, now: () => NOW, pointCap: 10 });
    thin.start();
    const t = thin.features('submarine-cables', { limit: 20_000 });
    assert.equal(t.truncated, true);
    assert.equal(t.features.filter((f) => f.geometry.type === 'MultiLineString').length, 4);
    assert.equal(t.features.filter((f) => f.geometry.type === 'Point').length, 10);
    assert.deepEqual(t.features.map((f) => f.id), thin.features('submarine-cables', { limit: 20_000 }).features.map((f) => f.id), 'stable between calls');

    // limit also caps lines.
    const tiny = feed.features('submarine-cables', { limit: 3 });
    assert.equal(tiny.features.length, 3);
    assert.equal(tiny.truncated, true);

    const d = (await feed.featureDetail('submarine-cables', 'cable:marea'))!;
    assert.equal(d.title, 'MAREA');
    assert.equal(d.url, 'https://www.submarinecablemap.com/submarine-cable/marea');
    assert.match(d.subtitle!, /2 landing points/);
    const landing = d.sections.find((s) => s.title === 'Landing points')!;
    assert.deepEqual(landing.rows.slice(0, 2).map((r) => r.label).sort(), ['Bilbao', 'Virginia Beach, VA']);
    const src = d.sections.find((s) => s.title === 'Source')!;
    assert.ok(src.rows.some((r) => r.label === 'Credit' && r.value === '© TeleGeography, submarinecablemap.com'));
    assert.ok(src.rows.some((r) => r.label === 'Licence' && String(r.value).includes('CC BY-NC-SA 3.0')));
    assert.match(d.sources[0]!, /CC BY-NC-SA 3\.0/);
    assert.ok(d.feature.geometry.type === 'MultiLineString');

    const l = (await feed.featureDetail('submarine-cables', 'landing:virginia-beach-va-united-states'))!;
    assert.equal(l.title, 'Virginia Beach, VA');
    assert.equal(l.subtitle, 'Cable landing point · United States');
    assert.ok(l.sections.find((s) => s.title === 'Cables landing here')!.rows.some((r) => r.label === 'MAREA'));
    assert.equal(l.url, 'https://www.submarinecablemap.com/landing-point/virginia-beach-va-united-states');
    assert.equal(await feed.featureDetail('submarine-cables', 'cable:nope'), null);
    assert.equal(await feed.featureDetail('submarine-cables', '__proto__'), null);

    await feed.stop();
    assert.equal(feed.status().state, 'off');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- datacenters

test('datacenters: parses polygons, multipolygons and points; centroid, area, ranks and skips', () => {
  const text = fx('datacenters.geojsonl');
  const ds = parseDatacenters(text);
  assert.equal(ds.skipped, 0);
  assert.equal(ds.items.length, 19);
  const aws = ds.items.find((d) => d.id === '1176042553')!;
  assert.equal(aws.name, 'AWS');
  assert.equal(aws.operator, 'Amazon Web Services');
  assert.equal(aws.mapped, 'outline');
  assert.ok(aws.areaM2! > 10 && aws.areaM2! < 200, `tiny outline ${aws.areaM2}`);
  assert.ok(Math.abs(aws.lon - -70.85) < 0.01 && Math.abs(aws.lat - -52.942) < 0.01);
  assert.ok(ds.items.some((d) => d.mapped === 'point' && d.areaM2 === null));
  assert.ok(ds.items.every((d) => Math.abs(d.lon) <= 180 && Math.abs(d.lat) <= 90));
  assert.ok(datacenterRank(aws) > datacenterRank({ ...aws, name: null, operator: null, tags: {} }));

  const mixed = [
    '{not json',
    JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [500, 0] }, properties: { osm_id: 1, tags: {} } }),
    JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [10, 20] }, properties: { osm_id: 2, tags: { name: '  X  ', operator: 'Op', website: 'example.com', 'contact:phone': '+1' } } }),
    JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [11, 21] }, properties: { osm_id: 2, tags: {} } }),
    JSON.stringify({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]], [[[1, 1], [1.01, 1], [1.01, 1.01], [1, 1.01], [1, 1]]]] }, properties: { osm_id: 3, tags: { name: 'Campus' } } }),
    '',
  ].join('\n');
  const m = parseDatacenters(mixed);
  assert.equal(m.skipped, 3);
  assert.deepEqual(m.items.map((d) => d.id), ['2', '3']);
  assert.equal(m.items[0]!.name, 'X');
  assert.ok(!('contact:phone' in m.items[0]!.tags));
  assert.ok(Math.abs(m.items[1]!.lon - 1.005) < 1e-3, 'centred on the larger part');
});

test('datacenters feed: points with names, bbox query, detail with sanitised website and source', async () => {
  const dir = fixtureDir();
  try {
    const feed = new DatacentersFeed({ dataDir: dir, now: () => NOW });
    feed.start();
    assert.equal(feed.status().state, 'live');
    assert.equal(feed.status().count, 19);
    const all = feed.features('datacenters', { limit: 20_000 });
    assert.equal(all.features.length, 19);
    assert.ok(all.features.every((f) => f.geometry.type === 'Point'));
    const aws = all.features.find((f) => f.id === '1176042553')!;
    assert.equal(aws.label, 'AWS');
    assert.equal(aws.props.operator, 'Amazon Web Services');
    // Patagonia only
    const south = feed.features('datacenters', { bbox: [-75, -55, -65, -50], limit: 100 });
    assert.ok(south.features.some((f) => f.id === '1176042553'));
    assert.ok(south.features.length < 19);
    const d = (await feed.featureDetail('datacenters', '1176042553'))!;
    assert.equal(d.title, 'AWS');
    assert.equal(d.subtitle, 'Amazon Web Services');
    assert.equal(d.sections.at(-1)!.title, 'Source');
    assert.ok(d.sections.at(-1)!.rows.some((r) => r.label === 'Licence' && String(r.value).startsWith('ODbL')));
    assert.ok(d.sources[0]!.includes('OpenStreetMap contributors'));
    assert.equal(await feed.featureDetail('datacenters', 'nope'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('datacenters detail: only http(s) websites become the link; javascript: is dropped', async () => {
  const dir = fixtureDir();
  try {
    writeFileSync(
      path.join(dir, DATACENTERS_DIR, 'datacenters.geojsonl'),
      [
        JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { osm_id: 10, tags: { name: 'Good', website: 'www.example.org/dc', 'data_center:power': '20 MW', 'building:levels': '3' } } }),
        JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [2, 2] }, properties: { osm_id: 11, tags: { name: 'Evil', website: 'javascript:alert(1)' } } }),
      ].join('\n'),
    );
    const feed = new DatacentersFeed({ dataDir: dir });
    feed.start();
    const good = (await feed.featureDetail('datacenters', '10'))!;
    assert.equal(good.url, 'https://www.example.org/dc');
    assert.ok(good.sections.find((s) => s.title === 'Capacity')!.rows.some((r) => r.value === '20 MW'));
    const evil = (await feed.featureDetail('datacenters', '11'))!;
    assert.equal(evil.url, undefined);
    assert.ok(!evil.sections.some((s) => s.rows.some((r) => r.label === 'Website')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- installations

test('installations: parses typed ids, classes, bounds and area; skips bad rows; rank favours big and airfields', () => {
  const ds = parseInstallations(JSON.parse(fx('military-names.json')));
  assert.equal(ds.skipped, 0);
  assert.equal(ds.release, '2026-09-23.1');
  assert.deepEqual(ds.snapshots, ['2026-09-06', '2026-09-12']);
  const scott = ds.items.find((i) => i.id === 'r122949')!;
  assert.equal(scott.name, 'Scott Air Force Base');
  assert.equal(scott.cls, 'airfield');
  assert.deepEqual(scott.bounds, [-89.8799, 38.5292, -89.8041, 38.5588]);
  assert.equal(scott.areaM2, 12_413_875);
  const campbell = ds.items.find((i) => i.id === 'r130448')!;
  assert.equal(campbell.cls, 'military_land');
  assert.ok(installationRank(campbell) > installationRank(scott) - 1 && installationRank(scott) > 7);

  const classes = ['base'];
  const bad = parseInstallations({
    classes,
    records: [
      ['w1', 'Ok', 1, 2, 0, 0, 3, 3, 0, 100],
      ['w1', 'Duplicate', 1, 2, 0, 0, 3, 3, 0, 100],
      ['x9', 'Bad id', 1, 2, 0, 0, 3, 3, 0, 100],
      ['w2', '', 1, 2, 0, 0, 3, 3, 0, 100],
      ['w3', 'Bad class', 1, 2, 0, 0, 3, 3, 9, 100],
      ['w4', 'Bad lat', 1, 95, 0, 0, 3, 3, 0, 100],
      ['w5', 'Short', 1, 2],
      'nope',
    ],
  });
  assert.equal(bad.items.length, 1);
  assert.equal(bad.skipped, 7);
  assert.throws(() => parseInstallations({ records: [] }), /malformed/);
  assert.throws(() => parseInstallations(null), /malformed/);
});

test('installations feed: points labelled by name, bbox, detail links to OSM and carries the caution', async () => {
  const dir = fixtureDir();
  try {
    const feed = new InstallationsFeed({ dataDir: dir, now: () => NOW });
    feed.start();
    const st = feed.status();
    assert.equal(st.state, 'live');
    assert.equal(st.source, 'OpenStreetMap via Overture Maps');
    assert.equal(st.lastSuccess, Date.parse('2026-09-12T00:00:00Z'), 'age counts from the newest OSM snapshot');
    const all = feed.features('installations', { limit: 100 });
    assert.equal(all.features.length, 9);
    const scott = all.features.find((f) => f.id === 'r122949')!;
    assert.equal(scott.label, 'Scott Air Force Base');
    assert.deepEqual(scott.props, { name: 'Scott Air Force Base', class: 'airfield', areaKm2: 12.41 });
    assert.deepEqual(coords(scott), [-89.85277, 38.54384]);
    const stl = feed.features('installations', { bbox: [-91, 37.5, -88, 39.5], limit: 100 });
    assert.deepEqual(stl.features.map((f) => f.id), ['r122949']);
    const d = (await feed.featureDetail('installations', 'r122949'))!;
    assert.equal(d.title, 'Scott Air Force Base');
    assert.equal(d.subtitle, 'Airfield · mapped military area');
    assert.equal(d.url, 'https://www.openstreetmap.org/relation/122949');
    const src = d.sections.at(-1)!;
    assert.equal(src.title, 'Source');
    assert.ok(src.rows.some((r) => r.label === 'Caution'));
    assert.ok(src.rows.some((r) => r.label === 'Overture release' && r.value === '2026-09-23.1'));
    assert.ok(d.sections[0]!.rows.some((r) => r.label === 'Mapped area' && r.value === '12.4 km²'));
    // a way id links to /way/
    const way = [...all.features].find((f) => f.id.startsWith('w'));
    if (way) assert.match((await feed.featureDetail('installations', way.id))!.url!, /openstreetmap\.org\/way\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing dataset reports error instead of throwing, and serves nothing', () => {
  const feed = new DatacentersFeed({ dataDir: path.join(tmpdir(), 'gev-does-not-exist'), now: () => NOW });
  feed.start();
  const st = feed.status();
  assert.equal(st.state, 'error');
  assert.match(st.lastError!, /Bundled dataset unavailable/);
  assert.deepEqual(feed.features('datacenters', { limit: 10 }), { features: [], truncated: false });
});

// ---------------------------------------------------------------- the real bundled data

test('bundled datasets: counts match the published numbers and bbox queries are fast', async () => {
  const cables = new CablesFeed({ dataDir: STATIC_DATA_DIR, now: () => NOW });
  const dcs = new DatacentersFeed({ dataDir: STATIC_DATA_DIR, now: () => NOW });
  const inst = new InstallationsFeed({ dataDir: STATIC_DATA_DIR, now: () => NOW });
  for (const f of [cables, dcs, inst]) {
    f.start();
    assert.equal(f.status().state, 'live', f.id);
    assert.ok(f.loadMs < 1500, `${f.id} loaded in ${f.loadMs} ms`);
  }
  assert.equal(cables.count, 694 + 1917, '712 source features, 18 of them continue another cable id');
  assert.equal(dcs.count, 4351);
  assert.equal(inst.count, 36_466);

  // World views are thinned to the cap; regional views come back whole.
  const w = inst.features('installations', { limit: 20_000 });
  assert.equal(w.truncated, true);
  assert.equal(w.features.length, 3000);
  const dw = dcs.features('datacenters', { limit: 20_000 });
  assert.equal(dw.truncated, true);
  assert.equal(dw.features.length, 2500);
  const cw = cables.features('submarine-cables', { limit: 20_000 });
  assert.equal(cw.features.filter((f) => f.geometry.type === 'MultiLineString').length, 694);
  assert.equal(cw.features.filter((f) => f.geometry.type === 'Point').length, 800);

  const europe: BBox = [-12, 35, 30, 60];
  const r = dcs.features('datacenters', { bbox: europe, limit: 20_000 });
  assert.ok(r.features.length > 500 && r.features.length <= 2500);
  for (const f of r.features) {
    const [lon, lat] = coords(f);
    assert.ok(lon >= -12 && lon <= 30 && lat >= 35 && lat <= 60);
  }
  // small boxes are whole
  const ashburn: BBox = [-77.7, 38.9, -77.3, 39.1];
  const a = dcs.features('datacenters', { bbox: ashburn, limit: 20_000 });
  assert.equal(a.truncated, false);
  assert.ok(a.features.length > 20, `Ashburn has ${a.features.length}`);

  // timing: 200 regional queries per layer
  for (const [feed, layer] of [[inst, 'installations'], [dcs, 'datacenters'], [cables, 'submarine-cables']] as const) {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      const lon = -120 + ((i * 37) % 240);
      const lat = -50 + ((i * 17) % 100);
      feed.features(layer, { bbox: [lon, lat, lon + 20, lat + 12], limit: 20_000 });
    }
    const per = (performance.now() - t0) / 200;
    assert.ok(per < 25, `${layer}: ${per.toFixed(2)} ms per 20x12 degree query`);
  }

  // Details for known sites exist.
  assert.equal((await inst.featureDetail('installations', 'r122949'))!.title, 'Scott Air Force Base');
  assert.ok(await cables.featureDetail('submarine-cables', 'cable:marea'));
  assert.ok(await dcs.featureDetail('datacenters', '1176042553'));
});
