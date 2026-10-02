import type { FeatureDetail, FeatureGeometry, ObjectDetail } from '@gev/shared';
import { launchEta } from './featureStyle.ts';
import { formatAge } from './time.ts';

/** First usable coordinate of a geometry: the marker for a point, the start of a line or ring otherwise. */
export function anchorOf(g: FeatureGeometry): { lon: number; lat: number; alt?: number } {
  let c: ArrayLike<number> | undefined;
  switch (g.type) {
    case 'Point':
      c = g.coordinates;
      break;
    case 'LineString':
      c = g.coordinates[0];
      break;
    case 'MultiLineString':
      c = g.coordinates[0]?.[0];
      break;
    case 'Polygon':
      c = g.coordinates[0]?.[0];
      break;
  }
  return { lon: c?.[0] ?? 0, lat: c?.[1] ?? 0, alt: c && c.length > 2 ? c[2] : undefined };
}

/** Present a FeatureDetail through the same panel as a tracked object. */
export function featureToObjectDetail(d: FeatureDetail, now = Date.now()): ObjectDetail {
  const a = anchorOf(d.feature.geometry);
  const hasSource = d.sections.some((s) => s.title.toLowerCase() === 'source');
  return {
    layer: d.layer,
    objectId: d.featureId,
    observation: { layer: d.layer, objectId: d.featureId, t: d.feature.t ?? now, lon: a.lon, lat: a.lat, alt: a.alt, props: d.feature.props },
    title: d.title,
    subtitle: d.subtitle,
    // Provenance last, like every detail; the panel would otherwise add a "Received" row that means nothing for an event.
    sections: hasSource ? d.sections : [...d.sections, { title: 'Source', rows: [{ label: 'Feed', value: d.sources.join(', ') || 'Unknown' }] }],
    sources: d.sources,
  };
}

/** The line beside the freshness chip: what the time on a feature means, in words. */
export function featureTimeNote(layer: string, t: number, now: number, historical: boolean): string {
  switch (layer) {
    case 'earthquakes':
      return historical ? `Occurred ${formatAge(now - t).replace(' ago', '')} before this time` : `Occurred ${formatAge(now - t)}`;
    case 'launches': {
      const eta = launchEta(t, now);
      return eta.startsWith('T-') ? `Launch ${eta}` : `Launched ${eta}`;
    }
    case 'bikeshare':
      return `Station reported ${formatAge(now - t)}`;
    case 'radio':
      return 'From the Radio Browser directory';
    case 'submarine-cables':
    case 'datacenters':
    case 'installations':
      return 'From a bundled snapshot';
    case 'cyclones':
      return `Position ${formatAge(now - t)}`;
    default:
      return `Updated ${formatAge(now - t)}`;
  }
}
