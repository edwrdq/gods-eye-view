import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { clean, headingFor, plausible, round5, type Camera } from '../camera.ts';
import type { CameraSource } from './types.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../static-data/cctv');

export const TALLINN_HOST = 'ristmikud.tallinn.ee';
export const WARENDORF_HOST = 'webcam.warendorf.de';

export interface TallinnRow {
  cam: number;
  name: string;
  lat: number;
  lon: number;
  /** Set by hand from imagery; absent when the maintainers never worked it out. */
  heading?: number;
}

/**
 * The Tallinn intersection cameras. The list is bundled (the city publishes no machine-readable
 * catalogue); the picture of camera N is https://ristmikud.tallinn.ee/last/camNNN.jpg. A heading
 * in the list was set by hand (the original app's maintainers, #643) and counts as known; the rest
 * get the placeholder.
 */
export function parseTallinn(rows: unknown): Camera[] {
  if (!Array.isArray(rows)) return [];
  const out: Camera[] = [];
  const seen = new Set<number>();
  for (const r of rows as Array<Partial<TallinnRow>>) {
    const cam = r?.cam;
    if (typeof cam !== 'number' || !Number.isInteger(cam) || cam < 0 || cam > 9999 || seen.has(cam)) continue;
    const lat = typeof r.lat === 'number' ? r.lat : NaN;
    const lon = typeof r.lon === 'number' ? r.lon : NaN;
    if (!plausible(lat, lon) || lat < 59.2 || lat > 59.7 || lon < 24.3 || lon > 25.4) continue;
    seen.add(cam);
    const id = `tln-${String(cam).padStart(3, '0')}`;
    out.push({
      id,
      source: 'tallinn',
      name: clean(r.name, 120) || `Tallinn camera ${cam}`,
      city: 'Tallinn',
      lon: round5(lon),
      lat: round5(lat),
      ...headingFor(id, typeof r.heading === 'number' ? r.heading : null, 'curated'),
      type: 'still',
      imageUrl: `https://${TALLINN_HOST}/last/cam${String(cam).padStart(3, '0')}.jpg`,
    });
  }
  return out;
}

export function loadTallinnFile(file = path.join(DIR, 'tallinn.json')): Camera[] {
  return parseTallinn(JSON.parse(readFileSync(file, 'utf8')));
}

/** The one Stadt Warendorf webcam (Marktplatz / Historisches Rathaus), with a facing worked out from OpenStreetMap geometry by the original app's maintainers. */
export function warendorfCameras(): Camera[] {
  const id = 'warendorf-marktplatz-rathaus';
  return [
    {
      id,
      source: 'warendorf',
      name: 'Marktplatz / Historisches Rathaus',
      city: 'Warendorf',
      lon: 7.99089,
      lat: 51.95266,
      ...headingFor(id, 221, 'curated'),
      type: 'still',
      imageUrl: `http://${WARENDORF_HOST}/image/jpeg.cgi`,
    },
  ];
}

export const tallinn: CameraSource = {
  id: 'tallinn',
  name: 'City of Tallinn',
  provider: 'City of Tallinn',
  coverage: [24.3, 59.2, 25.4, 59.7],
  pageUrl: 'https://ristmikud.tallinn.ee/',
  licence: 'Public City of Tallinn traffic camera data (no licence text published)',
  attribution: 'City of Tallinn, ristmikud.tallinn.ee',
  catalogTtlMs: 7 * 24 * 3_600_000,
  frame: { refreshS: 60, hosts: [TALLINN_HOST] },
  async load() {
    const cameras = loadTallinnFile();
    if (cameras.length === 0) throw new Error('the bundled Tallinn list is empty');
    return { cameras };
  },
};

export const warendorf: CameraSource = {
  id: 'warendorf',
  name: 'Stadt Warendorf',
  provider: 'Stadt Warendorf',
  coverage: [7.9, 51.9, 8.1, 52.0],
  pageUrl: 'https://www.warendorf.de/',
  licence: 'Public municipal webcam (no licence text published)',
  attribution: 'Stadt Warendorf',
  catalogTtlMs: 7 * 24 * 3_600_000,
  // The webcam is plain http, the only way the town publishes it.
  frame: { refreshS: 60, hosts: [WARENDORF_HOST], allowHttp: true },
  async load() {
    return { cameras: warendorfCameras() };
  },
};
