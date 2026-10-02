import type { Feature, FeatureGeometry, PropValue } from '@gev/shared';

export const LAYER = 'cyclones';
const HOUR = 3_600_000;

export type Position = [number, number];

export interface StormStatus {
  /** Lower-case ATCF id, e.g. ep182026. */
  id: string;
  name: string;
  classification: string;
  /** AL, EP or CP. */
  basin: string;
  lon: number;
  lat: number;
  /** Time of the status position (epoch ms). */
  positionAt: number;
  /** Public advisory number as published, normalised ("47A", "21"). */
  advisoryNumber: string;
  /** Issue time of the public advisory (epoch ms); forecast hours count from here. */
  issuedAt: number;
  windKt: number | null;
  pressureMb: number | null;
  movementDir: number | null;
  movementKt: number | null;
  advisoryUrl: string | null;
  discussionUrl: string | null;
  graphicsUrl: string | null;
}

const num = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === '' || (typeof v !== 'number' && typeof v !== 'string')) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** "047A" -> "47A", "021" -> "21". Null when not an advisory number. */
export function normaliseAdvisory(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{1,3}[A-Za-z]?$/.test(v)) return null;
  return v.replace(/^0+(?=\d)/, '').toUpperCase();
}

function isoMs(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)) return null;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

/** Only links on nhc.noaa.gov text/graphics pages are passed on. */
function nhcLink(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 256) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname === 'www.nhc.noaa.gov' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Parse CurrentStorms.json. An empty `activeStorms` array is the normal state
 * outside the season and yields []. Invalid storms are skipped individually;
 * `skipped` counts them. A payload without an `activeStorms` array throws.
 */
export function parseCurrentStorms(payload: unknown): { storms: StormStatus[]; skipped: number } {
  const root = payload as { activeStorms?: unknown } | null;
  if (!root || !Array.isArray(root.activeStorms)) throw new Error('malformed NHC CurrentStorms response');
  const storms: StormStatus[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of root.activeStorms as Array<Record<string, any> | null>) {
    const id = typeof raw?.id === 'string' ? raw.id.toLowerCase() : '';
    const lon = num(raw?.longitudeNumeric, -180, 180);
    const lat = num(raw?.latitudeNumeric, -90, 90);
    const positionAt = isoMs(raw?.lastUpdate);
    const pub = raw?.publicAdvisory;
    const fc = raw?.forecastAdvisory;
    const advisoryNumber = normaliseAdvisory(pub?.advNum) ?? normaliseAdvisory(fc?.advNum);
    const issuedAt = isoMs(pub?.issuance) ?? isoMs(fc?.issuance) ?? positionAt;
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!/^(?:al|ep|cp)\d{6}$/.test(id) || seen.has(id) || lon === null || lat === null || positionAt === null || advisoryNumber === null || issuedAt === null || !name || name.length > 80) {
      skipped++;
      continue;
    }
    seen.add(id);
    storms.push({
      id,
      name,
      classification: typeof raw!.classification === 'string' ? raw!.classification.trim().toUpperCase() : '',
      basin: id.slice(0, 2).toUpperCase(),
      lon,
      lat,
      positionAt,
      advisoryNumber,
      issuedAt,
      windKt: num(raw!.intensity, 0, 300),
      pressureMb: num(raw!.pressure, 800, 1100),
      movementDir: num(raw!.movementDir, 0, 360),
      movementKt: num(raw!.movementSpeed, 0, 200),
      advisoryUrl: nhcLink(pub?.url) ?? nhcLink(fc?.url),
      discussionUrl: nhcLink(raw!.forecastDiscussion?.url),
      graphicsUrl: nhcLink(raw!.forecastGraphics?.url),
    });
  }
  return { storms, skipped };
}

const CLASS_NAMES: Record<string, string> = {
  TD: 'Tropical depression',
  TS: 'Tropical storm',
  HU: 'Hurricane',
  STD: 'Subtropical depression',
  STS: 'Subtropical storm',
  PTC: 'Post-tropical cyclone',
  PC: 'Post-tropical cyclone',
  TC: 'Tropical cyclone',
  EX: 'Extratropical cyclone',
  SD: 'Subtropical depression',
  SS: 'Subtropical storm',
  LO: 'Remnant low',
  DB: 'Disturbance',
  WV: 'Tropical wave',
  IN: 'Inland',
};

