import { clean, headingFor, plausible, round5, type Camera } from '../camera.ts';
import { getText } from '../../http.ts';
import type { CameraSource, LoadContext } from './types.ts';

export const TARKTEE_LOCATIONS_URL = 'https://tarktee.transpordiamet.ee/api/v1/datex/roadCameraLocations';
export const TARKTEE_IMAGES_URL = 'https://tarktee.transpordiamet.ee/api/v1/datex/roadCameraImages';
export const TARKTEE_HOST = 'tarktee.transpordiamet.ee';
const IMAGE_PREFIX = `https://${TARKTEE_HOST}/images/`;
/** The picture address changes with every capture (it holds the time), so it is looked up again this often. */
export const TARKTEE_INDEX_TTL_MS = 10 * 60_000;

export interface TarkteeLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface TarkteeImage {
  url: string;
  /** Capture time, epoch ms. */
  time: number | null;
}

/** DATEX II predefined locations: id, name and position of every camera. The group container has no position and is skipped. */
export function parseTarkteeLocations(xml: string): TarkteeLocation[] {
  const out: TarkteeLocation[] = [];
  const block = /<predefinedLocation\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/predefinedLocation>/g;
  for (let m = block.exec(xml); m; m = block.exec(xml)) {
    const lat = /<latitude>\s*(-?\d+(?:\.\d+)?)\s*<\/latitude>/i.exec(m[2]!);
    const lon = /<longitude>\s*(-?\d+(?:\.\d+)?)\s*<\/longitude>/i.exec(m[2]!);
    if (!lat || !lon) continue;
    const name = /<value\b[^>]*>\s*([^<]+?)\s*<\/value>/i.exec(m[2]!);
    out.push({ id: m[1]!, name: clean(name?.[1], 100) || m[1]!, lat: Number(lat[1]), lon: Number(lon[1]) });
  }
  return out;
}

/** DATEX II traffic views: location id to the current picture address and capture time. Only addresses on the official host count. */
export function parseTarkteeImages(xml: string): Map<string, TarkteeImage> {
  const out = new Map<string, TarkteeImage>();
  const block = /<trafficView\b[^>]*>([\s\S]*?)<\/trafficView>/g;
  for (let m = block.exec(xml); m; m = block.exec(xml)) {
    const ref = /<linearPredefinedLocationReference\b[^>]*\bid="([^"]+)"/i.exec(m[1]!);
    const url = /<urlLinkAddress>\s*([^<\s]+)\s*<\/urlLinkAddress>/i.exec(m[1]!);
    const time = /<trafficViewTime>\s*([^<\s]+)\s*<\/trafficViewTime>/i.exec(m[1]!);
    if (!ref || !url || !url[1]!.startsWith(IMAGE_PREFIX)) continue;
    const t = time ? Date.parse(time[1]!) : NaN;
    out.set(ref[1]!, { url: url[1]!, time: Number.isFinite(t) ? t : null });
  }
  return out;
}

/** Cameras from both documents; a location without a picture in the second document is not a working camera. */
export function buildTarktee(locations: TarkteeLocation[], images: Map<string, TarkteeImage>): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const l of locations) {
    const img = images.get(l.id);
    if (!img || !plausible(l.lat, l.lon) || l.lat < 57.4 || l.lat > 59.9 || l.lon < 21.5 || l.lon > 28.4) continue;
    const n = /\/images\/(\d+)\//.exec(img.url);
    const id = `ee-tarktee-${n ? n[1] : l.id.slice(0, 8)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      source: 'tarktee',
      name: l.name,
      city: 'Estonia',
      lon: round5(l.lon),
      lat: round5(l.lat),
      ...headingFor(id, null, 'published'),
      type: 'still',
      imageUrl: img.url,
      ...(img.time !== null ? { imageTime: img.time } : {}),
      ref: l.id,
    });
  }
  return out;
}

const opts = (ctx: Pick<LoadContext, 'signal' | 'now'>) => ({ signal: ctx.signal, now: ctx.now, timeoutMs: 45_000, maxBytes: 8 * 1024 * 1024, headers: { Accept: 'application/xml' } });

/** Estonian Transpordiamet (Tarktee) road weather cameras, from two DATEX II documents. */
export function createTarktee(): CameraSource {
  let index: { at: number; map: Map<string, TarkteeImage> } | null = null;
  let pending: Promise<Map<string, TarkteeImage>> | null = null;

  async function images(ctx: Pick<LoadContext, 'fetch' | 'signal' | 'now'>): Promise<Map<string, TarkteeImage>> {
    if (index && ctx.now() - index.at < TARKTEE_INDEX_TTL_MS) return index.map;
    pending ??= getText(ctx.fetch, TARKTEE_IMAGES_URL, opts(ctx))
      .then((r) => {
        const map = parseTarkteeImages(r.text);
        if (map.size === 0) throw new Error('no pictures in the answer');
        index = { at: ctx.now(), map };
        return map;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  return {
    id: 'tarktee',
    name: 'Transpordiamet (Tarktee)',
    provider: 'Estonian Transport Administration (Transpordiamet)',
    coverage: [21.5, 57.4, 28.4, 59.9],
    pageUrl: 'https://tarktee.transpordiamet.ee/',
    licence: 'Public Transpordiamet road camera data (no licence text published)',
    attribution: 'Transpordiamet, tarktee.transpordiamet.ee',
    catalogTtlMs: 24 * 3_600_000,
    // Cameras deliver a new picture every ten to fifteen minutes.
    frame: { refreshS: 600, hosts: [TARKTEE_HOST] },
    async load(ctx) {
      const [loc, imgs] = await Promise.all([getText(ctx.fetch, TARKTEE_LOCATIONS_URL, opts(ctx)), images(ctx)]);
      const cameras = buildTarktee(parseTarkteeLocations(loc.text), imgs);
      if (cameras.length === 0) throw new Error('no cameras in the answers');
      return { cameras };
    },
    async resolveImage(camera, ctx) {
      const img = camera.ref ? (await images(ctx)).get(camera.ref) : undefined;
      return img?.url;
    },
  };
}

export const tarktee = createTarktee();
