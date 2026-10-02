// SGP4 helpers for the orbits worker. Pure functions over satellite.js; no globals,
// so they can be tested in node.
import { gstime, sgp4, twoline2satrec, type SatRec } from 'satellite.js';

const A = 6_378_137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const RAD = Math.PI / 180;
const UNIX_JD = 2_440_587.5;

export type { SatRec };

/** Satellite record for a two-line set, or null when SGP4 rejects it. */
export function makeSatrec(tle1: string, tle2: string): SatRec | null {
  try {
    const r = twoline2satrec(tle1, tle2);
    return r.error === 0 ? r : null;
  } catch {
    return null;
  }
}

/** Julian date (UTC) of an epoch in ms. */
export const julianDate = (tMs: number): number => tMs / 86_400_000 + UNIX_JD;

/** Greenwich mean sidereal time, radians, at a Julian date. */
export const gmstAt = (jd: number): number => gstime(jd);

/** Minutes from the element epoch to `jd`. */
export function minutesSinceEpoch(satrec: SatRec, jd: number): number {
  return (jd - satrec.jdsatepoch) * 1440;
}

export interface Teme {
  /** km, TEME. */
  x: number;
  y: number;
  z: number;
  /** km/s, TEME. */
  vx: number;
  vy: number;
  vz: number;
}

/** Propagate to `jd`; null when the element set has decayed or is out of range. */
export function propagateTeme(satrec: SatRec, jd: number): Teme | null {
  const r = sgp4(satrec, minutesSinceEpoch(satrec, jd));
  if (!r || typeof r.position === 'boolean' || !r.position) return null;
  const p = r.position;
  const v = r.velocity;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
  return { x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z };
}

/** Rotate TEME km to Earth-fixed metres by the sidereal angle (polar motion ignored: metres of error). */
export function temeToEcefM(t: Teme, gmst: number, out: Float64Array, o: number): void {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  out[o] = (t.x * c + t.y * s) * 1000;
  out[o + 1] = (-t.x * s + t.y * c) * 1000;
  out[o + 2] = t.z * 1000;
}

/** Earth-fixed metres to geodetic degrees and metres (Bowring-style iteration on WGS84). */
export function ecefToGeodetic(x: number, y: number, z: number): { lon: number; lat: number; alt: number } {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  let alt = 0;
  for (let i = 0; i < 5; i++) {
    const sin = Math.sin(lat);
    const n = A / Math.sqrt(1 - E2 * sin * sin);
    alt = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + alt)));
  }
  return { lon: lon / RAD, lat: lat / RAD, alt };
}

/**
 * Propagate every record to one instant. Writes Earth-fixed metres to `out`
 * (3 numbers per record, NaN for a failed one). Returns how many failed.
 */
export function propagateAll(sats: ReadonlyArray<SatRec | null>, active: Uint32Array, tMs: number, out: Float64Array): number {
  const jd = julianDate(tMs);
  const g = gmstAt(jd);
  let failed = 0;
  for (let k = 0; k < active.length; k++) {
    const sat = sats[active[k]!];
    const teme = sat ? propagateTeme(sat, jd) : null;
    if (teme) temeToEcefM(teme, g, out, 3 * k);
    else {
      out[3 * k] = out[3 * k + 1] = out[3 * k + 2] = Number.NaN;
      failed++;
    }
  }
  return failed;
}

export interface SatState {
  lon: number;
  lat: number;
  /** Metres above the ellipsoid. */
  alt: number;
  /** Inertial speed, km/s. */
  speedKms: number;
  ecef: [number, number, number];
}

export function stateAt(sat: SatRec, tMs: number): SatState | null {
  const jd = julianDate(tMs);
  const teme = propagateTeme(sat, jd);
  if (!teme) return null;
  const buf = new Float64Array(3);
  temeToEcefM(teme, gmstAt(jd), buf, 0);
  const g = ecefToGeodetic(buf[0]!, buf[1]!, buf[2]!);
  return { lon: g.lon, lat: g.lat, alt: g.alt, speedKms: Math.hypot(teme.vx, teme.vy, teme.vz), ecef: [buf[0]!, buf[1]!, buf[2]!] };
}

export interface OrbitPath {
  /** Earth-fixed metres, 3 per sample, oldest first; the sample at index `nowIndex` is the position at `tMs`. */
  xyz: Float64Array;
  nowIndex: number;
}

/**
 * The path through the Earth-fixed frame from one period before `tMs` to one period after,
 * sampled `stepsPerSide` times each side. Failed samples are dropped.
 */
export function orbitPath(sat: SatRec, tMs: number, periodMin: number, stepsPerSide = 120): OrbitPath {
  const out: number[] = [];
  const buf = new Float64Array(3);
  let nowIndex = 0;
  const stepMs = (periodMin * 60_000) / stepsPerSide;
  for (let i = -stepsPerSide; i <= stepsPerSide; i++) {
    const t = tMs + i * stepMs;
    const jd = julianDate(t);
    const teme = propagateTeme(sat, jd);
    if (!teme) continue;
    temeToEcefM(teme, gmstAt(jd), buf, 0);
    if (i <= 0) nowIndex = out.length / 3;
    out.push(buf[0]!, buf[1]!, buf[2]!);
  }
  return { xyz: Float64Array.from(out), nowIndex };
}
