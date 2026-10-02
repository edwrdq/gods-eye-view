import { clean, headingFor, num, plausible, round5, type Camera } from '../camera.ts';
import { directionToHeading } from '../direction.ts';
import { getJson } from '../../http.ts';
import type { CameraSource } from './types.ts';

export const DELDOT_URL = 'https://tmc.deldot.gov/json/videocamera.json';
export const DELDOT_STREAM_HOST = 'video.deldot.gov';

/**
 * DelDOT cameras (Delaware) publish live video only: an HLS playlist per camera and no still.
 * They are video cameras here: the detail panel plays the stream where the browser can play HLS
 * itself and offers the official stream link otherwise. Nothing is relayed by this server. The
 * heading comes from a travel token in the title ("US 13 SB @ ...", about one camera in five).
 */
export function parseDeldot(payload: unknown): Camera[] {
  const rows = (payload as { videoCameras?: unknown[] } | null)?.videoCameras;
  if (!Array.isArray(rows)) return [];
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const r of rows as Array<Record<string, any>>) {
    if (String(r?.status).toLowerCase() !== 'active') continue;
    const lat = num(r.lat);
    const lon = num(r.lon);
    if (!plausible(lat, lon) || lat < 38.4 || lat > 39.9 || lon < -75.85 || lon > -75.0) continue;
    let stream: URL;
    try {
      stream = new URL(String(r?.urls?.m3u8s ?? ''));
    } catch {
      continue;
    }
    if (stream.origin !== `https://${DELDOT_STREAM_HOST}` || stream.username || stream.password || !/^\/live\/[A-Za-z0-9_.-]+\/playlist\.m3u8$/.test(stream.pathname)) continue;
    const raw = String(r.id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(raw)) continue;
    const id = `deldot-${raw.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const title = clean(r.title, 120);
    out.push({
      id,
      source: 'deldot',
      name: title || `DelDOT ${raw}`,
      city: r.county ? `${clean(r.county, 40)} County` : 'Delaware',
      lon: round5(lon),
      lat: round5(lat),
      ...headingFor(id, directionToHeading(title), 'name'),
      type: 'video',
      streamUrl: stream.href,
    });
  }
  return out;
}

export const deldot: CameraSource = {
  id: 'deldot',
  name: 'DelDOT',
  provider: 'Delaware Department of Transportation',
  coverage: [-75.85, 38.4, -75.0, 39.9],
  pageUrl: 'https://deldot.gov/map/',
  licence: 'Public DelDOT traffic camera streams (no licence text published; public availability is not a redistribution licence, so streams are linked, not relayed)',
  attribution: 'DelDOT, Delaware Department of Transportation',
  catalogTtlMs: 12 * 3_600_000,
  async load(ctx) {
    const json = await getJson(ctx.fetch, DELDOT_URL, { signal: ctx.signal, now: ctx.now, timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 });
    const cameras = parseDeldot(json);
    if (cameras.length === 0) throw new Error('no cameras in the answer');
    return { cameras };
  },
};
