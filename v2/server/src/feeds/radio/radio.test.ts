import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clock, jsonResponse, manualTimers } from '../test-utils.ts';
import { RadioFeed, RADIO_CAP, RADIO_FRESHNESS_MS, RADIO_POLL_MS } from './feed.ts';
import { playMode, parseStations, stationFeature, type Station } from './parse.ts';
import { buildStationDetail } from './detail.ts';
import { discoverServers, FALLBACK_SERVERS, serverOrigin, SERVER_LIST_URL, shuffle } from './servers.ts';

const rows = (): any[] => JSON.parse(readFileSync(new URL('./fixtures/radio-browser-stations.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-02T16:30:00Z');

test('parses real Radio Browser records into stations', () => {
  const { stations, skipped } = parseStations(rows());
  assert.equal(skipped, 0);
  assert.equal(stations.length, 12);
  const konga = stations[0]!;
  assert.equal(konga.id, 'f835db87-94b4-4256-a893-b8194316df3f');
  assert.equal(konga.name, 'Konga103.7FM');
  assert.equal(konga.country, 'Nigeria');
  assert.equal(konga.countryCode, 'NG');
  assert.equal(konga.codec, 'MP3');
  assert.equal(konga.bitrate, 96);
  assert.deepEqual([konga.lon, konga.lat], [3.378, 6.5515]);
  assert.deepEqual(konga.tags, ['business', 'commerce', 'hits', 'inspiration', 'music']);
  assert.deepEqual(konga.languages, ['english']);
  assert.equal(konga.streamUrl, 'https://lunar.citrus3.com:8124/stream');
  assert.equal(konga.homepage, 'https://kongafm.com/');
  assert.ok(konga.clicks > 0);
  assert.equal(stations.find((s) => /Radio Paradise/.test(s.name))!.streamUrl.startsWith('http://'), true, 'plain http streams are kept (the client decides)');
});

test('play mode: native codecs play in the browser, HLS and unknown codecs are links', () => {
  const { stations } = parseStations(rows());
  const by = (re: RegExp) => stations.find((s) => re.test(s.name))!;
  assert.equal(playMode(by(/Konga/)), 'audio');
  assert.equal(playMode(by(/Chillout/)), 'audio'); // AAC+
  assert.equal(playMode(by(/Radio Paradise/)), 'audio'); // AAC
  assert.equal(playMode(by(/Deutschlandfunk/)), 'audio'); // OGG
  const hls = stations.filter((s) => s.hls);
  assert.ok(hls.length >= 1);
  for (const s of hls) assert.equal(playMode(s), 'link');
  assert.equal(playMode({ codec: 'UNKNOWN', hls: false }), 'link');
  assert.equal(playMode({ codec: '', hls: false }), 'link');
  assert.equal(playMode({ codec: 'MP3', hls: true }), 'link');
});

test('unusable records are dropped; text is cleaned; links are http(s) only', () => {
  const base = rows()[0];
  const r = (over: Record<string, unknown>) => ({ ...base, stationuuid: crypto.randomUUID(), ...over });
  const good = r({});
  const input = [
    good,
    r({ geo_lat: null, geo_long: null }),
    r({ geo_lat: 0, geo_long: 0 }), // placeholder
    r({ geo_lat: 91, geo_long: 3 }),
    r({ geo_lat: '', geo_long: '' }),
    r({ lastcheckok: 0 }),
    r({ stationuuid: 'not-a-uuid' }),
    r({ name: '   ' }),
    r({ url: 'javascript:alert(1)', url_resolved: 'javascript:alert(1)' }),
    r({ url_resolved: '', url: 'ftp://example.org/x' }),
    { ...good }, // same id as the first
    r({ name: 'Evil\u0000 \n FM', homepage: 'javascript:alert(1)', tags: 'Jazz, jazz , ,SOUL,#,+,0,00s,-', language: 'English,,French', bitrate: 0, url: 'https://user:pw@example.org/s', url_resolved: 'https://user:pw@example.org/s' }),
    r({ url_resolved: 'https://example.org/ok', bitrate: 128, hls: 0, clickcount: 'x' }),
    'nonsense',
    null,
  ];
  const { stations, skipped } = parseStations(input);
  assert.equal(stations.length, 2);
  assert.equal(skipped, 13);
  const evil = stations.find((s) => s.name.startsWith('Evil'))!;
  assert.equal(evil, undefined, 'credentials in a stream URL are refused');
  const ok = stations.find((s) => s.streamUrl === 'https://example.org/ok')!;
  assert.equal(ok.clicks, 0);
  assert.equal(ok.bitrate, 128);

  const cleaned = parseStations([r({ name: 'Evil\u0000 \n FM', homepage: 'javascript:alert(1)', tags: 'Jazz, jazz , ,SOUL,#,+,0,00s,-', language: 'English,,French', bitrate: 0 })]).stations[0]!;
  assert.equal(cleaned.name, 'Evil FM');
  assert.equal(cleaned.homepage, null);
  assert.deepEqual(cleaned.tags, ['jazz', 'soul', '00s'], 'punctuation and single characters are not tags');
  assert.deepEqual(cleaned.languages, ['English', 'French']);
  assert.equal(cleaned.bitrate, null);
  assert.deepEqual(parseStations({ not: 'an array' }), { stations: [], skipped: 0 });
});

test('map features are compact; the detail feature carries stream, homepage, tags and language', () => {
  const s = parseStations(rows()).stations[0]!;
  const compact = stationFeature(s);
  assert.deepEqual(Object.keys(compact.props).sort(), ['bitrate', 'clicks', 'codec', 'country', 'name', 'play']);
  assert.equal(compact.props.play, 'audio');
  assert.equal(compact.label, 'Konga103.7FM');
  const d = buildStationDetail(s, NOW - 3_600_000, NOW);
  assert.equal(d.title, 'Konga103.7FM');
  assert.equal(d.subtitle, 'Lagos, Nigeria');
  assert.equal(d.url, 'https://kongafm.com/');
  assert.equal(d.feature.props.streamUrl, s.streamUrl);
  assert.equal(d.feature.props.homepage, 'https://kongafm.com/');
  assert.equal(d.feature.props.tags, 'business, commerce, hits, inspiration, music');
  assert.equal(d.feature.props.language, 'english');
  const all = d.sections.flatMap((x) => x.rows);
  assert.ok(all.some((r) => r.label === 'Bitrate' && r.value === '96 kbit/s'));
  assert.ok(all.some((r) => r.label === 'Directory fetched' && r.value === '1 h ago'));
  assert.equal(d.sections.at(-1)!.title, 'Source');
});

// ---------------------------------------------------------------- server discovery

test('server discovery: DNS first (A records, reverse names), only radio-browser names accepted', async () => {
  const fetchCalls: string[] = [];
  const servers = await discoverServers({
    resolve4: async (h) => (assert.equal(h, 'all.api.radio-browser.info'), ['1.1.1.1', '2.2.2.2', '3.3.3.3']),
    reverse: async (ip) => ({ '1.1.1.1': ['de1.api.radio-browser.info'], '2.2.2.2': ['evil.example.com'], '3.3.3.3': ['nl1.api.radio-browser.info', 'x.api.radio-browser.info.evil.com'] })[ip]!,
    fetch: async (u) => (fetchCalls.push(u), jsonResponse([])),
    random: () => 0,
  });
  assert.equal(fetchCalls.length, 0);
  assert.ok(servers.includes('https://de1.api.radio-browser.info') && servers.includes('https://nl1.api.radio-browser.info'));
  assert.ok(!servers.some((s) => /evil/.test(s)));
  assert.ok(servers.includes('https://de2.api.radio-browser.info'), 'built-in servers follow as a last resort');
  assert.equal(servers.length, 3);
});

test('server discovery falls back to the HTTP list, then to the built-in servers', async () => {
  const viaHttp = await discoverServers({
    resolve4: async () => {
      throw new Error('ENOTFOUND');
    },
    reverse: async () => [],
    fetch: async (u) => (assert.equal(u, SERVER_LIST_URL), jsonResponse([{ ip: '9.9.9.9', name: 'de1.api.radio-browser.info' }, { ip: '8.8.8.8', name: 'at1.api.radio-browser.info' }])),
    random: () => 0.5,
  });
  assert.deepEqual([...viaHttp].sort().slice(0, 2), ['https://at1.api.radio-browser.info', 'https://de1.api.radio-browser.info']);
  const none = await discoverServers({
    resolve4: async () => {
      throw new Error('no dns');
    },
    reverse: async () => [],
    fetch: async () => new Response('x', { status: 503 }),
    random: () => 0,
  });
  assert.deepEqual(none.sort(), FALLBACK_SERVERS.map((h) => `https://${h}`).sort());
  assert.equal(serverOrigin('all.api.radio-browser.info'), null);
  assert.equal(serverOrigin('DE1.api.radio-browser.info.'), 'https://de1.api.radio-browser.info');
  assert.equal(serverOrigin('api.radio-browser.info'), null);
  assert.equal(serverOrigin(42), null);
  assert.deepEqual(shuffle([1, 2, 3, 4], () => 0).sort(), [1, 2, 3, 4]);
});

// ---------------------------------------------------------------- the feed

function directory(n: number): any[] {
  const base = rows()[0];
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => ({
    ...base,
    stationuuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Station ${String(i).padStart(5, '0')}`,
    geo_lat: -70 + rnd() * 140,
    geo_long: -179 + rnd() * 358,
    clickcount: Math.floor(rnd() * 1000),
    votes: 0,
  }));
}

function setup(opts: { data?: any[]; failHosts?: string[]; cacheFile?: string; pageSize?: number; start?: number; minStations?: number; cap?: number } = {}) {
  const c = clock(opts.start ?? NOW);
  const calls: URL[] = [];
  const data = opts.data ?? directory(1_000);
  const feed = new RadioFeed({
    fetch: async (url) => {
      const u = new URL(url);
      calls.push(u);
      if (opts.failHosts?.includes(u.hostname)) return new Response('down', { status: 503 });
      const q = u.searchParams;
      const off = Number(q.get('offset'));
      const lim = Number(q.get('limit'));
      return jsonResponse(data.slice(off, off + lim));
    },
    dns: { resolve4: async () => ['1.1.1.1'], reverse: async () => ['de1.api.radio-browser.info', 'de2.api.radio-browser.info'] },
    random: () => 0,
    cacheFile: opts.cacheFile,
    pageSize: opts.pageSize ?? 400,
    minStations: opts.minStations ?? 100,
    cap: opts.cap,
    now: c.now,
    timers: manualTimers,
  });
  return { feed, c, calls, data };
}

test('fetches the geo-located directory page by page from one server', async () => {
  const { feed, calls } = setup({ data: directory(1_000) });
  feed.start();
  await feed.idle();
  assert.equal(calls.length, 3); // 400 + 400 + 200
  assert.deepEqual(calls.map((u) => u.searchParams.get('offset')), ['0', '400', '800']);
  const first = calls[0]!;
  assert.equal(first.pathname, '/json/stations/search');
  assert.equal(first.searchParams.get('has_geo_info'), 'true');
  assert.equal(first.searchParams.get('hidebroken'), 'true');
  assert.equal(new Set(calls.map((u) => u.hostname)).size, 1, 'one server serves every page');
  const st = feed.status();
  assert.equal(st.state, 'live');
  assert.equal(st.count, 1_000);
  assert.equal(st.source, 'Radio Browser');
  assert.equal(st.freshnessMs, RADIO_FRESHNESS_MS);
  await feed.stop();
});

test('a server that is down is skipped and the next one answers', async () => {
  // The fixed random source puts de2 first in the shuffled list.
  const { feed, calls } = setup({ failHosts: ['de2.api.radio-browser.info'], data: directory(300), pageSize: 1000 });
  feed.start();
  await feed.idle();
  assert.deepEqual(calls.map((u) => u.hostname), ['de2.api.radio-browser.info', 'de1.api.radio-browser.info']);
  assert.equal(feed.status().state, 'live');
  assert.equal(feed.status().count, 300);
  await feed.stop();
});

test('when every server fails the feed reports an error and keeps the previous list; refresh is every 6 hours', async () => {
  const data = directory(300);
  let down = false;
  const c = clock(NOW);
  const calls: string[] = [];
  const feed = new RadioFeed({
    fetch: async (url) => {
      calls.push(url);
      return down ? new Response('x', { status: 500 }) : jsonResponse(data);
    },
    dns: { resolve4: async () => ['1.1.1.1'], reverse: async () => ['de1.api.radio-browser.info'] },
    pageSize: 1000,
    minStations: 100,
    now: c.now,
    timers: manualTimers,
  });
  feed.start();
  await feed.idle();
  const after1 = calls.length;
  c.advance(RADIO_POLL_MS - 1000);
  await feed.tick();
  assert.equal(calls.length, after1, 'not due yet');
  down = true;
  c.advance(2000);
  await feed.tick();
  assert.ok(calls.length > after1);
  const st = feed.status();
  assert.equal(st.state, 'error');
  assert.match(st.lastError!, /Radio Browser/);
  assert.equal(st.count, 300);
  assert.equal(feed.features('radio', { limit: 10_000 }).features.length, 300, 'old list still served');
  await feed.stop();
});

test('a suspiciously small directory answer does not replace the list', async () => {
  const big = directory(300);
  let data = big;
  const c = clock(NOW);
  const feed = new RadioFeed({
    fetch: async () => jsonResponse(data),
    dns: { resolve4: async () => ['1.1.1.1'], reverse: async () => ['de1.api.radio-browser.info'] },
    pageSize: 1000,
    minStations: 100,
    now: c.now,
    timers: manualTimers,
  });
  feed.start();
  await feed.idle();
  data = big.slice(0, 5);
  c.advance(RADIO_POLL_MS + 1);
  await feed.tick();
  assert.equal(feed.status().count, 300);
  assert.equal(feed.status().state, 'error');
  await feed.stop();
});

test('the station list is cached on disk and a restart does not refetch it until due', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-radio-'));
  try {
    const file = path.join(dir, 'cache', 'radio-stations.json');
    const a = setup({ cacheFile: file, data: directory(500), pageSize: 1000 });
    a.feed.start();
    await a.feed.idle();
    await a.feed.stop();
    assert.equal(a.calls.length, 1);
    const b = setup({ cacheFile: file, data: directory(500), pageSize: 1000, start: NOW + 2 * 3_600_000 });
    b.feed.start();
    await b.feed.idle();
    assert.equal(b.calls.length, 0, 'served from the cache');
    assert.equal(b.feed.status().count, 500);
    assert.equal(b.feed.status().lastSuccess, NOW);
    b.c.advance(RADIO_POLL_MS);
    await b.feed.tick();
    assert.equal(b.calls.length, 1, 'refreshed once the six hours are over');
    await b.feed.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- views and thinning

const key = (f: { geometry: any }) => `${Math.floor((f.geometry.coordinates[0] + 180) / 20)},${Math.floor((f.geometry.coordinates[1] + 90) / 20)}`;

test('world zoom is thinned to the cap, spread over the map, most listened-to first', async () => {
  const { feed, data } = setup({ data: directory(5_000), pageSize: 6_000, cap: 1_500, minStations: 100 });
  feed.start();
  await feed.idle();
  const world = feed.features('radio', { limit: 20_000 });
  assert.equal(world.features.length, 1_500);
  assert.equal(world.truncated, true);
  assert.equal(new Set(world.features.map((f) => f.id)).size, 1_500);
  // every populated 20 degree block keeps something
  const have = new Set(data.map((d) => key({ geometry: { coordinates: [d.geo_long, d.geo_lat] } })));
  const kept = new Set(world.features.map(key));
  for (const k of have) assert.ok(kept.has(k), `block ${k} kept at least one station`);
  // the most listened-to stations in the list survive the cut, and are drawn last (on top)
  const top = [...data].sort((a, b) => b.clickcount - a.clickcount).slice(0, 5);
  const ids = new Set(world.features.map((f) => f.id));
  assert.ok(top.filter((t) => ids.has(t.stationuuid)).length >= 4);
  const clicks = world.features.map((f) => f.props.clicks as number);
  assert.deepEqual(clicks, [...clicks].sort((a, b) => a - b));
  // a world answer is computed once
  assert.equal(feed.features('radio', { limit: 20_000 }), world);
  assert.equal(feed.features('radio', { bbox: [-180, -90, 180, 90], limit: 20_000 }), world);
  // a smaller limit is honoured
  assert.equal(feed.features('radio', { limit: 100 }).features.length, 100);
  await feed.stop();
});

test('a city-sized view returns every station in it, untruncated; antimeridian boxes work', async () => {
  const data = directory(2_000);
  data[0] = { ...data[0], geo_lat: 48.85, geo_long: 2.35 };
  data[1] = { ...data[1], geo_lat: 48.9, geo_long: 2.4 };
  data[2] = { ...data[2], geo_lat: -17.7, geo_long: 179.9 };
  data[3] = { ...data[3], geo_lat: -17.8, geo_long: -179.9 };
  const { feed } = setup({ data, pageSize: 5_000 });
  feed.start();
  await feed.idle();
  const paris = feed.features('radio', { bbox: [2.2, 48.7, 2.6, 49.0], limit: 20_000 });
  assert.equal(paris.truncated, false);
  assert.ok(paris.features.length >= 2);
  assert.ok(paris.features.every((f) => (f.geometry as any).coordinates[0] >= 2.2 && (f.geometry as any).coordinates[0] <= 2.6));
  const fiji = feed.features('radio', { bbox: [179, -19, -179, -17], limit: 20_000 });
  const names = fiji.features.map((f) => f.label);
  assert.ok(names.includes(data[2].name) && names.includes(data[3].name));
  assert.deepEqual(feed.features('radio', { bbox: [-40, -80, -39, -79], limit: 10 }).features.length, 0);
  // a dense box is thinned too, and says so
  const dense = feed.features('radio', { bbox: [-100, -60, 100, 60], limit: 50 });
  assert.equal(dense.features.length, 50);
  assert.equal(dense.truncated, true);
  await feed.stop();
});

test('featureDetail resolves from memory and returns null for an unknown id', async () => {
  const { feed, calls } = setup({ data: directory(300), pageSize: 1000 });
  feed.start();
  await feed.idle();
  const n = calls.length;
  const d = await feed.featureDetail('radio', '00000000-0000-4000-8000-000000000007');
  assert.equal(d!.title, 'Station 00007');
  assert.equal(typeof d!.feature.props.streamUrl, 'string');
  assert.equal(await feed.featureDetail('radio', 'nope'), null);
  assert.equal(calls.length, n);
  assert.ok(RADIO_CAP >= 1_000 && RADIO_CAP <= 2_500);
  await feed.stop();
});

test('stations typed as the Station interface keep working in thinning (no stray fields needed)', () => {
  const s: Station = { id: 'x', name: 'n', lon: 1, lat: 2, country: '', countryCode: '', state: '', languages: [], tags: [], codec: 'MP3', bitrate: null, hls: false, streamUrl: 'https://a.example/s', homepage: null, clicks: 0, votes: 0 };
  assert.equal(stationFeature(s).props.bitrate, undefined);
});
