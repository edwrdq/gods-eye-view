import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessChip, layerChip, type LayerChipInput } from './viewState.ts';

test('status bar says Live only while viewing now and every source is fresh', () => {
  assert.equal(freshnessChip({ viewing: false, fresh: 7, total: 7 }).kind, 'live');
  assert.equal(freshnessChip({ viewing: false, fresh: 5, total: 7 }).kind, 'stale');
  assert.equal(freshnessChip({ viewing: false, fresh: 0, total: 0 }).kind, 'stale');
});

test('status bar says Recorded in history, whatever the sources are doing now', () => {
  for (const [fresh, total] of [[7, 7], [3, 7], [0, 0]] as const) {
    const c = freshnessChip({ viewing: true, fresh, total });
    assert.equal(c.kind, 'recorded');
    assert.match(c.text, /now$/);
    assert.match(c.label, /^Viewing recorded history/);
  }
});

const base: LayerChipInput = { kind: 'tracked', viewing: false, drawnHistorical: false, currentOnly: false, health: 'live', hasData: true };

test('layer chip: live, stale, error', () => {
  assert.equal(layerChip(base), 'live');
  assert.equal(layerChip({ ...base, health: 'stale' }), 'stale');
  assert.equal(layerChip({ ...base, health: 'error' }), 'error');
});

test('layer chip: viewing history is Recorded even before the historical snapshot lands', () => {
  assert.equal(layerChip({ ...base, viewing: true }), 'recorded');
  assert.equal(layerChip({ ...base, viewing: true, health: 'stale' }), 'recorded');
  assert.equal(layerChip({ ...base, drawnHistorical: true }), 'recorded');
  assert.equal(layerChip({ ...base, kind: 'features', viewing: true }), 'recorded');
});

test('layer chip: satellites are Computed, live-only layers are Current', () => {
  assert.equal(layerChip({ ...base, kind: 'orbits', viewing: true }), 'computed');
  assert.equal(layerChip({ ...base, kind: 'orbits', hasData: false }), 'waiting');
  assert.equal(layerChip({ ...base, kind: 'features', viewing: true, currentOnly: true }), 'current');
});
