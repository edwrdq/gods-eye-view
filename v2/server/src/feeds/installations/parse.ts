import type { Feature } from '@gev/shared';

export const LAYER = 'installations';

export interface Installation {
  /** Typed OSM id: "r122949" is relation 122949, "w..." a way. */
  id: string;
  name: string;
  /** Interior label point. */
  lon: number;
  lat: number;
  /** Bounds of the mapped area [west, south, east, north]. */
  bounds: [number, number, number, number];
  /** What the area is mapped as. */
  cls: string;
  areaM2: number;
}

export interface InstallationDataset {
  release: string | null;
  snapshots: string[];
  items: Installation[];
  skipped: number;
}

const CLASS_LABEL: Record<string, string> = {
  military_land: 'Military land',
  airfield: 'Airfield',
  naval_base: 'Naval base',
  range: 'Range',
  barracks: 'Barracks',
  base: 'Base',
  training_area: 'Training area',
};

export const classLabel = (cls: string): string => CLASS_LABEL[cls] ?? cls.replaceAll('_', ' ');

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Parse the bundled military-area name index (OpenStreetMap via Overture Maps).
 * Rows are `[typedOsmId, name, lon, lat, west, south, east, north, classIndex,
 * areaM2]`. Geometry is reduced to a label point and bounds; there is no
 * outline. Invalid rows and duplicate ids are skipped.
 */
export function parseInstallations(json: unknown): InstallationDataset {
  const root = json as { release?: unknown; snapshots?: unknown; classes?: unknown; records?: unknown } | null;
  if (!root || !Array.isArray(root.records) || !Array.isArray(root.classes)) throw new Error('malformed military names index');
  const classes = root.classes as unknown[];
  const items: Installation[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of root.records as unknown[]) {
    if (!Array.isArray(r) || r.length < 10) {
      skipped++;
      continue;
    }
    const [id, name, lon, lat, w, s, e, n, ci, area] = r as unknown[];
    const cls = typeof ci === 'number' ? classes[ci] : undefined;
    if (
      typeof id !== 'string' || !/^[nwr]\d+$/.test(id) || seen.has(id) ||
      typeof name !== 'string' || name.trim() === '' || typeof cls !== 'string' ||
      num(lon) === null || num(lat) === null || Math.abs(lon as number) > 180 || Math.abs(lat as number) > 90 ||
      num(w) === null || num(s) === null || num(e) === null || num(n) === null
    ) {
      skipped++;
      continue;
    }
    seen.add(id);
    items.push({ id, name: name.trim(), lon: lon as number, lat: lat as number, bounds: [w, s, e, n] as [number, number, number, number], cls, areaM2: num(area) ?? 0 });
  }
  return {
    release: typeof root.release === 'string' ? root.release : null,
    snapshots: Array.isArray(root.snapshots) ? (root.snapshots as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    items,
    skipped,
  };
}

/** Thinning priority: bigger areas first (log scale), airfields and naval bases get a small lift so they survive. */
export function installationRank(i: Installation): number {
  const lift = i.cls === 'airfield' || i.cls === 'naval_base' ? 1 : i.cls === 'base' ? 0.5 : 0;
  return Math.log10(Math.max(1, i.areaM2)) + lift;
}

export const installationFeature = (i: Installation): Feature => ({
  id: i.id,
  geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
  label: i.name,
  props: { name: i.name, class: i.cls, areaKm2: Math.round(i.areaM2 / 1e4) / 100 },
});
