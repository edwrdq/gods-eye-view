import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelOf } from './labels.ts';

test('labels come from callsign, then name, then registration', () => {
  assert.equal(labelOf({ callsign: ' UAL1523 ', registration: 'N1' }, 'a1'), 'UAL1523');
  assert.equal(labelOf({ name: 'EVER GIVEN', callsign: '' }, '2000'), 'EVER GIVEN');
  assert.equal(labelOf({ registration: 'N77520' }, 'a1'), 'N77520');
});

test('labels fall back to the object id', () => {
  assert.equal(labelOf({}, 'a1'), 'a1');
  assert.equal(labelOf(undefined, 'a1'), 'a1');
  assert.equal(labelOf({ callsign: 5, name: null }, 'a1'), 'a1');
});
