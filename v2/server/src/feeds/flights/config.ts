import { parseAreas, type Area } from './areas.ts';

export interface FlightsConfig {
  openSky: { clientId: string; clientSecret: string } | null;
  /** Global OpenSky poll interval. See the credit budget note on OPENSKY_MIN_INTERVAL_MS. */
  openSkyIntervalMs: number;
  /** Per-area adsb.lol poll interval. */
  areaIntervalMs: number;
  /** adsb.lol /v2/mil poll interval. */
  milIntervalMs: number;
  areas: Area[];
  /** History throttle: minimum seconds between stored points of one aircraft. */
  storeIntervalMs: number;
  warnings: string[];
}

/**
 * OpenSky credit budget: an authenticated /states/all call over the whole globe
 * costs 4 credits (the original app measured this), and a standard account gets
 * 4000 credits per day = 1000 calls per day = one call per 86.4 s when running
 * 24/7. The default of 90 s uses 960 calls = 3840 credits/day (4% headroom);
 * anything below 87 s would exhaust the daily quota before midnight UTC. The
 * floor below enforces that unless the operator has a larger quota
 * (OPENSKY_POLL_S below the floor is clamped).
 */
export const OPENSKY_MIN_INTERVAL_MS = 87_000;
export const OPENSKY_DEFAULT_INTERVAL_MS = 90_000;
/** The original app's adsb.lol point cache was 12 s; stay well above it. */
export const ADSB_MIN_INTERVAL_MS = 30_000;
export const ADSB_DEFAULT_INTERVAL_MS = 60_000;

function seconds(raw: string | undefined, def: number, min: number, name: string, warnings: string[]): number {
  const t = raw?.trim();
  if (!t) return def;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) {
    warnings.push(`Invalid ${name}=${t}; using ${def / 1000}`);
    return def;
  }
  if (n * 1000 < min) {
    warnings.push(`${name}=${t} is below the minimum; using ${min / 1000}`);
    return min;
  }
  return Math.round(n * 1000);
}

export function loadFlightsConfig(env: Record<string, string | undefined>): FlightsConfig {
  const warnings: string[] = [];
  const id = env.OPENSKY_CLIENT_ID?.trim();
  const secret = env.OPENSKY_CLIENT_SECRET?.trim();
  const { areas, invalid } = parseAreas(env.ADSB_AREAS);
  if (invalid.length) warnings.push(`Ignoring invalid ADSB_AREAS entries: ${invalid.join('; ')}`);
  return {
    openSky: id && secret ? { clientId: id, clientSecret: secret } : null,
    openSkyIntervalMs: seconds(env.OPENSKY_POLL_S, OPENSKY_DEFAULT_INTERVAL_MS, OPENSKY_MIN_INTERVAL_MS, 'OPENSKY_POLL_S', warnings),
    areaIntervalMs: seconds(env.ADSB_AREA_POLL_S, ADSB_DEFAULT_INTERVAL_MS, ADSB_MIN_INTERVAL_MS, 'ADSB_AREA_POLL_S', warnings),
    milIntervalMs: seconds(env.ADSB_MIL_POLL_S, ADSB_DEFAULT_INTERVAL_MS, ADSB_MIN_INTERVAL_MS, 'ADSB_MIL_POLL_S', warnings),
    areas,
    storeIntervalMs: seconds(env.FLIGHTS_STORE_INTERVAL_S, 60_000, 10_000, 'FLIGHTS_STORE_INTERVAL_S', warnings),
    warnings,
  };
}
