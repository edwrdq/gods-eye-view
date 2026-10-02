/**
 * GBFS (General Bikeshare Feed Specification) parsing: the MobilityData systems
 * catalogue, a system's gbfs.json, station_information, station_status and
 * vehicle_types, across versions 1.x, 2.x and 3.x. Pure functions, no network.
 *
 * Real feeds are loose about types (0/1 for booleans, strings for numbers, names
 * as plain strings in v2 and as localised arrays in v3), so every reader here
 * accepts both and drops what it cannot trust instead of throwing.
 */

import { httpUrl } from '../url.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- catalogue

export interface CatalogueSystem {
  /** The catalogue's "System ID". */
  id: string;
  name: string;
  /** Free text, e.g. "New York, NY". */
  location: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** gbfs.json address (the catalogue's "Auto-Discovery URL"). */
  discoveryUrl: string;
  /** The operator's public site, when the catalogue gives an http(s) one. */
  website?: string;
}

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Read the systems catalogue (MobilityData/gbfs systems.csv). Systems that need
 * authentication, have no https discovery address or repeat an earlier id are left out.
 */
export function parseCatalogue(csv: string): { systems: CatalogueSystem[]; skipped: number } {
  const rows = parseCsv(csv);
  const head = rows.shift() ?? [];
  const col = (name: string) => head.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const [iCountry, iName, iLoc, iId, iUrl, iAuthType, iSite] = ['Country Code', 'Name', 'Location', 'System ID', 'Auto-Discovery URL', 'Authentication Type', 'URL'].map(col);
  if ([iId, iUrl, iName].some((i) => i === undefined || i < 0)) return { systems: [], skipped: rows.length };
  const systems: CatalogueSystem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of rows) {
    const id = (r[iId!] ?? '').trim();
    const url = (r[iUrl!] ?? '').trim();
    const auth = iAuthType !== undefined && iAuthType >= 0 ? (r[iAuthType] ?? '').trim() : '';
    if (!id || seen.has(id) || !/^https:\/\//i.test(url) || auth !== '') {
      skipped++;
      continue;
    }
    seen.add(id);
    const site = iSite !== undefined && iSite >= 0 ? httpUrl(r[iSite]) : undefined;
    systems.push({
      id,
      name: (r[iName!] ?? '').trim() || id,
      location: iLoc !== undefined && iLoc >= 0 ? (r[iLoc] ?? '').trim() : '',
      country: iCountry !== undefined && iCountry >= 0 ? (r[iCountry] ?? '').trim().toUpperCase() : '',
      discoveryUrl: url,
      ...(site ? { website: site } : {}),
    });
  }
  return { systems, skipped };
}

// ---------------------------------------------------------------- discovery

export interface Discovery {
  stationInformation?: string;
  stationStatus?: string;
  vehicleTypes?: string;
}

/**
 * Feed addresses from a gbfs.json. v1/v2 key the list by language (`data.en.feeds`),
 * v3 has it at `data.feeds`. English is preferred, otherwise the first language.
 * Relative addresses resolve against the document's own URL.
 */
export function parseDiscovery(json: unknown, baseUrl: string): Discovery | null {
  const data = isObj(json) ? json.data : null;
  if (!isObj(data)) return null;
  let feeds: unknown = data.feeds;
  if (!Array.isArray(feeds)) {
    const langs = Object.entries(data).filter(([, v]) => isObj(v) && Array.isArray(v.feeds));
    const pick = langs.find(([k]) => k.toLowerCase().startsWith('en')) ?? langs[0];
    feeds = pick ? (pick[1] as Obj).feeds : null;
  }
  if (!Array.isArray(feeds)) return null;
  const out: Discovery = {};
  for (const f of feeds) {
    if (!isObj(f) || typeof f.name !== 'string' || typeof f.url !== 'string') continue;
    let url: string;
    try {
      url = new URL(f.url, baseUrl).href;
    } catch {
      continue;
    }
    if (f.name === 'station_information') out.stationInformation = url;
    else if (f.name === 'station_status') out.stationStatus = url;
    else if (f.name === 'vehicle_types') out.vehicleTypes = url;
  }
  return out;
}

/** The document's own `ttl` in seconds, or null when absent or nonsense. */
export function docTtlSeconds(json: unknown): number | null {
  const t = isObj(json) ? json.ttl : undefined;
  return typeof t === 'number' && Number.isFinite(t) && t >= 0 ? t : null;
}

// ---------------------------------------------------------------- value readers