export const className = (c: string): string => CLASS_NAMES[c] ?? (c || 'Tropical cyclone');

/** Saffir-Simpson category from 1-minute sustained wind in knots (NHC thresholds). */
export function hurricaneCategory(kt: number): 1 | 2 | 3 | 4 | 5 | null {
  if (kt >= 137) return 5;
  if (kt >= 113) return 4;
  if (kt >= 96) return 3;
  if (kt >= 83) return 2;
  if (kt >= 64) return 1;
  return null;
}

/** Short category: TD, TS, H1 to H5, or the NHC classification for other types. */
export function stormCategory(classification: string, kt: number | null): string {
  if (classification === 'HU' || (classification === '' && kt !== null && kt >= 64)) {
    const c = kt === null ? null : hurricaneCategory(kt);
    return c ? `H${c}` : 'HU';
  }
  return classification || 'TC';
}

/** Category for a forecast point, whose type is implied by its wind speed. */
export function categoryFromWind(kt: number | null): string | null {
  if (kt === null) return null;
  const c = hurricaneCategory(kt);
  if (c) return `H${c}`;
  return kt >= 34 ? 'TS' : 'TD';
}

// ---------------------------------------------------------------- GIS layers

export interface GisItem {
  stormId: string;
  advisoryNumber: string;
  geometry: FeatureGeometry | { type: 'MultiPolygon'; coordinates: Array<Array<Position[]>> };
  tauHours: number | null;
  windKt: number | null;
  gustKt: number | null;
}

const isPos = (c: unknown): c is Position =>
  Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number' && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

const pos = (c: unknown[]): Position => [c[0] as number, c[1] as number];

function cleanLine(c: unknown): Position[] | null {
  return Array.isArray(c) && c.length >= 2 && c.every(isPos) ? (c as unknown[][]).map(pos) : null;
}
function cleanRing(c: unknown): Position[] | null {
  const r = cleanLine(c);
  return r && r.length >= 4 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1] ? r : null;
}
function cleanPolygon(c: unknown): Position[][] | null {
  if (!Array.isArray(c) || c.length === 0) return null;
  const rings = c.map(cleanRing);
  return rings.every((r) => r !== null) ? (rings as Position[][]) : null;
}

function cleanGeometry(g: any, want: 'points' | 'track' | 'cone'): GisItem['geometry'] | null {
  switch (want) {
    case 'points':
      return g?.type === 'Point' && isPos(g.coordinates) ? { type: 'Point', coordinates: pos(g.coordinates) } : null;
    case 'track': {
      if (g?.type === 'LineString') {
        const l = cleanLine(g.coordinates);
        return l ? { type: 'LineString', coordinates: l } : null;
      }
      if (g?.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
        const parts = g.coordinates.map(cleanLine);
        return parts.length > 0 && parts.every((p: Position[] | null) => p) ? { type: 'MultiLineString', coordinates: parts as Position[][] } : null;
      }
      return null;
    }
    case 'cone': {
      if (g?.type === 'Polygon') {
        const p = cleanPolygon(g.coordinates);
        return p ? { type: 'Polygon', coordinates: p } : null;
      }
      if (g?.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
        const polys = g.coordinates.map(cleanPolygon);
        return polys.length > 0 && polys.every((p: Position[][] | null) => p) ? { type: 'MultiPolygon', coordinates: polys as Position[][][] } : null;
      }
      return null;
    }
  }
}

const SUFFIX = { points: 'pts', track: 'lin', cone: 'pgn' } as const;

/**
 * Parse one NHC_tropical_weather_summary forecast layer (5 points, 6 track,
 * 7 cone) from its GeoJSON query result. Items carry the storm id and the
 * advisory number encoded in idp_source ("ep152026-047A_5day_pts"). Truncated
 * results (exceededTransferLimit) throw, since a partial layer would silently
 * drop a storm.
 */
