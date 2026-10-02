import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Feature } from '@gev/shared';
import { clock, jsonResponse, manualTimers } from '../test-utils.ts';
import { isPublicHttpsUrl } from '../url.ts';
import {
  BikeshareFeed,
  BIKESHARE_FRESHNESS_MS,
  CATALOGUE_POLL_MS,
  INFO_MIN_MS,
  MAX_CONCURRENT,
  MAX_PER_HOST,
  MAX_VIEW_DEG,
  STATUS_MAX_MS,
  STATUS_MIN_MS,
} from './feed.ts';
import {
  parseCatalogue,
  parseCsv,
  parseDiscovery,
  parseStationInformation,
  parseStationStatus,
  parseVehicleTypes,
  reportedAtMs,
  stationReading,
  stationsBBox,
} from './gbfs.ts';
import { bboxesOverlap, mergeCatalogue, parseIndex, selectSystems, type IndexedSystem } from './systems.ts';

const fx = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-02T16:30:00Z');
const MIN = 60_000;
const HOUR = 3_600_000;

// ---------------------------------------------------------------- catalogue

test('CSV reader handles quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
  const rows = parseCsv('﻿a,b,c\r\n1,"x, y",3\r\n"he said ""hi""","two\nlines",\n\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', '3'], ['he said "hi"', 'two\nlines', '']]);
});

test('parses the real catalogue: authentication, non-https and repeated ids are left out', () => {
  const csv = readFileSync(new URL('./fixtures/systems-sample.csv', import.meta.url), 'utf8');
  const { systems, skipped } = parseCatalogue(csv + csv.split('\n')[3] + '\n'); // a repeated row
  const ids = systems.map((s) => s.id);
  assert.ok(ids.includes('lyft_nyc') && ids.includes('Paris') && ids.includes('nextbike_nh'));
  assert.ok(!ids.includes('lime_wetzikon'), 'needs authentication');
  assert.ok(!ids.includes('http_only'), 'discovery address is not https');
  assert.equal(ids.filter((i) => i === 'lime_mississauga').length, 1);
  assert.equal(skipped, 3);
  const velib = systems.find((s) => s.id === 'Paris')!;
  assert.equal(velib.name, "Vélib' Metropole");
  assert.equal(velib.location, 'Paris');
  assert.equal(velib.country, 'FR');
  assert.equal(velib.discoveryUrl, 'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/gbfs.json');
  assert.equal(velib.website, 'https://www.velib-metropole.fr/');
  assert.equal(systems.find((s) => s.id === 'nextbike_nh')!.location, 'Hodonín, CZ');
  assert.deepEqual(parseCatalogue('not,a,catalogue\n1,2,3'), { systems: [], skipped: 1 });
});

// ---------------------------------------------------------------- discovery and documents

