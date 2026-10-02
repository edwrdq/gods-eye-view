import type { BBox, LayerKind } from '@gev/shared';

/** Follow keeps a moving object in view; static features (a quake, a pad, a storm part) get a one-off "Fly to". */
export function primaryAction(kind: LayerKind): 'follow' | 'flyto' {
  return kind === 'features' ? 'flyto' : 'follow';
}

/**
 * Titles are names, set in the UI sans. Only a title that is itself an
 * identifier (a callsign, MMSI or ICAO hex of a tracked object) is set in mono.
 */
export function titleIsIdentifier(kind: LayerKind, title: string, objectId: string): boolean {
  if (kind !== 'tracked') return false;
  const t = title.trim();
  return t === objectId || (!/\s/.test(t) && /\d/.test(t));
}

/** Half-width in degrees of the view "Fly to" frames around a feature of this layer. */
const FRAME_HALF_DEG: Record<string, number> = { earthquakes: 0.6, launches: 0.15, cyclones: 6, cctv: 0.004 };

/** A box around a point sized for what the layer shows, for the camera to frame. */
export function frameBBox(layerId: string, lon: number, lat: number): BBox {
  const h = FRAME_HALF_DEG[layerId] ?? 1;
  const dLon = Math.min(h / Math.max(0.2, Math.cos((lat * Math.PI) / 180)), 90);
  const west = lon - dLon;
  const east = lon + dLon;
  const wrap = (v: number) => (v > 180 ? v - 360 : v < -180 ? v + 360 : v);
  return [wrap(west), Math.max(-90, lat - h), wrap(east), Math.min(90, lat + h)];
}
