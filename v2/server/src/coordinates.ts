import type { BBox, GeocodeResult } from '@gev/shared';

// One component: optional leading hemisphere letter, optional sign, degrees with optional
// minutes and seconds, optional trailing hemisphere letter. Ambiguous input is refused
// rather than guessed (a wrong fly-to looks like a successful search).
const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const COMPONENT = new RegExp(
  String.raw`^([NSEW])?\s*([+-])?\s*${NUM}\s*(?:[°º˚]\s*(?:${NUM}\s*['′’]\s*(?:${NUM}\s*(?:["″”]|''|′′|’’))?)?)?\s*([NSEW])?$`,
  'i',
);
const DEGREE_MARK = /[°º˚]/;

interface Component {
  value: number;
  axis: 'lat' | 'lon' | null;
}

function readComponent(text: string): Component | null {
  const m = COMPONENT.exec(text.trim());
  if (!m) return null;
  const [, before, sign, deg, min, sec, after] = m;
  if (before && after) return null;
  const letter = (before ?? after ?? '').toUpperCase();
  if (letter && sign) return null;
  // Minutes/seconds only make sense with a degree mark, which the pattern already enforces.
  if (min !== undefined && Number(min) >= 60) return null;
  if (sec !== undefined && Number(sec) >= 60) return null;
  if (!DEGREE_MARK.test(text) && (min !== undefined || sec !== undefined)) return null;

  let magnitude = Number(deg) + (min ? Number(min) / 60 : 0) + (sec ? Number(sec) / 3600 : 0);
  if (!Number.isFinite(magnitude)) return null;
  const negative = sign === '-' || letter === 'S' || letter === 'W';
  if (negative) magnitude = -magnitude;
  const axis = letter === 'N' || letter === 'S' ? 'lat' : letter ? 'lon' : null;
  return { value: magnitude, axis };
}

/** Split into exactly two components: on , or ; if present, else on the one valid whitespace split. */
function readPair(query: string): [Component, Component] | null {
  const text = query.trim();
  if (/[,;]/.test(text)) {
    const parts = text.split(/[,;]/);
    if (parts.length !== 2) return null;
    const a = readComponent(parts[0] ?? '');
    const b = readComponent(parts[1] ?? '');
    return a && b ? [a, b] : null;
  }
  let found: [Component, Component] | null = null;
  for (const m of text.matchAll(/\s+/g)) {
    const a = readComponent(text.slice(0, m.index));
    const b = a && readComponent(text.slice(m.index + m[0].length));
    if (a && b) {
      if (found) return null; // more than one reading
      found = [a, b];
    }
  }
  return found;
}

export interface ParsedCoordinates {
  lat: number;
  lon: number;
}

/**
 * Parse "lat, lon" in decimal degrees (optionally with N/S/E/W) or degrees-minutes-seconds.
 * Without hemisphere letters the order is latitude then longitude.
 */
export function parseCoordinates(query: string): ParsedCoordinates | null {
  const pair = readPair(query);
  if (!pair) return null;
  const [first, second] = pair;
  if (first.axis && first.axis === second.axis) return null;
  const swapped = first.axis === 'lon' || second.axis === 'lat';
  const lat = swapped ? second.value : first.value;
  const lon = swapped ? first.value : second.value;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function formatCoordinates({ lat, lon }: ParsedCoordinates): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

const HALF_SPAN = 0.015;

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function wrapLon(lon: number): number {
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return round6(w === -180 && lon > 0 ? 180 : w);
}

/** A geocode result for a coordinate query, or null when the query is not a coordinate. */
export function coordinateResult(query: string): GeocodeResult | null {
  const c = parseCoordinates(query);
  if (!c) return null;
  const bbox: BBox = [
    wrapLon(c.lon - HALF_SPAN),
    round6(Math.max(-90, c.lat - HALF_SPAN)),
    wrapLon(c.lon + HALF_SPAN),
    round6(Math.min(90, c.lat + HALF_SPAN)),
  ];
  return {
    label: formatCoordinates(c),
    lon: c.lon,
    lat: c.lat,
    bbox,
    kind: 'coordinates',
    source: 'local',
  };
}
