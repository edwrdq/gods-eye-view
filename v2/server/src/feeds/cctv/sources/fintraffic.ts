import { clean, headingFor, num, plausible, round5, type Camera } from '../camera.ts';
import { getJson } from '../../http.ts';
import type { CameraSource } from './types.ts';

export const FINTRAFFIC_URL = 'https://tie.digitraffic.fi/api/weathercam/v1/stations';
export const FINTRAFFIC_IMAGE_HOST = 'weathercam.digitraffic.fi';

/** "kt51_Inkoo" to "kt51 Inkoo"; the view number tells apart the views that share one station. */
function label(stationName: string, stationId: string, presetId: string): string {
  const base = clean(stationName.replace(/_/g, ' '), 100) || `Fintraffic ${stationId}`;
  const view = presetId.slice(stationId.length);
  return view ? `${base} (view ${view})` : base;
}

/**
 * Fintraffic / Digitraffic road weather cameras. One station carries several presets (fixed views
 * that share its position); each preset is one camera. Stations not GATHERING and presets not
 * inCollection are dropped. Picture addresses are built from a strictly checked preset id, never
 * read from the data. The data has no compass heading (the per-preset direction is relative to road
 * addresses, not a bearing), so every camera gets the placeholder.
 */
export function parseFintraffic(payload: unknown): Camera[] {
  const features = (payload as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const f of features as Array<Record<string, any>>) {
    const p = f?.properties ?? {};
    const stationId = String(p.id ?? '').trim();
    if (!/^C\d{5}$/.test(stationId) || String(p.collectionStatus ?? '').toUpperCase() !== 'GATHERING') continue;
    const lon = num(f.geometry?.coordinates?.[0]);
    const lat = num(f.geometry?.coordinates?.[1]);
    if (!plausible(lat, lon) || lat < 59.5 || lat > 70.5 || lon < 19 || lon > 32) continue;
    for (const preset of Array.isArray(p.presets) ? p.presets : []) {
      const pid = String(preset?.id ?? '').trim();
      if (preset?.inCollection !== true || !/^C\d{7}$/.test(pid) || !pid.startsWith(stationId)) continue;
      const id = `fi-${pid.toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const updated = Date.parse(String(p.dataUpdatedTime ?? ''));
      out.push({
        id,
        source: 'fintraffic',
        name: label(String(p.name ?? ''), stationId, pid),
        city: 'Finland',
        lon: round5(lon),
        lat: round5(lat),
        ...headingFor(id, null, 'published'),
        type: 'still',
        imageUrl: `https://${FINTRAFFIC_IMAGE_HOST}/${pid}.jpg`,
        ...(Number.isFinite(updated) ? { imageTime: updated } : {}),
      });
    }
  }
  return out;
}

export const fintraffic: CameraSource = {
  id: 'fintraffic',
  name: 'Fintraffic',
  provider: 'Fintraffic (Digitraffic)',
  coverage: [19, 59.5, 32, 70.5],
  pageUrl: 'https://liikennetilanne.fintraffic.fi/',
  licence: 'CC BY 4.0 (Digitraffic terms of service)',
  attribution: 'Fintraffic / digitraffic.fi, licence CC BY 4.0',
  catalogTtlMs: 12 * 3_600_000,
  // Each station collects a picture every ten minutes.
  frame: { refreshS: 600, hosts: [FINTRAFFIC_IMAGE_HOST] },
  async load(ctx) {
    // Digitraffic asks every client to name itself.
    const json = await getJson(ctx.fetch, FINTRAFFIC_URL, { signal: ctx.signal, now: ctx.now, timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024, headers: { 'Digitraffic-User': 'gods-eye-view' } });
    const cameras = parseFintraffic(json);
    if (cameras.length === 0) throw new Error('no cameras in the answer');
    return { cameras };
  },
};
