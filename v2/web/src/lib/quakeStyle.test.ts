import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGE_ALPHA, ageBucket, isDeep, magnitudeBucket, magnitudeSize, QUAKE_MAX_PX, QUAKE_MIN_PX, quakeStyle } from './quakeStyle.ts';

const H = 3_600_000;

test('magnitude maps to a growing, bounded diameter', () => {
  const sizes = [1, 2, 3, 4, 5, 6, 7, 8].map(magnitudeSize);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i]! >= sizes[i - 1]!, `non-decreasing at M${i + 1}`);
  assert.equal(magnitudeSize(-3), QUAKE_MIN_PX);
  assert.equal(magnitudeSize(1), QUAKE_MIN_PX);
  assert.equal(magnitudeSize(9.5), QUAKE_MAX_PX);
  assert.equal(magnitudeSize(3), 10);
  assert.equal(magnitudeSize(5), 21);
  assert.equal(magnitudeSize(6), 30);
  assert.equal(magnitudeSize(Number.NaN), QUAKE_MIN_PX);
});

test('magnitudes are bucketed to half units so images are shared', () => {
  assert.equal(magnitudeBucket(5.24), 5);
  assert.equal(magnitudeBucket(5.26), 5.5);
  assert.equal(magnitudeSize(5.1), magnitudeSize(4.9));
});

test('age buckets and opacity get fainter with age', () => {
  assert.equal(ageBucket(0), 0);
  assert.equal(ageBucket(59 * 60_000), 0);
  assert.equal(ageBucket(1 * H), 1);
  assert.equal(ageBucket(5.9 * H), 1);
  assert.equal(ageBucket(6 * H), 2);
  assert.equal(ageBucket(12 * H), 3);
  assert.equal(ageBucket(30 * H), 3);
  assert.equal(ageBucket(-5 * H), 0, 'a time after the viewed instant reads as new');
  for (let i = 1; i < AGE_ALPHA.length; i++) assert.ok(AGE_ALPHA[i]! < AGE_ALPHA[i - 1]!);
});

test('depth: shallow is solid, 70 km and deeper gets the centre dot', () => {
  assert.equal(isDeep(10), false);
  assert.equal(isDeep(69.9), false);
  assert.equal(isDeep(70), true);
  assert.equal(isDeep(600), true);
  assert.equal(isDeep(Number.NaN), false);
});

test('quakeStyle combines the three channels against the viewed time', () => {
  const ref = 1_000_000_000_000;
  const s = quakeStyle(5.1, 10, ref - 30 * 60_000, ref);
  assert.deepEqual({ sizePx: s.sizePx, age: s.age, deep: s.deep }, { sizePx: 21, age: 0, deep: false });
  const old = quakeStyle(5.1, 150, ref - 20 * H, ref);
  assert.deepEqual({ age: old.age, deep: old.deep }, { age: 3, deep: true });
  assert.notEqual(s.key, old.key);
  assert.equal(quakeStyle(5.1, 10, ref - 20 * 60_000, ref).key, s.key, 'same look, same image');
  // History mode: ages are measured against the viewed time, not now.
  assert.equal(quakeStyle(4, 10, ref - 8 * H, ref - 7 * H).age, 1);
  assert.equal(quakeStyle(4, 10, Number.NaN, ref).age, 0);
});
