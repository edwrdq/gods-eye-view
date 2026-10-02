import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FeatureDetail } from '@gev/shared';
import type { FeedLayer } from '../types.ts';
import { StaticFeaturesFeed, type StaticDataset, type StaticEntry } from '../static/static-feed.ts';
import { buildDatacenterDetail } from './detail.ts';
import { datacenterFeature, datacenterRank, LAYER, parseDatacenters, type Datacenter } from './parse.ts';

export const DATACENTERS_DIR = 'datacenters';
/** The extraction date was never recorded; this is when the file entered the original app's repository (an upper bound). */
export const DATACENTERS_SNAPSHOT = '2026-09-10';
export const DATACENTERS_FILE = 'datacenters.geojsonl';
/** Datacenters returned for one request before thinning; zoom in for the rest. */
export const DATACENTER_CAP = 2500;

/** Data centers mapped in OpenStreetMap, from the bundled extract (4,351 features). */
export class DatacentersFeed extends StaticFeaturesFeed<Datacenter> {
  readonly id = 'datacenters';
  readonly source = 'OpenStreetMap';
  readonly layers: readonly FeedLayer[] = [{ id: LAYER, kind: 'features', storageLayer: LAYER, lookbackMs: 0 }];
  protected readonly pointCap = DATACENTER_CAP;

  protected load(): StaticDataset<Datacenter> {
    const file = path.join(this.dataDir, DATACENTERS_DIR, DATACENTERS_FILE);
    const { items, skipped } = parseDatacenters(readFileSync(file, 'utf8'));
    if (skipped > 0) this.log(`${this.id}: skipped ${skipped} unusable source features`);
    if (items.length === 0) throw new Error(`${DATACENTERS_FILE} has no usable features`);
    return {
      snapshotAt: Date.parse(`${DATACENTERS_SNAPSHOT}T00:00:00Z`),
      entries: items.map((d) => ({
        entry: { id: d.id, feature: datacenterFeature(d), rank: datacenterRank(d), point: true, data: d },
        boxes: [[d.lon, d.lat, d.lon, d.lat]],
      })),
    };
  }

  protected buildDetail(entry: StaticEntry<Datacenter>): FeatureDetail {
    return buildDatacenterDetail(entry);
  }
}
