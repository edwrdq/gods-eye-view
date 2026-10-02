import { setTimeout as delay } from 'node:timers/promises';
import type { BBox, GeocodeResult } from '@gev/shared';
import { coordinateResult } from './coordinates.ts';

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface Geocoder {
  /** Rejects with GeocodeUnavailableError when every provider failed. */
  search(query: string, signal?: AbortSignal): Promise<GeocodeResult[]>;
}

export class GeocodeUnavailableError extends Error {
  constructor() {
    super('Search providers are unavailable');
    this.name = 'GeocodeUnavailableError';
  }
}

export interface GeocoderOptions {
  fetch?: FetchLike;
  userAgent?: string;
  timeoutMs?: number;
  cacheSize?: number;
  cacheTtlMs?: number;
  /** Minimum spacing between Nominatim requests (usage policy: 1/s). */
  nominatimIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const PHOTON_URL = 'https://photon.komoot.io/api/';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const LIMIT = 8;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Finite number in range from a number or numeric string; never coerces null/''/booleans to 0. */
function bounded(v: unknown, min: number, max: number): number | null {
  if (typeof v === 'string' && v.trim() === '') return null;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** west > east is kept as-is and means the box crosses the antimeridian. */
function makeBBox(west: unknown, south: unknown, east: unknown, north: unknown): BBox | undefined {
  const w = bounded(west, -180, 180);
  const s = bounded(south, -90, 90);
  const e = bounded(east, -180, 180);
  const n = bounded(north, -90, 90);
  if (w === null || s === null || e === null || n === null || s > n) return undefined;
  return [w, s, e, n];
}

const PHOTON_PLACE_TYPES = new Set(['country', 'state', 'county', 'city', 'district', 'locality', 'street']);
const PLACE_KEYS = new Set(['place', 'boundary', 'natural', 'water', 'waterway', 'landuse', 'highway']);

export function parsePhoton(body: unknown): GeocodeResult[] {
  if (!isObj(body) || !Array.isArray(body.features)) throw new Error('Invalid Photon response');
  const out: GeocodeResult[] = [];
  for (const f of body.features) {
    if (!isObj(f) || !isObj(f.geometry) || !isObj(f.properties)) continue;
    const coords = f.geometry.coordinates;
    if (!Array.isArray(coords)) continue;
    const lon = bounded(coords[0], -180, 180);
    const lat = bounded(coords[1], -90, 90);
    if (lon === null || lat === null) continue;

    const p = f.properties;
    const name = str(p.name);
    const street = [str(p.street), str(p.housenumber)].filter(Boolean).join(' ');
    const label = name || street;
    if (!label) continue;

    const type = str(p.type);
    const key = str(p.osm_key);
    const kind: GeocodeResult['kind'] =
      PHOTON_PLACE_TYPES.has(type) || PLACE_KEYS.has(key)
        ? 'place'
        : (type === 'house' || p.housenumber) && !name
          ? 'address'
          : 'poi';

    const parts = [name ? street : '', str(p.district), str(p.city), str(p.state), str(p.country)];
    const detail = [...new Set(parts.filter((x) => x && x !== label))].join(', ');

    const result: GeocodeResult = { label, lon, lat, kind, source: 'photon' };
    if (detail) result.detail = detail;
    // Photon extent order is [west, north, east, south].
    const ext = Array.isArray(p.extent) && p.extent.length === 4 ? p.extent : null;
    const bbox = ext && makeBBox(ext[0], ext[3], ext[2], ext[1]);
    if (bbox) result.bbox = bbox;
    out.push(result);
  }
  return out;
}

const NOMINATIM_PLACE_CATEGORIES = new Set([
  'place', 'boundary', 'natural', 'water', 'waterway', 'landuse', 'highway',
]);

export function parseNominatim(body: unknown): GeocodeResult[] {
  if (!Array.isArray(body)) throw new Error('Invalid Nominatim response');
  const out: GeocodeResult[] = [];
  for (const row of body) {
    if (!isObj(row)) continue;
    const lat = bounded(row.lat, -90, 90);
    const lon = bounded(row.lon, -180, 180);
    if (lat === null || lon === null) continue;

    const display = str(row.display_name);
    const name = str(row.name);
    const [head = '', ...rest] = display.split(',').map((s) => s.trim());
    const label = name || head;
    if (!label) continue;

    const category = str(row.category) || str(row.class);
    const type = str(row.type);
    const addresstype = str(row.addresstype);
    const isAddress =
      type === 'house' || type === 'house_number' || (category === 'building' && !name) ||
      (category === 'place' && addresstype === 'house');
    const kind: GeocodeResult['kind'] = isAddress
      ? 'address'
      : NOMINATIM_PLACE_CATEGORIES.has(category)
        ? 'place'
        : 'poi';

    // With a distinct name, the display_name head is usually the same text; drop duplicates.
    const detail = (name ? [head, ...rest] : rest).filter((s) => s && s !== label).join(', ');
    const result: GeocodeResult = { label, lon, lat, kind, source: 'nominatim' };
    if (detail) result.detail = detail;
    // Nominatim boundingbox order is [south, north, west, east], as strings.
    const bb = Array.isArray(row.boundingbox) && row.boundingbox.length === 4 ? row.boundingbox : null;
    const bbox = bb && makeBBox(bb[2], bb[0], bb[3], bb[1]);
    if (bbox) result.bbox = bbox;
    out.push(result);
  }
  return out;
}

export function createGeocoder(options: GeocoderOptions = {}): Geocoder {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const userAgent = options.userAgent ?? 'GodsEyeView/2 (self-hosted OSINT globe; geocode)';
  const timeoutMs = options.timeoutMs ?? 5000;
  const cacheSize = options.cacheSize ?? 500;
  const ttl = options.cacheTtlMs ?? 3_600_000;
  const interval = options.nominatimIntervalMs ?? 1000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number, signal?: AbortSignal) => delay(ms, undefined, { signal }));

