import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { BBox, FeatureDetail } from '@gev/shared';
import type { FeedLayer } from '../types.ts';
import { StaticFeaturesFeed, type StaticDataset, type StaticEntry } from '../static/static-feed.ts';
import { buildCableDetail, SOURCE_NAME, type CableData } from './detail.ts';
import { cableFeature, landingFeature, LAYER, parseCables } from './parse.ts';

export const CABLES_DIR = 'telegeography_submarine_cables';
/** Landing points returned for one request before thinning; zoom in for the rest. */
export const LANDING_POINT_CAP = 800;
/** Date in source.json: the bundled files were downloaded then. */
const FALLBACK_SNAPSHOT = '2026-05-24';

/** TeleGeography submarine cables (lines) and landing points, from the bundled snapshot. */
export class CablesFeed extends StaticFeaturesFeed<CableData> {
  readonly id = 'cables';
  readonly source = SOURCE_NAME;
  readonly layers: readonly FeedLayer[] = [{ id: LAYER, kind: 'features', storageLayer: LAYER, lookbackMs: 0 }];
  protected readonly pointCap = LANDING_POINT_CAP;
  private snapshot = FALLBACK_SNAPSHOT;

  protected load(): StaticDataset<CableData> {
    const dir = path.join(this.dataDir, CABLES_DIR);
    const read = (f: string): unknown => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    try {
      const meta = JSON.parse(readFileSync(path.join(dir, 'source.json'), 'utf8')) as { downloaded_at?: unknown };
      if (typeof meta.downloaded_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meta.downloaded_at)) this.snapshot = meta.downloaded_at;
    } catch {
      // provenance file is informative only
    }
    const data = parseCables(read('cable-geo.json'), read('landing-point-geo.json'));
    if (data.skipped > 0) this.log(`${this.id}: skipped ${data.skipped} unusable source features`);
    const cableBySlug = new Map(data.cables.map((c) => [c.slug, c]));
    const landingBySlug = new Map(data.landings.map((l) => [l.slug, l]));
    const entries: StaticDataset<CableData>['entries'] = [];
    for (const c of data.cables) {
      const boxes: BBox[] = c.parts.map((p) => {
        let w = Infinity;
        let s = Infinity;
        let e = -Infinity;
        let n = -Infinity;
        for (const [lon, lat] of p) {
          if (lon < w) w = lon;
          if (lon > e) e = lon;
          if (lat < s) s = lat;
          if (lat > n) n = lat;
        }
        return [w, s, e, n];
      });
      entries.push({
        entry: { id: `cable:${c.slug}`, feature: cableFeature(c), rank: c.lengthKm, point: false, data: { kind: 'cable', cable: c, landings: c.landingSlugs.map((s) => landingBySlug.get(s)!).filter(Boolean) } },
        boxes,
      });
    }
    for (const l of data.landings) {
      entries.push({
        entry: {
          id: `landing:${l.slug}`,
          feature: landingFeature(l),
          // Busier landing stations first when thinning.
          rank: l.cableSlugs.length,
          point: true,
          data: { kind: 'landing', landing: l, cables: l.cableSlugs.map((s) => cableBySlug.get(s)!).filter(Boolean) },
        },
        boxes: [[l.lon, l.lat, l.lon, l.lat]],
      });
    }
    let snapshotAt = Date.parse(`${this.snapshot}T00:00:00Z`);
    if (!Number.isFinite(snapshotAt)) snapshotAt = statSync(path.join(dir, 'cable-geo.json')).mtimeMs;
    return { entries, snapshotAt };
  }

  protected buildDetail(entry: StaticEntry<CableData>): FeatureDetail {
    return buildCableDetail(entry, this.snapshot);
  }
}
