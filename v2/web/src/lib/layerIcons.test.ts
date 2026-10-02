import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerIconName } from './layerIcons.ts';

test('every ground layer has its own detail icon, not the category camera', () => {
  assert.equal(layerIconName('bikeshare', 'ground'), 'bike');
  assert.equal(layerIconName('cctv', 'ground'), 'cctv');
  assert.equal(layerIconName('transit', 'ground'), 'bus');
  assert.equal(layerIconName('radio', 'signals'), 'radio');
  assert.equal(layerIconName('launches', 'space'), 'rocket');
});

test('an unknown layer falls back to its category icon', () => {
  assert.equal(layerIconName('something-new', 'ground'), 'video');
  assert.equal(layerIconName(undefined, 'air'), 'plane');
});
