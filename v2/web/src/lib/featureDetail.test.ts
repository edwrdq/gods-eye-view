import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FeatureDetail } from '@gev/shared';
import { anchorOf, featureTimeNote, featureToObjectDetail } from './featureDetail.ts';
import { layerSummary } from './layerSummary.ts';

const quake: FeatureDetail = {
  layer: 'earthquakes',
  featureId: 'us1',
  feature: { id: 'us1', geometry: { type: 'Point', coordinates: [158.02, -8.93] }, t: 1_000, props: { mag: 5.1 } },
  title: 'M 5.1 earthquake',
  subtitle: '159 km SE of Gizo',
  sections: [{ title: 'Event', rows: [{ label: 'Magnitude', value: '5.1' }] }],
  sources: ['USGS Earthquake Hazards Program'],
  url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1',
};

test('a FeatureDetail renders like an ObjectDetail with provenance last', () => {
  const d = featureToObjectDetail(quake, 5_000);
  assert.equal(d.objectId, 'us1');
  assert.equal(d.observation.lon, 158.02);
  assert.equal(d.observation.lat, -8.93);
  assert.equal(d.observation.t, 1_000);
  assert.deepEqual(d.sections.map((s) => s.title), ['Event', 'Source']);
  assert.equal(d.sections[1]!.rows[0]!.value, 'USGS Earthquake Hazards Program');
});

test('a server-provided Source section is kept as is', () => {
  const d = featureToObjectDetail({ ...quake, sections: [...quake.sections, { title: 'Source', rows: [{ label: 'Feed', value: 'x' }] }] });
  assert.equal(d.sections.filter((s) => s.title === 'Source').length, 1);
});

test('anchors for every geometry', () => {
  assert.deepEqual(anchorOf({ type: 'Point', coordinates: [1, 2, 300] }), { lon: 1, lat: 2, alt: 300 });
  assert.deepEqual(anchorOf({ type: 'LineString', coordinates: [[3, 4], [5, 6]] }), { lon: 3, lat: 4, alt: undefined });
  assert.deepEqual(anchorOf({ type: 'MultiLineString', coordinates: [[[7, 8]]] }), { lon: 7, lat: 8, alt: undefined });
  assert.deepEqual(anchorOf({ type: 'Polygon', coordinates: [[[9, 10]]] }), { lon: 9, lat: 10, alt: undefined });
});

test('time notes say what the time means for each layer', () => {
  const now = 10 * 3_600_000;
  assert.equal(featureTimeNote('earthquakes', now - 2 * 3_600_000, now, false), 'Occurred 2 h ago');
  assert.equal(featureTimeNote('earthquakes', now - 2 * 3_600_000, now, true), 'Occurred 2 h before this time');
  assert.equal(featureTimeNote('launches', now + 3 * 86_400_000, now, false), 'Launch T-3 d');
  assert.equal(featureTimeNote('launches', now - 26 * 86_400_000, now, false), 'Launched 26 d ago');
  assert.equal(featureTimeNote('cyclones', now - 5 * 3_600_000, now, false), 'Position 5 h ago');
});

test('layer row count lines', () => {
  const base = { feedCount: 0, drawn: 0, at: null };
  assert.equal(layerSummary({ ...base, layerId: 'earthquakes', drawn: 27 }), '27 earthquakes · 24 h');
  assert.equal(layerSummary({ ...base, layerId: 'earthquakes', drawn: 1 }), '1 earthquake · 24 h');
  assert.equal(layerSummary({ ...base, layerId: 'earthquakes', drawn: 0 }), 'No earthquakes · 24 h');
  assert.match(layerSummary({ ...base, layerId: 'earthquakes', drawn: 5, at: Date.UTC(2026, 9, 1, 13, 21, 17) }), /^5 earthquakes · 24 h to 13:21Z$/);
  assert.equal(layerSummary({ ...base, layerId: 'cyclones', feedCount: 2, drawn: 25 }), '2 active storms');
  assert.equal(layerSummary({ ...base, layerId: 'cyclones', feedCount: 1 }), '1 active storm');
  assert.equal(layerSummary({ ...base, layerId: 'cyclones' }), 'No active storms');
  assert.equal(layerSummary({ ...base, layerId: 'launches', drawn: 41 }), '41 launches');
  assert.equal(layerSummary({ ...base, layerId: 'satellites', drawn: 956, shown: 956 }), '956 satellites');
  assert.equal(layerSummary({ ...base, layerId: 'satellites', drawn: 956, shown: 120 }), '120 of 956 satellites');
  assert.equal(layerSummary({ ...base, layerId: 'satellites' }), 'Waiting for orbital elements');
});
