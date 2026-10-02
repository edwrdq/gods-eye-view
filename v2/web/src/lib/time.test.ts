import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAge, formatClockUtc, formatDuration, formatShortUtc, formatUtc, formatViewUtc } from './time.ts';

test('ages read naturally', () => {
  assert.equal(formatAge(0), 'just now');
  assert.equal(formatAge(400), 'just now');
  assert.equal(formatAge(2_000), '2 s ago');
  assert.equal(formatAge(59_999), '59 s ago');
  assert.equal(formatAge(60_000), '1 min ago');
  assert.equal(formatAge(14 * 60_000 + 20_000), '14 min ago');
  assert.equal(formatAge(3 * 3_600_000), '3 h ago');
  assert.equal(formatAge(47 * 3_600_000), '47 h ago');
  assert.equal(formatAge(72 * 3_600_000), '3 d ago');
});

test('negative or invalid ages do not leak', () => {
  assert.equal(formatAge(-5_000), 'just now');
  assert.equal(formatAge(Number.NaN), 'unknown');
});

test('durations drop the suffix', () => {
  assert.equal(formatDuration(3 * 3_600_000), '3 h');
  assert.equal(formatDuration(100), 'just now');
});

test('UTC formats', () => {
  const t = Date.UTC(2026, 9, 2, 4, 19, 43);
  assert.equal(formatUtc(t), '2026-10-02 04:19:43Z');
  assert.equal(formatClockUtc(t), '04:19:43Z');
  assert.equal(formatShortUtc(t), '2 Oct 04:19Z');
  assert.equal(formatViewUtc(t), '2 Oct 04:19:43Z');
});
