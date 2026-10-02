import { clean, headingFor, plausible, round5, type Camera } from '../camera.ts';
import { directionToHeading } from '../direction.ts';
import { getJson } from '../../http.ts';
import type { CameraSource } from './types.ts';

export const NSW_URL = 'https://data.livetraffic.com/cameras/traffic-cam.json';
export const NSW_IMAGE_HOST = 'webcams.transport.nsw.gov.au';
/** The picture host answers other clients with a short HTML page and status 200, so it is asked as a browser would. */
export const NSW_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_VIEW = 140;

/**
 * Live Traffic NSW cameras. Every camera has a compass `direction` ("N-E") of its own, a
 * published heading, and a `view` sentence that makes the best name unless it is a works notice.
 */
export function parseNsw(payload: unknown): Camera[] {
  const features = (payload as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const f of features as Array<Record<string, any>>) {
    const raw = String(f?.id ?? '').trim();
    if (!/^[0-9A-Za-z-]{1,60}$/.test(raw) || seen.has(raw)) continue;
    const lon = typeof f.geometry?.coordinates?.[0] === 'number' ? f.geometry.coordinates[0] : NaN;
    const lat = typeof f.geometry?.coordinates?.[1] === 'number' ? f.geometry.coordinates[1] : NaN;
    if (!plausible(lat, lon) || lat < -38 || lat > -28 || lon < 140.9 || lon > 159.2) continue;
    const p = f.properties ?? {};
    const href = typeof p.href === 'string' ? p.href.trim() : '';
    if (!href.startsWith(`https://${NSW_IMAGE_HOST}/`)) continue;
    seen.add(raw);
    const view = typeof p.view === 'string' ? p.view.trim() : '';
    const title = clean(p.title, 100);
    const name = view && view.length <= MAX_VIEW && !/[\r\n]/.test(view) ? clean(view, MAX_VIEW) : title;
    const id = `nsw-${raw}`;
    // "N-E" to "NE".
    const dir = String(p.direction ?? '').trim().toUpperCase().replace(/-/g, '');
    out.push({
      id,
      source: 'nsw',
      name: name || `NSW camera ${raw.slice(0, 8)}`,
      city: clean(String(p.region ?? '').replace(/_/g, ' '), 60) || 'New South Wales',
      lon: round5(lon),
      lat: round5(lat),
      ...headingFor(id, directionToHeading(dir, true), 'published'),
      type: 'still',
      imageUrl: href,
    });
  }
  return out;
}

export const nsw: CameraSource = {
  id: 'nsw',
  name: 'Live Traffic NSW',
  provider: 'Transport for NSW',
  coverage: [140.9, -38, 159.2, -28],
  pageUrl: 'https://www.livetraffic.com/',
  licence: 'CC BY 4.0 (Transport for NSW open data)',
  attribution: 'Live Traffic NSW, Transport for NSW',
  catalogTtlMs: 12 * 3_600_000,
  frame: { refreshS: 60, hosts: [NSW_IMAGE_HOST], userAgent: NSW_BROWSER_UA },
  async load(ctx) {
    const json = await getJson(ctx.fetch, NSW_URL, { signal: ctx.signal, now: ctx.now, timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024 });
    const cameras = parseNsw(json);
    if (cameras.length === 0) throw new Error('no cameras in the answer');
    return { cameras };
  },
};
