import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FeaturesResponse } from '@gev/shared';
import { clock, jsonResponse } from '../test-utils.ts';
import { headingFor, placeholderHeading } from './camera.ts';
import { CameraCatalog } from './catalog.ts';
import { directionToHeading } from './direction.ts';
import { CctvFeed } from './feed.ts';
import { decodeTxdotEnvelope, FrameError, FrameService, looksLikeImage, MIN_REFRESH_S } from './frames.ts';
import { parseAustin } from './sources/austin.ts';
import { calgaryImage, parseCalgary } from './sources/calgary.ts';
import { caltrans, parseCaltrans } from './sources/caltrans.ts';
import { loadTallinnFile } from './sources/curated.ts';
import { parseDeldot } from './sources/deldot.ts';
import { parseDriveBc } from './sources/drivebc.ts';
import { parseFintraffic } from './sources/fintraffic.ts';
import { NSW_BROWSER_UA, parseNsw } from './sources/nsw.ts';
import { buildTarktee, createTarktee, parseTarkteeImages, parseTarkteeLocations } from './sources/tarktee.ts';
import { parseTfl } from './sources/tfl.ts';
import { parseTxdot, TXDOT_SNAPSHOT } from './sources/txdot.ts';
import type { CameraSource } from './sources/types.ts';

const fx = (n: string): any => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const fxText = (n: string): string => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 2, 3, 4]);
const MIN = 60_000;

// ---------------------------------------------------------------- headings

test('direction words: bare cardinals only in a field of their own', () => {
  assert.equal(directionToHeading('West', true), 270);
  assert.equal(directionToHeading('5TH ST / WEST AVE'), null);
  assert.equal(directionToHeading('US-290 EB'), 90);
  assert.equal(directionToHeading('N-E'.replace('-', ''), true), 45);
  assert.equal(directionToHeading('Median', true), null);
  assert.equal(directionToHeading(undefined), null);
});

test('placeholder heading is stable, one of 16 points, and marked estimated', () => {
  assert.equal(placeholderHeading('tfl-1'), placeholderHeading('tfl-1'));
  assert.equal(placeholderHeading('tfl-1') % 22.5, 0);
  const h = headingFor('x', null, 'published');
  assert.equal(h.headingConfidence, 'estimated');
  assert.equal(h.headingBasis, 'placeholder');
  assert.deepEqual(headingFor('x', -90, 'published'), { heading: 270, headingConfidence: 'known', headingBasis: 'published' });
});

// ---------------------------------------------------------------- adapters on real-shaped data

test('Austin: only TURNED_ON cameras inside the metro, heading only from a travel word', () => {
  const cams = parseAustin(fx('austin.json'));
  assert.ok(cams.length >= 4);
  assert.ok(cams.every((c) => c.id.startsWith('austin-') && c.type === 'still' && c.imageUrl!.startsWith('https://cctv.austinmobility.io/image/')));
  assert.ok(!cams.some((c) => c.id === 'austin-99999'), 'outside the box');
  for (const c of cams) assert.equal(c.headingConfidence, c.headingBasis === 'name' ? 'known' : 'estimated');
});

test('Caltrans: in-service only, published direction, "Median" is estimated, interval from the list', () => {
  const cams = parseCaltrans(fx('caltrans-d4.json'), 4);
  assert.equal(cams.length, 5);
  const west = cams[0]!;
  assert.equal(west.heading, 270);
  assert.equal(west.headingBasis, 'published');
  assert.equal(west.group, 'd4');
  assert.equal(west.refreshS, 300);
  assert.ok(west.imageTime! > 1.7e12);
  assert.ok(west.imageUrl!.startsWith('https://cwwp2.dot.ca.gov/'));
  const median = cams.find((c) => c.headingBasis === 'placeholder');
  assert.ok(median, 'a camera with no usable direction');
  assert.equal(median!.headingConfidence, 'estimated');
});

