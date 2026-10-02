import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cycloneClassName, cycloneLabel, cycloneSize, launchEta, launchState, LAUNCH_ORDER, LAUNCH_PX } from './featureStyle.ts';

test('storm markers grow with intensity class', () => {
  const order = ['TD', 'TS', 'H1', 'H2', 'H3', 'H4', 'H5'].map(cycloneSize);
  for (let i = 1; i < order.length; i++) assert.ok(order[i]! > order[i - 1]!);
  assert.equal(cycloneSize('??'), cycloneSize('TD'));
  assert.equal(cycloneSize(null), cycloneSize('TD'));
});

test('storm names and labels read plainly', () => {
  assert.equal(cycloneClassName('H3'), 'Hurricane 3');
  assert.equal(cycloneClassName('TS'), 'Tropical storm');
  assert.equal(cycloneClassName('XX'), 'XX');
  assert.equal(cycloneLabel('Rachel', 'H3'), 'Rachel H3');
  assert.equal(cycloneLabel('Rachel', null), 'Rachel');
});

test('launch status maps to three marker states; upcoming draws on top', () => {
  assert.equal(launchState('upcoming'), 'upcoming');
  assert.equal(launchState('success'), 'success');
  assert.equal(launchState('failure'), 'failure');
  assert.equal(launchState('partial'), 'failure');
  assert.equal(launchState(undefined), 'upcoming');
  assert.ok(LAUNCH_ORDER.upcoming > LAUNCH_ORDER.success);
  assert.ok(LAUNCH_PX.upcoming > LAUNCH_PX.success);
});

test('launch countdown', () => {
  const now = 1_000_000_000_000;
  assert.equal(launchEta(now + 3 * 86_400_000, now), 'T-3 d');
  assert.equal(launchEta(now + 5 * 3_600_000, now), 'T-5 h');
  assert.equal(launchEta(now + 12 * 60_000, now), 'T-12 min');
  assert.equal(launchEta(now - 26 * 86_400_000, now), '26 d ago');
  assert.equal(launchEta(now - 90 * 60_000, now), '2 h ago');
  assert.equal(launchEta(Number.NaN, now), '');
});
