import { clean, headingFor, num, plausible, round5, type Camera } from '../camera.ts';
import { getJson } from '../../http.ts';
import type { CameraSource } from './types.ts';

export const TFL_URL = 'https://api.tfl.gov.uk/Place/Type/JamCam';
export const TFL_IMAGE_HOST = 's3-eu-west-1.amazonaws.com';
export const TFL_IMAGE_PREFIX = `https://${TFL_IMAGE_HOST}/jamcams.tfl.gov.uk/`;

/**
 * Transport for London JamCams. A camera counts when available is "true" and its still is on TfL's
 * public bucket. TfL's `view` field is free text written for the operators ("NORTH - A41 Watford
 * Way", "Zoom - Victoria station") and does not say reliably which way the lens points, so, as in the
 * original app, no heading is taken from it: every JamCam gets the placeholder.
 */
export function parseTfl(payload: unknown): Camera[] {
  if (!Array.isArray(payload)) return [];
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const place of payload as Array<Record<string, any>>) {
    const props: Record<string, string> = {};
    for (const p of Array.isArray(place?.additionalProperties) ? place.additionalProperties : []) if (p?.key) props[String(p.key)] = String(p.value ?? '');
    if (props.available?.toLowerCase() !== 'true') continue;
    const lat = num(place.lat);
    const lon = num(place.lon);
    if (!plausible(lat, lon)) continue;
    const image = props.imageUrl ?? '';
    if (!image.startsWith(TFL_IMAGE_PREFIX)) continue;
    const raw = String(place.id ?? '').replace(/^JamCams_/, '');
    if (!/^[0-9A-Za-z._-]{1,40}$/.test(raw)) continue;
    const id = `tfl-${raw}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      source: 'tfl',
      name: clean(place.commonName, 120) || `JamCam ${raw}`,
      city: 'London',
      lon: round5(lon),
      lat: round5(lat),
      ...headingFor(id, null, 'published'),
      type: 'still',
      imageUrl: image,
    });
  }
  return out;
}

export const tfl: CameraSource = {
  id: 'tfl',
  name: 'Transport for London',
  provider: 'Transport for London',
  coverage: [-0.7, 51.2, 0.5, 51.8],
  pageUrl: 'https://www.tfl.gov.uk/traffic/status/',
  licence: 'TfL Open Data terms (attribution required)',
  attribution: 'Powered by TfL Open Data. Contains OS data © Crown copyright and database rights',
  catalogTtlMs: 12 * 3_600_000,
  frame: { refreshS: 60, hosts: [TFL_IMAGE_HOST] },
  async load(ctx) {
    const json = await getJson(ctx.fetch, TFL_URL, { signal: ctx.signal, now: ctx.now, timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024 });
    const cameras = parseTfl(json);
    if (cameras.length === 0) throw new Error('no cameras in the answer');
    return { cameras };
  },
};
