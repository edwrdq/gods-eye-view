import type { BBox } from '@gev/shared';
import { bboxCentre, approxDistanceM } from '../../geo.ts';
import type { CatalogueSystem } from './gbfs.ts';

/**
 * The systems catalogue carries no coordinates, so a bundled index (built by
 * build-index.ts) adds each station-based bike system's bounding box. The live
 * catalogue stays the authority for names and addresses; the index only says
 * where a system is. Which systems a map view needs is decided here, from the
 * index alone, so no operator is contacted for a view it does not touch.
 */

export interface IndexedSystem extends CatalogueSystem {
  /** Where its stations are, [west, south, east, north]. */
  bbox: BBox;
  /** Station count when the index was built. */
  stations: number;
}

export interface IndexFile {
  version: number;
  generatedAt: string;
  systems: IndexedSystem[];
}

export const INDEX_VERSION = 1;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseIndex(json: unknown): IndexFile {
  const j = json as Partial<IndexFile> | null;
  if (!j || j.version !== INDEX_VERSION || !Array.isArray(j.systems)) throw new Error('unsupported bikeshare index');
  const systems: IndexedSystem[] = [];
  for (const s of j.systems) {
    const b = s?.bbox;
    if (typeof s?.id !== 'string' || typeof s.discoveryUrl !== 'string' || !Array.isArray(b) || b.length !== 4 || !b.every(num)) continue;
    if (b[1]! > b[3]! || Math.abs(b[1]!) > 90 || Math.abs(b[3]!) > 90) continue;
    systems.push({
      id: s.id,
      name: String(s.name ?? s.id),
      location: String(s.location ?? ''),
      country: String(s.country ?? ''),
      website: typeof s.website === 'string' ? s.website : undefined,
      discoveryUrl: s.discoveryUrl,
      bbox: [b[0]!, b[1]!, b[2]!, b[3]!],
      stations: num(s.stations) ? s.stations : 0,
    });
  }
  return { version: INDEX_VERSION, generatedAt: String(j.generatedAt ?? ''), systems };
}

export interface MergeResult {
  systems: IndexedSystem[];
  /** In the catalogue but not in the index: station-based systems added since the index was built, or systems without stations. */
  unlocated: number;
  /** In the index but no longer in the catalogue. */
  retired: number;
}

/** Join the live catalogue with the index: catalogue text and addresses, index boxes. Without a catalogue the index stands alone. */
export function mergeCatalogue(index: readonly IndexedSystem[], catalogue: readonly CatalogueSystem[] | null): MergeResult {
  if (!catalogue) return { systems: [...index], unlocated: 0, retired: 0 };
  const byId = new Map(index.map((s) => [s.id, s]));
  const systems: IndexedSystem[] = [];
  let unlocated = 0;
  for (const c of catalogue) {
    const ix = byId.get(c.id);
    if (!ix) {
      unlocated++;
      continue;
    }
    systems.push({ ...ix, name: c.name, location: c.location, country: c.country, website: c.website ?? ix.website, discoveryUrl: c.discoveryUrl });
  }
  return { systems, unlocated, retired: index.length - systems.length };
}

/** Longitude spans of a lon range; west > east wraps across 180. */
function spans(west: number, east: number): Array<[number, number]> {
  return west <= east ? [[west, east]] : [[west, 180], [-180, east]];
}

/** True when two boxes overlap, either of which may cross the antimeridian. `pad` widens the first by that many degrees. */
export function bboxesOverlap(a: BBox, b: BBox, pad = 0): boolean {
  if (a[3] + pad < b[1] || a[1] - pad > b[3]) return false;
  for (const [aw, ae] of spans(a[0] - pad, a[2] + pad)) for (const [bw, be] of spans(b[0], b[2])) if (aw <= be && ae >= bw) return true;
  return false;
}

/** Width and height of a view in degrees (the width accounts for the antimeridian). */
export function viewSpan(b: BBox): { lon: number; lat: number } {
  const c = bboxCentre(b);
  return { lon: c.widthDeg, lat: c.heightDeg };
}

export interface Selection {
  chosen: IndexedSystem[];
  /** Systems that overlap the view, before the cap. */
  total: number;
}

/**
 * The systems a view needs: those whose box overlaps it (with a margin, since a
 * box is trimmed of outliers), nearest the view centre first, at most `max`.
 */
export function selectSystems(systems: readonly IndexedSystem[], view: BBox, max: number, pad = 0.05): Selection {
  const centre = bboxCentre(view);
  const hits = systems.filter((s) => bboxesOverlap(view, s.bbox, pad));
  const dist = (s: IndexedSystem): number => {
    const c = bboxCentre(s.bbox);
    return approxDistanceM(centre.lat, centre.lon, c.lat, c.lon);
  };
  const ranked = hits.map((s) => ({ s, d: dist(s) })).sort((a, b) => a.d - b.d || (a.s.id < b.s.id ? -1 : 1));
  return { chosen: ranked.slice(0, max).map((r) => r.s), total: hits.length };
}