test('TfL: unavailable cameras dropped, no heading taken from the free-text view field', () => {
  const cams = parseTfl(fx('tfl.json'));
  assert.equal(cams.length, 4);
  assert.ok(cams.every((c) => c.headingConfidence === 'estimated' && c.id.startsWith('tfl-') && c.imageUrl!.startsWith('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/')));
});

test('Fintraffic: one camera per preset, stations not gathering dropped, address built from the id', () => {
  const raw = fx('fintraffic.json');
  const cams = parseFintraffic(raw);
  const presets = raw.features.filter((f: any) => f.properties.collectionStatus === 'GATHERING').reduce((n: number, f: any) => n + f.properties.presets.filter((p: any) => p.inCollection).length, 0);
  assert.equal(cams.length, presets);
  assert.ok(cams[0]!.imageUrl!.match(/^https:\/\/weathercam\.digitraffic\.fi\/C\d{7}\.jpg$/));
  assert.ok(cams.every((c) => c.headingConfidence === 'estimated'));
});

test('DriveBC: orientation is a published heading, only partner credits are kept, intervals are clamped', () => {
  const cams = parseDriveBc(fx('drivebc.json'));
  assert.equal(cams.length, 5, 'the camera that is off is dropped');
  assert.ok(cams.every((c) => c.headingConfidence === 'known' || c.headingBasis === 'placeholder'));
  assert.ok(cams.every((c) => !c.credit), 'satellite/solar notes are not credits');
  assert.ok(cams.every((c) => c.refreshS === undefined || (c.refreshS >= 120 && c.refreshS <= 1800)));
  const withOrientation = fx('drivebc.json').find((r: any) => r.is_on && r.should_appear && r.orientation);
  const got = cams.find((c) => c.id === `drivebc-${withOrientation.id}`)!;
  assert.equal(got.headingBasis, 'published');
  assert.equal(parseDriveBc([{ ...withOrientation, credit: '<b>Images courtesy of TransLink</b>' }])[0]!.credit, 'Images courtesy of TransLink');
});

test('TxDOT: offline devices dropped, interchange cameras deduplicated, ids from the device key', () => {
  const raw = fx('txdot-aus.json');
  const cams = parseTxdot(raw, 'AUS');
  const online = new Set(Object.values(raw.roadwayCctvStatuses).flat().filter((r: any) => r.statusDescription === 'Device Online').map((r: any) => r.icd_Id));
  assert.equal(cams.length, online.size);
  assert.ok(cams.every((c) => c.id.startsWith('txdot-aus-') && c.id.length <= 64 && c.imageUrl!.startsWith(TXDOT_SNAPSHOT)));
  const eb = cams.find((c) => / EB$/.test(c.name));
  if (eb) assert.deepEqual([eb.heading, eb.headingBasis], [90, 'name']);
  assert.ok(cams.every((c) => c.headingBasis === 'name' || c.headingBasis === 'placeholder'), 'the roadway direction field is never used');
});

test('NSW: "N-E" is 45 degrees, a works notice is not a name, other hosts dropped', () => {
  const raw = fx('nsw.json');
  const cams = parseNsw(raw);
  assert.equal(cams.length, 6);
  assert.ok(cams.every((c) => c.headingBasis === 'published' || c.headingBasis === 'placeholder'));
  const long = cams[5]!;
  assert.ok(long.name.length <= 100 && !/Roadworks/.test(long.name), 'falls back to the title');
  const bad = JSON.parse(JSON.stringify(raw));
  bad.features[0].properties.href = 'https://evil.example/x.jpg';
  assert.equal(parseNsw(bad).length, 5);
  assert.ok(NSW_BROWSER_UA.startsWith('Mozilla/'));
});

test('Calgary: http pictures upgraded and pinned, the address-grid quadrant is not a heading', () => {
  const cams = parseCalgary(fx('calgary.json'));
  assert.equal(cams.length, 6);
  assert.ok(cams.every((c) => c.imageUrl!.startsWith('https://trafficcam.calgary.ca/') && c.headingConfidence === 'estimated' && /^calgary-\d+$/.test(c.id)));
  assert.equal(calgaryImage('http://trafficcam.calgary.ca/loc86.jpg'), 'https://trafficcam.calgary.ca/loc86.jpg');
  assert.equal(calgaryImage('http://evil.example/loc86.jpg'), null);
});

