import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FeedStatus } from '@gev/shared';
import { cadenceMs, nextPollMs, effectiveState, freshnessSummary, retryDelayMs } from './cadence.ts';

const feed = (over: Partial<FeedStatus> = {}): FeedStatus => ({
  layer: 'flights',
  state: 'live',
  source: 'adsb.lol',
  lastSuccess: 1_000_000,
  lastError: null,
  count: 10,
  freshnessMs: 30_000,
  ...over,
});

test('cadence is a third of the freshness window, never under 5 s', () => {
  assert.equal(cadenceMs(30_000), 10_000);
  assert.equal(cadenceMs(9_000), 5_000);
  assert.equal(cadenceMs(1_000), 5_000);
  assert.equal(cadenceMs(900_000), 120_000);
});

test('cadence falls back for missing or invalid windows', () => {
  assert.equal(cadenceMs(undefined), 15_000);
  assert.equal(cadenceMs(0), 15_000);
  assert.equal(cadenceMs(Number.NaN), 15_000);
});

test('retry backs off exponentially up to a minute', () => {
  assert.equal(retryDelayMs(10_000, 0), 10_000);
  assert.equal(retryDelayMs(10_000, 1), 20_000);
  assert.equal(retryDelayMs(10_000, 2), 40_000);
  assert.equal(retryDelayMs(10_000, 3), 60_000);
  assert.equal(retryDelayMs(90_000, 1), 90_000); // never faster than the base
});

test('a live feed turns stale once its data outlives the window', () => {
  assert.equal(effectiveState(feed(), 1_010_000), 'live');
  assert.equal(effectiveState(feed(), 1_031_000), 'stale');
  assert.equal(effectiveState(feed({ state: 'error' }), 1_010_000), 'error');
  assert.equal(effectiveState(feed({ lastSuccess: null }), 5_000_000), 'live');
});

test('freshness summary counts running feeds only', () => {
  const feeds = [feed(), feed({ layer: 'm', lastSuccess: 900_000 }), feed({ layer: 'v', state: 'needs-key' }), feed({ layer: 'x', state: 'off' })];
  assert.deepEqual(freshnessSummary(feeds, 1_010_000), { fresh: 1, total: 2 });
});

test('an empty feed with no data yet is retried at the minimum interval', () => {
  const empty = feed({ lastSuccess: null, state: 'stale', count: 0, freshnessMs: 180_000 });
  assert.equal(nextPollMs(empty, 0, 0), 5_000);
  assert.equal(nextPollMs(feed({ freshnessMs: 180_000 }), 10, 0), 60_000);
  assert.equal(nextPollMs(empty, 0, 2), 60_000); // failures back off normally
  assert.equal(nextPollMs(null, 0, 0), 15_000);
});
