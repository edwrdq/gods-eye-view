import type { BBox } from '@gev/shared';

const M_PER_DEG_LAT = 111_320;

/** True when (lon, lat) is inside bbox; west > east means the box crosses the antimeridian. */
export function inBBox(lon: number, lat: number, bbox: BBox): boolean {
  const [west, south, east, north] = bbox;
  if (lat < south || lat > north) return false;
  return west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
}

/** True when the box covers the whole world (no spatial filtering needed). */
export function isWorld(bbox: BBox): boolean {
  return bbox[0] <= -180 && bbox[2] >= 180 && bbox[1] <= -90 && bbox[3] >= 90;
}

/**
 * Parse "west,south,east,north". Returns an error message instead of throwing.
 * Latitudes must satisfy south <= north; west > east is allowed (antimeridian).
 */
export function parseBBox(raw: string): BBox | string {
  const parts = raw.split(',');
  if (parts.length !== 4) return 'bbox must be west,south,east,north';
  const nums = parts.map((p) => (p.trim() === '' ? NaN : Number(p)));
  if (!nums.every(Number.isFinite)) return 'bbox values must be finite numbers';
  const [west, south, east, north] = nums as [number, number, number, number];
  if (south < -90 || north > 90) return 'bbox latitudes must be within -90..90';
  if (south > north) return 'bbox south must not exceed north';
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    return 'bbox longitudes must be within -180..180';
  }
  return [west, south, east, north];
}

/** Equirectangular distance in metres; accurate enough for throttling decisions. */
export function approxDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  let dLon = Math.abs(lon2 - lon1);
  if (dLon > 180) dLon = 360 - dLon;
  const dLat = (lat2 - lat1) * M_PER_DEG_LAT;
  const x = dLon * M_PER_DEG_LAT * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, x);
}

/** Smallest absolute difference between two compass headings, 0..180. */
export function headingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}

/** Centre of a bbox, handling the antimeridian. */
export function bboxCentre(bbox: BBox): { lon: number; lat: number; widthDeg: number; heightDeg: number } {
  const [west, south, east, north] = bbox;
  const widthDeg = east >= west ? east - west : east - west + 360;
  return { lon: wrapLon(west + widthDeg / 2), lat: (south + north) / 2, widthDeg, heightDeg: north - south };
}

type Coord = readonly number[];

/** Longitude spans [lo, hi] covered by a lon range; west > east wraps across 180. */
function lonSpans(west: number, east: number): Array<[number, number]> {
  return west <= east ? [[west, east]] : [[west, 180], [-180, east]];
}

function partBBox(coords: readonly Coord[]): BBox {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minPos = Infinity;
  let maxNeg = -Infinity;
  for (const c of coords) {
    const lon = c[0]!;
    const lat = c[1]!;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon >= 0 && lon < minPos) minPos = lon;
    if (lon < 0 && lon > maxNeg) maxNeg = lon;
  }
  // A part spanning more than half the globe crosses the antimeridian: its
  // box runs from the westernmost positive longitude east through 180 to the
  // easternmost negative one.
  if (maxLon - minLon > 180 && Number.isFinite(minPos) && Number.isFinite(maxNeg)) {
    return [minPos, minLat, maxNeg, maxLat];
  }
  return [minLon, minLat, maxLon, maxLat];
}

function bboxesIntersect(a: BBox, b: BBox): boolean {
  if (a[3] < b[1] || a[1] > b[3]) return false;
  for (const [alo, ahi] of lonSpans(a[0], a[2])) {
    for (const [blo, bhi] of lonSpans(b[0], b[2])) if (alo <= bhi && blo <= ahi) return true;
  }
  return false;
}

/**
 * Whether a feature geometry touches `bbox`. Lines and polygons are tested by
 * the bounding box of each part (coarse: a diagonal line can pass a box it does
 * not touch), which is what a map viewport query needs.
 */
export function geometryIntersects(
  g: { type: string; coordinates: unknown },
  bbox: BBox,
): boolean {
  switch (g.type) {
    case 'Point': {
      const c = g.coordinates as Coord;
      return inBBox(c[0]!, c[1]!, bbox);
    }
    case 'LineString':
      return bboxesIntersect(partBBox(g.coordinates as Coord[]), bbox);
    case 'MultiLineString':
      return (g.coordinates as Coord[][]).some((p) => bboxesIntersect(partBBox(p), bbox));
    case 'Polygon':
      return bboxesIntersect(partBBox((g.coordinates as Coord[][])[0] ?? []), bbox);
    default:
      return false;
  }
}
