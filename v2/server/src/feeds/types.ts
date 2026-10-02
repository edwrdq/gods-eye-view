import type {
  BBox,
  ElementsResponse,
  Feature,
  FeatureDetail,
  FeedStatus,
  LayerKind,
  ObjectDetail,
  Observation,
} from '@gev/shared';
import type { LivePicture } from './live-picture.ts';

/** Injectable timer functions so tests (and shutdown) control scheduling. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Real timers, unref'd so background feeds never hold the process open. */
export const realTimers: Timers = {
  setTimeout(fn, ms) {
    const h = setTimeout(fn, ms);
    h.unref();
    return h;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  setInterval(fn, ms) {
    const h = setInterval(fn, ms);
    h.unref();
    return h;
  },
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A layer id served by a feed, and how it maps onto the live picture and history. */
export interface FeedLayer {
  /** Public layer id (see layers.ts). */
  id: string;
  /** How the layer is served; defaults to 'tracked' for the original feeds. */
  kind?: LayerKind;
  /** Layer name rows are stored under in history. */
  storageLayer: string;
  /** Historical snapshots look back this far from `at` for the latest point. */
  lookbackMs: number;
  /** Filtered view over the feed's objects (e.g. military only). */
  include?: (o: Observation) => boolean;
}

/** Lifecycle and status shared by every feed, whatever it serves. */
export interface Feed {
  /** Feed id as used in the FEEDS env list. */
  readonly id: string;
  readonly freshnessMs: number;
  readonly layers: readonly FeedLayer[];
  /** Begin background polling / streaming. Idempotent. */
  start(): void;
  stop(): Promise<void>;
  /** Status for one of this feed's layers (default: the first). */
  status(layer?: string): FeedStatus;
}

/** Moving objects served through snapshots, details and tracks (flights, vessels). */
export interface TrackedFeed extends Feed {
  /** Live picture (objectId -> latest observation, full props). */
  readonly live: LivePicture;
  /** Browser viewport hint from a snapshot request (area-of-interest feeds only). */
  hint?(layer: string, bbox: BBox): void;
  /** Build the detail panel content; must still resolve when enrichment fails. */
  detail(layer: string, obs: Observation, historical: boolean): Promise<ObjectDetail>;
}

export interface FeatureQuery {
  bbox?: BBox;
  /** Inclusive epoch-ms bounds on Feature.t; undefined means the layer's default. */
  from?: number;
  to?: number;
  /** Maximum features to return; the feed sets `truncated` beyond it. */
  limit: number;
}

export interface FeatureResult {
  features: Feature[];
  truncated: boolean;
  /** The feed is still loading data this view needs; the client asks again soon. */
  pending?: boolean;
}

/** Events and shapes served through /features (earthquakes, cyclones, launches). */
export interface FeaturesFeed extends Feed {
  /** May be asynchronous: layers served from the operators' own feeds (bikeshare) load what the view needs first. */
  features(layer: string, query: FeatureQuery): FeatureResult | Promise<FeatureResult>;
  /** Null when the feature is unknown. Must resolve without network access. */
  featureDetail(layer: string, featureId: string): Promise<FeatureDetail | null>;
}

/** What a feature's picture request came to. */
export type ImageOutcome =
  | { kind: 'ok'; image: { body: Uint8Array; contentType: string; frameTime: number; fetchedAt: number; refreshS: number; nextInS: number; origin: 'upstream' | 'cache' | 'stale' } }
  /** The feature has no picture to show. */
  | { kind: 'none'; message: string }
  | { kind: 'error'; status: 502 | 504 | 404; message: string; retryAfterS: number | null };

/** A features feed whose features have a live picture, served through /features/:id/image (cctv). */
export interface ImageFeed extends Feed {
  /** Null when the feature is unknown. */
  image(layer: string, featureId: string): Promise<ImageOutcome | null>;
}

/** Orbital element sets served through /elements (satellites). */
export interface OrbitsFeed extends Feed {
  /** Null when `group` is not one of this feed's groups. */
  elements(layer: string, group?: string): Pick<ElementsResponse, 'groups' | 'elements'> | null;
}

export const isTrackedFeed = (f: Feed): f is TrackedFeed => 'live' in f;
export const isFeaturesFeed = (f: Feed): f is FeaturesFeed => 'features' in f;
export const isImageFeed = (f: Feed): f is ImageFeed => 'image' in f;
export const isOrbitsFeed = (f: Feed): f is OrbitsFeed => 'elements' in f;

/** Persists a batch of observations (one transaction). */
export type ObservationSink = (batch: Observation[]) => void;
