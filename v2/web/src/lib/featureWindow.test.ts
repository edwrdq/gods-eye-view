import assert from 'node:assert/strict';
import { test } from 'node:test';
import { featureWindow, isLiveOnly, referenceTime, windowLabel } from './featureWindow.ts';

const DAY = 86_400_000;

test('earthquakes: live asks for the server default, history for the 24 h up to the viewed time', () => {
  assert.deepEqual(featureWindow('earthquakes', null), {});
  const at = 1_790_000_000_000;
  assert.deepEqual(featureWindow('earthquakes', at), { from: at - DAY, to: at });
});

test('layers without history send no window and say they are current only', () => {
  const at = 1_790_000_000_000;
  assert.deepEqual(featureWindow('cyclones', at), {});
  assert.deepEqual(featureWindow('launches', at), {});
  assert.equal(isLiveOnly('cyclones'), true);
  assert.equal(isLiveOnly('launches'), true);
  assert.equal(isLiveOnly('earthquakes'), false);
});

test('reference time and labels', () => {
  assert.equal(referenceTime(null, 500), 500);
  assert.equal(referenceTime(200, 500), 200);
  assert.equal(windowLabel('earthquakes'), '24 h');
  assert.equal(windowLabel('launches'), null);
});