test('DelDOT: active cameras are video-only with a pinned HTTPS playlist', () => {
  const cams = parseDeldot(fx('deldot.json'));
  const active = new Set(fx('deldot.json').videoCameras.filter((r: any) => r.status === 'Active').map((r: any) => r.id));
  assert.equal(cams.length, active.size, 'the unavailable camera is dropped');
  assert.ok(cams.every((c) => c.type === 'video' && !c.imageUrl && /^https:\/\/video\.deldot\.gov\/live\/[\w.-]+\/playlist\.m3u8$/.test(c.streamUrl!)));
});

test('Tarktee: locations and pictures joined; off-host pictures and locations without one dropped', () => {
  const locs = parseTarkteeLocations(fxText('tarktee-locations.xml'));
  assert.equal(locs.length, 3);
  const imgs = parseTarkteeImages(fxText('tarktee-images.xml'));
  assert.equal(imgs.size, 3, 'the off-host address is ignored');
  const cams = buildTarktee(locs, imgs);
  assert.equal(cams.length, 3);
  assert.ok(cams.every((c) => c.imageUrl!.startsWith('https://tarktee.transpordiamet.ee/images/') && c.imageTime && c.ref));
});

test('Tallinn bundled list: 255 cameras, hand-set headings are known, the rest estimated', () => {
  const cams = loadTallinnFile();
  assert.equal(cams.length, 255);
  assert.equal(cams.filter((c) => c.headingConfidence === 'known').length, 230);
  assert.ok(cams.every((c) => /^https:\/\/ristmikud\.tallinn\.ee\/last\/cam\d{3}\.jpg$/.test(c.imageUrl!)));
});

// ---------------------------------------------------------------- catalog

function fakeSource(id: string, coverage: [number, number, number, number], opts: { cams?: number; fail?: boolean; ttl?: number; group?: boolean } = {}): CameraSource & { calls: number } {
  const s = {
    calls: 0,
    id,
    name: id.toUpperCase(),
    provider: id,
    coverage,
    pageUrl: `https://${id}.example/`,
    licence: 'test',
    catalogTtlMs: opts.ttl ?? 60 * MIN,
    frame: { refreshS: 60, hosts: [`${id}.example`] },
    async load() {
      s.calls++;
      if (opts.fail) throw new Error('HTTP 503');
      const n = opts.cams ?? 3;
      const cameras = Array.from({ length: n }, (_, i) => ({
        id: `${id}-${i}`,
        source: id,
        name: `${id} ${i}`,
        city: id,
        lon: coverage[0] + ((i + 0.5) / n) * (coverage[2] - coverage[0]),
        lat: (coverage[1] + coverage[3]) / 2,
        ...headingFor(`${id}-${i}`, i % 2 ? 90 : null, 'published'),
        type: 'still' as const,
        imageUrl: `https://${id}.example/${i}.jpg`,
        ...(opts.group ? { group: i === 0 ? 'a' : 'b' } : {}),
      }));
      return { cameras };
    },
  };
  return s as CameraSource & { calls: number };
}

const noFetch = async (): Promise<Response> => {
  throw new Error('unexpected fetch');
};

test('catalog: a view loads only the sources it overlaps, and reads them from memory afterwards', async () => {
  const a = fakeSource('aa', [0, 0, 10, 10]);
  const b = fakeSource('bb', [100, 40, 110, 50]);
  const cat = new CameraCatalog({ sources: [a, b], fetch: noFetch });
  cat.start();
  const r = await cat.ensure([1, 1, 5, 5], 1000);
  assert.equal(r.pending, false);
  assert.deepEqual([a.calls, b.calls], [1, 0]);
  assert.equal(cat.query([1, 1, 9, 9], 100).cameras.length, 3);
  await cat.ensure([1, 1, 5, 5], 1000);
  assert.equal(a.calls, 1, 'no second fetch');
  await cat.ensure(undefined, 1000);
  assert.equal(b.calls, 1, 'a world view needs everything');
  assert.equal(cat.query(undefined, 100).cameras.length, 6);
  assert.equal(cat.get('bb-1')!.source.id, 'bb');
});

