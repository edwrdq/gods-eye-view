import type { BBox, Feature, PropValue } from '@gev/shared';
import { haversineKm, lineLengthKm } from '../static/geom.ts';
import { SpatialIndex } from '../static/spatial-index.ts';

export const LAYER = 'submarine-cables';

/** A cable end this close to a landing point (km) is taken to come ashore there. */
export const LANDING_MATCH_KM = 10;

type Coord = [number, number];

export interface Cable {
  /** TeleGeography slug, e.g. "marea". */
  slug: string;
  name: string;
  /** Route parts, [lon, lat] rounded to 4 decimals (about 11 m). */
  parts: Coord[][];
  /** Route length as drawn, km (an approximation, not the published length). */
  lengthKm: number;
  /** Landing point slugs near the ends of its parts, nearest match per end. */
  landingSlugs: string[];
}

export interface LandingPoint {
  slug: string;
  /** Full source name, "Virginia Beach, VA, United States". */
  name: string;
  /** "Virginia Beach, VA" */
  place: string;
  /** "United States"; null when the name has no comma. */
  country: string | null;
  lon: number;
  lat: number;
  tbd: boolean;
  cableSlugs: string[];
}

export interface CableDataset {
  cables: Cable[];
  landings: LandingPoint[];
  /** Features dropped for bad geometry or missing ids. */
  skipped: number;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** "Nybor, Denmark" -> place "Nybor", country "Denmark" (the last comma-separated part). */
export function splitLandingName(name: string): { place: string; country: string | null } {
  const i = name.lastIndexOf(',');
  if (i < 0) return { place: name, country: null };
  return { place: name.slice(0, i).trim(), country: name.slice(i + 1).trim() || null };
}

function validCoord(c: unknown): c is Coord {
  return Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
}

interface GeoCollection {
  features?: unknown;
}

/**
 * Parse TeleGeography's two GeoJSON files. The bundled files carry only id,
 * name and colour per cable and id, name and a TBD flag per landing point, so
 * owners, ready-for-service year and the cable-to-landing links are not in
 * them. The links are derived from geometry: a landing point within
 * LANDING_MATCH_KM of the end of a cable part. Ends in open water (branching
 * units, the antimeridian cut) match nothing, which is expected.
 */
export function parseCables(cableJson: unknown, landingJson: unknown): CableDataset {
  const cf = (cableJson as GeoCollection | null)?.features;
  const lf = (landingJson as GeoCollection | null)?.features;
  if (!Array.isArray(cf) || !Array.isArray(lf)) throw new Error('malformed submarine cable data');
  let skipped = 0;

  const landings: LandingPoint[] = [];
  const bySlug = new Map<string, LandingPoint>();
  for (const raw of lf as Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }>) {
    const slug = str(raw?.properties?.id);
    const name = str(raw?.properties?.name);
    const c = raw?.geometry?.coordinates;
    if (!slug || !name || raw.geometry?.type !== 'Point' || !validCoord(c) || bySlug.has(slug)) {
      skipped++;
      continue;
    }
    const { place, country } = splitLandingName(name);
    const lp: LandingPoint = { slug, name, place, country, lon: round4(c[0]), lat: round4(c[1]), tbd: raw.properties?.is_tbd === true, cableSlugs: [] };
    landings.push(lp);
    bySlug.set(slug, lp);
  }

  const grid = new SpatialIndex<LandingPoint>(2);
  for (const lp of landings) grid.add(lp, [[lp.lon, lp.lat, lp.lon, lp.lat]]);
  const nearest = (lon: number, lat: number): LandingPoint | null => {
    const dLat = 0.12;
    const dLon = Math.min(180, dLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
    const box: BBox = [Math.max(-180, lon - dLon), lat - dLat, Math.min(180, lon + dLon), lat + dLat];
    let best: LandingPoint | null = null;
    let bestKm = LANDING_MATCH_KM;
    for (const lp of grid.query(box)) {
      const d = haversineKm(lon, lat, lp.lon, lp.lat);
      if (d <= bestKm) {
        bestKm = d;
        best = lp;
      }
    }
    return best;
  };

  // The source splits some cables into several features with the same id
  // ("feature_id" -0, -1, ...); they are parts of one system, so merge them.
  const parsed = new Map<string, { name: string; parts: Coord[][] }>();
  for (const raw of cf as Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }>) {
    const slug = str(raw?.properties?.id);
    const name = str(raw?.properties?.name);
    const g = raw?.geometry;
    const lines = g?.type === 'MultiLineString' ? g.coordinates : g?.type === 'LineString' ? [g.coordinates] : null;
    if (!slug || !name || !Array.isArray(lines)) {
      skipped++;
      continue;
    }
    const parts: Coord[][] = [];
    for (const line of lines) {
      if (!Array.isArray(line)) continue;
      const pts = line.filter(validCoord).map((c): Coord => [round4(c[0]), round4(c[1])]);
      if (pts.length >= 2) parts.push(pts);
    }
    if (parts.length === 0) {
      skipped++;
      continue;
    }
    const prev = parsed.get(slug);
    if (prev) prev.parts.push(...parts);
    else parsed.set(slug, { name, parts });
  }
  const cables: Cable[] = [];
  for (const [slug, { name, parts }] of parsed) {
    const landingSlugs: string[] = [];
    for (const p of parts) {
      for (const end of [p[0]!, p[p.length - 1]!]) {
        const lp = nearest(end[0], end[1]);
        if (lp && !landingSlugs.includes(lp.slug)) {
          landingSlugs.push(lp.slug);
          lp.cableSlugs.push(slug);
        }
      }
    }
    cables.push({ slug, name, parts, lengthKm: parts.reduce((km, p) => km + lineLengthKm(p), 0), landingSlugs });
  }
  return { cables, landings, skipped };
}

export const cableFeature = (c: Cable): Feature => ({
  id: `cable:${c.slug}`,
  geometry: { type: 'MultiLineString', coordinates: c.parts },
  label: c.name,
  props: { kind: 'cable', name: c.name, lengthKm: Math.round(c.lengthKm), landings: c.landingSlugs.length },
});

export const landingFeature = (l: LandingPoint): Feature => {
  const props: Record<string, PropValue> = { kind: 'landing', name: l.place, country: l.country, cables: l.cableSlugs.length };
  if (l.tbd) props.tbd = true;
  return { id: `landing:${l.slug}`, geometry: { type: 'Point', coordinates: [l.lon, l.lat] }, label: l.place, props };
};
