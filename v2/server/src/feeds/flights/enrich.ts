import { TtlLru } from '../../cache.ts';
import type { FetchLike } from '../types.ts';

export interface AircraftInfo {
  typeCode: string | null;
  typeName: string | null;
  registration: string | null;
  owner: string | null;
  country: string | null;
}

export interface AirportInfo {
  code: string;
  name: string;
}

export interface RouteInfo {
  airline: string | null;
  origin: AirportInfo;
  destination: AirportInfo;
}

export interface Enricher {
  aircraft(hex: string): Promise<AircraftInfo | null>;
  route(callsign: string): Promise<RouteInfo | null>;
}

const BASE = 'https://api.adsbdb.com/v0';
const TTL_MS = 24 * 3600_000;
/** Failures are remembered briefly so a down service is not hammered per detail click. */
const FAILURE_TTL_MS = 60_000;

export function parseAircraft(json: unknown): AircraftInfo | null {
  const a = (json as { response?: { aircraft?: Record<string, unknown> } } | null)?.response?.aircraft;
  if (!a || typeof a !== 'object') return null;
  const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const manufacturer = s(a.manufacturer);
  const type = s(a.type);
  return {
    typeCode: s(a.icao_type),
    typeName: manufacturer && type ? `${manufacturer} ${type}` : type,
    registration: s(a.registration),
    owner: s(a.registered_owner),
    country: s(a.registered_owner_country_name),
  };
}

export function parseRoute(json: unknown): RouteInfo | null {
  const fr = (json as { response?: { flightroute?: Record<string, any> } } | null)?.response?.flightroute;
  if (!fr?.origin || !fr?.destination) return null;
  const airport = (a: Record<string, unknown>): AirportInfo => ({
    code: String(a.iata_code || a.icao_code || ''),
    name: String(a.municipality || a.name || ''),
  });
  return {
    airline: typeof fr.airline?.name === 'string' && fr.airline.name ? fr.airline.name : null,
    origin: airport(fr.origin),
    destination: airport(fr.destination),
  };
}

/**
 * adsbdb.com lookups (aircraft by ICAO hex, route by callsign), cached 24 h in
 * an LRU. 404s are cached as misses; network errors and other statuses resolve
 * to null and are retried after a short pause. Never throws.
 */
export function createAdsbdbEnricher(deps: {
  fetch: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  max?: number;
}): Enricher {
  const now = deps.now ?? Date.now;
  const aircraftCache = new TtlLru<AircraftInfo | null>(deps.max ?? 5000, TTL_MS, now);
  const routeCache = new TtlLru<RouteInfo | null>(deps.max ?? 5000, TTL_MS, now);
  const failures = new TtlLru<true>(deps.max ?? 5000, FAILURE_TTL_MS, now);
  const inflight = new Map<string, Promise<unknown>>();

  function lookup<T>(
    kind: string,
    key: string,
    cache: TtlLru<T | null>,
    parse: (json: unknown) => T | null,
  ): Promise<T | null> {
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit.value);
    const ik = `${kind}:${key}`;
    if (failures.get(ik)) return Promise.resolve(null);
    const pending = inflight.get(ik);
    if (pending) return pending as Promise<T | null>;
    const p = (async (): Promise<T | null> => {
      try {
        const res = await deps.fetch(`${BASE}/${kind}/${encodeURIComponent(key)}`, {
          signal: AbortSignal.timeout(deps.timeoutMs ?? 4000),
          headers: { 'User-Agent': 'gods-eye-view-v2' },
        });
        if (res.status === 404) {
          cache.set(key, null);
          return null;
        }
        if (!res.ok) {
          failures.set(ik, true);
          return null;
        }
        const data = parse(await res.json());
        cache.set(key, data);
        return data;
      } catch {
        failures.set(ik, true);
        return null;
      } finally {
        inflight.delete(ik);
      }
    })();
    inflight.set(ik, p);
    return p;
  }

  return {
    aircraft(hex) {
      if (!/^[0-9a-f]{6}$/.test(hex)) return Promise.resolve(null);
      return lookup('aircraft', hex, aircraftCache, parseAircraft);
    },
    route(callsign) {
      const cs = callsign.trim().toUpperCase();
      if (!/^[A-Z0-9]{2,8}$/.test(cs)) return Promise.resolve(null);
      return lookup('callsign', cs, routeCache, parseRoute);
    },
  };
}

export const noEnrichment: Enricher = {
  aircraft: async () => null,
  route: async () => null,
};
