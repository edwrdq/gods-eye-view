import { clean, headingFor, plausible, round5, inBox, type Camera } from '../camera.ts';
import { directionToHeading } from '../direction.ts';
import { getJson } from '../../http.ts';
import type { CameraSource } from './types.ts';

export const AUSTIN_URL = 'https://data.austintexas.gov/api/views/b4k4-adkb/rows.json?accessType=DOWNLOAD';
export const AUSTIN_IMAGE_HOST = 'cctv.austinmobility.io';
const AUSTIN_BOX: [number, number, number, number] = [-98.12, 30.02, -97.4, 30.58];

/** "POINT (-97.82 30.22)": the dataset's location column (lon, then lat). */
function point(v: unknown): { lat: number; lon: number } | null {
  const m = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(typeof v === 'string' ? v : '');
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}

/**
 * City of Austin traffic cameras, from the Socrata `rows.json` export: columns are described in
 * meta.view.columns and every row is an array. Only cameras with status TURNED_ON are kept (the
 * dataset also lists planned and removed ones whose pictures never load). The dataset carries no
 * facing, so a heading exists only when the name holds an explicit travel word (EB, WB, ...).
 */
export function parseAustin(payload: unknown): Camera[] {
  const p = payload as { meta?: { view?: { columns?: Array<{ fieldName?: string }> } }; data?: unknown[] } | null;
  const columns = p?.meta?.view?.columns;
  const rows = p?.data;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return [];
  const at = (name: string) => columns.findIndex((c) => c?.fieldName === name);
  const iId = at('camera_id');
  const iName = at('location_name');
  const iStatus = at('camera_status');
  const iLoc = at('location');
  if (iId < 0 || iLoc < 0) return [];
  const seen = new Set<string>();
  const out: Camera[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const raw = String(row[iId] ?? '').trim();
    if (!/^\d{1,8}$/.test(raw) || seen.has(raw)) continue;
    // Tolerate a missing status column (a schema change should fail open), not a different status.
    const status = iStatus >= 0 ? String(row[iStatus] ?? '').trim().toUpperCase() : '';
    if (status && status !== 'TURNED_ON') continue;
    const pt = point(row[iLoc]);
    if (!pt || !plausible(pt.lat, pt.lon) || !inBox(pt.lat, pt.lon, AUSTIN_BOX)) continue;
    seen.add(raw);
    const id = `austin-${raw}`;
    const name = clean(iName >= 0 ? row[iName] : '') || `Austin camera ${raw}`;
    out.push({
      id,
      source: 'austin',
      name,
      city: 'Austin',
      lon: round5(pt.lon),
      lat: round5(pt.lat),
      ...headingFor(id, directionToHeading(name), 'name'),
      type: 'still',
      imageUrl: `https://${AUSTIN_IMAGE_HOST}/image/${raw}.jpg`,
    });
  }
  return out;
}

export const austin: CameraSource = {
  id: 'austin',
  name: 'City of Austin',
  provider: 'Austin Transportation & Public Works',
  coverage: AUSTIN_BOX,
  pageUrl: 'https://data.austintexas.gov/d/b4k4-adkb',
  licence: 'City of Austin Open Data terms of use',
  attribution: 'City of Austin, TX, data.austintexas.gov',
  catalogTtlMs: 12 * 3_600_000,
  frame: { refreshS: 60, hosts: [AUSTIN_IMAGE_HOST] },
  async load(ctx) {
    const json = await getJson(ctx.fetch, AUSTIN_URL, { signal: ctx.signal, now: ctx.now, timeoutMs: 30_000, maxBytes: 12 * 1024 * 1024 });
    const cameras = parseAustin(json);
    if (cameras.length === 0) throw new Error('no cameras in the answer');
    return { cameras };
  },
};

