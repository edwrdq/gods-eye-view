import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FeatureDetail } from '@gev/shared';
import type { FeedLayer } from '../types.ts';
import { StaticFeaturesFeed, type StaticDataset, type StaticEntry } from '../static/static-feed.ts';
import { buildInstallationDetail, type InstallationMeta } from './detail.ts';
import { installationFeature, installationRank, LAYER, parseInstallations, type Installation } from './parse.ts';

export const INSTALLATIONS_DIR = 'osm_military_names';
export const INSTALLATIONS_FILE = 'names.json';
/** Installations returned for one request before thinning; zoom in for the rest. */
export const INSTALLATION_CAP = 3000;

/**
 * Mapped military areas from the bundled OpenStreetMap/Overture name index
 * (36,466 named areas, label point and bounds). Nothing is fetched at runtime:
 * the original app stopped using public Overpass for this layer, and the
 * bundled index covers the world without it.
 */
export class InstallationsFeed extends StaticFeaturesFeed<Installation> {
  readonly id = 'installations';
  readonly source = 'OpenStreetMap via Overture Maps';
  readonly layers: readonly FeedLayer[] = [{ id: LAYER, kind: 'features', storageLayer: LAYER, lookbackMs: 0 }];
  protected readonly pointCap = INSTALLATION_CAP;
  private meta: InstallationMeta = { release: null, snapshots: [] };

  protected load(): StaticDataset<Installation> {
    const file = path.join(this.dataDir, INSTALLATIONS_DIR, INSTALLATIONS_FILE);
    const ds = parseInstallations(JSON.parse(readFileSync(file, 'utf8')));
    if (ds.skipped > 0) this.log(`${this.id}: skipped ${ds.skipped} unusable rows`);
    if (ds.items.length === 0) throw new Error(`${INSTALLATIONS_FILE} has no usable rows`);
    this.meta = { release: ds.release, snapshots: ds.snapshots };
    // The newest OSM snapshot date is when the data was true; fall back to the file date.
    const newest = [...ds.snapshots].sort().pop();
    const at = newest ? Date.parse(`${newest}T00:00:00Z`) : NaN;
    return {
      snapshotAt: Number.isFinite(at) ? at : statSync(file).mtimeMs,
      entries: ds.items.map((i) => ({
        entry: { id: i.id, feature: installationFeature(i), rank: installationRank(i), point: true, data: i },
        boxes: [[i.lon, i.lat, i.lon, i.lat]],
      })),
    };
  }

  protected buildDetail(entry: StaticEntry<Installation>): FeatureDetail {
    return buildInstallationDetail(entry, this.meta);
  }
}
