/**
 * Earthquake marker encoding (documented in DESIGN.md, "Phase 3 map encodings").
 *
 * - Size = magnitude. Diameter grows by 1.45x per magnitude unit (about the
 *   energy-scale feel of the Richter scale without letting M7 swallow a country):
 *   M3 is 10 px, M5 21 px, M6 30 px, M7 43 px. Bucketed to half units so the
 *   marker images share the texture atlas.
 * - Age = fill opacity, in four steps against the viewed time: under 1 h, under
 *   6 h, under 12 h, older. Fresh quakes are the loudest thing on the globe.
 * - Depth = a dark centre dot for deep events (70 km and deeper). Shallow events
 *   are solid. Shallow quakes do most of the damage, so solid is the default.
 *
 * Hue stays the hazards vermillion for every quake; nothing is carried by colour alone.
 */

export const QUAKE_MIN_PX = 7;
export const QUAKE_MAX_PX = 44;
export const DEEP_KM = 70;
/** Upper edges of the first three age buckets, in hours. The fourth bucket is everything older. */
export const AGE_EDGES_H = [1, 6, 12] as const;
/** Fill opacity per age bucket. */
export const AGE_ALPHA = [1, 0.8, 0.6, 0.42] as const;
export const AGE_LABELS = ['< 1 h', '< 6 h', '< 12 h', 'older'] as const;
export type AgeBucket = 0 | 1 | 2 | 3;

/** Magnitude rounded to the nearest half unit and clamped to the drawable range. */
export function magnitudeBucket(mag: number): number {
  if (!Number.isFinite(mag)) return 0;
  return Math.min(8, Math.max(0, Math.round(mag * 2) / 2));
}

/** Marker diameter in CSS pixels for a magnitude. */
export function magnitudeSize(mag: number): number {
  const m = magnitudeBucket(mag);
  return Math.min(QUAKE_MAX_PX, Math.max(QUAKE_MIN_PX, Math.round(3.2 * 1.45 ** m)));
}

export function ageBucket(ageMs: number): AgeBucket {
  const h = ageMs / 3_600_000;
  if (!(h >= 0)) return 0; // future or unknown times read as new
  if (h < AGE_EDGES_H[0]) return 0;
  if (h < AGE_EDGES_H[1]) return 1;
  if (h < AGE_EDGES_H[2]) return 2;
  return 3;
}

export function isDeep(depthKm: number): boolean {
  return Number.isFinite(depthKm) && depthKm >= DEEP_KM;
}

export interface QuakeStyle {
  sizePx: number;
  age: AgeBucket;
  deep: boolean;
  /** Image cache key; equal keys draw identical pixels. */
  key: string;
}

/** Style of one quake at the viewed instant `ref` (epoch ms). A missing time counts as new. */
export function quakeStyle(mag: number, depthKm: number, t: number, ref: number): QuakeStyle {
  const sizePx = magnitudeSize(mag);
  const age = Number.isFinite(t) ? ageBucket(ref - t) : 0;
  const deep = isDeep(depthKm);
  return { sizePx, age, deep, key: `gev-quake:${sizePx}:${age}:${deep ? 'd' : 's'}` };
}
