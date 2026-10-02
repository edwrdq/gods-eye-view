import type { BBox, FeedStatus } from '@gev/shared';
import type { ApiConfig, ApiFailure } from '../api/index.ts';
import type { FeaturePack } from '../lib/geometryPack.ts';

export type ToFeatureWorker =
  | { type: 'init'; api: ApiConfig }
  /** Fetch a layer's features and answer with `features` or `failed`. A newer fetch for the layer supersedes an older one. */
  | { type: 'fetch'; layer: string; seq: number; from?: number; to?: number; bbox?: BBox }
  | { type: 'drop'; layer: string };

export interface FeaturesMessage {
  type: 'features';
  layer: string;
  seq: number;
  feed: FeedStatus;
  truncated: boolean;
  /** Features in the server answer. */
  received: number;
  pack: FeaturePack;
  fetchMs: number;
  packMs: number;
}

export interface FeatureFailedMessage {
  type: 'failed';
  layer: string;
  seq: number;
  failure: ApiFailure;
  status: number;
  message: string;
}

export type FromFeatureWorker = FeaturesMessage | FeatureFailedMessage;
