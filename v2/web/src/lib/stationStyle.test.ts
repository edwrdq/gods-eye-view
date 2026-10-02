import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BIKE_LEVEL_FILL, bikeForm, bikeKey, bikeOrder, bikePx, radioPx, stationLabel } from './stationStyle.ts';

test('the gauge ends mean trouble: empty only with no bike, solid only with no free dock', () => {
  assert.deepEqual(bikeForm('empty', 0), { form: 'level', level: 0 });
  assert.deepEqual(bikeForm('full', 1), { form: 'level', level: 4 });
  // one bike in a 40-dock station is nearly empty but not "empty"; 39 of 40 is nearly solid but not "full"
  assert.deepEqual(bikeForm('ok', 1 / 40), { form: 'level', level: 1 });
  assert.deepEqual(bikeForm('ok', 39 / 40), { form: 'level', level: 3 });
  assert.deepEqual(bikeForm('ok', 0.5), { form: 'level', level: 2 });
  assert.deepEqual(bikeForm('ok', 0.3), { form: 'level', level: 1 });
  assert.deepEqual(bikeForm('ok', 0.7), { form: 'level', level: 3 });
});

test('stations without a dock count, without a reading or out of service have their own forms', () => {
  assert.deepEqual(bikeForm('ok', Number.NaN), { form: 'dot' });
  assert.deepEqual(bikeForm('offline', 0.5), { form: 'offline' });
  assert.deepEqual(bikeForm('unknown', Number.NaN), { form: 'nodata' });
  assert.deepEqual(bikeForm('anything else', 0.5), { form: 'nodata' });
});

test('fill heights rise with the level; sizes and order', () => {
  const f = [0, 1, 2, 3, 4].map((l) => BIKE_LEVEL_FILL[l as 0 | 1 | 2 | 3 | 4]);
  assert.deepEqual([...f].sort((a, b) => a - b), f);
  assert.equal(f[0], 0);
  assert.equal(f[4], 1);
  assert.deepEqual([bikePx(8), bikePx(24), bikePx(60), bikePx(Number.NaN)], [14, 16, 18, 15]);
  assert.ok(bikeOrder('offline') < bikeOrder('ok') && bikeOrder('ok') < bikeOrder('empty') && bikeOrder('empty') === bikeOrder('full'));
  assert.notEqual(bikeKey({ form: 'level', level: 1 }, 14, '#a3d64f'), bikeKey({ form: 'level', level: 2 }, 14, '#a3d64f'));
});

test('radio rings grow with listens in three steps; labels are trimmed', () => {
  assert.deepEqual([radioPx(0), radioPx(100), radioPx(999), radioPx(1000), radioPx(Number.NaN)], [14, 17, 17, 20, 14]);
  assert.equal(stationLabel('  Short  '), 'Short');
  assert.equal(stationLabel('x'.repeat(50)).length, 34);
});