test('discovery: v2 per-language list, v1 (Velib), v3 flat list, relative addresses', () => {
  const lyft = parseDiscovery(fx('lyft-gbfs.json'), 'https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json')!;
  assert.equal(lyft.stationInformation, 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json');
  assert.equal(lyft.stationStatus, 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json');
  assert.equal(lyft.vehicleTypes, 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/vehicle_types.json');
  const velib = parseDiscovery(fx('velib-gbfs.json'), 'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/gbfs.json')!;
  assert.match(velib.stationStatus!, /Velib_Metropole\/station_status\.json$/);
  assert.equal(velib.vehicleTypes, undefined);
  const v3 = parseDiscovery(fx('v3-gbfs.json'), 'https://api.mobidata-bw.de/sharing/gbfs/v3/lara_to_go/gbfs')!;
  assert.equal(v3.stationInformation, 'https://api.mobidata-bw.de/sharing/gbfs/v3/lara_to_go/station_information');
  const rel = parseDiscovery({ data: { de: { feeds: [{ name: 'station_status', url: 'status.json' }] } } }, 'https://x.example/a/gbfs.json')!;
  assert.equal(rel.stationStatus, 'https://x.example/a/status.json');
  assert.equal(parseDiscovery({ data: {} }, 'https://x.example/'), null);
  assert.equal(parseDiscovery(null, 'https://x.example/'), null);
});

test('station_information: Citi Bike (v2.3), Velib (v1) and a v3 feed with localised names', () => {
  const nyc = parseStationInformation(fx('lyft-station_information.json'));
  assert.equal(nyc.stations.length, 5);
  assert.equal(nyc.ttlS, 60);
  const barrow = nyc.stations.find((s) => s.name === 'Barrow St & Hudson St')!;
  assert.equal(barrow.capacity, null, 'a capacity of 0 means unknown');
  assert.deepEqual([barrow.lon, barrow.lat], [-74.006744, 40.731724]);
  const paris = parseStationInformation(fx('velib-station_information.json'));
  assert.equal(paris.ttlS, 3600);
  assert.equal(paris.stations[0]!.name, 'Benjamin Godard - Victor Hugo');
  assert.equal(paris.stations[0]!.capacity, 35);
  assert.equal(paris.stations[0]!.id, '213688169', 'numeric ids become strings');
  const v3 = parseStationInformation(fx('v3-station_information.json'));
  assert.equal(v3.stations[0]!.name, 'WN-Hohenacker - Rathaus');
  assert.equal(v3.stations.length, 4);
});

test('station_information: bad coordinates, virtual stations, repeats and junk are skipped', () => {
  const ok = { station_id: 'a', name: 'A', lat: 10, lon: 20, capacity: 12 };
  const r = parseStationInformation({
    ttl: 'x',
    data: {
      stations: [
        ok,
        { ...ok },
        { ...ok, station_id: 'b', lat: 0, lon: 0 },
        { ...ok, station_id: 'c', lat: 91 },
        { ...ok, station_id: 'd', lat: 'x' },
        { ...ok, station_id: 'e', is_virtual_station: true },
        { ...ok, station_id: '', },
        { ...ok, station_id: 'f'.repeat(65) },
        { ...ok, station_id: 'g', name: ' \u0000 ' },
        'junk',
        null,
      ],
    },
  });
  assert.deepEqual(r.stations.map((s) => s.id), ['a', 'g']);
  assert.equal(r.stations[1]!.name, 'Station g');
  assert.equal(r.skipped, 9);
  assert.equal(r.ttlS, null);
  assert.deepEqual(parseStationInformation({}).stations, []);
});

test('station_status: e-bikes from Lyft, Velib and v2.1/v3 vehicle types; booleans as 0/1; last_reported in both formats', () => {
  const vt = parseVehicleTypes(fx('lyft-vehicle_types.json'));
  assert.equal(vt.bikes, true);
  assert.deepEqual([...vt.electric], [['1', false], ['2', true]]);
  const nyc = parseStationStatus(fx('lyft-station_status.json'), vt);
  assert.equal(nyc.ttlS, 60);
  const withEbikes = [...nyc.status.values()].find((s) => (s.ebikes ?? 0) > 0)!;
  assert.ok(withEbikes.bikes! >= withEbikes.ebikes!);
  const offline = nyc.status.get('66db2a71-0aca-11e7-82f6-3863bb44ef7c')!;
  assert.deepEqual([offline.installed, offline.renting, offline.returning], [false, false, false]);
  assert.equal(offline.reportedAt, null, 'last_reported 86400 means never');

  const paris = parseStationStatus(fx('velib-station_status.json')).status;
  const v = paris.get('213688169')!;
  assert.deepEqual([v.bikes, v.ebikes, v.docks], [0, 0, 35]);
  assert.equal(v.reportedAt, 1790957551 * 1000);
  const raw = fx('velib-station_status.json').data.stations.find((s: any) => s.num_bikes_available_types.some((t: any) => t.ebike > 0));
  if (raw) assert.equal(paris.get(String(raw.station_id))!.ebikes, raw.num_bikes_available_types.find((t: any) => 'ebike' in t).ebike);

  // v3: num_vehicles_available, RFC 3339 times, e-bikes through vehicle_types_available
  const vt3 = parseVehicleTypes(fx('v3-vehicle_types.json'));
  assert.equal(vt3.bikes, true);
  const s3 = parseStationStatus(fx('v3-station_status.json'), vt3).status;
  const first = s3.get('LTG:Station:1173089833')!;
  assert.deepEqual([first.bikes, first.docks, first.ebikes], [0, null, 0]);
  assert.equal(first.reportedAt, Date.parse('2026-10-02T16:28:59.000+00:00'));
  assert.equal(s3.get('LTG:Station:640294288')!.bikes, 1);
  assert.equal(s3.get('LTG:Station:640294288')!.ebikes, 1, 'cargo bike with electric propulsion');
});

test('last_reported: seconds, milliseconds, RFC 3339, and nonsense', () => {
  assert.equal(reportedAtMs(1790957551), 1790957551000);
  assert.equal(reportedAtMs(1790957551000), 1790957551000);
  assert.equal(reportedAtMs('1790957551'), 1790957551000);
  assert.equal(reportedAtMs('2026-10-02T16:28:59Z'), Date.parse('2026-10-02T16:28:59Z'));
  for (const bad of [0, -5, 86400, null, undefined, 'never', '', NaN, {}]) assert.equal(reportedAtMs(bad), null, String(bad));
});

test('vehicle types: car sharing and mixed fleets are not bikeshare', () => {
  const doc = (...forms: string[]) => ({ data: { vehicle_types: forms.map((f, i) => ({ vehicle_type_id: String(i), form_factor: f, propulsion_type: 'human' })) } });
  assert.equal(parseVehicleTypes(doc('bicycle')).bikes, true);
  assert.equal(parseVehicleTypes(doc('cargo_bicycle')).bikes, true);
  assert.equal(parseVehicleTypes(doc('car')).bikes, false);
  assert.equal(parseVehicleTypes(doc('bicycle', 'car')).bikes, false);
  assert.equal(parseVehicleTypes(doc('scooter_standing')).bikes, false);
  assert.equal(parseVehicleTypes({}).bikes, true, 'no information is not a reason to exclude');
});

test('station state: empty, full, offline, ok, unknown, and the fill share', () => {
  const st = (over: object) => ({ id: 'x', bikes: 5, ebikes: null, docks: 5, installed: true, renting: true, returning: true, reportedAt: null, ...over });
  const info = { capacity: 10 };
  assert.deepEqual(stationReading(info, st({})), { state: 'ok', fill: 0.5, capacity: 10 });
  assert.equal(stationReading(info, st({ bikes: 0, docks: 10 })).state, 'empty');
  assert.equal(stationReading(info, st({ bikes: 10, docks: 0 })).state, 'full');
  assert.equal(stationReading(info, st({ installed: false })).state, 'offline');
  assert.equal(stationReading(info, st({ renting: false, returning: false })).state, 'offline');
  assert.equal(stationReading(info, st({ renting: false })).state, 'empty', 'cannot rent: nothing to take');
  assert.equal(stationReading(info, st({ returning: false })).state, 'full', 'cannot return: no dock for a bike');
  assert.equal(stationReading(info, st({ bikes: null })).state, 'unknown');
  assert.equal(stationReading(info, undefined).state, 'unknown');
  // no capacity: bikes plus free docks stand in; bikes over capacity clamp to 1
  assert.deepEqual(stationReading({ capacity: null }, st({ bikes: 3, docks: 9 })), { state: 'ok', fill: 0.25, capacity: 12 });
  assert.equal(stationReading({ capacity: 4 }, st({ bikes: 9, docks: 1 })).fill, 1);
  assert.deepEqual(stationReading({ capacity: null }, st({ docks: null })), { state: 'ok', fill: null, capacity: null });
});

test('system boxes drop stray stations once there are enough to tell', () => {
  const pts = Array.from({ length: 200 }, (_, i) => ({ lon: 2.2 + (i % 20) * 0.01, lat: 48.8 + Math.floor(i / 20) * 0.01 }));
  assert.deepEqual(stationsBBox(pts), [2.2, 48.8, 2.39, 48.89]);
  assert.deepEqual(stationsBBox([...pts, { lon: 0, lat: 0.5 }, { lon: -40, lat: 10 }]), [2.2, 48.8, 2.39, 48.89].map((v, i) => (i === 0 || i === 1 ? v : v)).map((v, i) => (i < 2 ? stationsBBox([...pts, { lon: 0, lat: 0.5 }, { lon: -40, lat: 10 }])![i]! : v)));
  assert.equal(stationsBBox([]), null);
  assert.deepEqual(stationsBBox([{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }]), [1, 2, 3, 4]);
});

// ---------------------------------------------------------------- choosing systems for a view

const sys = (id: string, bbox: [number, number, number, number], over: Partial<IndexedSystem> = {}): IndexedSystem => ({
  id,
  name: id,
  location: '',
  country: 'XX',
  discoveryUrl: `https://${id.toLowerCase().replace(/[^a-z0-9]/g, '')}.example.org/gbfs.json`,
  bbox,
  stations: 100,
  ...over,
});
const NYC: [number, number, number, number] = [-74.07, 40.62, -73.85, 40.88];
const PARIS: [number, number, number, number] = [2.19, 48.77, 2.48, 48.94];
const world = [sys('lyft_nyc', NYC), sys('Paris', PARIS), sys('bluebikes', [-71.2, 42.26, -70.89, 42.52]), sys('fiji', [178.4, -18.3, -179.9, -17.5])];

test('selection: only systems that overlap the view, nearest the view centre first, capped', () => {
  assert.deepEqual(selectSystems(world, [-74.1, 40.6, -73.8, 40.9], 6).chosen.map((s) => s.id), ['lyft_nyc']);
  assert.deepEqual(selectSystems(world, [2.0, 48.7, 2.6, 49.0], 6).chosen.map((s) => s.id), ['Paris']);
  assert.deepEqual(selectSystems(world, [-40, 0, -30, 10], 6), { chosen: [], total: 0 });
  // New York and Boston in one view: both, New York first when the view is centred nearer it
  const both = selectSystems(world, [-75, 40.3, -70.5, 42.8], 6);
  assert.deepEqual(both.chosen.map((s) => s.id), ['lyft_nyc', 'bluebikes']);
  const capped = selectSystems(world, [-75, 40.3, -70.5, 42.8], 1);
  assert.deepEqual([capped.chosen.length, capped.total], [1, 2]);
  // a system's box is trimmed of outliers: a view just outside it still counts
  assert.equal(selectSystems(world, [-73.82, 40.6, -73.6, 40.9], 6, 0.05).chosen.length, 1);
  assert.equal(selectSystems(world, [-73.7, 40.6, -73.6, 40.9], 6, 0.05).chosen.length, 0);
});

test('selection handles the antimeridian on either side', () => {
  assert.deepEqual(selectSystems(world, [179, -19, -179, -17], 6).chosen.map((s) => s.id), ['fiji']);
  assert.deepEqual(selectSystems(world, [-180, -19, -179.5, -17], 6).chosen.map((s) => s.id), ['fiji']);
  assert.deepEqual(selectSystems(world, [170, -19, 178, -17], 6).chosen.map((s) => s.id), []);
  assert.equal(bboxesOverlap([170, 0, -170, 10], [175, 2, 178, 3]), true);
  assert.equal(bboxesOverlap([170, 0, -170, 10], [0, 2, 10, 3]), false);
});

test('the index file: validated on load, merged with the live catalogue', () => {
  const idx = parseIndex({ version: 1, generatedAt: '2026-10-02T00:00:00Z', systems: [...world, { id: 'bad', discoveryUrl: 'https://x', bbox: [1, 2, 3] }, { id: 'badlat', discoveryUrl: 'https://x', bbox: [0, 50, 1, 40] }] });
  assert.equal(idx.systems.length, 4);
  assert.throws(() => parseIndex({ version: 99, systems: [] }), /unsupported/);
  const cat = [
    { id: 'lyft_nyc', name: 'Citi Bike', location: 'New York, NY', country: 'US', discoveryUrl: 'https://new.example.org/gbfs.json' },
    { id: 'new_system', name: 'New', location: '', country: 'US', discoveryUrl: 'https://n.example.org/gbfs.json' },
    { id: 'Paris', name: "Vélib'", location: 'Paris', country: 'FR', discoveryUrl: 'https://p.example.org/gbfs.json' },
  ];
  const m = mergeCatalogue(idx.systems, cat);
  assert.deepEqual(m.systems.map((s) => s.id), ['lyft_nyc', 'Paris']);
  assert.equal(m.systems[0]!.discoveryUrl, 'https://new.example.org/gbfs.json', 'the live address wins');
  assert.deepEqual(m.systems[0]!.bbox, NYC, 'the index supplies the place');
  assert.deepEqual([m.unlocated, m.retired], [1, 2]);
  assert.equal(mergeCatalogue(idx.systems, null).systems.length, 4);
});

// ---------------------------------------------------------------- the feed

const NYC_HOST = 'gbfs.citibikenyc.com';
const PARIS_HOST = 'velib-metropole-opendata.smovengo.cloud';
const nycSys = sys('lyft_nyc', NYC, { name: 'Citi Bike', location: 'New York, NY', country: 'US', discoveryUrl: `https://${NYC_HOST}/gbfs/2.3/gbfs.json`, website: 'https://www.citibikenyc.com/' });
const parisSys = sys('Paris', PARIS, { name: "Vélib' Metropole", location: 'Paris', country: 'FR', discoveryUrl: `https://${PARIS_HOST}/opendata/Velib_Metropole/gbfs.json` });

const DOCS: Record<string, () => unknown> = {
  [`https://${NYC_HOST}/gbfs/2.3/gbfs.json`]: () => fx('lyft-gbfs.json'),
  'https://gbfs.lyft.com/gbfs/2.3/bkn/en/vehicle_types.json': () => fx('lyft-vehicle_types.json'),
  'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json': () => fx('lyft-station_information.json'),
  'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json': () => fx('lyft-station_status.json'),
  [`https://${PARIS_HOST}/opendata/Velib_Metropole/gbfs.json`]: () => fx('velib-gbfs.json'),
  [`https://${PARIS_HOST}/opendata/Velib_Metropole/station_information.json`]: () => fx('velib-station_information.json'),
  [`https://${PARIS_HOST}/opendata/Velib_Metropole/station_status.json`]: () => fx('velib-station_status.json'),
};

interface Setup {
  index?: IndexedSystem[];
  docs?: Record<string, () => unknown | Response | Promise<unknown | Response>>;
  cacheFile?: string;
  timers?: any;
  deadlineMs?: number;
  maxSystems?: number;
  stationCap?: number;
  start?: number;
}

function setup(o: Setup = {}) {
  const c = clock(o.start ?? NOW);
  const log: string[] = [];
  const calls: string[] = [];
  const docs = { ...DOCS, ...o.docs };
  let inflight = 0;
  let peak = 0;
  const perHost = new Map<string, number>();
  let peakHost = 0;
  const feed = new BikeshareFeed({
    fetch: async (url) => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith('systems.csv')) return new Response(catalogueFor(o.index ?? [nycSys, parisSys]), { status: 200 });
      inflight++;
      peak = Math.max(peak, inflight);
      perHost.set(u.hostname, (perHost.get(u.hostname) ?? 0) + 1);
      peakHost = Math.max(peakHost, perHost.get(u.hostname)!);
      try {
        const doc = docs[url];
        if (!doc) return new Response('not found', { status: 404 });
        const body = await doc();
        return body instanceof Response ? body : jsonResponse(body);
      } finally {
        inflight--;
        perHost.set(u.hostname, perHost.get(u.hostname)! - 1);
      }
    },
    index: { version: 1, generatedAt: '2026-10-02T00:00:00Z', systems: o.index ?? [nycSys, parisSys] },
    catalogueUrl: 'https://catalogue.example.org/systems.csv',
    cacheFile: o.cacheFile,
    now: c.now,
    timers: o.timers ?? manualTimers,
    log: (m) => log.push(m),
    deadlineMs: o.deadlineMs,
    maxSystems: o.maxSystems,
    stationCap: o.stationCap,
  });
  return { feed, c, calls, log, peak: () => peak, peakHost: () => peakHost };
}

// The catalogue the fake server returns: every indexed system (as the live catalogue would list it) plus filler rows so it looks like a real one.
function catalogueFor(index: IndexedSystem[]): string {
  const head = 'Country Code,Name,Location,System ID,URL,Auto-Discovery URL,Supported Versions,Authentication Info URL,Authentication Type,Authentication Parameter Name';
  const rows = index.map((x) => `${x.country},"${x.name}","${x.location}",${x.id},${x.website ?? ''},${x.discoveryUrl},2.3,,,`);
  const filler = Array.from({ length: 60 }, (_, i) => `XX,Filler ${i},Town ${i},filler_${i},https://f${i}.example.org,https://f${i}.example.org/gbfs.json,2.3,,,`);
  return [head, ...rows, ...filler].join('\n');
}

const NYC_VIEW: [number, number, number, number] = [-74.07, 40.62, -73.85, 40.88];
const PARIS_VIEW: [number, number, number, number] = [2.19, 48.77, 2.48, 48.94];
const q = (bbox?: [number, number, number, number]) => ({ bbox, limit: 20_000 });
const hostOf = (calls: string[], host: string) => calls.filter((u) => new URL(u).hostname.endsWith(host));

test('a view fetches only the systems it overlaps, with one request per document', async () => {
  const { feed, calls } = setup();
  feed.start();
  await feed.idle();
  assert.equal(feed.systemCount, 2);
  calls.length = 0;
  const r = await feed.features('bikeshare', q(NYC_VIEW));
  assert.equal(hostOf(calls, PARIS_HOST).length, 0, 'Paris was not touched');
  assert.deepEqual(calls.map((u) => u.split('/').pop()), ['gbfs.json', 'vehicle_types.json', 'station_information.json', 'station_status.json']);
  assert.equal(r.truncated, false);
  assert.equal(r.features.length, 5);
  const f = r.features[0]!;
  assert.match(f.id, /^lyft_nyc:/);
  assert.equal(f.geometry.type, 'Point');
  assert.equal(f.props.system, 'Citi Bike');
  assert.ok(['ok', 'empty', 'full', 'offline'].includes(f.props.state as string));
  assert.equal(typeof f.t, 'number');
  const full = r.features.find((x) => x.props.state === 'full');
  assert.ok(full && full.props.docks === 0);
  const empty = r.features.find((x) => x.props.state === 'empty')!;
  assert.equal(empty.props.bikes, 0);
  const off = r.features.find((x) => x.props.state === 'offline')!;
  assert.equal(off.props.capacity, undefined, 'unknown capacity is omitted, not zero');
  assert.deepEqual(Object.keys(f.props).filter((k) => !['name', 'system', 'state', 'bikes', 'ebikes', 'docks', 'capacity', 'fill', 'reported'].includes(k)), []);
  await feed.stop();
});

test('caching: status for a minute, information for hours, each honouring the feed ttl', async () => {
  const { feed, c, calls } = setup();
  feed.start();
  await feed.idle();
  calls.length = 0;
  await feed.features('bikeshare', q(NYC_VIEW));
  assert.equal(calls.length, 4);
  calls.length = 0;

  c.advance(STATUS_MIN_MS - 1000); // Lyft says ttl 60 s
  await feed.features('bikeshare', q(NYC_VIEW));
  assert.equal(calls.length, 0, 'served from memory inside the ttl');

  c.advance(2000);
  await feed.features('bikeshare', q(NYC_VIEW));
  assert.deepEqual(calls.map((u) => u.split('/').pop()), ['station_status.json'], 'only the status is refetched');

  calls.length = 0;
  c.advance(INFO_MIN_MS - STATUS_MIN_MS);
  await feed.features('bikeshare', q(NYC_VIEW));
  assert.deepEqual(calls.map((u) => u.split('/').pop()), ['gbfs.json', 'station_information.json', 'station_status.json'], 'after 3 hours the whole system is refreshed (vehicle types are kept)');
  await feed.stop();
});

test('ttl: a feed that says 0 is not hit every second; one that says an hour is not served for an hour', async () => {
  const zero = (name: string) => () => ({ ...fx(name), ttl: 0 });
  const { feed, c, calls } = setup({ docs: { 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json': zero('lyft-station_status.json'), 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json': zero('lyft-station_information.json') } });
  feed.start();
  await feed.idle();
  calls.length = 0;
  await feed.features('bikeshare', q(NYC_VIEW));
  calls.length = 0;
  c.advance(30_000);
  await feed.features('bikeshare', q(NYC_VIEW));
  assert.equal(calls.length, 0, 'ttl 0 still waits the 60 s floor');

  // Velib: status ttl 3600 s, capped to two minutes so counts stay current; information ttl 1 h, floored to 3 h
  calls.length = 0;
  await feed.features('bikeshare', q(PARIS_VIEW));
  const first = calls.length;
  assert.equal(first, 3);
  calls.length = 0;
  c.advance(STATUS_MAX_MS - 1000);
  await feed.features('bikeshare', q(PARIS_VIEW));
  assert.equal(calls.length, 0);
  c.advance(2000);
  await feed.features('bikeshare', q(PARIS_VIEW));
  assert.deepEqual(calls.map((u) => u.split('/').pop()), ['station_status.json']);
  await feed.stop();
});

test('concurrent requests for one system share a single fetch', async () => {
  const { feed, calls } = setup();
  feed.start();
  await feed.idle();
  calls.length = 0;
  const [a, b, d] = await Promise.all([feed.features('bikeshare', q(NYC_VIEW)), feed.features('bikeshare', q([-74.05, 40.6, -73.8, 40.9])), feed.features('bikeshare', q(NYC_VIEW))]);
  assert.equal(calls.length, 4);
  assert.equal(a.features.length, 5);
  assert.equal(b.features.length, 5);
  assert.equal(d.features.length, 5);
  await feed.stop();
});

test('a view that is too wide, or has no box, fetches nothing and says so', async () => {
  const { feed, calls } = setup();
  feed.start();
  await feed.idle();
  calls.length = 0;
  assert.deepEqual(await feed.features('bikeshare', q(undefined)), { features: [], truncated: true });
  assert.deepEqual(await feed.features('bikeshare', q([-180, -90, 180, 90])), { features: [], truncated: true });
  assert.deepEqual(await feed.features('bikeshare', q([-74 - MAX_VIEW_DEG, 30, -74 + 1, 41])), { features: [], truncated: true });
  assert.deepEqual(await feed.features('bikeshare', q([-74, 30, -73, 30 + MAX_VIEW_DEG + 1])), { features: [], truncated: true });
  assert.equal(calls.length, 0);
  // empty ocean: nothing to fetch, nothing hidden
  assert.deepEqual(await feed.features('bikeshare', q([-40, 0, -39, 1])), { features: [], truncated: false });
  assert.equal(calls.length, 0);
  await feed.stop();
});

test('a failing system backs off, serves what it last had, and recovers', async () => {
  let paris: 'ok' | 'down' = 'ok';
  const { feed, c, calls } = setup({ docs: { [`https://${PARIS_HOST}/opendata/Velib_Metropole/station_status.json`]: () => (paris === 'down' ? new Response('x', { status: 500 }) : fx('velib-station_status.json')) } });
  feed.start();
  await feed.idle();
  await feed.features('bikeshare', q(PARIS_VIEW));
  paris = 'down';
  calls.length = 0;
  c.advance(STATUS_MAX_MS + 1000);
  const r = await feed.features('bikeshare', q(PARIS_VIEW));
  assert.equal(calls.length, 1, 'one attempt');
  assert.equal(r.features.length, 5, 'the last station list is still served');
  assert.ok(r.features.every((f) => f.props.bikes !== undefined), 'with the last counts');
  c.advance(MIN);
  await feed.features('bikeshare', q(PARIS_VIEW));
  assert.equal(calls.length, 1, 'backing off for two minutes');
  paris = 'ok';
  c.advance(2 * MIN);
  await feed.features('bikeshare', q(PARIS_VIEW));
  assert.equal(calls.length, 2, 'retried after the back-off');
  assert.equal(feed.status().state, 'live');
  await feed.stop();
});

test('a system that never answered is left out, the layer reports the error, and a later success clears it', async () => {
  let down = true;
  const { feed, c } = setup({ docs: { [`https://${PARIS_HOST}/opendata/Velib_Metropole/gbfs.json`]: () => (down ? new Response('x', { status: 503 }) : fx('velib-gbfs.json')) } });
  feed.start();
  await feed.idle();
  const r = await feed.features('bikeshare', q(PARIS_VIEW));
  assert.deepEqual(r, { features: [], truncated: false });
  const st = feed.status();
  assert.equal(st.state, 'error');
  assert.match(st.lastError!, /No bikeshare system answered/);
  down = false;
  c.advance(5 * MIN);
  assert.equal((await feed.features('bikeshare', q(PARIS_VIEW))).features.length, 5);
  assert.equal(feed.status().state, 'live');
  await feed.stop();
});

test('a view over two systems loads both and tolerates one being down', async () => {
  const near: [number, number, number, number] = [2.19, 48.77, 2.5, 48.95];
  const second = sys('Paris2', [2.3, 48.8, 2.5, 48.95], { discoveryUrl: 'https://down.example.org/gbfs.json' });
  const { feed } = setup({ index: [parisSys, second], docs: { 'https://down.example.org/gbfs.json': () => new Response('x', { status: 500 }) } });
  feed.start();
  await feed.idle();
  const r = await feed.features('bikeshare', q(near));
  assert.equal(r.features.length, 5);
  assert.equal(feed.status().state, 'live');
  await feed.stop();
});

test('limits: concurrent fetches overall and per host, systems per view, stations per view', async () => {
  const many = Array.from({ length: 10 }, (_, i) => sys(`city${i}`, [10 + i * 0.01, 50, 10.5 + i * 0.01, 50.4], { discoveryUrl: `https://h${i % 2}.example.org/c${i}/gbfs.json` }));
  const docs: Record<string, () => unknown> = {};
  for (let i = 0; i < 10; i++) {
    const base = `https://h${i % 2}.example.org/c${i}`;
    docs[`${base}/gbfs.json`] = async () => {
      await new Promise((r) => setTimeout(r, 15));
      return { ttl: 0, data: { en: { feeds: [{ name: 'station_information', url: `${base}/info.json` }, { name: 'station_status', url: `${base}/status.json` }] } } };
    };
    docs[`${base}/info.json`] = async () => {
      await new Promise((r) => setTimeout(r, 15));
      return { ttl: 0, data: { stations: Array.from({ length: 30 }, (_, k) => ({ station_id: `s${k}`, name: `S${k}`, lat: 50.1 + k * 0.001, lon: 10.1 + i * 0.01 + k * 0.001, capacity: 10 + k })) } };
    };
    docs[`${base}/status.json`] = async () => {
      await new Promise((r) => setTimeout(r, 15));
      return { ttl: 0, data: { stations: Array.from({ length: 30 }, (_, k) => ({ station_id: `s${k}`, num_bikes_available: k % 7, num_docks_available: 3, is_installed: 1, is_renting: 1, is_returning: 1, last_reported: 1790957551 })) } };
    };
  }
  const s = setup({ index: many, docs, stationCap: 100 });
  s.feed.start();
  await s.feed.idle();
  const r = await s.feed.features('bikeshare', q([10, 49.9, 10.6, 50.5]));
  assert.ok(s.peak() <= MAX_CONCURRENT, `peak ${s.peak()} fetches at once`);
  assert.ok(s.peak() >= 2, `but they do run side by side (peak ${s.peak()}, calls ${s.calls.length}, ${s.log.join('; ')})`);
  assert.ok(s.peakHost() <= MAX_PER_HOST, `peak ${s.peakHost()} per host`);
  assert.equal(r.truncated, true);
  // 6 systems x 30 stations = 180, thinned to 100
  assert.equal(r.features.length, 100);
  assert.equal(new Set(r.features.map((f) => f.id.split(':')[0])).size, 6, 'six systems were loaded, evenly represented');
  assert.equal(new Set(r.features.map((f) => f.id)).size, 100);
  assert.equal(hostOf(s.calls, 'h0.example.org').length + hostOf(s.calls, 'h1.example.org').length, 18, 'three documents per system, none for the four left out');
  await s.feed.stop();
});

test('a slow operator does not hold the view: the deadline answers with what is ready and the load finishes behind it', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const timeouts: Array<() => void> = [];
  const timers = { ...manualTimers, setTimeout: (fn: () => void) => (timeouts.push(fn), fn), clearTimeout: () => {} };
  const { feed, calls } = setup({
    timers,
    index: [parisSys, { ...nycSys, bbox: [2.3, 48.8, 2.5, 48.95] }],
    docs: { [`https://${NYC_HOST}/gbfs/2.3/gbfs.json`]: async () => (await gate, fx('lyft-gbfs.json')) },
  });
  feed.start();
  await feed.idle();
  const pending = feed.features('bikeshare', q(PARIS_VIEW));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.ok(timeouts.length >= 1, 'a deadline timer is armed');
  timeouts.at(-1)!();
  const r = await pending;
  assert.equal(r.features.length, 5, 'Paris is there; the slow one is not');
  release();
  await new Promise((r) => setTimeout(r, 20));
  const again = await feed.features('bikeshare', q(PARIS_VIEW));
  assert.ok(again.features.length >= 5);
  assert.ok(hostOf(calls, NYC_HOST).length >= 1);
  await feed.stop();
});

