import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_PICTURE_DELAY_MS, nextPictureDelayMs, pictureAge, pictureIsOld } from './cameraRefresh.ts';

test('after a success the next request waits for the server to have a newer picture', () => {
  assert.equal(nextPictureDelayMs({ refreshS: 60, refreshAfterS: 42, failures: 0 }), 43_000);
  assert.equal(nextPictureDelayMs({ refreshS: 300, refreshAfterS: null, failures: 0 }), 300_000);
});

test('never faster than the floor, even for a fast source or a header that says now', () => {
  assert.equal(nextPictureDelayMs({ refreshS: 5, refreshAfterS: null, failures: 0 }), MIN_PICTURE_DELAY_MS);
  assert.equal(nextPictureDelayMs({ refreshS: 60, refreshAfterS: 0, failures: 0 }), MIN_PICTURE_DELAY_MS);
});

test('failures back off from 30 s, honour Retry-After, and stop at 5 min', () => {
  const d = (failures: number, retryAfterS?: number) => nextPictureDelayMs({ refreshS: 60, refreshAfterS: null, failures, retryAfterS });
  assert.equal(d(1), 30_000);
  assert.equal(d(2), 60_000);
  assert.equal(d(3), 120_000);
  assert.equal(d(9), 240_000 > 300_000 ? 300_000 : 240_000);
  assert.equal(d(1, 90), 90_000);
  assert.ok(d(20, 600) <= 300_000);
});

test('age wording and the old-picture threshold', () => {
  assert.equal(pictureAge(12_000), '12 s ago');
  assert.equal(pictureAge(3 * 60_000), '3 min ago');
  assert.equal(pictureAge(5 * 3_600_000), '5 h ago');
  assert.equal(pictureIsOld(10 * 60_000, 300), false);
  assert.equal(pictureIsOld(2 * 3_600_000, 300), true);
});
