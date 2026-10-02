import type { FeedStatus, LayerCategory, LayerKind } from '@gev/shared';
import type { ApiFailure } from '../../api/index.ts';

export interface LayerSpec {
  id: string;
  category: LayerCategory;
  kind: LayerKind;
}

/** One satellite group and how many element sets it holds. */
export interface GroupInfo {
  name: string;
  count: number;
}

export interface LayerRunState {
  phase: 'loading' | 'ready' | 'error';
  /** At least one snapshot has been drawn (stays true through later errors: stale data stays on screen). */
  hasData: boolean;
  feed: FeedStatus | null;
  truncated: boolean;
  /** Objects that matched before the server capped the answer (tracked layers); undefined when unknown. */
  total?: number;
  /** Instant of the drawn snapshot. */
  at: number | null;
  historical: boolean;
  /** Objects drawn. */
  drawn: number;
  error: { failure: ApiFailure; message: string } | null;
  /**
   * Features layers: the layer only knows the present, so while a past time is
   * viewed it keeps showing current data and the row says so.
   */
  currentOnly?: boolean;
  /** Orbits layers: groups available, how many satellites are loaded and shown. */
  orbits?: { groups: GroupInfo[]; total: number; shown: number; oldestEpoch: number | null; newestEpoch: number | null };
}

export interface UpdateMetric {
  layer: string;
  /** Objects in the server answer. */
  received: number;
  /** Primitives written (new + changed + removed). */
  written: number;
  /** Main-thread time to apply the update (mirror + primitives + labels), ms. */
  applyMs: number;
  /** Worker time: network fetch (with JSON parse) and typed-array diff, ms. For orbits: SGP4 for all active satellites. */
  fetchMs: number;
  parseMs: number;
}

export interface Selected {
  layer: string;
  objectId: string;
}

export interface DataHooks {
  onLayerState(layer: string, state: LayerRunState | null): void;
  /** The user clicked an object (or empty globe: null). */
  onPick(sel: Selected | null): void;
  onFollowStopped(): void;
}
