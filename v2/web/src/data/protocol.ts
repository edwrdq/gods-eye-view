import type { BBox, FeedStatus } from '@gev/shared';
import type { ApiConfig, ApiFailure } from '../api/index.ts';
import type { UpdatePacket } from './slots.ts';

/** Main thread to snapshot worker. */
export type ToWorker =
  | { type: 'init'; api: ApiConfig }
  /** Fetch a snapshot and answer with `update` or `failed`. A newer fetch for the same layer supersedes an older one. */
  | { type: 'fetch'; layer: string; seq: number; bbox: BBox | null; at: number | null }
  /** Abort anything in flight for the layer and forget its objects (layer turned off). */
  | { type: 'drop'; layer: string };

export interface UpdateMessage {
  type: 'update';
  layer: string;
  seq: number;
  /** The instant the snapshot describes. */
  at: number;
  historical: boolean;
  feed: FeedStatus;
  truncated: boolean;
  /** Objects in the server's answer (before diffing). */
  received: number;
  packet: UpdatePacket;
  /** Worker time spent fetching (network) and then parsing + diffing, ms. */
  fetchMs: number;
  parseMs: number;
}

export interface FailedMessage {
  type: 'failed';
  layer: string;
  seq: number;
  failure: ApiFailure;
  status: number;
  message: string;
}

export type FromWorker = UpdateMessage | FailedMessage;