export function parseForecastLayer(payload: unknown, kind: 'points' | 'track' | 'cone'): GisItem[] {
  const root = payload as { type?: unknown; features?: unknown; exceededTransferLimit?: unknown } | null;
  if (!root || root.type !== 'FeatureCollection' || !Array.isArray(root.features) || root.exceededTransferLimit) {
    throw new Error('malformed NHC GIS response');
  }
  const out: GisItem[] = [];
  for (const f of root.features as Array<any>) {
    const p = f?.properties;
    const m = typeof p?.idp_source === 'string' ? p.idp_source.match(/^((?:al|ep|cp)\d{6})-(\d{1,3}[a-z]?)_5day_(pts|lin|pgn)$/i) : null;
    if (!m || m[3]!.toLowerCase() !== SUFFIX[kind]) continue;
    const advisoryNumber = normaliseAdvisory(m[2]);
    const geometry = cleanGeometry(f.geometry, kind);
    if (advisoryNumber === null || geometry === null) continue;
    out.push({
      stormId: m[1]!.toLowerCase(),
      advisoryNumber,
      geometry,
      tauHours: num(p.tau, 0, 240),
      windKt: num(p.maxwind, 0, 300),
      gustKt: num(p.gust, 0, 350),
    });
  }
  return out;
}

export interface PastPoint {
  t: number;
  lon: number;
  lat: number;
  windKt: number | null;
}

/** Parse the Past Points layer (10) into time-ordered points per storm id. */
export function parsePastPoints(payload: unknown): Map<string, PastPoint[]> {
  const root = payload as { type?: unknown; features?: unknown; exceededTransferLimit?: unknown } | null;
  if (!root || root.type !== 'FeatureCollection' || !Array.isArray(root.features) || root.exceededTransferLimit) {
    throw new Error('malformed NHC GIS response');
  }
  const out = new Map<string, PastPoint[]>();
  for (const f of root.features as Array<any>) {
    const p = f?.properties;
    const m = typeof p?.idp_source === 'string' ? p.idp_source.match(/^((?:al|ep|cp)\d{6})_pts$/i) : null;
    const dtg = String(p?.dtg ?? '');
    const dm = dtg.match(/^(\d{4})(\d\d)(\d\d)(\d\d)$/);
    if (!m || !dm || !f.geometry || f.geometry.type !== 'Point' || !isPos(f.geometry.coordinates)) continue;
    const t = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(dm[4]));
    const [lon, lat] = pos(f.geometry.coordinates);
    const id = m[1]!.toLowerCase();
    const list = out.get(id) ?? [];
    list.push({ t, lon, lat, windKt: num(p.intensity, 0, 300) });
    out.set(id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.t - b.t);
  return out;
}

/** Split a polyline wherever consecutive longitudes jump across the antimeridian. */
export function splitAtAntimeridian(points: Position[]): FeatureGeometry | null {
  if (points.length < 2) return null;
  const parts: Position[][] = [[points[0]!]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (Math.abs(b[0] - a[0]) > 180) {
      // Interpolate the latitude where the segment crosses +-180.
      const edge = a[0] > 0 ? 180 : -180;
      const unwrapped = b[0] + (a[0] > 0 ? 360 : -360);
      const f = (edge - a[0]) / (unwrapped - a[0]);
      const lat = a[1] + (b[1] - a[1]) * Math.min(1, Math.max(0, f));
      const edgeA: Position = [edge, lat];
      const edgeB: Position = [-edge, lat];
      parts[parts.length - 1]!.push(edgeA);
      parts.push([edgeB, b]);
    } else {
      parts[parts.length - 1]!.push(b);
    }
  }
  const usable = parts.filter((p) => p.length >= 2);
  if (usable.length === 0) return null;
  return usable.length === 1 ? { type: 'LineString', coordinates: usable[0]! } : { type: 'MultiLineString', coordinates: usable };
}

// ---------------------------------------------------------------- assembling

export interface ForecastLayers {
  points: GisItem[];
  track: GisItem[];
  cone: GisItem[];
}

export interface StormGeometry {
  /** Advisory number the geometry belongs to. */
  advisoryNumber: string;
  forecastPoints: Array<{ tauHours: number; lon: number; lat: number; windKt: number | null; gustKt: number | null }>;
  forecastLine: FeatureGeometry | null;
  cone: Array<Position[][]>;
  pastTrack: FeatureGeometry | null;
}