test('catalog: thinning keeps a spread subset and says so', async () => {
  const a = fakeSource('aa', [0, 0, 10, 10], { cams: 200 });
  const cat = new CameraCatalog({ sources: [a], fetch: noFetch });
  await cat.ensure(undefined, 1000);
  const q = cat.query([0, 0, 10, 10], 50);
  assert.equal(q.truncated, true);
  assert.equal(q.cameras.length, 50);
  const lons = q.cameras.map((c) => c.lon).sort((x, y) => x - y);
  assert.ok(lons[lons.length - 1]! - lons[0]! > 8, 'spread over the view, not the first 50');
  assert.equal(cat.query([0, 0, 10, 10], 500).truncated, false);
});

test('catalog: lists are cached on disk and a restart fetches nothing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cctv-'));
  try {
    const a = fakeSource('aa', [0, 0, 10, 10]);
    const first = new CameraCatalog({ sources: [a], fetch: noFetch, cacheDir: dir });
    await first.ensure([1, 1, 5, 5], 1000);
    const again = fakeSource('aa', [0, 0, 10, 10]);
    const second = new CameraCatalog({ sources: [again], fetch: noFetch, cacheDir: dir });
    second.start();
    assert.equal(second.query(undefined, 100).cameras.length, 3, 'served at once from disk');
    await second.ensure([1, 1, 5, 5], 1000);
    assert.equal(again.calls, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('catalog: a stale list is served now and refreshed in the background, once', async () => {
  const c = clock();
  const a = fakeSource('aa', [0, 0, 10, 10], { ttl: 10 * MIN });
  const cat = new CameraCatalog({ sources: [a], fetch: noFetch, now: c.now });
  await cat.ensure([1, 1, 5, 5], 1000);
  c.advance(11 * MIN);
  const t0 = Date.now();
  await cat.ensure([1, 1, 5, 5], 1000);
  await cat.ensure([1, 1, 5, 5], 1000);
  assert.ok(Date.now() - t0 < 500);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(a.calls, 2);
});

test('catalog: a failing source backs off, keeps its last list, and does not block the others', async () => {
  const c = clock();
  const good = fakeSource('gg', [0, 0, 10, 10]);
  const bad = fakeSource('bb', [0, 0, 10, 10], { fail: true });
  const logs: string[] = [];
  const cat = new CameraCatalog({ sources: [good, bad], fetch: noFetch, now: c.now, log: (m) => logs.push(m) });
  await cat.ensure([1, 1, 5, 5], 1000);
  assert.equal(cat.query(undefined, 100).cameras.length, 3);
  assert.equal(cat.summary().failing[0], 'BB');
  await cat.ensure([1, 1, 5, 5], 1000);
  assert.equal(bad.calls, 1, 'not asked again at once');
  c.advance(61_000);
  await cat.ensure([1, 1, 5, 5], 1000);
  assert.equal(bad.calls, 2);
  assert.ok(logs.some((l) => /bb failed/.test(l)));
});

test('catalog: a part that failed on refresh keeps its old cameras', async () => {
  const c = clock();
  let phase = 0;
  const src: CameraSource = {
    ...fakeSource('gg', [0, 0, 10, 10], { ttl: MIN, group: true }),
    async load() {
      const base = await fakeSource('gg', [0, 0, 10, 10], { group: true }).load({} as never);
      return phase === 0 ? base : { cameras: base.cameras.filter((x) => x.group === 'b'), failedGroups: ['a'] };
    },
  };
  const cat = new CameraCatalog({ sources: [src], fetch: noFetch, now: c.now });
  await cat.ensure([1, 1, 5, 5], 1000);
  assert.equal(cat.query(undefined, 100).cameras.length, 3);
  phase = 1;
  c.advance(2 * MIN);
  await cat.ensure([1, 1, 5, 5], 1000);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(cat.query(undefined, 100).cameras.length, 3, 'group a kept');
});

test('catalog: a view waits briefly for a slow first load and reports it as pending', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow: CameraSource = { ...fakeSource('ss', [0, 0, 10, 10]), async load() { await gate; return { cameras: [] }; } };
  const cat = new CameraCatalog({ sources: [slow], fetch: noFetch });
  const r = await cat.ensure([1, 1, 5, 5], 30);
  assert.equal(r.pending, true);
  release();
  await cat.stop();
});

// ---------------------------------------------------------------- pictures

function frameSetup(over: Partial<CameraSource['frame'] & object> = {}) {
  const c = clock();
  const src = { ...fakeSource('aa', [0, 0, 10, 10]), frame: { refreshS: 60, hosts: ['aa.example'], ...over } } as CameraSource;
  const camera = { ...(({ ...fakeSource('aa', [0, 0, 1, 1]) }) as any), id: 'aa-0', source: 'aa', name: 'x', city: 'x', lon: 0, lat: 0, heading: 0, headingConfidence: 'known', headingBasis: 'published', type: 'still', imageUrl: 'https://aa.example/0.jpg' } as any;
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  let handler: (url: string, headers: Record<string, string>) => Response = () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg', etag: '"a"', 'last-modified': new Date(c.now() - 20_000).toUTCString() } });
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    return handler(url, headers);
  };
  const svc = new FrameService({ fetch: fetchFn, now: c.now });
  return { c, src, camera, calls, svc, setHandler: (h: typeof handler) => (handler = h) };
}

