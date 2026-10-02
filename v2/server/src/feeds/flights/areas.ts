import type { BBox } from '@gev/shared';
import { bboxCentre, wrapLon } from '../../geo.ts';

export interface Area {
  lat: number;
  lon: number;
}

/** adsb.lol point queries accept at most 250 nautical miles. */
export const MAX_RADIUS_NM = 250;
/** A 250 nm circle fully covers a ~5 degree square (half-diagonal ~ 3.5 deg ~ 212 nm). */
const GRID_STEP_DEG = 5;

const roundQuarter = (v: number): number => Math.round(v * 4) / 4;

export function areaKey(a: Area): string {
  return `${a.lat.toFixed(2)},${a.lon.toFixed(2)}`;
}

/** Parse "lat,lon;lat,lon" or "lat,lon lat,lon" or a JSON-ish "[[lat,lon],...]" env value. */
export function parseAreas(raw: string | undefined): { areas: Area[]; invalid: string[] } {
  const areas: Area[] = [];
  const invalid: string[] = [];
  const text = (raw ?? '').replace(/[[\]]/g, ' ').trim();
  if (!text) return { areas, invalid };
  // Pairs are separated by ';', '|' or whitespace-after-a-complete-pair; use a number scanner.
  const nums = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (nums.length % 2 !== 0) invalid.push(text);
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const lat = Number(nums[i]);
    const lon = Number(nums[i + 1]);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) invalid.push(`${nums[i]},${nums[i + 1]}`);
    else areas.push({ lat, lon });
  }
  return { areas, invalid };
}

/**
 * Query centres that cover a bbox with 250 nm circles: a grid with ~5 degree
 * spacing, trimmed to the `max` points nearest the box centre (large boxes get
 * partial coverage rather than an unbounded number of upstream requests).
 */
export function coverPoints(bbox: BBox, max = 4): Area[] {
  const c = bboxCentre(bbox);
  const nLat = Math.max(1, Math.ceil(c.heightDeg / GRID_STEP_DEG));
  const cosLat = Math.max(0.2, Math.cos((c.lat * Math.PI) / 180));
  const nLon = Math.max(1, Math.ceil((c.widthDeg * cosLat) / GRID_STEP_DEG));
  const pts: (Area & { d: number })[] = [];
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const lat = bbox[1] + ((i + 0.5) * c.heightDeg) / nLat;
      const lon = wrapLon(bbox[0] + ((j + 0.5) * c.widthDeg) / nLon);
      const d = Math.hypot(lat - c.lat, (lon - c.lon) * cosLat);
      pts.push({ lat: Math.max(-90, Math.min(90, roundQuarter(lat))), lon: roundQuarter(lon), d });
    }
  }
  pts.sort((a, b) => a.d - b.d);
  const seen = new Set<string>();
  const out: Area[] = [];
  for (const p of pts) {
    const k = areaKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ lat: p.lat, lon: p.lon });
    if (out.length >= max) break;
  }
  return out;
}

/** Static (env) areas plus recently requested viewport areas that expire. */
export class AreaBook {
  private readonly dynamic = new Map<string, { area: Area; expires: number }>();

  private readonly staticAreas: Area[];
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxDynamic: number;

  constructor(staticAreas: Area[], now: () => number, ttlMs = 10 * 60_000, maxDynamic = 3) {
    this.staticAreas = staticAreas;
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxDynamic = maxDynamic;
  }

  /** Register a browser viewport. Returns true when it added a new area. */
  touch(bbox: BBox): boolean {
    let added = false;
    for (const area of coverPoints(bbox)) {
      const key = areaKey(area);
      if (!this.dynamic.has(key)) added = true;
      this.dynamic.delete(key);
      this.dynamic.set(key, { area, expires: this.now() + this.ttlMs });
    }
    while (this.dynamic.size > this.maxDynamic) {
      const oldest = this.dynamic.keys().next().value;
      if (oldest === undefined) break;
      this.dynamic.delete(oldest);
    }
    return added;
  }

  /** Current areas, static first, de-duplicated, expired viewports dropped. */
  active(): Area[] {
    const t = this.now();
    for (const [k, v] of this.dynamic) if (v.expires <= t) this.dynamic.delete(k);
    const seen = new Set<string>();
    const out: Area[] = [];
    for (const a of [...this.staticAreas, ...[...this.dynamic.values()].map((v) => v.area)]) {
      const k = areaKey(a);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(a);
      }
    }
    return out;
  }
}