/**
 * Combine status and GIS layers per storm. Geometry is attached only when its
 * advisory number equals the status's public advisory number, so an older
 * forecast is never shown under a newer advisory.
 */
export function assembleGeometry(
  storms: StormStatus[],
  layers: ForecastLayers,
  past: Map<string, PastPoint[]> | null,
): Map<string, StormGeometry> {
  const out = new Map<string, StormGeometry>();
  for (const s of storms) {
    const mine = (items: GisItem[]) => items.filter((i) => i.stormId === s.id && i.advisoryNumber === s.advisoryNumber);
    const pts = mine(layers.points);
    const line = mine(layers.track)[0];
    const cone = mine(layers.cone)[0];
    const pastPts = past?.get(s.id) ?? [];
    let pastTrack: FeatureGeometry | null = null;
    if (pastPts.length > 0) {
      const coords: Position[] = pastPts.map((p) => [p.lon, p.lat]);
      const last = coords[coords.length - 1]!;
      if (last[0] !== s.lon || last[1] !== s.lat) coords.push([s.lon, s.lat]);
      pastTrack = splitAtAntimeridian(coords);
    }
    if (pts.length === 0 && !line && !cone && !pastTrack) continue;
    const seen = new Set<number>();
    const forecastPoints = pts
      .filter((p) => p.tauHours !== null && p.geometry.type === 'Point' && !seen.has(p.tauHours) && seen.add(p.tauHours))
      .map((p) => {
        const [lon, lat] = (p.geometry as { coordinates: Position }).coordinates;
        return { tauHours: p.tauHours!, lon, lat, windKt: p.windKt, gustKt: p.gustKt };
      })
      .sort((a, b) => a.tauHours - b.tauHours);
    let cones: Array<Position[][]> = [];
    if (cone?.geometry.type === 'Polygon') cones = [cone.geometry.coordinates as Position[][]];
    else if (cone?.geometry.type === 'MultiPolygon') cones = cone.geometry.coordinates;
    out.set(s.id, {
      advisoryNumber: s.advisoryNumber,
      forecastPoints,
      forecastLine: line && (line.geometry.type === 'LineString' || line.geometry.type === 'MultiLineString') ? line.geometry : null,
      cone: cones,
      pastTrack,
    });
  }
  return out;
}

/** Build map features for one storm. */
export function stormFeatures(s: StormStatus, g: StormGeometry | undefined): Feature[] {
  const category = stormCategory(s.classification, s.windKt);
  const base: Record<string, PropValue> = {
    stormId: s.id,
    name: s.name,
    intensityKt: s.windKt,
    category,
    basin: s.basin,
  };
  const out: Feature[] = [
    {
      id: `${s.id}:position`,
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      t: s.positionAt,
      label: s.name,
      props: { ...base, part: 'position', movementDir: s.movementDir, movementKt: s.movementKt },
    },
  ];
  if (!g) return out;
  if (g.pastTrack) {
    out.push({ id: `${s.id}:track`, geometry: g.pastTrack, t: s.positionAt, props: { ...base, part: 'track' } });
  }
  if (g.forecastLine) {
    out.push({ id: `${s.id}:forecast`, geometry: g.forecastLine, t: s.issuedAt, props: { ...base, part: 'forecast' } });
  }
  for (const p of g.forecastPoints) {
    if (p.tauHours === 0) continue; // the current position is already a feature
    out.push({
      id: `${s.id}:forecast:${p.tauHours}`,
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      t: s.issuedAt + p.tauHours * HOUR,
      label: `+${p.tauHours} h`,
      props: { ...base, part: 'forecast', tauHours: p.tauHours, intensityKt: p.windKt, gustKt: p.gustKt, category: categoryFromWind(p.windKt) },
    });
  }
  g.cone.forEach((rings, i) => {
    out.push({
      id: i === 0 ? `${s.id}:cone` : `${s.id}:cone:${i}`,
      geometry: { type: 'Polygon', coordinates: rings },
      t: s.issuedAt,
      props: { ...base, part: 'cone' },
    });
  });
  return out;
}
