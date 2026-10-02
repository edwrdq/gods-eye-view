import type { BBox } from '@gev/shared';
import { wrapLon } from './format.ts';

export interface NormalizedBBox {
  west: number;
  south: number;
  /** Always >= west; may exceed 180 when the box crosses the antimeridian. */
  east: number;
  north: number;
  /** Centre longitude wrapped into [-180, 180). */
  centerLon: number;
  centerLat: number;
  /** Width in degrees of longitude, 0..360. */
  lonSpan: number;
  latSpan: number;
}

const clampLat = (v: number) => Math.max(-90, Math.min(90, v));

/** Unwrap an antimeridian-crossing box (west > east) and derive centre and spans. */
export function normalizeBBox(box: BBox): NormalizedBBox {
  const [w, s0, e0, n0] = box;
  const south = clampLat(Math.min(s0, n0));
  const north = clampLat(Math.max(s0, n0));
  const west = w;
  let east = e0;
  if (east < west) east += 360;
  const lonSpan = Math.min(360, east - west);
  return {
    west,
    south,
    east: west + lonSpan,
    north,
    centerLon: wrapLon(west + lonSpan / 2),
    centerLat: (south + north) / 2,
    lonSpan,
    latSpan: north - south,
  };
}

const EARTH_RADIUS_M = 6_371_008;
const MIN_ALTITUDE_M = 500;
const MAX_ALTITUDE_M = 22_000_000;

export function clampAltitude(m: number): number {
  return Math.max(MIN_ALTITUDE_M, Math.min(MAX_ALTITUDE_M, m));
}

/**
 * Camera height that frames a box looking straight down. `fovY` is the vertical
 * field of view in radians; `aspect` is canvas width / height. A margin keeps
 * the box off the very edge of the screen.
 */
export function altitudeForBBox(
  box: NormalizedBBox,
  { aspect, fovY = Math.PI / 3, minAltitude = 1500 }: { aspect: number; fovY?: number; minAltitude?: number },
): number {
  const rad = Math.PI / 180;
  const heightM = box.latSpan * rad * EARTH_RADIUS_M;
  const widthM = box.lonSpan * rad * EARTH_RADIUS_M * Math.max(0.05, Math.cos(box.centerLat * rad));
  const needed = Math.max(heightM, widthM / Math.max(0.2, aspect));
  const margin = 1.25;
  const altitude = ((needed * margin) / 2) / Math.tan(fovY / 2);
  return Math.max(minAltitude, clampAltitude(altitude));
}

export type PlaceKind = 'coordinates' | 'place' | 'address' | 'poi';

/** Altitude (m) for a result with no usable bbox, by what kind of thing it is. */
export function altitudeForKind(kind: PlaceKind): number {
  switch (kind) {
    case 'coordinates':
      return 2_500;
    case 'address':
      return 1_200;
    case 'poi':
      return 3_500;
    case 'place':
      return 45_000;
  }
}

const WGS84_RADIUS_M = 6_378_137;

/**
 * Camera height at which the whole globe fits the canvas with some breathing room.
 * `fovY` is the vertical field of view in radians, `aspect` is width / height; the
 * tighter of the two axes decides.
 */
export function altitudeToFitGlobe({ aspect, fovY, fill = 0.82 }: { aspect: number; fovY: number; fill?: number }): number {
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
  const half = (Math.min(fovX, fovY) / 2) * fill;
  return WGS84_RADIUS_M / Math.sin(half) - WGS84_RADIUS_M;
}
