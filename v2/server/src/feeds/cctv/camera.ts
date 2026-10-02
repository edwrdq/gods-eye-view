import type { BBox, Feature, PropValue } from '@gev/shared';

export const LAYER = 'cctv';

/** Whether the direction a camera looks is a fact the source gave, or a placeholder. */
export type HeadingConfidence = 'known' | 'estimated';

/**
 * Where the heading comes from:
 * - published: a field of the source's own data says which way the camera faces;
 * - name: an explicit travel word in the camera's name ("US 13 SB @ ...");
 * - curated: set by hand from imagery by this project's maintainers (original app, #643);
 * - placeholder: the source says nothing. A fixed pseudo-random bearing is drawn from the camera id so
 *   views do not all point the same way. It carries no information about the real view.
 */
export type HeadingBasis = 'published' | 'name' | 'curated' | 'placeholder';

export type CameraType = 'still' | 'video';

/** One public camera, as kept in memory and in the disk cache. */
export interface Camera {
  /** Stable across refreshes, unique across sources. */
  id: string;
  /** Source id (see sources/index.ts). */
  source: string;
  name: string;
  /** Place line: a city, district or road the source names. */
  city: string;
  lon: number;
  lat: number;
  /** Degrees clockwise from true north. Always finite; see headingBasis. */
  heading: number;
  headingConfidence: HeadingConfidence;
  headingBasis: HeadingBasis;
  type: CameraType;
  /** Upstream still picture. Never sent to the browser; the server fetches it. */
  imageUrl?: string;
  /** Official live stream (HLS playlist). Opened by the viewer's browser, never relayed. */
  streamUrl?: string;
  /** Seconds between pictures the source publishes, when the catalogue says (overrides the source default). */
  refreshS?: number;
  /** Picture time in the catalogue, epoch ms, when it has one. */
  imageTime?: number;
  /** Per-camera attribution a partner supplies inside a source (DriveBC). */
  credit?: string;
  /** Sub-part of the source that was loaded together (Caltrans district): a failed refresh keeps that part's old cameras. */
  group?: string;
  /** Source-specific handle (Tarktee location id). */
  ref?: string;
}

/** FNV-1a 32-bit hash: the same id always gives the same placeholder bearing. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One of 16 compass points, derived from the id only. */
export function placeholderHeading(id: string): number {
  return (hashSeed(id) % 16) * 22.5;
}

export interface HeadingFields {
  heading: number;
  headingConfidence: HeadingConfidence;
  headingBasis: HeadingBasis;
}

/** A source-given heading when there is one, else the placeholder (marked estimated). */
export function headingFor(id: string, given: number | null | undefined, basis: Exclude<HeadingBasis, 'placeholder'>): HeadingFields {
  if (given !== null && given !== undefined && Number.isFinite(given)) {
    return { heading: ((given % 360) + 360) % 360, headingConfidence: 'known', headingBasis: basis };
  }
  return { heading: placeholderHeading(id), headingConfidence: 'estimated', headingBasis: 'placeholder' };
}

/** Free text from a third party: control characters out, spaces collapsed, bounded. */
export function clean(value: unknown, max = 160): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/** Finite, in range, and not the (0, 0) a null becomes. */
export function plausible(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

/** A number only when the value is a number (Number(null) and Number('') are 0 and would park a camera on the equator). */
export function num(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
}

export function inBox(lat: number, lon: number, box: BBox): boolean {
  return lat >= box[1] && lat <= box[3] && lon >= box[0] && lon <= box[2];
}

/** The picture endpoint of a camera on this server (the browser never sees the upstream address). */
export const imagePath = (id: string): string => `/api/layers/${LAYER}/features/${encodeURIComponent(id)}/image`;

/** Compact props for the map (the heading and the two codes the markers are styled by) plus what a hover needs. */
export function cameraFeature(c: Camera, sourceName: string, full = false): Feature {
  const props: Record<string, PropValue> = {
    name: c.name,
    source: sourceName,
    city: c.city,
    type: c.type,
    heading: Math.round(c.heading * 10) / 10,
    headingConfidence: c.headingConfidence,
  };
  if (full) {
    props.headingBasis = c.headingBasis;
    if (c.imageUrl) props.imageUrl = imagePath(c.id);
    if (c.streamUrl) props.streamUrl = c.streamUrl;
    if (c.imageTime) props.imageTime = c.imageTime;
    if (c.credit) props.credit = c.credit;
  }
  return { id: c.id, geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, ...(full && c.imageTime ? { t: c.imageTime } : {}), label: c.name, props };
}
