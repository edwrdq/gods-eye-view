import { clean, headingFor, num, plausible, round5, type Camera } from '../camera.ts';
import { getJson } from '../../http.ts';
import type { CameraSource } from './types.ts';

export const CALGARY_URL = 'https://data.calgary.ca/resource/k7p9-kppz.json?$limit=500';
export const CALGARY_HOST = 'trafficcam.calgary.ca';

/** The dataset lists most pictures as http://; the host answers https and redirects there, so the address is upgraded and pinned to that host. */
export function calgaryImage(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.hostname.toLowerCase() !== CALGARY_HOST || u.username || u.password) return null;
    u.protocol = 'https:';
    u.port = '';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Open Calgary traffic cameras (Socrata dataset k7p9-kppz). There is no facing in the data: the
 * `quadrant` field and the suffix on each name ("... Trail SE") are Calgary's address grid, not a
 * bearing, and reading them as one would give every camera a confident wrong heading. All get the placeholder.
 */
export function parseCalgary(payload: unknown): Camera[] {
  if (!Array.isArray(payload)) return [];
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const r of payload as Array<Record<string, any>>) {
    const lon = num(r?.point?.coordinates?.[0]);
    const lat = num(r?.point?.coordinates?.[1]);
    if (!plausible(lat, lon) || lat < 50.8 || lat > 51.25 || lon < -114.4 || lon > -113.8) continue;
    const image = calgaryImage(r?.camera_url?.url);
    if (!image) continue;
    // The picture's file name ("loc86.jpg") is the only stable per-camera token.
    const m = /loc(\d+)\.jpg$/i.exec(new URL(image).pathname);
    if (!m) continue;
    const id = `calgary-${m[1]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      source: 'calgary',
      name: clean(r.camera_location, 120) || clean(r.camera_url?.description, 120) || `Calgary camera ${m[1]}`,
      city: 'Calgary',
      lon: round5(lon),
      lat: round5(lat),
      ...headingFor(id, null, 'published'),
      type: 'still',
      imageUrl: image,
    });
  }
  return out;
}

export const calgary: CameraSource = {
  id: 'calgary',
  name: 'City of Calgary',
  provider: 'The City of Calgary',
  coverage: [-114.4, 50.8, -113.8, 51.25],
  pageUrl: 'https://data.calgary.ca/d/k7p9-kppz',
  licence: 'Open Government Licence – City of Calgary',
  attribution: 'Contains information licensed under the Open Government Licence – City of Calgary',
  catalogTtlMs: 12 * 3_600_000,
  frame: { refreshS: 60, hosts: [CALGARY_HOST] },
  async load(ctx) {
    const json = await getJson(ctx.fetch, CALGARY_URL, { signal: ctx.signal, now: ctx.now, timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 });
    const cameras = parseCalgary(json);
    if (cameras.length === 0) throw new Error('no cameras in the answer');
    return { cameras };
  },
};
