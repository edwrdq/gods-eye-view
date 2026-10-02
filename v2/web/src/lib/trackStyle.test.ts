import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fadeAlpha, thin } from './trackStyle.ts';

test('track fades from faint to solid', () => {
  assert.ok(fadeAlpha(0, 10) < 0.15);
  assert.equal(fadeAlpha(9, 10), 1);
  assert.ok(fadeAlpha(4, 10) < fadeAlpha(5, 10));
  assert.equal(fadeAlpha(0, 1), 1);
});

test('thin keeps the ends and the order', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => i);
  const t = thin(pts, 100);
  assert.equal(t.length, 100);
  assert.equal(t[0], 0);
  assert.equal(t[99], 999);
  assert.deepEqual(t, [...t].sort((a, b) => a - b));
  assert.deepEqual(thin([1, 2, 3], 10), [1, 2, 3]);
});
