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

// ---------------------------------------------------------------- view bounding boxes

const RAD2DEG = 180 / Math.PI;

/** What camera.computeViewRectangle() returns: radians, west > east when crossing the antimeridian. */
export interface RectangleRad {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** View spans wider than this many degrees of longitude are treated as "the whole world". */
export const WORLD_SPAN_DEG = 240;

/**
 * Convert the camera's visible rectangle into an API bbox, padded so small pans
 * stay inside it. Returns null for "whole world": no rectangle (the globe fills
 * the view), or a span so wide that filtering buys nothing. West > east in the
 * result means it crosses the antimeridian.
 */
export function bboxFromRectangle(rect: RectangleRad | undefined | null, padFraction = 0.25): BBox | null {
  if (!rect) return null;
  const w = rect.west * RAD2DEG;
  const e = rect.east * RAD2DEG;
  const s = rect.south * RAD2DEG;
  const n = rect.north * RAD2DEG;
  if (![w, e, s, n].every(Number.isFinite)) return null;
  let span = e - w;
  if (span < 0) span += 360;
  if (span >= WORLD_SPAN_DEG) return null;
  const padLon = span * padFraction;
  const padLat = (n - s) * padFraction;
  if (span + 2 * padLon >= 360) return null;
  return [wrapLon(w - padLon), clampLat(s - padLat), wrapLon(e + padLon), clampLat(n + padLat)];
}

/** `bbox` query value for the API. */
export function bboxParam(box: BBox): string {
  return box.map((v) => (Math.round(v * 1e4) / 1e4).toString()).join(',');
}

function lonRange(box: BBox): [number, number] {
  const w = box[0];
  let e = box[2];
  if (e < w) e += 360;
  return [w, e];
}

/** True when `inner` lies completely inside `outer`. `null` is the whole world. */
export function bboxContains(outer: BBox | null, inner: BBox | null): boolean {
  if (outer === null) return true;
  if (inner === null) return false;
  if (inner[1] < outer[1] || inner[3] > outer[3]) return false;
  const [ow, oe] = lonRange(outer);
  const [iw, ie] = lonRange(inner);
  for (const shift of [-360, 0, 360]) {
    if (iw + shift >= ow && ie + shift <= oe) return true;
  }
  return false;
}

/** Whether a point is inside a bbox (handles the antimeridian). `null` is the whole world. */
export function bboxHasPoint(box: BBox | null, lon: number, lat: number): boolean {
  if (box === null) return true;
  if (lat < box[1] || lat > box[3]) return false;
  const [w, e] = lonRange(box);
  const l = wrapLon(lon);
  return (l >= w && l <= e) || (l + 360 >= w && l + 360 <= e);
}

/** Area in square degrees (the whole world for null); only used to compare views. */
export function bboxArea(box: BBox | null): number {
  if (box === null) return 360 * 180;
  const [w, e] = lonRange(box);
  return (e - w) * Math.max(0, box[3] - box[1]);
}
