import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './index.ts';
import type { FeatureRow } from './features.ts';

function ev(id: string, over: Partial<FeatureRow> = {}): FeatureRow {
  return { id, t: 1000, updated: 10, lon: 10, lat: 20, rank: 4, label: 'M 4.0', props: { mag: 4 }, extra: { net: 'us' }, ...over };
}

test('upsert inserts new events and keeps only the newest revision', () => {
  const { features } = openDb(':memory:');
  assert.equal(features.upsertMany('q', [ev('a'), ev('b')]), 2);
  assert.equal(features.count('q'), 2);
  // newer revision replaces
  assert.equal(features.upsertMany('q', [ev('a', { updated: 20, rank: 4.6, label: 'M 4.6', props: { mag: 4.6 } })]), 1);
  assert.equal(features.get('q', 'a')!.props.mag, 4.6);
  assert.equal(features.get('q', 'a')!.updated, 20);
  // older or identical revisions are ignored
  assert.equal(features.upsertMany('q', [ev('a', { updated: 15, props: { mag: 9 } }), ev('a', { updated: 20, props: { mag: 8 } })]), 0);
  assert.equal(features.get('q', 'a')!.props.mag, 4.6);
  // layers are separate namespaces
  features.upsertMany('other', [ev('a', { props: { mag: 1 } })]);
  assert.equal(features.get('other', 'a')!.props.mag, 1);
  assert.equal(features.get('q', 'missing'), null);
});

test('query filters by time and bbox (including the antimeridian) and orders by rank', () => {
  const { features } = openDb(':memory:');
  features.upsertMany('q', [
    ev('fiji', { lon: 179.5, lat: -17, t: 5000, rank: 5 }),
    ev('tonga', { lon: -179.5, lat: -17, t: 6000, rank: 6 }),
    ev('sf', { lon: -122.4, lat: 37.7, t: 7000, rank: 3 }),
    ev('old', { lon: -122.4, lat: 37.7, t: 100, rank: 7 }),
  ]);
  const ids = (q: Parameters<typeof features.query>[1]) => features.query('q', q).rows.map((r) => r.id);
  assert.deepEqual(ids({ from: 0, to: 10_000, limit: 10 }), ['old', 'tonga', 'fiji', 'sf']);
  assert.deepEqual(ids({ from: 1000, to: 6500, limit: 10 }), ['tonga', 'fiji']);
  assert.deepEqual(ids({ from: 0, to: 10_000, bbox: [-130, 30, -110, 45], limit: 10 }), ['old', 'sf']);
  assert.deepEqual(ids({ from: 0, to: 10_000, bbox: [170, -30, -170, 0], limit: 10 }).sort(), ['fiji', 'tonga']);
  assert.deepEqual(ids({ from: 0, to: 10_000, bbox: [-10, -10, 10, 10], limit: 10 }), []);
});

test('a capped query keeps the highest-ranked events and reports truncation', () => {
  const { features } = openDb(':memory:');
  features.upsertMany('q', Array.from({ length: 50 }, (_, i) => ev(`e${i}`, { rank: i, t: 1000 + i })));
  const r = features.query('q', { from: 0, to: 1e9, limit: 5 });
  assert.equal(r.truncated, true);
  assert.deepEqual(r.rows.map((x) => x.id), ['e49', 'e48', 'e47', 'e46', 'e45']);
  assert.equal(features.query('q', { from: 0, to: 1e9, limit: 50 }).truncated, false);
});

test('deleteMissingSince removes withdrawn events inside the window only; prune drops old events', () => {
  const { features } = openDb(':memory:');
  features.upsertMany('q', [ev('keep', { t: 5000 }), ev('gone', { t: 5100 }), ev('older', { t: 100 })]);
  assert.equal(features.deleteMissingSince('q', 1000, new Set(['keep'])), 1);
  assert.deepEqual(features.query('q', { from: 0, to: 1e9, limit: 10 }).rows.map((r) => r.id).sort(), ['keep', 'older']);
  assert.equal(features.pruneBefore('q', 1000), 1);
  assert.equal(features.count('q'), 1);
});
