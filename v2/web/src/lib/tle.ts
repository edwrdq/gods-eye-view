import type { OrbitalElements } from '@gev/shared';

/** Orbital figures read straight from a two-line element set (no propagation). */

const MU_KM3_S2 = 398_600.4418;
const EARTH_RADIUS_KM = 6378.137;

export interface TleSummary {
  /** Degrees. */
  inclinationDeg: number;
  /** Revolutions per day. */
  meanMotion: number;
  eccentricity: number;
  periodMin: number;
  /** Altitudes above the equatorial radius, km. */
  perigeeKm: number;
  apogeeKm: number;
  /** International designator, e.g. "98067A". */
  designator: string;
}

export function tleSummary(tle1: string, tle2: string): TleSummary | null {
  const inclinationDeg = Number(tle2.slice(8, 16));
  const eccentricity = Number(`0.${tle2.slice(26, 33).trim()}`);
  const meanMotion = Number(tle2.slice(52, 63));
  if (!Number.isFinite(inclinationDeg) || !Number.isFinite(eccentricity) || !Number.isFinite(meanMotion) || meanMotion <= 0) return null;
  const n = (meanMotion * 2 * Math.PI) / 86_400; // rad/s
  const a = Math.cbrt(MU_KM3_S2 / (n * n));
  return {
    inclinationDeg,
    meanMotion,
    eccentricity,
    periodMin: 1440 / meanMotion,
    perigeeKm: a * (1 - eccentricity) - EARTH_RADIUS_KM,
    apogeeKm: a * (1 + eccentricity) - EARTH_RADIUS_KM,
    designator: tle1.slice(9, 17).trim(),
  };
}

/** Mod-10 checksum over the first 68 columns (digits count their value, '-' counts 1). */
export function tleChecksum(line: string): number {
  let sum = 0;
  for (let i = 0; i < 68 && i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c >= 48 && c <= 57) sum += c - 48;
    else if (c === 45) sum += 1;
  }
  return sum % 10;
}

export interface SynthOrbit {
  catalog: number;
  inclinationDeg: number;
  raanDeg: number;
  eccentricity: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
  meanMotion: number;
  epochMs: number;
}

const f = (v: number, int: number, dec: number) => v.toFixed(dec).padStart(int + dec + 1, ' ');

/** Build a valid TLE pair for a synthetic orbit (used by the ?satbench flag and tests). */
export function buildTle(o: SynthOrbit): { tle1: string; tle2: string } {
  const d = new Date(o.epochMs);
  const yy = d.getUTCFullYear() % 100;
  const dayOfYear = (o.epochMs - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1;
  const id = String(o.catalog).padStart(5, '0');
  const day = dayOfYear.toFixed(8).padStart(12, '0');
  const l1 = `1 ${id}U 24001A   ${String(yy).padStart(2, '0')}${day}  .00000000  00000-0  00000-0 0  999`;
  const ecc = Math.round(o.eccentricity * 1e7).toString().padStart(7, '0');
  const l2 = `2 ${id} ${f(o.inclinationDeg, 3, 4)} ${f(o.raanDeg, 3, 4)} ${ecc} ${f(o.argPerigeeDeg, 3, 4)} ${f(o.meanAnomalyDeg, 3, 4)} ${f(o.meanMotion, 2, 8)}00001`;
  return { tle1: l1 + (tleChecksum(l1) % 10), tle2: l2 + (tleChecksum(l2) % 10) };
}

/** Deterministic synthetic constellation for the `?satbench=N` performance flag. */
export function synthElements(n: number, nowMs: number): OrbitalElements[] {
  let s = 0x9e3779b9;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const shells = [
    { inc: 53.05, mm: 15.06 },
    { inc: 53.2, mm: 15.1 },
    { inc: 70, mm: 14.9 },
    { inc: 97.6, mm: 14.8 },
    { inc: 43, mm: 15.2 },
  ];
  const out: OrbitalElements[] = [];
  for (let i = 0; i < n; i++) {
    const shell = shells[i % shells.length]!;
    const epoch = nowMs - rnd() * 2 * 86_400_000;
    const catalog = 80_000 + (i % 19_999);
    const { tle1, tle2 } = buildTle({
      catalog,
      inclinationDeg: shell.inc,
      raanDeg: rnd() * 360,
      eccentricity: 0.0001 + rnd() * 0.0008,
      argPerigeeDeg: rnd() * 360,
      meanAnomalyDeg: rnd() * 360,
      meanMotion: shell.mm,
      epochMs: epoch,
    });
    out.push({ noradId: String(catalog), name: `BENCH-${i}`, group: 'starlink', tle1, tle2, epoch });
  }
  return out;
}
