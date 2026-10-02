import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditsFor } from './dataCredits.ts';
import { featureWindow, ignoresTime, isLiveOnly, isStatic } from './featureWindow.ts';
import { layerSummary } from './layerSummary.ts';
import { layerNoun } from './layers.ts';
import { markerVariantFor } from './markerStyle.ts';
import { layerChip } from './viewState.ts';

test('bundled datasets are static: no window, they ignore the viewed time, and are not "live only" feeds', () => {
  for (const id of ['submarine-cables', 'datacenters', 'installations']) {
    assert.equal(isStatic(id), true, id);
    assert.equal(ignoresTime(id), true, id);
    assert.equal(isLiveOnly(id), false, id);
    assert.deepEqual(featureWindow(id, 1_790_000_000_000), {});
  }
  assert.equal(isStatic('earthquakes'), false);
  assert.equal(ignoresTime('cyclones'), true);
  assert.equal(ignoresTime('earthquakes'), false);
});

test('snapshot chip wins over time and health', () => {
  const base = { kind: 'features' as const, viewing: true, drawnHistorical: false, currentOnly: true, health: 'stale' as const, hasData: true };
  assert.equal(layerChip({ ...base, snapshot: true }), 'snapshot');
  assert.equal(layerChip({ ...base, snapshot: false }), 'current');
});

test('cable summary counts cables and landing points separately', () => {
  assert.equal(layerSummary({ layerId: 'submarine-cables', feedCount: 2611, drawn: 1494, lines: 694, at: null }), '694 cables · 800 landing points');
  assert.equal(layerSummary({ layerId: 'submarine-cables', feedCount: 2611, drawn: 2, lines: 1, at: null }), '1 cable · 1 landing point');
  assert.equal(layerSummary({ layerId: 'submarine-cables', feedCount: 2611, drawn: 0, lines: 0, at: null }), 'No cables in view');
  assert.equal(layerSummary({ layerId: 'datacenters', feedCount: 4351, drawn: 2500, at: null }), '2,500 data centers');
  assert.equal(layerSummary({ layerId: 'installations', feedCount: 36466, drawn: 1, at: null }), '1 mapped site');
  assert.equal(layerNoun('installations', 5), 'mapped sites');
});

test('mapped military areas draw hollow, data centers solid; credits follow the enabled layers', () => {
  assert.equal(markerVariantFor('installations'), 'military');
  assert.equal(markerVariantFor('datacenters'), 'standard');
  assert.deepEqual(creditsFor({}).map((c) => c.layer), []);
  const on = creditsFor({ 'submarine-cables': true, installations: true, datacenters: false });
  assert.deepEqual(on.map((c) => c.layer), ['submarine-cables', 'installations']);
  assert.match(on[0]!.text, /TeleGeography/);
  assert.match(on[0]!.licence, /CC BY-NC-SA 3\.0/);
});
