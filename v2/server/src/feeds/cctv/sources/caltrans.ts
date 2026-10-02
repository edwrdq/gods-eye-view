import { clean, headingFor, num, plausible, round5, type Camera } from '../camera.ts';
import { directionToHeading } from '../direction.ts';
import { getJson } from '../../http.ts';
import type { CameraSource } from './types.ts';

export const CALTRANS_HOST = 'cwwp2.dot.ca.gov';
export const caltransUrl = (district: number): string => `https://${CALTRANS_HOST}/data/d${district}/cctv/cctvStatusD${String(district).padStart(2, '0')}.json`;
/** The four big metros first (San Francisco Bay, Los Angeles, San Diego, Sacramento), then the rest. */
export const CALTRANS_ORDER = [4, 7, 11, 3, 12, 8, 6, 5, 10, 2, 1, 9];

/**
 * Caltrans CCTV, one JSON list per district. Only cameras in service with a still on the official
 * host are kept. `location.direction` is a field of its own ("West"), so bare words count as a
 * published heading. The list says how often the still changes (currentImageUpdateFrequency, in
 * minutes), which becomes the camera's refresh interval.
 */
export function parseCaltrans(payload: unknown, district: number): Camera[] {
  const rows = (payload as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const cctv = (row as { cctv?: Record<string, any> } | null)?.cctv;
    if (!cctv || String(cctv.inService).toLowerCase() !== 'true') continue;
    const loc = cctv.location ?? {};
    const lat = num(loc.latitude);
    const lon = num(loc.longitude);
    if (!plausible(lat, lon)) continue;
    const image = typeof cctv.imageData?.static?.currentImageURL === 'string' ? cctv.imageData.static.currentImageURL : '';
    if (!image.startsWith(`https://${CALTRANS_HOST}/`)) continue;
    const locationName = clean(loc.locationName, 200);
    // "TV102 -- I-580 : West of SR-24": the leading token is the camera code.
    const m = /^([A-Za-z0-9_-]+)\s*--\s*(.*)$/.exec(locationName);
    const code = (m?.[1] ?? `i${clean(cctv.index, 8)}`).toLowerCase();
    const id = `ca-d${district}-${code}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const label = m?.[2] || locationName || `Caltrans D${district} ${code}`;
    const place = clean(loc.nearbyPlace, 80);
    const everyMin = num(cctv.imageData?.static?.currentImageUpdateFrequency);
    const epoch = num(cctv.recordTimestamp?.recordEpoch);
    out.push({
      id,
      source: 'caltrans',
      name: place ? `${label} (${place})` : label,
      city: place || `District ${district}`,
      lon: round5(lon),
      lat: round5(lat),
      ...headingFor(id, directionToHeading(loc.direction, true), 'published'),
      type: 'still',
      imageUrl: image,
      ...(Number.isFinite(everyMin) && everyMin > 0 ? { refreshS: Math.round(Math.min(30, Math.max(1, everyMin)) * 60) } : {}),
      ...(Number.isFinite(epoch) && epoch > 1e9 ? { imageTime: epoch * 1000 } : {}),
      group: `d${district}`,
    });
  }
  return out;
}

export const caltrans: CameraSource = {
  id: 'caltrans',
  name: 'Caltrans',
  provider: 'California Department of Transportation',
  coverage: [-124.6, 32.4, -114.1, 42.1],
  pageUrl: 'https://cwwp2.dot.ca.gov/vm/iframemap.htm',
  licence: 'Public Caltrans traffic camera data (no licence text published)',
  attribution: 'Caltrans, cwwp2.dot.ca.gov',
  catalogTtlMs: 24 * 3_600_000,
  frame: { refreshS: 300, hosts: [CALTRANS_HOST] },
  async load(ctx) {
    const cameras: Camera[] = [];
    const failedGroups: string[] = [];
    let failure = '';
    // Two districts at a time, metros first; each finished district is shown at once.
    const queue = [...CALTRANS_ORDER];
    const worker = async () => {
      for (let d = queue.shift(); d !== undefined; d = queue.shift()) {
        try {
          const json = await getJson(ctx.fetch, caltransUrl(d), { signal: ctx.signal, now: ctx.now, timeoutMs: 30_000, maxBytes: 16 * 1024 * 1024 });
          cameras.push(...parseCaltrans(json, d));
          ctx.partial?.([...cameras]);
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          failedGroups.push(`d${d}`);
          failure = (err as Error).message;
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (cameras.length === 0) throw new Error(failure || 'no cameras in the answers');
    if (failedGroups.length > 0) ctx.log(`cctv: caltrans districts failed (${failedGroups.join(', ')}): ${failure}`);
    return { cameras, failedGroups };
  },
};
