import type { FeedStatus, OrbitalElements } from '@gev/shared';
import type { ApiConfig, ApiFailure } from '../api/index.ts';

export interface GroupCount {
  name: string;
  count: number;
}

export type ToOrbitWorker =
  | { type: 'init'; api: ApiConfig; /** Synthetic satellites instead of the server's; 0 = off. */ bench: number }
  /** (Re)fetch all element sets. */
  | { type: 'load'; seq: number }
  /** Show one group, or all (null). */
  | { type: 'group'; group: string | null }
  /** Viewed instant; null follows the clock. */
  | { type: 'time'; at: number | null }
  /** Propagate this one satellite faster (4 Hz) and keep its details ready. */
  | { type: 'select'; noradId: string | null }
  /** Stop ticking while the tab is hidden. */
  | { type: 'pause'; paused: boolean }
  /** Ask for the details and orbit path of a satellite at the current time. */
  | { type: 'inspect'; reqId: number; noradId: string };

export interface LoadedMessage {
  type: 'loaded';
  seq: number;
  feed: FeedStatus;
  groups: GroupCount[];
  total: number;
  /** NORAD ids and names, "\n" separated, in element order (indices used by `active` and `positions`). */
  ids: string;
  names: string;
  /** Group name per element, as an index into `groupNames`. */
  groupOf: Uint8Array;
  groupNames: string[];
  /** Oldest and newest element epochs, ms. */
  oldestEpoch: number | null;
  newestEpoch: number | null;
  fetchMs: number;
  /** Time to build every satrec, ms. */
  initMs: number;
}

export interface LoadFailedMessage {
  type: 'failed';
  seq: number;
  failure: ApiFailure;
  status: number;
  message: string;
}

/** The elements now being propagated (after a group change or a load). */
export interface ActiveMessage {
  type: 'active';
  indices: Uint32Array;
}

/** Earth-fixed positions aligned with the latest `active` message; NaN marks a satellite that no longer propagates. */
export interface PositionsMessage {
  type: 'positions';
  /** The instant the positions describe. */
  t: number;
  xyz: Float64Array;
  /** Worker time to propagate all, ms. */
  ms: number;
  failed: number;
}

/** Faster updates for the selected satellite. */
export interface SelectedMessage {
  type: 'selected';
  noradId: string;
  t: number;
  xyz: Float64Array;
  lon: number;
  lat: number;
  alt: number;
  speedKms: number;
}

export interface InspectedMessage {
  type: 'inspected';
  reqId: number;
  noradId: string;
  /** Null when the satellite is unknown. */
  elements: OrbitalElements | null;
  t: number;
  state: { lon: number; lat: number; alt: number; speedKms: number } | null;
  /** Orbit path, Earth-fixed metres, and the index of the sample at `t`. */
  path: Float64Array;
  nowIndex: number;
}

export type FromOrbitWorker = LoadedMessage | LoadFailedMessage | ActiveMessage | PositionsMessage | SelectedMessage | InspectedMessage;
