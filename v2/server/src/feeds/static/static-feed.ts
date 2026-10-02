import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BBox, Feature, FeatureDetail, FeedStatus } from '@gev/shared';
import { geometryIntersects, isWorld } from '../../geo.ts';
import { FeedHealth } from '../health.ts';
import { thinGrid } from '../thin.ts';
import type { FeatureQuery, FeatureResult, FeaturesFeed, FeedLayer } from '../types.ts';
import { SpatialIndex } from './spatial-index.ts';

/** Directory holding the bundled datasets and their licence notes. */
export const STATIC_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../static-data');

/** A dataset snapshot never goes stale on a timer; its age is shown from the snapshot date. */
export const STATIC_FRESHNESS_MS = 10 * 365 * 86_400_000;

/** One indexed feature. `data` is whatever the detail builder needs. */
export interface StaticEntry<D = unknown> {
  id: string;
  feature: Feature;
  /** Higher is kept first when a response is thinned. */
  rank: number;
  /** Lines and polygons are never thinned (they carry the layer); points are. */
  point: boolean;
  data: D;
}

export interface StaticDataset<D> {
  entries: Array<{ entry: StaticEntry<D>; boxes: BBox[] }>;
  /** When the dataset snapshot was taken (epoch ms); shown as the feed's last success. */
  snapshotAt: number;
}

export interface StaticFeedOptions {
  now?: () => number;
  log?: (msg: string) => void;
  /** Override where the dataset is read from (tests). */
  dataDir?: string;
  /** Override the points-per-response cap (tests). */
  pointCap?: number;
}

/**
 * Base for layers backed by a dataset shipped with the server. The data is read
 * from disk once at start, indexed on a grid, and every query is answered from
 * memory. A response is capped at `pointCap` points (spread evenly over the
 * map, best-ranked first within an area) and flagged `truncated`; zooming in
 * narrows the box until everything fits.
 */
export abstract class StaticFeaturesFeed<D> implements FeaturesFeed {
  abstract readonly id: string;
  abstract readonly layers: readonly FeedLayer[];
  abstract readonly source: string;
  readonly freshnessMs = STATIC_FRESHNESS_MS;
  /** Points returned for one request before thinning kicks in. */
  protected abstract readonly pointCap: number;

  protected readonly now: () => number;
  protected readonly log: (msg: string) => void;
  protected readonly dataDir: string;
  private readonly capOverride: number | undefined;
  protected readonly health: FeedHealth;
  protected readonly index = new SpatialIndex<StaticEntry<D>>();
  private byId = new Map<string, StaticEntry<D>>();
  private readonly worldCache = new Map<number, FeatureResult>();
  loadMs = 0;

  constructor(opts: StaticFeedOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.dataDir = opts.dataDir ?? STATIC_DATA_DIR;
    this.capOverride = opts.pointCap;
    this.health = new FeedHealth(this.now, STATIC_FRESHNESS_MS);
  }

  /** Read and parse the dataset synchronously; throw when it is missing or unusable. */
  protected abstract load(): StaticDataset<D>;
  protected abstract buildDetail(entry: StaticEntry<D>): FeatureDetail;

  get count(): number {
    return this.index.size;
  }

  start(): void {
    this.health.running = true;
    if (this.index.size > 0) return;
    const t0 = performance.now();
    try {
      const ds = this.load();
      for (const { entry, boxes } of ds.entries) {
        if (this.byId.has(entry.id)) continue;
        this.byId.set(entry.id, entry);
        this.index.add(entry, boxes);
      }
      this.loadMs = performance.now() - t0;
      this.health.ok(ds.snapshotAt);
      this.log(`${this.id}: ${this.index.size} features loaded in ${this.loadMs.toFixed(0)} ms`);
    } catch (err) {
      this.health.fail(`Bundled dataset unavailable: ${(err as Error).message}`);
      this.log(`${this.id}: ${(err as Error).message}`);
    }
  }

  async stop(): Promise<void> {
    this.health.running = false;
  }

  status(layer: string = this.layers[0]!.id): FeedStatus {
    return {
      layer,
      state: this.health.state(),
      source: this.source,
      lastSuccess: this.health.lastSuccess,
      lastError: this.health.lastError,
      count: this.index.size,
      freshnessMs: STATIC_FRESHNESS_MS,
    };
  }

  features(_layer: string, q: FeatureQuery): FeatureResult {
    const world = !q.bbox || isWorld(q.bbox);
    const cached = world ? this.worldCache.get(q.limit) : undefined;
    if (cached) return cached;
    const result = this.run(world ? undefined : q.bbox, q.limit);
    if (world) this.worldCache.set(q.limit, result);
    return result;
  }

  private run(bbox: BBox | undefined, limit: number): FeatureResult {
    let hits = this.index.query(bbox);
    if (bbox) hits = hits.filter((e) => geometryIntersects(e.feature.geometry, bbox));
    const lines: StaticEntry<D>[] = [];
    let points: StaticEntry<D>[] = [];
    for (const e of hits) (e.point ? points : lines).push(e);
    let truncated = false;
    let keptLines = lines;
    if (keptLines.length > limit) {
      keptLines = keptLines.sort(byRank).slice(0, limit);
      truncated = true;
    }
    const pointCap = Math.max(0, Math.min(this.capOverride ?? this.pointCap, limit - keptLines.length));
    if (points.length > pointCap) {
      points = thinGrid(points, pointCap, bbox, {
        lon: (e) => (e.feature.geometry as { coordinates: number[] }).coordinates[0]!,
        lat: (e) => (e.feature.geometry as { coordinates: number[] }).coordinates[1]!,
        score: (e) => e.rank,
        id: (e) => e.id,
      });
      truncated = true;
    }
    // Best last, so a client that draws in order puts the important ones on top.
    points = points.slice().sort(byRank).reverse();
    return { features: [...keptLines.map((e) => e.feature), ...points.map((e) => e.feature)], truncated };
  }

  async featureDetail(_layer: string, featureId: string): Promise<FeatureDetail | null> {
    const e = this.byId.get(featureId);
    return e ? this.buildDetail(e) : null;
  }
}

const byRank = <D>(a: StaticEntry<D>, b: StaticEntry<D>): number => b.rank - a.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
