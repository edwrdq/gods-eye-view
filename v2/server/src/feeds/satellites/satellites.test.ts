import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clock, manualTimers } from '../test-utils.ts';
import { CELESTRAK_MIN_REFRESH_MS, DEFAULT_GROUPS, SATELLITES_FRESHNESS_MS, SATELLITES_REFRESH_MS, SatellitesFeed } from './feed.ts';
import { parseTle, tleChecksum, tleEpoch, validLine } from './tle.ts';

const STATIONS = readFileSync(new URL('./fixtures/stations.tle', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-02T14:30:00Z');
const HOUR = 3_600_000;
const ISS1 = '1 25544U 98067A   26275.01380287  .00003738  00000+0  76743-4 0  9992';
const ISS2 = '2 25544  51.6312 131.4121 0006946 211.9293 148.1275 15.48707684588318';

/** Same text with one epoch digit changed on every line 1, so its checksum no longer matches. */
const corrupt = (text: string) =>
  text
    .split('\r\n')
    .map((l) => (l.startsWith('1 ') ? `${l.slice(0, 22)}${(Number(l[22]) + 1) % 10}${l.slice(23)}` : l))
    .join('\r\n');

test('checksums, line validation and epoch', () => {
  assert.equal(tleChecksum(ISS1), 2);
  assert.equal(tleChecksum(ISS2), 8);
  assert.ok(validLine(ISS1, 1));
  assert.ok(validLine(ISS2, 2));
  assert.ok(!validLine(ISS1.replace('76743', '76744'), 1));
  assert.ok(!validLine(ISS1.slice(0, 68), 1));
  assert.ok(!validLine(ISS2, 1));
  // '-' counts as 1: a line with minus signs
  assert.equal(tleChecksum('1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753'), 3);
  assert.equal(tleEpoch(ISS1), Date.UTC(2026, 0, 1) + Math.round(274.01380287 * 86_400_000));
  assert.equal(tleEpoch('1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753'), Math.round(Date.UTC(2000, 0, 1) + 178.78495062 * 86_400_000));
  assert.equal(tleEpoch('1 00005U 98002B   99179.50000000  .00000023  00000-0  28098-4 0  4753'), Date.UTC(1999, 0, 1) + 178.5 * 86_400_000);
  assert.equal(tleEpoch('1 00005U 58002B   00000.00000000'), null);
  assert.equal(tleEpoch('garbage'), null);
});

test('parses the real CelesTrak stations group (CRLF, padded names)', () => {
  const { entries, invalid } = parseTle(STATIONS);
  assert.equal(invalid, 0);
  assert.equal(entries.length, 20);
  const iss = entries[0]!;
  assert.deepEqual(
    { noradId: iss.noradId, name: iss.name, tle1: iss.tle1, tle2: iss.tle2 },
    { noradId: '25544', name: 'ISS (ZARYA)', tle1: ISS1, tle2: ISS2 },
  );
  assert.equal(iss.epoch, tleEpoch(ISS1));
  assert.ok(entries.every((e) => e.tle1.length === 69 && e.tle2.length === 69 && !/\s$/.test(e.name)));
  assert.equal(new Set(entries.map((e) => e.noradId)).size, 20);
  assert.equal(parseTle(STATIONS.replaceAll('\r\n', '\n')).entries.length, 20);
});

test('invalid element sets are dropped and counted; error pages yield nothing', () => {
  const bad = corrupt(STATIONS);
  const r = parseTle(bad);
  assert.equal(r.entries.length, 0);
  assert.equal(r.invalid, 20);

  const lines = STATIONS.split('\r\n');
  lines[2] = lines[2]!.replace('25544', '25545'); // line 2 for a different catalog number
  lines[5] = lines[5]!.slice(0, 60); // truncated line 2
  const some = parseTle(lines.join('\r\n'));
  assert.equal(some.entries.length, 18);
  assert.equal(some.invalid, 2);

  assert.deepEqual(parseTle('Invalid query: "GROUP=nope" (GROUP "nope" not found)\r\n'), { entries: [], invalid: 0 });
  assert.deepEqual(parseTle('No GP data found'), { entries: [], invalid: 0 });
  assert.deepEqual(parseTle(''), { entries: [], invalid: 0 });
});

test('two-line sets and "0 NAME" 3LE headers', () => {
  const two = parseTle(`${ISS1}\n${ISS2}\n`);
  assert.equal(two.entries[0]!.name, 'NORAD 25544');
  const three = parseTle(`0 ISS (ZARYA)\n${ISS1}\n${ISS2}\n\n`);
  assert.equal(three.entries[0]!.name, 'ISS (ZARYA)');
  // a name is never taken from the previous set's line 2
  const back = parseTle(`${ISS1}\n${ISS2}\n${ISS1}\n${ISS2}\n`);
  assert.deepEqual(back.entries.map((e) => e.name), ['NORAD 25544', 'NORAD 25544']);
});

// ---------------------------------------------------------------- feed

function setup(handlers: Record<string, () => Response>, opts: { groups?: string[]; cacheDir?: string; start?: number; refreshMs?: number } = {}) {
  const dir = opts.cacheDir ?? mkdtempSync(path.join(tmpdir(), 'gev-sats-'));
  const c = clock(opts.start ?? NOW);
  const calls: Array<{ group: string; headers: Record<string, string>; url: URL }> = [];
  const sleeps: number[] = [];
  const feed = new SatellitesFeed({
    fetch: async (url, init) => {
      const u = new URL(url);
      const group = u.searchParams.get('GROUP')!;
      calls.push({ group, headers: init!.headers as Record<string, string>, url: u });
      const h = handlers[group];
      if (!h) throw new Error(`no handler for ${group}`);
      return h();
    },
    cacheDir: dir,
    groups: opts.groups ?? ['stations', 'visual'],
    refreshMs: opts.refreshMs,
    now: c.now,
    timers: manualTimers,
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { feed, c, calls, dir, sleeps, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const text = (body: string, headers: Record<string, string> = {}) => () => new Response(body, { status: 200, headers });

function visualBody(): string {
  // ISS again (a duplicate across groups) plus two other stations copied from the fixture.
  const entries = parseTle(STATIONS).entries.slice(0, 3);
  return entries.map((e) => `${e.name}\r\n${e.tle1}\r\n${e.tle2}`).join('\r\n') + '\r\n';
}

test('downloads each group once, politely, caches to disk, dedupes across groups', async () => {
  const { feed, calls, dir, sleeps, cleanup } = setup({ stations: text(STATIONS, { 'last-modified': 'Fri, 02 Oct 2026 14:00:00 GMT' }), visual: text(visualBody()) });
  try {
    assert.equal(feed.status().state, 'off');
    feed.start();
    await feed.idle();
    assert.deepEqual(calls.map((c) => c.group), ['stations', 'visual']);
    assert.equal(calls[0]!.url.origin + calls[0]!.url.pathname, 'https://celestrak.org/NORAD/elements/gp.php');
    assert.equal(calls[0]!.url.searchParams.get('FORMAT'), 'tle');
    assert.match(calls[0]!.headers['User-Agent']!, /gods-eye-view/);
    assert.deepEqual(sleeps, [2000], 'a pause between group downloads');
    for (const g of ['stations', 'visual']) {
      assert.ok(existsSync(path.join(dir, `${g}.tle`)));
      assert.ok(existsSync(path.join(dir, `${g}.json`)));
    }
    const st = feed.status();
    assert.equal(st.state, 'live');
    assert.equal(st.source, 'CelesTrak');
    assert.equal(st.count, 20, 'ISS and the others in both groups count once');
    assert.equal(st.freshnessMs, SATELLITES_FRESHNESS_MS);

    const all = feed.elements('satellites')!;
    assert.deepEqual(all.groups, ['stations', 'visual']);
    assert.equal(all.elements.length, 20);
    assert.equal(all.elements.find((e) => e.noradId === '25544')!.group, 'stations', 'first group wins');
    const visual = feed.elements('satellites', 'visual')!;
    assert.equal(visual.elements.length, 3);
    assert.ok(visual.elements.every((e) => e.group === 'visual'));
    assert.equal(feed.elements('satellites', 'stations')!.elements.length, 20);
    assert.equal(feed.elements('satellites', 'starlink'), null);
    const e = all.elements[0]!;
    assert.deepEqual(Object.keys(e).sort(), ['epoch', 'group', 'name', 'noradId', 'tle1', 'tle2']);
  } finally {
    await feed.stop();
    cleanup();
  }
});

test('restart reads the disk cache and does not refetch before the refresh is due', async () => {
  const first = setup({ stations: text(STATIONS), visual: text(visualBody()) });
  try {
    first.feed.start();
    await first.feed.idle();
    await first.feed.stop();

    const again = setup({ stations: text(STATIONS), visual: text(visualBody()) }, { cacheDir: first.dir, start: NOW + 30 * 60_000 });
    again.feed.start();
    assert.equal(again.feed.elements('satellites')!.elements.length, 20, 'served from cache immediately');
    await again.feed.idle();
    assert.equal(again.calls.length, 0);
    assert.equal(again.feed.status().state, 'live');
    assert.equal(again.feed.status().lastSuccess, NOW);
    again.c.advance(SATELLITES_REFRESH_MS - 31 * 60_000);
    await again.feed.tick();
    assert.equal(again.calls.length, 0);
    again.c.advance(60_000);
    await again.feed.tick();
    assert.deepEqual(again.calls.map((c) => c.group), ['stations', 'visual']);
    await again.feed.stop();
  } finally {
    first.cleanup();
  }
});

test('conditional requests: If-Modified-Since / If-None-Match, and 304 keeps the cache', async () => {
  let n = 0;
  const { feed, c, calls, cleanup } = setup(
    {
      stations: () => (n++ === 0 ? new Response(STATIONS, { headers: { 'last-modified': 'Fri, 02 Oct 2026 14:00:00 GMT', etag: '"abc"' } }) : new Response(null, { status: 304 })),
    },
    { groups: ['stations'] },
  );
  try {
    feed.start();
    await feed.idle();
    assert.equal(calls[0]!.headers['If-Modified-Since'], undefined);
    c.advance(SATELLITES_REFRESH_MS);
    await feed.tick();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.headers['If-Modified-Since'], 'Fri, 02 Oct 2026 14:00:00 GMT');
    assert.equal(calls[1]!.headers['If-None-Match'], '"abc"');
    assert.equal(feed.elements('satellites')!.elements.length, 20);
    assert.equal(feed.status().lastSuccess, c.now());
    assert.equal(feed.status().state, 'live');
  } finally {
    await feed.stop();
    cleanup();
  }
});

test('bad responses never replace good data: error text, corrupt checksums, 5xx', async () => {
  const bodies = [() => new Response('Invalid query: "GROUP=stations"'), () => new Response(corrupt(STATIONS)), () => new Response('oops', { status: 500 }), () => new Response(STATIONS)];
  let n = 0;
  const { feed, c, calls, cleanup } = setup({ stations: () => (n === 0 ? (n++, new Response(STATIONS)) : bodies[n++ - 1]!()) }, { groups: ['stations'] });
  try {
    feed.start();
    await feed.idle();
    for (let i = 0; i < 3; i++) {
      c.advance(SATELLITES_REFRESH_MS * 2);
      await feed.tick();
      const st = feed.status();
      assert.equal(st.state, 'error', `after bad response ${i}`);
      assert.equal(st.count, 20, 'old elements still served');
    }
    assert.match(feed.status().lastError!, /HTTP 500/);
    c.advance(SATELLITES_REFRESH_MS * 2);
    await feed.tick();
    assert.equal(calls.length, 5);
    assert.equal(feed.status().state, 'live');
    assert.equal(feed.status().lastError, null);
  } finally {
    await feed.stop();
    cleanup();
  }
});

test('403 (blocked) and 429 back off at least two hours; failures retry per group, not per round', async () => {
  const visualCalls: number[] = [];
  const { feed, c, calls, cleanup } = setup({
    stations: () => new Response('blocked', { status: 403 }),
    visual: () => (visualCalls.push(1), new Response(visualBody())),
  });
  try {
    feed.start();
    await feed.idle();
    assert.equal(feed.status().state, 'error');
    assert.match(feed.status().lastError!, /stations: HTTP 403/);
    assert.equal(feed.elements('satellites', 'visual')!.elements.length, 3, 'working groups still load');
    assert.equal(feed.elements('satellites', 'stations')!.elements.length, 0, 'known group, no data yet');
    c.advance(CELESTRAK_MIN_REFRESH_MS - 60_000);
    await feed.tick();
    assert.equal(calls.filter((x) => x.group === 'stations').length, 1);
    c.advance(120_000);
    await feed.tick();
    assert.equal(calls.filter((x) => x.group === 'stations').length, 2);
    assert.equal(visualCalls.length, 1, 'visual was not refetched');
  } finally {
    await feed.stop();
    cleanup();
  }
  const rl = setup({ stations: () => new Response('slow down', { status: 429, headers: { 'retry-after': '14400' } }) }, { groups: ['stations'] });
  try {
    rl.feed.start();
    await rl.feed.idle();
    rl.c.advance(3 * HOUR);
    await rl.feed.tick();
    assert.equal(rl.calls.length, 1, 'Retry-After of 4 h honoured');
    rl.c.advance(HOUR + 1000);
    await rl.feed.tick();
    assert.equal(rl.calls.length, 2);
  } finally {
    await rl.feed.stop();
    rl.cleanup();
  }
});

test('refresh interval can never be set below CelesTrak\'s two hours; defaults include the main groups but not Starlink', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-sats-'));
  try {
    const feed = new SatellitesFeed({ fetch: async () => new Response(''), cacheDir: dir, refreshMs: 60_000 });
    assert.equal((feed as unknown as { refreshMs: number }).refreshMs, CELESTRAK_MIN_REFRESH_MS);
    for (const g of ['stations', 'visual', 'gps-ops', 'weather', 'science']) assert.ok(DEFAULT_GROUPS.includes(g), g);
    assert.ok(!DEFAULT_GROUPS.includes('starlink'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cached data older than the freshness window plus a failing refresh reports error and still serves elements', async () => {
  const first = setup({ stations: text(STATIONS) }, { groups: ['stations'] });
  try {
    first.feed.start();
    await first.feed.idle();
    await first.feed.stop();
    const later = setup({ stations: () => new Response('x', { status: 502 }) }, { groups: ['stations'], cacheDir: first.dir, start: NOW + 13 * HOUR });
    later.feed.start();
    await later.feed.idle();
    assert.equal(later.feed.status().state, 'error');
    assert.equal(later.feed.status().count, 20);
    await later.feed.stop();
  } finally {
    first.cleanup();
  }
});