  const cache = new Map<string, { expires: number; results: GeocodeResult[] }>();

  async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await doFetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Serialise Nominatim calls, spacing request starts by at least `interval`.
  let lastNominatim = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();
  function nominatimSlot(signal?: AbortSignal): Promise<void> {
    const slot = queue.then(async () => {
      signal?.throwIfAborted();
      const wait = lastNominatim + interval - now();
      if (wait > 0) await sleep(wait, signal);
      lastNominatim = now();
    });
    queue = slot.catch(() => {});
    return slot;
  }

  async function search(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (!q) return [];
    const local = coordinateResult(q);
    if (local) return [local];

    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit) {
      if (hit.expires > now()) {
        cache.delete(key);
        cache.set(key, hit); // refresh LRU position
        return hit.results;
      }
      cache.delete(key);
    }

    let allAnswered = true;
    let results: GeocodeResult[] = [];
    try {
      results = parsePhoton(await getJson(`${PHOTON_URL}?${new URLSearchParams({ q, limit: String(LIMIT) })}`, signal));
    } catch {
      signal?.throwIfAborted();
      allAnswered = false;
    }
    if (results.length === 0) {
      try {
        await nominatimSlot(signal);
        const params = new URLSearchParams({ format: 'jsonv2', q, limit: String(LIMIT) });
        results = parseNominatim(await getJson(`${NOMINATIM_URL}?${params}`, signal));
        // Photon failing earlier no longer matters: Nominatim gave a definite answer.
        allAnswered = true;
      } catch {
        signal?.throwIfAborted();
        if (!allAnswered) throw new GeocodeUnavailableError();
        allAnswered = false; // Photon answered empty, Nominatim failed: don't cache the miss
      }
    }

    if (results.length > 0 || allAnswered) {
      cache.set(key, { expires: now() + ttl, results });
      while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
    }
    return results;
  }

  return { search };
}
