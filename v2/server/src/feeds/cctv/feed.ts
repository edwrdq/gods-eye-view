import type { BBox, FeatureDetail, FeedState, FeedStatus } from '@gev/shared';
import { cameraFeature, LAYER } from './camera.ts';
import { CameraCatalog } from './catalog.ts';
import { buildCameraDetail } from './detail.ts';
import { FrameError, FrameService, MIN_REFRESH_S, type Frame } from './frames.ts';
import { SOURCES } from './sources/index.ts';
import type { CameraSource } from './sources/types.ts';
import { type FeatureQuery, type FeatureResult, type FeaturesFeed, type FeedLayer, type FetchLike, type ImageFeed, type ImageOutcome, type Timers } from '../types.ts';

/** A list is refreshed when a view needs it and it is older than its TTL, so "fresh" means a few days. */
export const CCTV_FRESHNESS_MS = 3 * 86_400_000;
/** Cameras returned for one view before thinning. */
export const CCTV_CAP = 1_500;
/** How long a view waits for source lists that are not loaded yet. */
export const CCTV_WAIT_MS = 8_000;

export interface CctvFeedDeps {
  fetch: FetchLike;
  /** Directory for the per-source list caches (DATA_DIR/cache/cctv). */
  cacheDir?: string;
  sources?: readonly CameraSource[];
  now?: () => number;
  timers?: Timers;
  log?: (msg: string) => void;
  cap?: number;
  waitMs?: number;
  maxLoads?: number;
}

/**
 * Public traffic and city cameras. The map gets camera positions with a facing; the detail panel
 * gets a picture through `image()`. Nothing is fetched until a view needs a source (see
 * CameraCatalog), and a camera's picture only when its panel asks for it, never more often than
 * the source's interval (see FrameService).
 */
export class CctvFeed implements FeaturesFeed, ImageFeed {
  readonly id = 'cctv';
  readonly freshnessMs = CCTV_FRESHNESS_MS;
  readonly layers: readonly FeedLayer[] = [{ id: LAYER, kind: 'features', storageLayer: LAYER, lookbackMs: 0 }];
  readonly catalog: CameraCatalog;
  readonly frames: FrameService;
  private readonly deps: CctvFeedDeps;
  private readonly now: () => number;
  private running = false;

  constructor(deps: CctvFeedDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.catalog = new CameraCatalog({ sources: deps.sources ?? SOURCES, fetch: deps.fetch, cacheDir: deps.cacheDir, now: this.now, log: deps.log, maxLoads: deps.maxLoads });
    this.frames = new FrameService({ fetch: deps.fetch, now: this.now, log: deps.log });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.catalog.start();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.frames.stop();
    await this.catalog.stop();
  }

  status(layer: string = LAYER): FeedStatus {
    const s = this.catalog.summary();
    let state: FeedState;
    if (!this.running) state = 'off';
    else if (s.count === 0) state = s.lastError ? 'error' : 'live'; // nothing is fetched until a view needs it
    else state = this.now() - (s.lastSuccess ?? 0) > CCTV_FRESHNESS_MS ? 'stale' : 'live';
    return {
      layer,
      state,
      source: 'Transport agencies',
      lastSuccess: s.lastSuccess,
      lastError: s.lastError,
      count: s.count,
      freshnessMs: CCTV_FRESHNESS_MS,
    };
  }

  async features(_layer: string, q: FeatureQuery): Promise<FeatureResult> {
    const view: BBox | undefined = q.bbox;
    const { pending } = await this.catalog.ensure(view, this.deps.waitMs ?? CCTV_WAIT_MS);
    const cap = Math.max(0, Math.min(this.deps.cap ?? CCTV_CAP, q.limit));
    const { cameras, truncated } = this.catalog.query(view, cap);
    // Cameras whose facing is known last, so a client that draws in order puts them on top.
    const features = cameras
      .slice()
      .sort((a, b) => Number(a.headingConfidence === 'known') - Number(b.headingConfidence === 'known') || (a.id < b.id ? -1 : 1))
      .map((c) => cameraFeature(c, this.catalog.source(c.source)?.name ?? c.source));
    return { features, truncated, ...(pending ? { pending: true } : {}) };
  }

  async featureDetail(_layer: string, featureId: string): Promise<FeatureDetail | null> {
    const hit = this.catalog.get(featureId);
    if (!hit) return null;
    const refreshS = Math.max(MIN_REFRESH_S, hit.camera.refreshS ?? hit.source.frame?.refreshS ?? 0);
    return buildCameraDetail({ camera: hit.camera, source: hit.source, refreshS, frameTime: this.frames.frameTimeOf(featureId) }, this.now());
  }

  async image(_layer: string, featureId: string): Promise<ImageOutcome | null> {
    const hit = this.catalog.get(featureId);
    if (!hit) return null;
    if (!hit.source.frame || !hit.camera.imageUrl) return { kind: 'none', message: 'This camera has no still picture.' };
    try {
      const f: Frame = await this.frames.get(hit.camera, hit.source);
      return { kind: 'ok', image: f };
    } catch (err) {
      if (err instanceof FrameError) return { kind: 'error', status: err.status, message: err.message, retryAfterS: err.retryAfterS };
      throw err;
    }
  }
}

