import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LayerDescriptor } from '@gev/shared';
import { countOn, groupLayers, isToggleable, matchesFilter, switchLabel } from './layers.ts';

const mk = (id: string, category: LayerDescriptor['category'], status: LayerDescriptor['status'], name = id): LayerDescriptor => ({
  id,
  name,
  category,
  description: `${name} description`,
  status,
  sources: [],
});

const layers = [mk('b', 'sea', 'needs-key', 'Ships'), mk('a', 'air', 'available', 'Flights'), mk('c', 'air', 'planned', 'Airports')];

test('groupLayers orders by category and drops empty groups', () => {
  const g = groupLayers(layers);
  assert.deepEqual(g.map((x) => x.category), ['air', 'sea']);
  assert.deepEqual(g[0]?.layers.map((l) => l.id), ['a', 'c']);
});

test('groupLayers filters by name, description and category', () => {
  assert.deepEqual(groupLayers(layers, 'ship').map((g) => g.category), ['sea']);
  assert.deepEqual(groupLayers(layers, 'AIR').map((g) => g.layers.length), [2]);
  assert.deepEqual(groupLayers(layers, 'zzz'), []);
  assert.equal(matchesFilter(mk('x', 'air', 'available', 'Flights'), 'flight desc'), false);
});

test('countOn counts only toggleable enabled layers', () => {
  assert.equal(countOn(layers, { a: true, b: true, c: true }), 1);
  assert.equal(countOn(layers, {}), 0);
});

test('toggleable and labels', () => {
  assert.equal(isToggleable(layers[0]!), false);
  assert.equal(isToggleable(layers[1]!), true);
  assert.equal(switchLabel(layers[2]!), 'Airports (planned)');
  assert.equal(switchLabel(layers[0]!), 'Ships (needs API key)');
});
