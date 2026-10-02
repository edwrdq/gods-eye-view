import { clean, headingFor, num, plausible, round5, type Camera } from '../camera.ts';
import { getJson } from '../../http.ts';
import type { CameraSource } from './types.ts';

export const DRIVEBC_URL = 'https://www.drivebc.ca/api/webcams/';
export const DRIVEBC_HOST = 'www.drivebc.ca';

const ORIENTATION: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

/**
 * The `credit` field mixes the owner of a partner's pictures ("Images courtesy of TransLink") with
 * operational notes ("relies on solar power"). Only the first kind is kept, as text.
 */
export function partnerCredit(raw: unknown): string {
  const text = clean(typeof raw === 'string' ? raw.replace(/<[^>]*>/g, ' ') : '', 160);
  return /courtesy|provided by|presented in cooperation|city of|parks canada/i.test(text) ? text : '';
}

/**
 * DriveBC highway cameras (British Columbia). Cameras that are on and published, with a positive
 * integer id. Picture addresses are built from the id on the official host. `orientation` is one of
 * the eight compass points and is a published heading. update_period_mean (seconds) is how often
 * a camera actually delivers a new picture; it sets the camera's refresh interval.
 */
export function parseDriveBc(payload: unknown): Camera[] {
  if (!Array.isArray(payload)) return [];
  const out: Camera[] = [];
  const seen = new Set<number>();
  for (const r of payload as Array<Record<string, any>>) {
    if (r?.is_on !== true || r?.should_appear !== true || !Number.isSafeInteger(r.id) || r.id <= 0 || seen.has(r.id)) continue;
    const c = r.location?.coordinates;
    const lon = num(c?.[0]);
    const lat = num(c?.[1]);
    if (!plausible(lat, lon) || lat < 48 || lat > 60.5 || lon < -139.5 || lon > -114) continue;
    seen.add(r.id);
    const id = `drivebc-${r.id}`;
    const region = clean(r.region_name, 60);
    const period = num(r.update_period_mean);
    const modified = Date.parse(String(r.last_update_modified ?? ''));
    out.push({
      id,
      source: 'drivebc',
      name: clean(r.name, 120) || `DriveBC camera ${r.id}`,
      city: region === 'Border Cams' ? 'BC border' : region || 'British Columbia',
      lon: round5(lon),
      lat: round5(lat),
      ...headingFor(id, ORIENTATION[clean(r.orientation, 3).toUpperCase()], 'published'),
      type: 'still',
      imageUrl: `https://${DRIVEBC_HOST}/images/${r.id}.jpg`,
      ...(Number.isFinite(period) && period > 0 ? { refreshS: Math.round(Math.min(1800, Math.max(120, period))) } : {}),
      ...(Number.isFinite(modified) ? { imageTime: modified } : {}),
      ...(partnerCredit(r.credit) ? { credit: partnerCredit(r.credit) } : {}),
    });
  }
  return out;
}

export const drivebc: CameraSource = {
  id: 'drivebc',
  name: 'DriveBC',
  provider: 'Government of British Columbia (DriveBC)',
  coverage: [-139.5, 48, -114, 60.5],
  pageUrl: 'https://www.drivebc.ca/',
  licence: 'Open Government Licence – British Columbia',
  attribution: 'DriveBC. Contains information licensed under the Open Government Licence – British Columbia',
  catalogTtlMs: 12 * 3_600_000,
  frame: { refreshS: 300, hosts: [DRIVEBC_HOST] },
  async load(ctx) {
    const json = await getJson(ctx.fetch, DRIVEBC_URL, { signal: ctx.signal, now: ctx.now, timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024 });
    const cameras = parseDriveBc(json);
    if (cameras.length === 0) throw new Error('no cameras in the answer');
    return { cameras };
  },
};
