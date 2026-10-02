import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HistoryRange } from '@gev/shared';
import { clampToRange, isLiveTime, LIVE_SNAP_MS, nextPlayTime, playbackStart, sliderFraction } from './timeline.ts';

const NOW = 10_000_000;
const range: HistoryRange = { from: NOW - 3_600_000, to: NOW - 5_000, retentionMs: 86_400_000 };

test('instants clamp into recorded history', () => {
  assert.equal(clampToRange(0, range, NOW), range.from);
  assert.equal(clampToRange(NOW + 1000, range, NOW), NOW);
  assert.equal(clampToRange(NOW - 1000, range, NOW), NOW - 1000);
  assert.equal(clampToRange(5, { from: null, to: null, retentionMs: 1 }, NOW), NOW);
});

test('near-now counts as live', () => {
  assert.equal(isLiveTime(NOW - LIVE_SNAP_MS, NOW), true);
  assert.equal(isLiveTime(NOW - LIVE_SNAP_MS - 1, NOW), false);
});

test('playback steps by speed and ends at live', () => {
  assert.equal(nextPlayTime(NOW - 3_000_000, 60, NOW), NOW - 3_000_000 + 60_000);
  assert.equal(nextPlayTime(NOW - 100_000, 60, NOW), null);
});

test('playback from live starts a little way back', () => {
  assert.equal(playbackStart(range, NOW), NOW - 15 * 60_000);
  assert.equal(playbackStart({ ...range, from: NOW - 60_000 }, NOW), NOW - 60_000);
  assert.equal(playbackStart({ from: null, to: null, retentionMs: 1 }, NOW), null);
  assert.equal(playbackStart(null, NOW), null);
});

test('slider fraction runs from the start of history to now', () => {
  assert.equal(sliderFraction(null, range, NOW), 1);
  assert.equal(sliderFraction(range.from!, range, NOW), 0);
  assert.equal(sliderFraction(NOW - 1_800_000, range, NOW), 0.5);
  assert.equal(sliderFraction(0, range, NOW), 0);
});