test('a feed that rents no bicycles, or points at a private address, is never drawn', async () => {
  const cars = { ...fx('lyft-gbfs.json') };
  const carDoc = { data: { vehicle_types: [{ vehicle_type_id: '1', form_factor: 'car', propulsion_type: 'electric' }] } };
  const a = setup({ docs: { 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/vehicle_types.json': () => carDoc, [`https://${NYC_HOST}/gbfs/2.3/gbfs.json`]: () => cars } });
  a.feed.start();
  await a.feed.idle();
  assert.deepEqual(await a.feed.features('bikeshare', q(NYC_VIEW)), { features: [], truncated: false });
  a.calls.length = 0;
  await a.feed.features('bikeshare', q(NYC_VIEW));
  assert.equal(a.calls.length, 0, 'remembered: not asked again');
  await a.feed.stop();

  const evil = {
    data: { en: { feeds: [{ name: 'station_information', url: 'http://127.0.0.1:8080/si.json' }, { name: 'station_status', url: 'https://10.0.0.5/ss.json' }] } },
  };
  const b = setup({ docs: { [`https://${NYC_HOST}/gbfs/2.3/gbfs.json`]: () => evil } });
  b.feed.start();
  await b.feed.idle();
  b.calls.length = 0;
  const r = await b.feed.features('bikeshare', q(NYC_VIEW));
  assert.deepEqual(r.features, []);
  assert.deepEqual(b.calls.map((u) => new URL(u).hostname), [NYC_HOST], 'nothing but the operator host was contacted');
  for (const u of ['http://example.org/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x', 'https://192.168.1.1/x', 'https://user:pw@example.org/x', 'https://printer.local/x', 'https://singlelabel/x']) assert.equal(isPublicHttpsUrl(u), false, u);
  assert.equal(isPublicHttpsUrl('https://gbfs.lyft.com/a/b.json'), true);
  await b.feed.stop();
});

test('station detail comes from memory and carries availability, station, source and licence', async () => {
  const { feed, calls, c } = setup();
  feed.start();
  await feed.idle();
  const r = await feed.features('bikeshare', q(NYC_VIEW));
  const f: Feature = r.features.find((x) => x.props.state === 'ok')!;
  calls.length = 0;
  const d = (await feed.featureDetail('bikeshare', f.id))!;
  assert.equal(calls.length, 0);
  assert.equal(d.title, f.props.name);
  assert.equal(d.subtitle, 'Citi Bike · New York, NY');
  assert.equal(d.url, 'https://www.citibikenyc.com/');
  assert.deepEqual(d.sections.map((s) => s.title), ['Availability', 'Station', 'Source']);
  const rows = d.sections.flatMap((s) => s.rows);
  const get = (label: string) => rows.find((x) => x.label === label);
  assert.equal(get('Bikes')!.value, f.props.bikes);
  assert.ok(get('Free docks'));
  assert.equal(get('System')!.value, 'Citi Bike');
  assert.match(String(get('Licence')!.value), /operator/);
  assert.match(String(get('Catalogue')!.value), /CC BY 3\.0/);
  assert.equal(d.feature.id, f.id);
  c.advance(0);
  assert.equal(await feed.featureDetail('bikeshare', 'lyft_nyc:nope'), null);
  assert.equal(await feed.featureDetail('bikeshare', 'nope'), null);
  assert.equal(await feed.featureDetail('bikeshare', 'Paris:1'), null, 'a system that was never loaded');
  await feed.stop();
});

test('station ids that would break the 64 character id limit are skipped, not truncated', async () => {
  const long = 'x'.repeat(60);
  const docs = {
    [`https://${NYC_HOST}/gbfs/2.3/gbfs.json`]: () => fx('lyft-gbfs.json'),
    'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json': () => ({ ttl: 60, data: { stations: [{ station_id: long, name: 'Long', lat: 40.73, lon: -74.0 }, { station_id: 'ok', name: 'Fine', lat: 40.74, lon: -74.0 }] } }),
    'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json': () => ({ ttl: 60, data: { stations: [{ station_id: 'ok', num_bikes_available: 2, num_docks_available: 2 }, { station_id: long, num_bikes_available: 1, num_docks_available: 1 }] } }),
  };
  const { feed } = setup({ docs });
  feed.start();
  await feed.idle();
  const r = await feed.features('bikeshare', q(NYC_VIEW));
  assert.deepEqual(r.features.map((f) => f.id), ['lyft_nyc:ok']);
  await feed.stop();
});

test('catalogue: refreshed daily, cached on disk, a restart does not refetch it until due; fetch failure keeps the bundled list', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-bikes-'));
  try {
    const file = path.join(dir, 'cache', 'bikeshare-systems.json');
    const a = setup({ cacheFile: file });
    a.feed.start();
    await a.feed.idle();
    assert.equal(hostOf(a.calls, 'catalogue.example.org').length, 1);
    assert.equal(a.feed.systemCount, 2, 'the catalogue names two located systems; the filler rows are not in the index');
    assert.equal(a.feed.status().state, 'live');
    assert.equal(a.feed.status().freshnessMs, BIKESHARE_FRESHNESS_MS);
    await a.feed.stop();

    const b = setup({ cacheFile: file, start: NOW + 2 * HOUR });
    b.feed.start();
    await b.feed.idle();
    assert.equal(hostOf(b.calls, 'catalogue.example.org').length, 0, 'cached');
    assert.equal(b.feed.systemCount, 2);
    assert.equal(b.feed.status().lastSuccess, NOW);
    b.c.advance(CATALOGUE_POLL_MS);
    await b.feed.tick();
    assert.equal(hostOf(b.calls, 'catalogue.example.org').length, 1, 'due again after a day');
    await b.feed.stop();

    // catalogue unavailable and nothing cached: the bundled list still serves, and the row says why
    const c = new BikeshareFeed({
      fetch: async () => new Response('x', { status: 500 }),
      index: { version: 1, generatedAt: '', systems: [nycSys, parisSys] },
      now: () => NOW,
      timers: manualTimers,
    });
    c.start();
    await c.idle();
    assert.equal(c.systemCount, 2);
    assert.match(c.status().lastError!, /bundled list/);
    await c.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a catalogue with too few systems is refused instead of emptying the layer', async () => {
  const feed = new BikeshareFeed({
    fetch: async () => new Response('Country Code,Name,Location,System ID,URL,Auto-Discovery URL\nUS,One,X,one,https://a.example,https://a.example/gbfs.json', { status: 200 }),
    index: { version: 1, generatedAt: '', systems: [nycSys, parisSys] },
    now: () => NOW,
    timers: manualTimers,
  });
  feed.start();
  await feed.idle();
  assert.equal(feed.systemCount, 2);
  await feed.stop();
});

test('the shipped index is valid and covers the cities the layer is tested against', () => {
  const idx = parseIndex(JSON.parse(readFileSync(new URL('../../../static-data/gbfs/systems.json', import.meta.url), 'utf8')));
  assert.ok(idx.systems.length > 100, `${idx.systems.length} systems`);
  assert.equal(new Set(idx.systems.map((s) => s.id)).size, idx.systems.length);
  const ids = (box: [number, number, number, number]) => selectSystems(idx.systems, box, 6).chosen.map((s) => s.id);
  assert.ok(ids([-74.05, 40.7, -73.95, 40.78]).includes('lyft_nyc'));
  assert.ok(ids([2.25, 48.83, 2.4, 48.9]).includes('Paris'));
  assert.deepEqual(ids([-40, 0, -39, 1]), []);
  for (const s of idx.systems) assert.ok(isPublicHttpsUrl(s.discoveryUrl), s.id);
});
