import type { Feature, PropValue } from '@gev/shared';
import { httpUrl } from '../url.ts';

export const LAYER = 'radio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One geo-located station of the Radio Browser directory, trimmed to what the layer uses. */
export interface Station {
  /** Radio Browser stationuuid. */
  id: string;
  name: string;
  lon: number;
  lat: number;
  country: string;
  countryCode: string;
  state: string;
  languages: string[];
  tags: string[];
  codec: string;
  bitrate: number | null;
  /** HLS playlist: needs a player library the client does not have. */
  hls: boolean;
  streamUrl: string;
  homepage: string | null;
  /** Radio Browser clickcount: how often people started it. Used to rank stations when a view is thinned. */
  clicks: number;
  votes: number;
}

type Obj = Record<string, unknown>;

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function list(v: unknown, itemMax: number, cap: number, lower: boolean): string[] {
  const out: string[] = [];
  for (const part of text(v, 600).split(',')) {
    const t = text(part, itemMax);
    const k = lower ? t.toLowerCase() : t;
    // Community tags include punctuation and single characters ("#", "+", "0"): not tags.
    if (k.length < 2 || !/[\p{L}\p{N}]/u.test(k) || /^[\p{N}]$/u.test(k)) continue;
    if (!out.includes(k)) out.push(k);
    if (out.length >= cap) break;
  }
  return out;
}

function coord(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const int = (v: unknown, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n)) : 0;
};

/**
 * Read a Radio Browser `stations/search` answer. Stations are dropped when they
 * have no valid position (0,0 is the "not set" placeholder), failed their last
 * check, or have no http(s) stream address. Duplicate ids keep the first.
 */
export function parseStations(json: unknown): { stations: Station[]; skipped: number } {
  const stations: Station[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  if (!Array.isArray(json)) return { stations, skipped: 0 };
  for (const raw of json) {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Obj;
    const id = typeof r.stationuuid === 'string' ? r.stationuuid.toLowerCase() : '';
    const lat = coord(r.geo_lat);
    const lon = coord(r.geo_long);
    const stream = httpUrl(r.url_resolved) ?? httpUrl(r.url);
    const name = text(r.name, 120);
    if (
      !UUID.test(id) ||
      seen.has(id) ||
      !name ||
      !stream ||
      Number(r.lastcheckok) !== 1 ||
      lat === null ||
      lon === null ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      (lat === 0 && lon === 0)
    ) {
      skipped++;
      continue;
    }
    seen.add(id);
    const bitrate = Number(r.bitrate);
    stations.push({
      id,
      name,
      lon: Math.round(lon * 1e4) / 1e4,
      lat: Math.round(lat * 1e4) / 1e4,
      country: text(r.country, 80),
      countryCode: text(r.countrycode, 2).toUpperCase(),
      state: text(r.state, 80),
      languages: list(r.language, 40, 6, false),
      tags: list(r.tags, 40, 12, true),
      codec: text(r.codec, 16).toUpperCase(),
      bitrate: Number.isFinite(bitrate) && bitrate >= 8 && bitrate <= 2048 ? Math.round(bitrate) : null,
      hls: Number(r.hls) === 1,
      streamUrl: stream,
      homepage: httpUrl(r.homepage) ?? null,
      clicks: int(r.clickcount, 10_000_000),
      votes: int(r.votes, 10_000_000),
    });
  }
  return { stations, skipped };
}

/** Codecs a browser's <audio> element normally plays without a helper library. */
const NATIVE = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'FLAC']);

/**
 * 'audio': plays in an <audio> element (the client still checks canPlayType and
 * mixed content when asked to). 'link': HLS playlists and unknown or exotic
 * codecs, which are offered as an "Open stream" link instead.
 */
export function playMode(s: Pick<Station, 'codec' | 'hls'>): 'audio' | 'link' {
  return !s.hls && NATIVE.has(s.codec) ? 'audio' : 'link';
}

/** Compact props for the map; the detail carries the rest. */
export function stationFeature(s: Station, full = false): Feature {
  const props: Record<string, PropValue> = { name: s.name, country: s.country, codec: s.codec, play: playMode(s), clicks: s.clicks };
  if (s.bitrate !== null) props.bitrate = s.bitrate;
  if (full) {
    props.countryCode = s.countryCode;
    props.state = s.state;
    props.language = s.languages.join(', ');
    props.tags = s.tags.join(', ');
    props.hls = s.hls;
    props.homepage = s.homepage;
    props.streamUrl = s.streamUrl;
    props.votes = s.votes;
  }
  return { id: s.id, geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, label: s.name, props };
}