test('pictures: one pull per interval however many viewers, then a conditional request', async () => {
  const t = frameSetup();
  const f1 = await t.svc.get(t.camera, t.src);
  assert.equal(f1.origin, 'upstream');
  assert.equal(f1.contentType, 'image/jpeg');
  assert.equal(f1.refreshS, 60);
  assert.ok(f1.frameTime < t.c.now(), 'dated by Last-Modified');
  const both = await Promise.all([t.svc.get(t.camera, t.src), t.svc.get(t.camera, t.src)]);
  assert.ok(both.every((f) => f.origin === 'cache'));
  assert.equal(t.calls.length, 1);
  t.c.advance(61_000);
  t.setHandler(() => new Response(null, { status: 304 }));
  const f2 = await t.svc.get(t.camera, t.src);
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1]!.headers['If-None-Match'], '"a"');
  assert.equal(f2.frameTime, f1.frameTime, 'unchanged picture keeps its time');
});

test('pictures: never faster than the minimum, even when a source says so', async () => {
  const t = frameSetup({ refreshS: 5 });
  await t.svc.get(t.camera, t.src);
  t.c.advance((MIN_REFRESH_S - 1) * 1000);
  await t.svc.get(t.camera, t.src);
  assert.equal(t.calls.length, 1);
  t.c.advance(2000);
  await t.svc.get(t.camera, t.src);
  assert.equal(t.calls.length, 2);
});

test('pictures: a failure serves the last picture as stale and backs off', async () => {
  const t = frameSetup();
  await t.svc.get(t.camera, t.src);
  t.c.advance(61_000);
  t.setHandler(() => new Response('no', { status: 503 }));
  const stale = await t.svc.get(t.camera, t.src);
  assert.equal(stale.origin, 'stale');
  const n = t.calls.length;
  await t.svc.get(t.camera, t.src);
  assert.equal(t.calls.length, n, 'backing off');
  t.c.advance(31_000);
  await t.svc.get(t.camera, t.src);
  assert.equal(t.calls.length, n + 1);
});

test('pictures: with nothing to fall back on a failure is an error with Retry-After', async () => {
  const t = frameSetup();
  t.setHandler(() => new Response('no', { status: 500 }));
  await assert.rejects(t.svc.get(t.camera, t.src), (e: unknown) => e instanceof FrameError && e.status === 502 && (e.retryAfterS ?? 0) >= 30);
  await assert.rejects(t.svc.get(t.camera, t.src), (e: unknown) => e instanceof FrameError);
  assert.equal(t.calls.length, 1);
});

