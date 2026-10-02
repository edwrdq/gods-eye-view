import { clean, headingFor, hashSeed, plausible, round5, type Camera } from '../camera.ts';
import { directionToHeading } from '../direction.ts';
import { getJson } from '../../http.ts';
import type { CameraSource } from './types.ts';

export const TXDOT_HOST = 'its.txdot.gov';
export const txdotListUrl = (district: string): string => `https://${TXDOT_HOST}/its/DistrictIts/GetCctvStatusListByDistrict?districtCode=${encodeURIComponent(district)}`;
export const TXDOT_SNAPSHOT = `https://${TXDOT_HOST}/its/DistrictIts/GetCctvSnapshotByIcdId`;
/** The metros first (Austin, San Antonio, Houston, Dallas, Fort Worth), then the other districts. */
export const TXDOT_DISTRICTS = ['AUS', 'SAT', 'HOU', 'DAL', 'FTW', 'ABL', 'AMA', 'ATL', 'BMT', 'BWD', 'BRY', 'CHS', 'CRP', 'ELP', 'LRD', 'LBB', 'LFK', 'ODA', 'PAR', 'PHR', 'SJT', 'TYL', 'WAC', 'WFS', 'YKM'];

/**
 * TxDOT ITS cameras of one district. Only `Device Online` cameras: an offline device keeps
 * serving a frame that can be years old. The heading comes from an explicit travel token in the
 * name ("US-290 EB") and never from the roadway's own direction field, which is the road's
 * direction (it reads "North" for east-west highways), not where the camera looks.
 */
export function parseTxdot(payload: unknown, district: string): Camera[] {
  const byRoad = (payload as { roadwayCctvStatuses?: Record<string, unknown> } | null)?.roadwayCctvStatuses;
  if (!byRoad || typeof byRoad !== 'object') return [];
  const code = district.toUpperCase();
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const rows of Object.values(byRoad)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows as Array<Record<string, any>>) {
      if (r?.statusDescription !== 'Device Online' || r?.hasSnapshot === false) continue;
      const lat = typeof r.latitude === 'number' ? r.latitude : NaN;
      const lon = typeof r.longitude === 'number' ? r.longitude : NaN;
      if (!plausible(lat, lon) || lat < 25.5 || lat > 36.7 || lon < -107 || lon > -93.4) continue;
      const icd = clean(r.icd_Id, 120);
      // An interchange camera is listed under both its roadways.
      if (!icd || seen.has(icd)) continue;
      seen.add(icd);
      const name = clean(r.name, 120) || icd;
      // The device key, base64url-encoded, so every key has its own id; a very long key falls back to a hash.
      const b64 = `txdot-${code.toLowerCase()}-${Buffer.from(icd, 'utf8').toString('base64url')}`;
      const id = b64.length <= 64 ? b64 : `txdot-${code.toLowerCase()}-h${hashSeed(icd).toString(36)}`;
      const url = new URL(TXDOT_SNAPSHOT);
      url.searchParams.set('icdId', icd);
      url.searchParams.set('districtCode', code);
      out.push({
        id,
        source: 'txdot',
        name,
        city: clean(r.equipLoc?.roadway, 60) || code,
        lon: round5(lon),
        lat: round5(lat),
        ...headingFor(id, directionToHeading(name), 'name'),
        type: 'still',
        imageUrl: url.toString(),
        group: code,
      });
    }
  }
  return out;
}

export const txdot: CameraSource = {
  id: 'txdot',
  name: 'TxDOT',
  provider: 'Texas Department of Transportation',
  coverage: [-107, 25.5, -93.4, 36.7],
  pageUrl: 'https://its.txdot.gov/',
  licence: 'Public TxDOT traffic camera data (no licence text published)',
  attribution: 'Texas Department of Transportation',
  catalogTtlMs: 24 * 3_600_000,
  frame: { refreshS: 60, hosts: [TXDOT_HOST], format: 'txdot-json' },
  async load(ctx) {
    const cameras: Camera[] = [];
    const failedGroups: string[] = [];
    let failure = '';
    const queue = [...TXDOT_DISTRICTS];
    const worker = async () => {
      for (let d = queue.shift(); d !== undefined; d = queue.shift()) {
        try {
          const json = await getJson(ctx.fetch, txdotListUrl(d), { signal: ctx.signal, now: ctx.now, timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024 });
          cameras.push(...parseTxdot(json, d));
          ctx.partial?.([...cameras]);
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          failedGroups.push(d);
          failure = (err as Error).message;
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (cameras.length === 0) throw new Error(failure || 'no cameras in the answers');
    if (failedGroups.length > 0) ctx.log(`cctv: txdot districts failed (${failedGroups.join(', ')}): ${failure}`);
    return { cameras, failedGroups };
  },
};

