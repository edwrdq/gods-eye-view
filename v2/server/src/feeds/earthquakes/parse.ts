import type { PropValue } from '@gev/shared';
import type { FeatureRow } from '../../db/features.ts';

export const LAYER = 'earthquakes';

export interface UsgsSnapshot {
  rows: FeatureRow[];
  /** Feed generation time (epoch ms) when the source states it. */
  generated: number | null;
  /** Events skipped because they were unusable (no magnitude, bad coordinates, ...). */
  skipped: number;
}

const ALERTS = new Set(['green', 'yellow', 'orange', 'red']);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Label for the map, e.g. "M 4.6". */
export function quakeLabel(mag: number): string {
  return `M ${mag.toFixed(1)}`;
}

/**
 * Parse a USGS GeoJSON summary feed. Bad events are skipped individually, but a
 * payload that is not a FeatureCollection throws so the previous data is kept.
 *
 * Quirks handled (from the original app and the feed spec): `mag` may be null
 * for brand-new events, depth may be negative (above sea level), `felt`, `cdi`,
 * `mmi` and `alert` are mostly null, `tsunami` is 0/1 and only flags a large
 * oceanic event, and the same id can appear in later polls with a newer
 * `updated` (revisions).
 */
export function parseUsgs(payload: unknown): UsgsSnapshot {
  const root = payload as { features?: unknown; metadata?: { generated?: unknown } } | null;
  if (!root || !Array.isArray(root.features)) throw new Error('malformed USGS response');
  const rows: FeatureRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of root.features as unknown[]) {
    const f = raw as { id?: unknown; geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> } | null;
    const p = f?.properties;
    const c = f?.geometry?.coordinates;
    const id = typeof f?.id === 'string' && f.id !== '' ? f.id : null;
    if (!p || typeof p !== 'object' || !Array.isArray(c) || c.length < 2 || id === null || seen.has(id)) {
      skipped++;
      continue;
    }
    const lon = num(c[0]);
    const lat = num(c[1]);
    const depth = num(c[2]);
    const mag = num(p.mag);
    const t = num(p.time);
    if (lon === null || lat === null || Math.abs(lon) > 180 || Math.abs(lat) > 90 || mag === null || mag > 10 || t === null) {
      skipped++;
      continue;
    }
    seen.add(id);
    const alert = typeof p.alert === 'string' && ALERTS.has(p.alert) ? p.alert : null;
    const place = str(p.place);
    const type = str(p.type) ?? 'earthquake';
    const props: Record<string, PropValue> = {
      mag,
      depthKm: depth,
      place,
      tsunami: p.tsunami === 1 || p.tsunami === true,
      alert,
      type,
    };
    const extra: Record<string, PropValue> = {
      magType: str(p.magType),
      status: str(p.status),
      felt: num(p.felt),
      cdi: num(p.cdi),
      mmi: num(p.mmi),
      sig: num(p.sig),
      net: str(p.net),
      nst: num(p.nst),
      gap: num(p.gap),
      dmin: num(p.dmin),
      rms: num(p.rms),
      url: str(p.url),
      title: str(p.title),
    };
    rows.push({
      id,
      t,
      updated: num(p.updated) ?? t,
      lon,
      lat,
      rank: mag,
      label: quakeLabel(mag),
      props,
      extra,
    });
  }
  const generated = num(root.metadata?.generated);
  return { rows, generated, skipped };
}
