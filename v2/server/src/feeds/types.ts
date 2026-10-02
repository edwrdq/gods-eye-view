import type { BBox, FeedStatus, ObjectDetail, Observation } from '@gev/shared';
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
  /** Layer name rows are stored under in history. */
  storageLayer: string;
  /** Historical snapshots look back this far from `at` for the latest point. */
  lookbackMs: number;
  /** Filtered view over the feed's objects (e.g. military only). */
  include?: (o: Observation) => boolean;
}

export interface Feed {
  /** Feed id as used in the FEEDS env list. */
  readonly id: string;
  readonly freshnessMs: number;
  readonly layers: readonly FeedLayer[];
  /** Live picture (objectId -> latest observation, full props). */
  readonly live: LivePicture;
  /** Begin background polling / streaming. Idempotent. */
  start(): void;
  stop(): Promise<void>;
  /** Status for one of this feed's layers (default: the first). */
  status(layer?: string): FeedStatus;
  /** Browser viewport hint from a snapshot request (area-of-interest feeds only). */
  hint?(layer: string, bbox: BBox): void;
  /** Build the detail panel content; must still resolve when enrichment fails. */
  detail(layer: string, obs: Observation, historical: boolean): Promise<ObjectDetail>;
}

/** Persists a batch of observations (one transaction). */
export type ObservationSink = (batch: Observation[]) => void;