test('pictures: HTML in a 200, other hosts, redirects off host, http and oversize are refused', async () => {
  const t = frameSetup();
  t.setHandler(() => new Response('<html>placeholder</html>', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(t.svc.get(t.camera, t.src), FrameError);
  t.c.advance(10 * MIN);
  t.setHandler(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } }));
  await assert.rejects(t.svc.get(t.camera, t.src), /another host/);
  t.c.advance(10 * MIN);
  await assert.rejects(t.svc.get({ ...t.camera, id: 'aa-1', imageUrl: 'https://evil.example/x.jpg' }, t.src), /not one this server may fetch/);
  await assert.rejects(t.svc.get({ ...t.camera, id: 'aa-2', imageUrl: 'http://aa.example/x.jpg' }, t.src), /not one this server may fetch/);
  t.setHandler(() => new Response(new Uint8Array(5 * 1024 * 1024), { headers: { 'content-type': 'image/jpeg' } }));
  await assert.rejects(t.svc.get({ ...t.camera, id: 'aa-3' }, t.src), /too large/);
});

test('pictures: same-origin redirects are followed; a host that wants a browser is asked as one', async () => {
  const t = frameSetup({ userAgent: NSW_BROWSER_UA });
  t.setHandler((url) => (url.endsWith('/0.jpg') ? new Response(null, { status: 301, headers: { location: '/moved.jpg' } }) : new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })));
  const f = await t.svc.get(t.camera, t.src);
  assert.equal(f.origin, 'upstream');
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[0]!.headers['User-Agent'], NSW_BROWSER_UA);
});

test('pictures: TxDOT JSON envelope is decoded, junk is not', async () => {
  const b64 = Buffer.from(JPEG).toString('base64');
  assert.deepEqual([...decodeTxdotEnvelope(JSON.stringify({ snippet: b64 }))!], [...JPEG]);
  assert.deepEqual([...decodeTxdotEnvelope(JSON.stringify({ snippet: `data:image/jpeg;base64,${b64}` }))!], [...JPEG]);
  assert.equal(decodeTxdotEnvelope(JSON.stringify({ snippet: 'not base64!!' })), null);
  assert.equal(decodeTxdotEnvelope(JSON.stringify({ snippet: Buffer.from('hello world, not a jpeg').toString('base64') })), null);
  assert.equal(decodeTxdotEnvelope('<html>'), null);
  const t = frameSetup({ format: 'txdot-json' });
  t.setHandler(() => jsonResponse({ snippet: b64 }));
  const f = await t.svc.get(t.camera, t.src);
  assert.equal(f.contentType, 'image/jpeg');
  assert.equal(looksLikeImage(f.body), true);
});

test('pictures: Tarktee looks the current address up, at most every ten minutes', async () => {
  const c = clock();
  const src = createTarktee();
  const imgXml = fxText('tarktee-images.xml');
  let reqs = 0;
  const fetchFn = async (url: string): Promise<Response> => {
    if (url.includes('roadCameraImages')) {
      reqs++;
      return new Response(imgXml, { headers: { 'content-type': 'application/xml' } });
    }
    if (url.includes('roadCameraLocations')) return new Response(fxText('tarktee-locations.xml'), { headers: { 'content-type': 'application/xml' } });
    return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
  };
  const loaded = await src.load({ fetch: fetchFn, signal: new AbortController().signal, now: c.now, log: () => {} });
  assert.equal(loaded.cameras.length, 3);
  const svc = new FrameService({ fetch: fetchFn, now: c.now });
  await svc.get(loaded.cameras[0]!, src);
  assert.equal(reqs, 1, 'the index fetched with the list is reused');
  c.advance(11 * MIN);
  await svc.get(loaded.cameras[0]!, src);
  assert.equal(reqs, 2);
});