function count(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function flag(v: unknown, fallback: boolean): boolean {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n !== 0;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === 'yes') return true;
  if (s === 'false' || s === 'no') return false;
  return fallback;
}

/** v2 names are strings, v3 names are [{text, language}]. */
function localised(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    const items = v.filter((x): x is Obj => isObj(x) && typeof x.text === 'string');
    const en = items.find((x) => typeof x.language === 'string' && x.language.toLowerCase().startsWith('en'));
    return ((en ?? items[0])?.text as string | undefined)?.trim() ?? '';
  }
  return '';
}

function clean(s: string, max: number): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stationArray(json: unknown): unknown[] {
  const data = isObj(json) ? json.data : null;
  if (isObj(data) && Array.isArray(data.stations)) return data.stations;
  if (Array.isArray(data)) return data;
  if (isObj(data)) {
    // Some v1 feeds wrap the list in a language key.
    for (const v of Object.values(data)) if (isObj(v) && Array.isArray(v.stations)) return v.stations;
  }
  return [];
}

// ---------------------------------------------------------------- station_information

export interface StationInfo {
  id: string;
  name: string;
  lon: number;
  lat: number;
  capacity: number | null;
}

/** Stations with a usable position. Virtual stations (areas, not places) and duplicate ids are skipped. */
export function parseStationInformation(json: unknown): { stations: StationInfo[]; skipped: number; ttlS: number | null } {
  const stations: StationInfo[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of stationArray(json)) {
    if (!isObj(raw)) {
      skipped++;
      continue;
    }
    const idRaw = raw.station_id ?? raw.id;
    const id = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw).trim() : '';
    const lat = Number(raw.lat ?? raw.latitude);
    const lon = Number(raw.lon ?? raw.longitude);
    const valid = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    if (!id || id.length > 64 || !valid || seen.has(id) || raw.is_virtual_station === true) {
      skipped++;
      continue;
    }
    seen.add(id);
    const name = clean(localised(raw.name) || localised(raw.short_name), 120);
    const cap = count(raw.capacity);
    stations.push({
      id,
      name: name || `Station ${id}`,
      lon: Math.round(lon * 1e6) / 1e6,
      lat: Math.round(lat * 1e6) / 1e6,
      capacity: cap !== null && cap > 0 ? cap : null,
    });
  }
  return { stations, skipped, ttlS: docTtlSeconds(json) };
}

// ---------------------------------------------------------------- vehicle_types

export interface VehicleTypes {
  /** vehicle_type_id -> electric (battery assisted or driven). */
  electric: Map<string, boolean>;
  /**
   * The system rents bicycles and no cars. Car sharing publishes GBFS with
   * stations too, and a fleet that mixes cars and bikes has car stations, so
   * neither is drawn as bikeshare. A document with no usable types says nothing.
   */
  bikes: boolean;
}

/** vehicle_types.json: which ids are electric, and whether the system is a bicycle system. */
export function parseVehicleTypes(json: unknown): VehicleTypes {
  const data = isObj(json) ? json.data : null;
  const list = isObj(data) && Array.isArray(data.vehicle_types) ? data.vehicle_types : [];
  const electric = new Map<string, boolean>();
  let any = false;
  let bicycle = false;
  let car = false;
  for (const v of list) {
    if (!isObj(v) || (typeof v.vehicle_type_id !== 'string' && typeof v.vehicle_type_id !== 'number')) continue;
    any = true;
    const form = typeof v.form_factor === 'string' ? v.form_factor : '';
    if (form === 'bicycle' || form === 'cargo_bicycle') bicycle = true;
    if (form === 'car') car = true;
    const prop = typeof v.propulsion_type === 'string' ? v.propulsion_type : '';
    electric.set(String(v.vehicle_type_id), prop === 'electric' || prop === 'electric_assist');
  }
  return { electric, bikes: any ? bicycle && !car : true };
}

// ---------------------------------------------------------------- station_status

export interface StationStatus {
  id: string;
  /** Bikes that can be rented now (all kinds, e-bikes included). */
  bikes: number | null;
  ebikes: number | null;
  /** Free docks. */
  docks: number | null;
  installed: boolean;
  renting: boolean;
  returning: boolean;
  /** Epoch ms of the station's own last report; null when never or unknown. */
  reportedAt: number | null;
}

