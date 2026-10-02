import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clock, manualTimers } from '../test-utils.ts';
import { buildLaunchDetail, fmtNet } from './detail.ts';
import { LaunchesFeed, LAUNCHES_FRESHNESS_MS, LAUNCHES_MIN_POLL_MS, LAUNCHES_POLL_MS } from './feed.ts';
import { mapStatus, parseLaunches, shortName } from './parse.ts';

const fixture = (): any => JSON.parse(readFileSync(new URL('./fixtures/ll2-launches.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-02T14:30:00Z');
const MIN = 60_000;
const json = (b: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(b), { status: 200, ...init });

test('parses a real LL2 detailed response', () => {
  const { launches, skipped } = parseLaunches(fixture());
  assert.equal(skipped, 0);
  assert.equal(launches.length, 4);
  const sl = launches[0]!;
  assert.equal(sl.id, '63181269-b125-4c36-951c-c9bd9bbc4b55');
  assert.equal(sl.name, 'Falcon 9 Block 5 | Starlink Group 15-23');
  assert.equal(sl.label, 'Starlink Group 15-23');
  assert.equal(sl.status, 'success');
  assert.equal(sl.statusName, 'Launch Successful');
  assert.equal(sl.vehicle, 'Falcon 9 Block 5');
  assert.ok(/SpaceX|Space Exploration/.test(sl.provider!));
  assert.equal(sl.padName, 'Space Launch Complex 4E');
  assert.equal(sl.locationName, 'Vandenberg SFB, CA, USA');
  assert.deepEqual([sl.lon, sl.lat], [-120.611, 34.632]);
  assert.equal(sl.net, Date.parse('2026-09-02T08:42:12Z'));
  assert.ok(sl.vidUrls.length > 0 && sl.vidUrls[0]!.url.startsWith('https://'));
  const vulcan = launches[3]!;
  assert.equal(vulcan.netPrecision, 'Month');
  assert.equal(vulcan.status, 'upcoming');
});

test('status mapping covers success, failure, partial failure and everything pending', () => {
  assert.equal(mapStatus({ name: 'Launch Successful', abbrev: 'Success' }).status, 'success');
  assert.equal(mapStatus({ name: 'Launch Failure', abbrev: 'Failure' }).status, 'failure');
  assert.equal(mapStatus({ name: 'Launch was a Partial Failure', abbrev: 'Partial Failure' }).status, 'partial');
  for (const n of ['Go for Launch', 'To Be Determined', 'To Be Confirmed', 'On Hold', 'Launch in Flight', 'Payload Deployed']) {
    assert.equal(mapStatus({ name: n, abbrev: n.split(' ')[0] }).status, 'upcoming', n);
  }
  assert.equal(mapStatus(null).status, 'upcoming');
  assert.equal(shortName('Falcon 9 Block 5 | Starlink Group 15-23', null), 'Starlink Group 15-23');
  assert.equal(shortName('Starship Flight 12', 'Flight 12'), 'Flight 12');
  assert.equal(shortName('Electron | ', null), 'Electron | ');
});

test('edge cases: unknown pad (0,0), missing time, location fallback, duplicate ids, bad links', () => {
  const j = fixture();
  const [a, b, c, d] = j.results;
  a.pad.latitude = 0;
  a.pad.longitude = 0;
  a.pad.location.latitude = 0;
  a.pad.location.longitude = 0;
  b.net = null;
  b.window_start = null;
  c.pad.latitude = null; // falls back to the location's coordinates
  c.pad.longitude = null;
  c.vid_urls = [{ title: 'x', url: 'javascript:alert(1)' }, { title: 'ok', url: 'https://example.org/live' }];
  d.id = c.id; // duplicate
  const r = parseLaunches(j);
  assert.equal(r.skipped, 3);
  assert.equal(r.launches.length, 1);
  assert.deepEqual([r.launches[0]!.lon, r.launches[0]!.lat], [c.pad.location.longitude, c.pad.location.latitude]);
  assert.deepEqual(r.launches[0]!.vidUrls, [{ title: 'ok', url: 'https://example.org/live' }]);
  assert.throws(() => parseLaunches({}), /malformed/);
  assert.throws(() => parseLaunches({ results: 'x' }), /malformed/);
  assert.deepEqual(parseLaunches({ count: 0, results: [] }), { launches: [], skipped: 0 });
});

test('NET is formatted honestly for its precision', () => {
  const ms = Date.parse('2026-10-31T00:00:00Z');
  assert.equal(fmtNet(ms, 'Month'), 'October 2026');
  assert.equal(fmtNet(ms, 'Year'), '2026');
  assert.equal(fmtNet(ms, 'Day'), '2026-10-31 (time not set)');
  assert.equal(fmtNet(Date.parse('2026-10-31T14:00:00Z'), 'Hour'), '2026-10-31 14:xx UTC');
  assert.equal(fmtNet(Date.parse('2026-10-31T14:05:09Z'), 'Minute'), '2026-10-31 14:05:09Z');
  assert.equal(fmtNet(Date.parse('2026-10-31T14:05:09Z'), null), '2026-10-31 14:05:09Z');
});

function setup(responses: Array<() => Response | Promise<Response>>, opts: { cacheFile?: string; token?: string; pollMs?: number; start?: number } = {}) {
  const c = clock(opts.start ?? NOW);
  const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
  let i = 0;
  const feed = new LaunchesFeed({
    fetch: async (url, init) => {
      calls.push({ url: new URL(url), headers: init!.headers as Record<string, string> });
      return responses[Math.min(i++, responses.length - 1)]!();
    },
    cacheFile: opts.cacheFile,
    token: opts.token,
    pollMs: opts.pollMs,
    now: c.now,
    timers: manualTimers,
  });
  return { feed, c, calls };
}

test('one request per poll with the 60 day window; features sorted by NET with pad points', async () => {
  const { feed, calls } = setup([() => json(fixture())], { token: ' secret ' });
  feed.start();
  await feed.idle();
  assert.equal(calls.length, 1);
  const u = calls[0]!.url;
  assert.equal(u.origin + u.pathname, 'https://ll.thespacedevs.com/2.3.0/launches/');
  assert.equal(u.searchParams.get('mode'), 'detailed');
  assert.equal(u.searchParams.get('limit'), '100');
  assert.equal(u.searchParams.get('net__gte'), new Date(NOW - 30 * 86_400_000).toISOString());
  assert.equal(u.searchParams.get('net__lte'), new Date(NOW + 30 * 86_400_000).toISOString());
  assert.equal(calls[0]!.headers.Authorization, 'Token secret');
  assert.match(calls[0]!.headers['User-Agent']!, /gods-eye-view/);

  const st = feed.status();
  assert.equal(st.state, 'live');
  assert.equal(st.count, 4);
  assert.equal(st.source, 'Launch Library 2');
  assert.equal(st.freshnessMs, LAUNCHES_FRESHNESS_MS);
  const r = feed.features('launches', { limit: 100 });
  assert.deepEqual(r.features.map((f) => f.label), ['Starlink Group 15-23', 'SDA Tranche 1 Transport Layer A', 'Dragon CRS-2 SpX-35', 'Amazon Leo (LV-01)'].sort((x, y) => Date.parse(fixture().results.find((l: any) => l.name.endsWith(x)).net) - Date.parse(fixture().results.find((l: any) => l.name.endsWith(y)).net)));
  assert.ok(r.features.every((f, i, a) => i === 0 || f.t! >= a[i - 1]!.t!));
  const f0 = r.features[0]!;
  assert.equal(f0.geometry.type, 'Point');
  assert.deepEqual(Object.keys(f0.props).sort(), ['mission', 'net', 'part', 'provider', 'status', 'statusName', 'vehicle']);
  assert.equal(f0.props.part, 'pad');
  assert.equal(f0.props.net, f0.t);
  await feed.stop();
});

test('features: from/to by NET, bbox (incl. antimeridian), cap with truncation', async () => {
  const { feed } = setup([() => json(fixture())]);
  feed.start();
  await feed.idle();
  const all = feed.features('launches', { limit: 100 }).features;
  const times = all.map((f) => f.t!);
  assert.equal(feed.features('launches', { from: times[1]!, limit: 100 }).features.length, 3);
  assert.equal(feed.features('launches', { to: times[1]! - 1, limit: 100 }).features.length, 1);
  // Vandenberg vs Cape Canaveral
  const west = feed.features('launches', { bbox: [-125, 30, -115, 40], limit: 100 }).features;
  assert.ok(west.length >= 1 && west.every((f) => (f.geometry as any).coordinates[0] < -115));
  const east = feed.features('launches', { bbox: [-85, 25, -75, 32], limit: 100 }).features;
  assert.equal(east.length + west.length, 4);
  assert.equal(feed.features('launches', { bbox: [100, -10, -170, 10], limit: 100 }).features.length, 0);
  const capped = feed.features('launches', { limit: 2 });
  assert.equal(capped.features.length, 2);
  assert.equal(capped.truncated, true);
  assert.equal(feed.features('launches', { limit: 4 }).truncated, false);
  await feed.stop();
});

test('rate limiting: the wait in a 429 body is honoured, cached launches keep being served', async () => {
  const { feed, c, calls } = setup([
    () => json(fixture()),
    () => new Response('{"detail":"Request was throttled. Expected available in 2315 seconds."}', { status: 429 }),
    () => json(fixture()),
  ]);
  feed.start();
  await feed.idle();
  c.advance(LAUNCHES_POLL_MS);
  await feed.tick();
  assert.equal(calls.length, 2);
  let st = feed.status();
  assert.equal(st.state, 'error');
  assert.match(st.lastError!, /HTTP 429/);
  assert.equal(st.count, 4, 'stale data still counted and served');
  assert.equal(feed.features('launches', { limit: 10 }).features.length, 4);
  c.advance(2_314_000);
  await feed.tick();
  assert.equal(calls.length, 2, 'still waiting out the throttle');
  c.advance(2_000);
  await feed.tick();
  assert.equal(calls.length, 3);
  st = feed.status();
  assert.equal(st.state, 'live');
  await feed.stop();
});

test('request rate never exceeds the free tier: the interval has a floor and failures back off', async () => {
  const { feed, c, calls } = setup([() => new Response('x', { status: 500 })], { pollMs: 10_000 });
  feed.start();
  await feed.idle();
  for (let i = 0; i < 60; i++) {
    c.advance(MIN);
    await feed.tick();
  }
  // an hour of failing polls, backoff doubling from 1 min up to 2 x the interval
  assert.ok(calls.length <= 8, `made ${calls.length} requests in an hour`);
  const ok = setup([() => json(fixture())], { pollMs: 10_000 });
  ok.feed.start();
  await ok.feed.idle();
  for (let i = 0; i < 60; i++) {
    ok.c.advance(MIN);
    await ok.feed.tick();
  }
  assert.ok(ok.calls.length <= 60 / (LAUNCHES_MIN_POLL_MS / MIN) + 1, `made ${ok.calls.length} requests`);
  await feed.stop();
  await ok.feed.stop();
});

test('disk cache: restart serves cached launches without refetching until the poll is due', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-launches-'));
  const cacheFile = path.join(dir, 'nested', 'launches.json');
  try {
    const first = setup([() => json(fixture())], { cacheFile });
    first.feed.start();
    await first.feed.idle();
    await first.feed.stop();
    assert.equal(JSON.parse(readFileSync(cacheFile, 'utf8')).launches.length, 4);

    // restart 10 minutes later: serve from cache, no request yet
    const second = setup([() => json(fixture())], { cacheFile, start: NOW + 10 * MIN });
    second.feed.start();
    await second.feed.idle();
    assert.equal(second.calls.length, 0);
    assert.equal(second.feed.status().count, 4);
    assert.equal(second.feed.status().state, 'live');
    assert.equal(second.feed.status().lastSuccess, NOW);
    second.c.advance(19 * MIN);
    await second.feed.tick();
    assert.equal(second.calls.length, 0);
    second.c.advance(MIN);
    await second.feed.tick();
    assert.equal(second.calls.length, 1);
    await second.feed.stop();

    // restart long after: cache is shown as stale while a fresh fetch happens at once
    const third = setup([() => new Response('x', { status: 503 })], { cacheFile, start: NOW + 5 * 3_600_000 });
    third.feed.start();
    await third.feed.idle();
    assert.equal(third.calls.length, 1);
    assert.equal(third.feed.status().count, 4);
    assert.equal(third.feed.status().state, 'error');
    assert.equal(third.feed.features('launches', { limit: 10 }).features.length, 4);
    await third.feed.stop();

    // a corrupt cache is ignored
    writeFileSync(cacheFile, '{not json');
    const fourth = setup([() => json(fixture())], { cacheFile, start: NOW });
    fourth.feed.start();
    await fourth.feed.idle();
    assert.equal(fourth.calls.length, 1);
    assert.equal(fourth.feed.status().state, 'live');
    await fourth.feed.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a bad payload leaves previous launches in place', async () => {
  const { feed, c } = setup([() => json(fixture()), () => json({ detail: 'oops' })]);
  feed.start();
  await feed.idle();
  c.advance(LAUNCHES_POLL_MS);
  await feed.tick();
  assert.match(feed.status().lastError!, /malformed Launch Library/);
  assert.equal(feed.status().count, 4);
  await feed.stop();
});

test('detail: mission, NET with precision, window, vehicle, pad, links and source', async () => {
  const { feed } = setup([() => json(fixture())]);
  feed.start();
  await feed.idle();
  const id = '63181269-b125-4c36-951c-c9bd9bbc4b55';
  const d = (await feed.featureDetail('launches', id))!;
  assert.equal(d.title, 'Starlink Group 15-23');
  assert.match(d.subtitle!, /^Falcon 9 Block 5 · /);
  assert.deepEqual(d.sources, ['Launch Library 2 (The Space Devs)']);
  const rows = new Map(d.sections.flatMap((s) => s.rows).map((r) => [r.label, r]));
  assert.equal(rows.get('Status')!.value, 'Launch Successful');
  assert.equal(rows.get('NET')!.value, '2026-09-02 08:42:12Z');
  assert.match(rows.get('NET')!.hint!, /d .*ago/);
  assert.equal(rows.get('Pad')!.value, 'Space Launch Complex 4E');
  assert.equal(rows.get('Rocket')!.value, 'Falcon 9 Block 5');
  assert.match(String(rows.get('Coordinates')!.value), /34\.6320° N, 120\.6110° W/);
  assert.ok(d.sections.find((s) => s.title === 'Links')!.rows.some((r) => r.label === 'Webcast'));
  assert.equal(d.url, 'https://www.spacex.com/launches/sl-15-23');
  assert.equal(d.feature.id, id);

  const month = parseLaunches(fixture()).launches[3]!;
  const md = buildLaunchDetail(month, NOW);
  const mrows = new Map(md.sections.flatMap((s) => s.rows).map((r) => [r.label, r]));
  assert.equal(mrows.get('NET')!.value, 'October 2026');
  assert.equal(mrows.get('NET')!.hint, 'month precision');
  assert.equal(mrows.get('Window'), undefined, 'identical window start and end adds nothing');
  assert.equal(await feed.featureDetail('launches', 'nope'), null);
  await feed.stop();
});
