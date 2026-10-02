import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capNote } from './layerSummary.ts';

test('capped layer says how many are shown of how many', () => {
  assert.equal(capNote(20_000, 33_104), 'Showing 20,000 of 33,104. Zoom in for all.');
  assert.equal(capNote(20_000, 21_500), 'Showing 20,000 of 21,500. Zoom in for all.');
});

test('without a usable total it falls back to the plain notice', () => {
  assert.equal(capNote(20_000, undefined), 'Capped. Zoom in to see the rest.');
  assert.equal(capNote(20_000, 20_000), 'Capped. Zoom in to see the rest.');
});
