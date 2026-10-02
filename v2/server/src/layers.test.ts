import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayers } from './layers.ts';

test('layer ids are unique and descriptions are present', () => {
  const layers = buildLayers({});
  assert.equal(new Set(layers.map((l) => l.id)).size, layers.length);
  for (const l of layers) {
    assert.ok(l.description.length > 10 && l.sources.length > 0, l.id);
  }
});

test('keyed layers report needs-key until the key is set', () => {
  const status = (env: Record<string, string>, id: string) =>
    buildLayers(env).find((l) => l.id === id)?.status;
  assert.equal(status({}, 'vessels'), 'needs-key');
  assert.equal(status({ AISSTREAM_API_KEY: '  ' }, 'vessels'), 'needs-key');
  assert.equal(status({ AISSTREAM_API_KEY: 'k' }, 'vessels'), 'planned');
  assert.equal(status({}, 'fires'), 'needs-key');
  assert.equal(status({ FIRMS_MAP_KEY: 'k' }, 'fires'), 'planned');
  assert.equal(status({}, 'flights'), 'planned');
});
