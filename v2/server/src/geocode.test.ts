import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeocoder, GeocodeUnavailableError, type FetchLike } from './geocode.ts';

const photonBody = {
  features: [
    {
      geometry: { coordinates: [-97.7431, 30.2672] },
      properties: {
        name: 'Austin', type: 'city', osm_key: 'place', state: 'Texas', country: 'United States',
        extent: [-98.0, 30.5, -97.5, 30.1],
      },
    },
    {
      geometry: { coordinates: [-97.74, 30.27] },
      properties: { name: 'Texas State Capitol', type: 'house', osm_key: 'tourism', city: 'Austin', country: 'United States' },
    },
    { geometry: { coordinates: [null, 5] }, properties: { name: 'Broken' } },
    { geometry: { coordinates: [1, 2] }, properties: {} },
  ],
};

const nominatimBody = [
  {
    lat: '48.8566', lon: '2.3522', name: 'Paris', category: 'boundary', type: 'administrative',
    display_name: 'Paris, Île-de-France, France', boundingbox: ['48.8155', '48.9021', '2.2241', '2.4699'],
  },
  { lat: '', lon: '2', display_name: 'Nowhere' },
];

type Handler = (url: string) => { ok?: boolean; status?: number; body?: unknown } | Error;

function fakeFetch(handler: Handler) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = handler(url);
    if (r instanceof Error) throw r;
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body };
  };
  return { fetch, calls };
}

const isPhoton = (u: string) => u.startsWith('https://photon.komoot.io/api/');

test('coordinates are answered locally without any request', async () => {
  const f = fakeFetch(() => new Error('should not be called'));
  const g = createGeocoder({ fetch: f.fetch });
  const r = await g.search('30.2672, -97.7431');
  assert.equal(r[0]?.source, 'local');
  assert.equal(f.calls.length, 0);
});

test('photon results are mapped; invalid features dropped', async () => {
  const f = fakeFetch(() => ({ body: photonBody }));
  const r = await createGeocoder({ fetch: f.fetch }).search('austin');
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], {
    label: 'Austin', detail: 'Texas, United States', lon: -97.7431, lat: 30.2672,
    bbox: [-98, 30.1, -97.5, 30.5], kind: 'place', source: 'photon',
  });
  assert.equal(r[1]?.kind, 'poi');
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0]!.url, /q=austin&limit=8/);
  assert.match(f.calls[0]!.headers['User-Agent'] ?? '', /GodsEyeView/);
});

test('falls back to nominatim when photon is empty', async () => {
  const f = fakeFetch((u) => (isPhoton(u) ? { body: { features: [] } } : { body: nominatimBody }));
  const r = await createGeocoder({ fetch: f.fetch, nominatimIntervalMs: 0 }).search('paris');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], {
    label: 'Paris', detail: 'Île-de-France, France', lon: 2.3522, lat: 48.8566,
    bbox: [2.2241, 48.8155, 2.4699, 48.9021], kind: 'place', source: 'nominatim',
  });
  assert.match(f.calls[1]!.url, /format=jsonv2/);
});

test('falls back to nominatim when photon errors or returns HTTP 500', async () => {
  for (const photon of [new Error('boom'), { ok: false, status: 500 }] as const) {
    const f = fakeFetch((u) => (isPhoton(u) ? photon : { body: nominatimBody }));
    const r = await createGeocoder({ fetch: f.fetch, nominatimIntervalMs: 0 }).search('paris');
    assert.equal(r[0]?.source, 'nominatim');
  }
});

test('throws when every provider fails; nothing is cached', async () => {
  const f = fakeFetch(() => new Error('down'));
  const g = createGeocoder({ fetch: f.fetch, nominatimIntervalMs: 0 });
  await assert.rejects(g.search('x'), GeocodeUnavailableError);
  await assert.rejects(g.search('x'), GeocodeUnavailableError);
  assert.equal(f.calls.length, 4);
});

test('photon empty + nominatim failure returns empty and is not cached', async () => {
  const f = fakeFetch((u) => (isPhoton(u) ? { body: { features: [] } } : new Error('down')));
  const g = createGeocoder({ fetch: f.fetch, nominatimIntervalMs: 0 });
  assert.deepEqual(await g.search('zzz'), []);
  await g.search('zzz');
  assert.equal(f.calls.length, 4);
});

test('caches case-insensitively and expires after the TTL', async () => {
  let t = 0;
  const f = fakeFetch(() => ({ body: photonBody }));
  const g = createGeocoder({ fetch: f.fetch, now: () => t, cacheTtlMs: 1000 });
  await g.search('Austin');
  await g.search('  austin ');
  assert.equal(f.calls.length, 1);
  t = 1001;
  await g.search('austin');
  assert.equal(f.calls.length, 2);
});

test('LRU evicts the least recently used entry', async () => {
  const f = fakeFetch(() => ({ body: photonBody }));
  const g = createGeocoder({ fetch: f.fetch, cacheSize: 2 });
  await g.search('a');
  await g.search('b');
  await g.search('a'); // refresh a
  await g.search('c'); // evicts b
  assert.equal(f.calls.length, 3);
  await g.search('a');
  assert.equal(f.calls.length, 3);
  await g.search('b');
  assert.equal(f.calls.length, 4);
});

test('nominatim requests are spaced at least one interval apart', async () => {
  let t = 0;
  const sleeps: number[] = [];
  const f = fakeFetch((u) => (isPhoton(u) ? { body: { features: [] } } : { body: nominatimBody }));
  const g = createGeocoder({
    fetch: f.fetch,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  });
  await Promise.all([g.search('one'), g.search('two'), g.search('three')]);
  assert.equal(f.calls.filter((c) => !isPhoton(c.url)).length, 3);
  assert.deepEqual(sleeps, [1000, 1000]);
});

test('a caller abort propagates instead of falling back', async () => {
  const f = fakeFetch(() => new Error('aborted'));
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(createGeocoder({ fetch: f.fetch }).search('x', ac.signal), (e) => !(e instanceof GeocodeUnavailableError));
  assert.equal(f.calls.length, 1);
});

test('a hung provider is cut off by the timeout', async () => {
  const fetch: FetchLike = (_url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  // AbortSignal.timeout timers are unref'd; keep the loop alive for the test.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(
      createGeocoder({ fetch, timeoutMs: 20, nominatimIntervalMs: 0 }).search('slow'),
      GeocodeUnavailableError,
    );
  } finally {
    clearInterval(keepAlive);
  }
});