/** v1/v2: Unix seconds. v3: RFC 3339. Tiny numbers (86400 and the like) mean "never reported". */
export function reportedAtMs(v: unknown): number | null {
  if (typeof v === 'string' && v.trim() !== '' && !/^\d+(\.\d+)?$/.test(v.trim())) {
    const t = Date.parse(v);
    return Number.isFinite(t) && t > 1e9 * 1000 ? t : null;
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e11 ? n : n * 1000; // some feeds already send milliseconds
  return ms > 1e9 * 1000 ? Math.round(ms) : null;
}

function ebikeCount(raw: Obj, vt: VehicleTypes | undefined): number | null {
  const direct = count(raw.num_ebikes_available);
  if (direct !== null) return direct;
  // Velib: num_bikes_available_types: [{ mechanical: 7 }, { ebike: 3 }]
  const types = raw.num_bikes_available_types;
  if (Array.isArray(types)) {
    let found: number | null = null;
    for (const t of types) if (isObj(t) && 'ebike' in t) found = (found ?? 0) + (count(t.ebike) ?? 0);
    if (found !== null) return found;
  } else if (isObj(types) && 'ebike' in types) return count(types.ebike);
  // v2.1+/v3: vehicle_types_available [{ vehicle_type_id, count }] joined with vehicle_types.json
  const avail = raw.vehicle_types_available;
  if (Array.isArray(avail) && vt && vt.electric.size > 0) {
    let n = 0;
    for (const a of avail) if (isObj(a) && vt.electric.get(String(a.vehicle_type_id)) === true) n += count(a.count) ?? 0;
    return n;
  }
  return null;
}

export function parseStationStatus(json: unknown, vt?: VehicleTypes): { status: Map<string, StationStatus>; ttlS: number | null } {
  const out = new Map<string, StationStatus>();
  for (const raw of stationArray(json)) {
    if (!isObj(raw)) continue;
    const idRaw = raw.station_id ?? raw.id;
    const id = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw).trim() : '';
    if (!id) continue;
    out.set(id, {
      id,
      bikes: count(raw.num_bikes_available ?? raw.num_vehicles_available),
      ebikes: ebikeCount(raw, vt),
      docks: count(raw.num_docks_available),
      installed: flag(raw.is_installed, true),
      renting: flag(raw.is_renting, true),
      returning: flag(raw.is_returning, true),
      reportedAt: reportedAtMs(raw.last_reported),
    });
  }
  return { status: out, ttlS: docTtlSeconds(json) };
}

// ---------------------------------------------------------------- derived state

/**
 * What a station is good for right now, in the words the map uses:
 * - offline: not installed, or neither renting nor returning
 * - empty: no bike to take (none there, or the station is not renting)
 * - full: no dock free (none free, or the station is not accepting returns)
 * - ok: both possible
 * - unknown: no status for it
 */
export type StationState = 'ok' | 'empty' | 'full' | 'offline' | 'unknown';

export interface StationReading {
  state: StationState;
  /** Bikes as a share of the dock count, 0..1; null when it cannot be told. */
  fill: number | null;
  /** Dock count used for `fill`: the station's capacity, else bikes plus free docks. */
  capacity: number | null;
}

export function stationReading(info: Pick<StationInfo, 'capacity'>, st: StationStatus | undefined): StationReading {
  if (!st) return { state: 'unknown', fill: null, capacity: info.capacity };
  const capacity = info.capacity ?? (st.bikes !== null && st.docks !== null && st.bikes + st.docks > 0 ? st.bikes + st.docks : null);
  const fill = st.bikes !== null && capacity !== null ? Math.max(0, Math.min(1, st.bikes / capacity)) : null;
  let state: StationState;
  if (!st.installed || (!st.renting && !st.returning)) state = 'offline';
  else if (!st.renting) state = 'empty';
  else if (!st.returning) state = 'full';
  else if (st.bikes === null) state = 'unknown';
  else if (st.bikes === 0) state = 'empty';
  else if (st.docks === 0) state = 'full';
  else state = 'ok';
  return { state, fill: fill === null ? null : Math.round(fill * 100) / 100, capacity };
}

// ---------------------------------------------------------------- geometry

/** Bounding box of station positions, trimmed of stray outliers (a station geocoded to 0,0 or the wrong continent). */
export function stationsBBox(points: ReadonlyArray<{ lon: number; lat: number }>): [number, number, number, number] | null {
  if (points.length === 0) return null;
  const lons = points.map((p) => p.lon).sort((a, b) => a - b);
  const lats = points.map((p) => p.lat).sort((a, b) => a - b);
  // Drop the outermost 1% on each side once there are enough stations to tell an outlier from an edge.
  const k = points.length >= 50 ? Math.floor(points.length * 0.01) : 0;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return [r(lons[k]!), r(lats[k]!), r(lons[lons.length - 1 - k]!), r(lats[lats.length - 1 - k]!)];
}
