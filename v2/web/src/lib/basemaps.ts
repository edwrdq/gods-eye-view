/**
 * Base-map option metadata and selection rules. Deliberately tiny and free of
 * Cesium so it stays in the initial bundle; provider code (URLs, credits)
 * lives in globe/basemap.ts, which loads with Cesium.
 */

export type BaseMapId = 'esri' | 'gibs' | 's2-2016' | 's2-2025' | 'osm' | 'google-3d' | 'ion-aerial';

export interface MapKeys {
  googleMapsApiKey: string | null;
  cesiumIonToken: string | null;
}

export interface BaseMapOption {
  id: BaseMapId;
  label: string;
  /** One line: resolution, recency, licence. */
  description: string;
  /** Short text tag beside the name, e.g. a licence restriction. */
  tag?: string;
  /** Selecting it needs a daily date (the date control appears). */
  dated?: boolean;
  /** True for options that draw their own surface and hide the Cesium globe. */
  tiles3d?: boolean;
}

export const BASE_MAPS: readonly BaseMapOption[] = [
  {
    id: 'esri',
    label: 'Esri World Imagery',
    description: 'Satellite and aerial photos, sharp in cities, dates vary by place. Esri terms of use.',
  },
  {
    id: 'gibs',
    label: 'NASA GIBS true colour',
    description: 'Daily VIIRS satellite view at 250 m: coarse but current. Free NASA data.',
    dated: true,
  },
  {
    id: 's2-2016',
    label: 'Sentinel-2 cloudless 2016',
    description: 'Cloud-free mosaic at 10 m, one image per place from 2016. CC BY 4.0.',
  },
  {
    id: 's2-2025',
    label: 'Sentinel-2 cloudless 2025',
    tag: 'Non-commercial',
    description: 'Same mosaic, newest year, 10 m. CC BY-NC-SA 4.0: not for commercial use.',
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    description: 'Street map with roads and names. © OpenStreetMap contributors, ODbL.',
  },
  {
    id: 'google-3d',
    label: 'Google Photorealistic 3D',
    description: 'Textured 3D models of cities, best close up. Google terms apply.',
    tiles3d: true,
  },
  {
    id: 'ion-aerial',
    label: 'Bing aerial (Cesium ion)',
    description: 'Aerial photos around 1 m in most cities, streamed through your ion account.',
  },
];

const BY_ID = new Map(BASE_MAPS.map((o) => [o.id, o]));

export function getBaseMap(id: string): BaseMapOption | undefined {
  return BY_ID.get(id as BaseMapId);
}

export function isBaseMapId(v: unknown): v is BaseMapId {
  return typeof v === 'string' && BY_ID.has(v as BaseMapId);
}

export interface Availability {
  available: boolean;
  /** Why it is unavailable, or a short note on how it will be reached. */
  note: string | null;
}

export function availability(id: BaseMapId, keys: MapKeys): Availability {
  const google = Boolean(keys.googleMapsApiKey?.trim());
  const ion = Boolean(keys.cesiumIonToken?.trim());
  if (id === 'google-3d') {
    if (google) return { available: true, note: null };
    if (ion) return { available: true, note: 'Streams through Cesium ion (no Google key set).' };
    return { available: false, note: 'Needs GOOGLE_MAPS_API_KEY (or CESIUM_ION_TOKEN) in .env' };
  }
  if (id === 'ion-aerial') {
    return ion ? { available: true, note: null } : { available: false, note: 'Needs CESIUM_ION_TOKEN in .env' };
  }
  return { available: true, note: null };
}

/** What the app starts on when nothing usable is stored: the best option the keys allow. */
export function defaultBaseMap(keys: MapKeys): BaseMapId {
  if (keys.googleMapsApiKey?.trim()) return 'google-3d';
  if (keys.cesiumIonToken?.trim()) return 'ion-aerial';
  return 'esri';
}

export interface BaseMapChoice {
  id: BaseMapId;
  /** Show Cesium OSM Buildings over the imagery (needs an ion token). */
  buildings: boolean;
  /** Ignore terrain and use a smooth ellipsoid. */
  flatTerrain: boolean;
}

export const BASEMAP_STORAGE_KEY = 'gev.v2.basemap';
const STORAGE_VERSION = 1;

export function serializeChoice(c: BaseMapChoice): string {
  return JSON.stringify({ v: STORAGE_VERSION, id: c.id, buildings: c.buildings, flatTerrain: c.flatTerrain });
}

/** Parse a stored choice; anything malformed, stale or unavailable falls back to the default. */
export function parseChoice(raw: string | null, keys: MapKeys): BaseMapChoice {
  const fallback: BaseMapChoice = { id: defaultBaseMap(keys), buildings: false, flatTerrain: false };
  if (!raw) return fallback;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || o.v !== STORAGE_VERSION || !isBaseMapId(o.id)) return fallback;
    const ion = Boolean(keys.cesiumIonToken?.trim());
    return {
      id: availability(o.id, keys).available ? o.id : fallback.id,
      buildings: o.buildings === true && ion,
      flatTerrain: o.flatTerrain === true,
    };
  } catch {
    return fallback;
  }
}

// --- NASA GIBS dates

/** First day with VIIRS SNPP true colour. */
export const GIBS_FIRST_DATE = '2015-11-24';

const DAY = 86_400_000;

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The most recent complete UTC day: today's mosaic is still filling in. */
export function gibsDefaultDate(now: Date = new Date()): string {
  return isoDay(now.getTime() - DAY);
}

/** Accept YYYY-MM-DD within the archive and not after the latest complete day; otherwise null. */
export function validateGibsDate(value: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(t) || isoDay(t) !== value) return null;
  if (value < GIBS_FIRST_DATE || value > gibsDefaultDate(now)) return null;
  return value;
}

/**
 * The imagery day for a viewed instant: its UTC day, held inside the archive
 * (today's mosaic is incomplete, so "today" shows the latest complete day).
 */
export function gibsDateForTime(at: number, now: Date = new Date()): string {
  const day = isoDay(at);
  const latest = gibsDefaultDate(now);
  return day > latest ? latest : day < GIBS_FIRST_DATE ? GIBS_FIRST_DATE : day;
}
