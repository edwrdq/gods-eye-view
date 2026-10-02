import type { Feature, PropValue } from '@gev/shared';
import { ringInfo } from '../static/geom.ts';

export const LAYER = 'datacenters';

export interface Datacenter {
  /** OSM element id (the file does not say whether it is a node, way or relation). */
  id: string;
  lon: number;
  lat: number;
  /** 'Building outline' or 'Point' (how it is mapped). */
  mapped: 'outline' | 'point';
  /** Footprint in m2 for outlines. */
  areaM2: number | null;
  name: string | null;
  operator: string | null;
  /** The OSM tags the detail panel uses, trimmed. */
  tags: Record<string, string>;
}

/** Tags kept for the detail panel; everything else is dropped to save memory. */
const KEEP_TAGS = [
  'name', 'name:en', 'alt_name', 'short_name', 'old_name', 'operator', 'operator:short', 'operator:wikidata', 'owner', 'brand', 'ref', 'website', 'contact:website',
  'start_date', 'building:levels', 'height', 'description', 'wikidata', 'wikipedia', 'data_center:power', 'capacity:it_load', 'capacity', 'power',
] as const;

const MAX_TAG_LEN = 200;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, MAX_TAG_LEN) : null);

function centroid(g: { type?: string; coordinates?: unknown }): { lon: number; lat: number; areaM2: number | null; mapped: 'outline' | 'point' } | null {
  const c = g.coordinates;
  if (g.type === 'Point' && Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') return { lon: c[0], lat: c[1], areaM2: null, mapped: 'point' };
  if (g.type === 'Polygon' && Array.isArray(c) && Array.isArray(c[0])) {
    const r = ringInfo(c[0] as number[][]);
    return r ? { ...r, mapped: 'outline' } : null;
  }
  if (g.type === 'MultiPolygon' && Array.isArray(c)) {
    // Centre on the largest part; sum the areas.
    let best: ReturnType<typeof ringInfo> = null;
    let total = 0;
    for (const poly of c as number[][][][]) {
      const r = Array.isArray(poly) && Array.isArray(poly[0]) ? ringInfo(poly[0]) : null;
      if (!r) continue;
      total += r.areaM2;
      if (!best || r.areaM2 > best.areaM2) best = r;
    }
    return best ? { lon: best.lon, lat: best.lat, areaM2: total, mapped: 'outline' } : null;
  }
  return null;
}

export interface DatacenterDataset {
  items: Datacenter[];
  skipped: number;
}

/**
 * Parse the bundled OSM datacenter extract (one GeoJSON feature per line). Each
 * building or point becomes a single marker at its centre; contact tags were
 * already removed from the extract. Bad lines and duplicates are skipped.
 */
export function parseDatacenters(text: string): DatacenterDataset {
  const items: Datacenter[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let f: { id?: unknown; geometry?: { type?: string; coordinates?: unknown }; properties?: { osm_id?: unknown; tags?: Record<string, unknown> } };
    try {
      f = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const osm = f.properties?.osm_id ?? f.id;
    const id = typeof osm === 'number' || typeof osm === 'string' ? String(osm) : null;
    const where = f.geometry ? centroid(f.geometry) : null;
    if (id === null || seen.has(id) || !where || !(Math.abs(where.lon) <= 180) || !(Math.abs(where.lat) <= 90)) {
      skipped++;
      continue;
    }
    seen.add(id);
    const tags: Record<string, string> = {};
    const raw = f.properties?.tags ?? {};
    for (const k of KEEP_TAGS) {
      const v = str(raw[k]);
      if (v !== null) tags[k] = v;
    }
    items.push({
      id,
      lon: Math.round(where.lon * 1e5) / 1e5,
      lat: Math.round(where.lat * 1e5) / 1e5,
      mapped: where.mapped,
      areaM2: where.areaM2 !== null ? Math.round(where.areaM2) : null,
      name: tags.name ?? tags['name:en'] ?? null,
      operator: tags.operator ?? tags['operator:short'] ?? tags.brand ?? null,
      tags,
    });
  }
  return { items, skipped };
}

/** What to call it on the map and in the panel. */
export function displayName(d: Datacenter): string {
  return d.name ?? (d.operator ? `${d.operator} data center` : 'Data center');
}

/** Thinning priority: named and attributed sites, then bigger ones. */
export function datacenterRank(d: Datacenter): number {
  let s = 0;
  if (d.operator) s += 3;
  if (d.name) s += 2;
  if (d.tags['operator:wikidata'] || d.tags.wikidata) s += 1;
  if (d.areaM2 && d.areaM2 > 1) s += Math.min(3, Math.log10(d.areaM2) / 2);
  return s;
}

export function datacenterFeature(d: Datacenter): Feature {
  const props: Record<string, PropValue> = { name: displayName(d), operator: d.operator };
  if (d.areaM2 !== null) props.areaM2 = d.areaM2;
  return { id: d.id, geometry: { type: 'Point', coordinates: [d.lon, d.lat] }, label: d.name ?? d.operator ?? undefined, props };
}