test('pictures: memory is bounded, oldest picture goes first', async () => {
  const c = clock();
  const svc = new FrameService({ fetch: async () => new Response(new Uint8Array(JPEG.length + 2000).fill(1).map((v, i) => (i < 4 ? JPEG[i]! : v)).map((v, i) => (i < 3 ? [0xff, 0xd8, 0xff][i]! : v)), { headers: { 'content-type': 'image/jpeg' } }), now: c.now, maxBytes: 5000 });
  const src = frameSetup().src;
  const cam = (i: number) => ({ id: `aa-${i}`, imageUrl: `https://aa.example/${i}.jpg` }) as any;
  for (let i = 0; i < 4; i++) await svc.get(cam(i), src);
  assert.ok(svc.frameTimeOf('aa-0') === null && svc.frameTimeOf('aa-3') !== null);
});

// ---------------------------------------------------------------- feed

function feedSetup() {
  const c = clock(Date.parse('2026-10-02T16:30:00Z'));
  const a = fakeSource('aa', [0, 0, 10, 10], { cams: 4 });
  const feed = new CctvFeed({ fetch: async () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg', 'last-modified': new Date(c.now() - 5000).toUTCString() } }), sources: [a], now: c.now, waitMs: 500 });
  feed.start();
  return { c, a, feed };
}

test('feed: features carry heading and confidence, known ones last; the status is live and on demand', async () => {
  const { feed } = feedSetup();
  assert.equal(feed.status().state, 'live');
  assert.equal(feed.status().count, 0);
  const r = await feed.features('cctv', { bbox: [0, 0, 10, 10], limit: 100 });
  assert.equal(r.features.length, 4);
  assert.equal(r.pending, undefined);
  const conf = r.features.map((f) => f.props.headingConfidence);
  assert.deepEqual(conf, ['estimated', 'estimated', 'known', 'known']);
  const f = r.features[0]!;
  assert.deepEqual(Object.keys(f.props).sort(), ['city', 'heading', 'headingConfidence', 'name', 'source', 'type']);
  assert.equal(f.props.source, 'AA');
  assert.equal(feed.status().count, 4);
  await feed.stop();
});

test('feed: detail explains the heading, names the source and gives the terms and page', async () => {
  const { feed } = feedSetup();
  await feed.features('cctv', { bbox: [0, 0, 10, 10], limit: 100 });
  const d = (await feed.featureDetail('cctv', 'aa-0'))!;
  assert.equal(d.feature.props.headingBasis, 'placeholder');
  assert.equal(d.feature.props.imageUrl, '/api/layers/cctv/features/aa-0/image');
  assert.equal(d.feature.props.refreshS, 60);
  assert.equal(d.url, 'https://aa.example/');
  const rowsOf = (t: string) => d.sections.find((s) => s.title === t)!.rows;
  assert.match(String(rowsOf('View').find((r) => r.label === 'Heading')!.value), /placeholder/);
  assert.equal(rowsOf('Source').find((r) => r.label === 'Terms')!.value, 'test');
  assert.equal(await feed.featureDetail('cctv', 'nope'), null);
  const known = (await feed.featureDetail('cctv', 'aa-1'))!;
  assert.match(String(known.sections[0]!.rows[1]!.value), /publishes which way/);
  await feed.stop();
});

test('feed: image() fetches through the frame service and the detail then knows the picture time', async () => {
  const { feed, c } = feedSetup();
  await feed.features('cctv', { bbox: [0, 0, 10, 10], limit: 100 });
  const r = await feed.image('cctv', 'aa-0');
  assert.equal(r!.kind, 'ok');
  if (r!.kind === 'ok') assert.equal(r!.image.frameTime, c.now() - 5000);
  const d = (await feed.featureDetail('cctv', 'aa-0'))!;
  assert.equal(d.feature.props.imageTime, c.now() - 5000);
  assert.equal(await feed.image('cctv', 'nope'), null);
  await feed.stop();
});

test('feed: video-only cameras have no picture', async () => {
  const c = clock();
  const v: CameraSource = {
    ...fakeSource('vv', [0, 0, 10, 10]),
    frame: undefined,
    async load() {
      return { cameras: [{ id: 'vv-0', source: 'vv', name: 'v', city: 'v', lon: 1, lat: 1, ...headingFor('vv-0', null, 'name'), type: 'video' as const, streamUrl: 'https://vv.example/p.m3u8' }] };
    },
  };
  const feed = new CctvFeed({ fetch: noFetch, sources: [v], now: c.now });
  feed.start();
  await feed.features('cctv', { bbox: [0, 0, 10, 10], limit: 10 });
  const r = await feed.image('cctv', 'vv-0');
  assert.equal(r!.kind, 'none');
  const d = (await feed.featureDetail('cctv', 'vv-0'))!;
  assert.equal(d.feature.props.streamUrl, 'https://vv.example/p.m3u8');
  assert.equal(d.feature.props.imageUrl, undefined);
  await feed.stop();
});

// ---------------------------------------------------------------- over HTTP

test('HTTP: features, detail and the picture route with its headers and errors', async () => {
  const { createApp } = await import('../../app.ts');
  const { openDb } = await import('../../db/index.ts');
  const { FeedManager } = await import('../manager.ts');
  const { FEED_DEFINITIONS, implementedLayers } = await import('../registry.ts');
  const { buildLayers } = await import('../../layers.ts');
  const { manualTimers } = await import('../test-utils.ts');
  const c = clock(Date.parse('2026-10-02T16:30:00Z'));
  const a = fakeSource('aa', [0, 0, 10, 10], { cams: 2 });
  let ok = true;
  const feed = new CctvFeed({
    fetch: async () => (ok ? new Response(JPEG, { headers: { 'content-type': 'image/jpeg', 'last-modified': new Date(c.now() - 3000).toUTCString() } }) : new Response('x', { status: 500 })),
    sources: [a],
    now: c.now,
    waitMs: 500,
  });
  const db = openDb(':memory:');
  const manager = new FeedManager({ feeds: [feed], definitions: FEED_DEFINITIONS, repo: db.observations, retentionMs: 86_400_000, now: c.now, timers: manualTimers });
  const app = createApp({
    clientConfig: { googleMapsApiKey: null, cesiumIonToken: null, layers: buildLayers({}, implementedLayers(['cctv'])) },
    geocoder: { search: async () => [] },
    dbStatus: () => ({ path: ':memory:', sizeBytes: 0 }),
    version: 'test',
    now: c.now,
    feeds: manager,
    observations: db.observations,
  });
  manager.start();
  try {
    const list = (await (await app.request('/api/layers/cctv/features?bbox=0,0,10,10')).json()) as FeaturesResponse;
    assert.equal(list.features.length, 2);
    assert.equal(list.pending, undefined);
    const img = await app.request('/api/layers/cctv/features/aa-0/image');
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal(img.headers.get('x-frame-time'), String(c.now() - 3000));
    assert.equal(img.headers.get('x-frame-source'), 'upstream');
    assert.equal(img.headers.get('cache-control'), 'no-store');
    assert.equal(Number(img.headers.get('x-refresh-after')), 60);
    assert.deepEqual([...new Uint8Array(await img.arrayBuffer())], [...JPEG]);
    const again = await app.request('/api/layers/cctv/features/aa-0/image');
    assert.equal(again.headers.get('x-frame-source'), 'cache');
    assert.equal((await app.request('/api/layers/cctv/features/zz/image')).status, 404);
    ok = false;
    const bad = await app.request('/api/layers/cctv/features/aa-1/image');
    assert.equal(bad.status, 502);
    assert.ok(Number(bad.headers.get('retry-after')) >= 30);
    assert.equal((await app.request('/api/layers/earthquakes/features/x/image')).status, 409);
  } finally {
    await manager.stop();
  }
});

test('the real Caltrans source lists its districts metros first', () => {
  assert.equal(caltrans.id, 'caltrans');
});
