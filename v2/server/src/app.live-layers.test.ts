import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ApiError, FeatureDetail, FeaturesResponse, FeedsResponse } from '@gev/shared';
import { createApp } from './app.ts';
import { openDb } from './db/index.ts';
import { BikeshareFeed } from './feeds/bikeshare/feed.ts';
import { FeedManager } from './feeds/manager.ts';
import { RadioFeed } from './feeds/radio/feed.ts';
import { FEED_DEFINITIONS, implementedLayers } from './feeds/registry.ts';
import { clock, jsonResponse, manualTimers } from './feeds/test-utils.ts';
import { buildLayers } from './layers.ts';

const fx = (rel: string): any => JSON.parse(readFileSync(new URL(`./feeds/${rel}`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-02T16:30:00Z');
const PARIS = { id: 'Paris', name: "Vélib' Metropole", location: 'Paris', country: 'FR', discoveryUrl: 'https://velib.example.org/gbfs.json', bbox: [2.19, 48.77, 2.48, 48.94], stations: 5 };

function setup(enabled: Array<'bikeshare' | 'radio'>) {
  const c = clock(NOW);
  const db = openDb(':memory:');
  const radioRows = fx('radio/fixtures/radio-browser-stations.json');
  const csv = ['Country Code,Name,Location,System ID,URL,Auto-Discovery URL', `FR,Vélib' Metropole,Paris,Paris,,${PARIS.discoveryUrl}`, ...Array.from({ length: 60 }, (_, i) => `XX,F${i},T,f${i},,https://f${i}.example.org/g.json`)].join('\n');
  const fetchFn = async (url: string): Promise<Response> => {
    if (url.endsWith('systems.csv')) return new Response(csv);
    if (url === PARIS.discoveryUrl) return jsonResponse({ ttl: 0, data: { en: { feeds: [{ name: 'station_information', url: 'https://velib.example.org/si.json' }, { name: 'station_status', url: 'https://velib.example.org/ss.json' }] } } });
    if (url === 'https://velib.example.org/si.json') return jsonResponse(fx('bikeshare/fixtures/velib-station_information.json'));
    if (url === 'https://velib.example.org/ss.json') return jsonResponse(fx('bikeshare/fixtures/velib-station_status.json'));
    if (url.includes('/json/stations/search')) return jsonResponse(new URL(url).searchParams.get('offset') === '0' ? radioRows : []);
    throw new Error(`unexpected ${url}`);
  };
  const base = { fetch: fetchFn, now: c.now, timers: manualTimers };
  const feeds: Array<BikeshareFeed | RadioFeed> = [];
  if (enabled.includes('bikeshare')) feeds.push(new BikeshareFeed({ ...base, catalogueUrl: 'https://c.example.org/systems.csv', index: { version: 1, generatedAt: '', systems: [PARIS] } }));
  if (enabled.includes('radio')) feeds.push(new RadioFeed({ ...base, dns: { resolve4: async () => ['1.1.1.1'], reverse: async () => ['de1.api.radio-browser.info'] }, minStations: 5, pageSize: 100 }));
  const manager = new FeedManager({ feeds, definitions: FEED_DEFINITIONS, repo: db.observations, retentionMs: 86_400_000, now: c.now, timers: manualTimers });
  const app = createApp({
    clientConfig: { googleMapsApiKey: null, cesiumIonToken: null, layers: buildLayers({}, implementedLayers(enabled)) },
    geocoder: { search: async () => [] },
    dbStatus: () => ({ path: ':memory:', sizeBytes: 0 }),
    version: 'test',
    now: c.now,
    feeds: manager,
    observations: db.observations,
  });
  const get = async <T>(p: string): Promise<{ status: number; body: T }> => {
    const res = await app.request(p);
    return { status: res.status, body: (await res.json()) as T };
  };
  return {
    get,
    async startAll() {
      manager.start();
      await Promise.all(feeds.map((f) => f.idle()));
    },
    stop: () => manager.stop(),
  };
}

test('bikeshare over HTTP: a view loads its system, a country-wide view is empty and truncated, detail by encoded id', async () => {
  const s = setup(['bikeshare']);
  try {
    await s.startAll();
    const feeds = (await s.get<FeedsResponse>('/api/feeds')).body.feeds;
    assert.equal(feeds.find((f) => f.layer === 'bikeshare')!.state, 'live');
    assert.equal(feeds.find((f) => f.layer === 'radio')!.state, 'off');

    const view = await s.get<FeaturesResponse>('/api/layers/bikeshare/features?bbox=2.19,48.77,2.48,48.94');
    assert.equal(view.status, 200);
    assert.equal(view.body.features.length, 5);
    assert.equal(view.body.truncated, false);
    assert.equal(view.body.feed.count, 5);

    const country = await s.get<FeaturesResponse>('/api/layers/bikeshare/features?bbox=-5,42,8,51');
    assert.deepEqual([country.body.features.length, country.body.truncated], [0, true]);
    const none = await s.get<FeaturesResponse>('/api/layers/bikeshare/features');
    assert.deepEqual([none.body.features.length, none.body.truncated], [0, true]);

    const f = view.body.features[0]!;
    const d = await s.get<FeatureDetail>(`/api/layers/bikeshare/features/${encodeURIComponent(f.id)}`);
    assert.equal(d.status, 200);
    assert.equal(d.body.featureId, f.id);
    assert.equal((await s.get<ApiError>('/api/layers/bikeshare/features/Paris:nope')).status, 404);
    assert.equal((await s.get<ApiError>('/api/layers/radio/features')).status, 409, 'radio is not enabled here');
  } finally {
    await s.stop();
  }
});

test('radio over HTTP: world view, a view of one city, detail with the stream', async () => {
  const s = setup(['radio']);
  try {
    await s.startAll();
    const world = await s.get<FeaturesResponse>('/api/layers/radio/features');
    assert.equal(world.status, 200);
    assert.equal(world.body.features.length, 12, 'HLS stations are listed too; they are offered as a link');
    assert.equal(world.body.feed.source, 'Radio Browser');
    const london = await s.get<FeaturesResponse>('/api/layers/radio/features?bbox=-0.6,51.3,0.4,51.7');
    assert.deepEqual(london.body.features.map((f) => f.label), ['Virgin Radio UK']);
    const d = await s.get<FeatureDetail>(`/api/layers/radio/features/${london.body.features[0]!.id}`);
    assert.equal(d.status, 200);
    assert.equal(typeof d.body.feature.props.streamUrl, 'string');
    assert.match(d.body.url ?? '', /^https?:\/\//);
    assert.equal((await s.get<ApiError>('/api/layers/bikeshare/features')).status, 409);
  } finally {
    await s.stop();
  }
});
