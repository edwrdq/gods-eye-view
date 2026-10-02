import type { BBox, Observation } from '@gev/shared';
import { approxDistanceM, headingDelta, inBBox, isWorld } from '../geo.ts';
import { thinToCap } from './thin.ts';

/** Decides which observations are worth a history row. */
export interface ThrottlePolicy {
  /** Always store when this long has passed since the last stored point. */
  minIntervalMs: number;
  /** ... or when the object moved farther than this since the last stored point. */
  minMoveM: number;
  /** ... or when its heading changed by more than this (degrees). */
  minHeadingDeg: number;
  /**
   * Objects slower than this (m/s) count as idle (parked aircraft, moored or
   * anchored vessels): they use idleIntervalMs instead of minIntervalMs and
   * their heading jitter is ignored. Both must be set to enable it.
   */
  idleSpeedMps?: number;
  idleIntervalMs?: number;
}

export interface LivePictureOptions {
  /** Drop objects not updated within this many ms (measured on the local clock). */
  timeoutMs: number;
  /** Hard cap; the least recently updated objects are evicted first. */
  maxObjects: number;
  throttle: ThrottlePolicy;
  now: () => number;
  /** Props kept in snapshots and history (the full set stays in memory for detail). */
  compactProps: (props: Observation['props']) => Observation['props'];
  /** Upper bound on queued, unflushed history rows. */
  maxPending?: number;
}

interface Entry {
  obs: Observation;
  /** Compact (snapshot / history) form, built lazily and reused until the next update. */
  compact?: Observation;
  seenAt: number;
  stored: { t: number; lon: number; lat: number; heading: number | undefined };
}

/**
 * Current picture of one feed: objectId -> latest Observation, with write
 * throttling for history and expiry of objects that stopped reporting.
 * Map insertion order is kept equal to recency of update, so expiry and
 * eviction only touch the front of the map.
 */
export class LivePicture {
  private readonly map = new Map<string, Entry>();
  private pending: Observation[] = [];

  private readonly opts: LivePictureOptions;

  constructor(opts: LivePictureOptions) {
    this.opts = opts;
  }

  get size(): number {
    return this.map.size;
  }

  /**
   * Insert or replace the object's latest observation. Returns false when the
   * observation is older than what we already hold (ignored). Queues a history
   * row when the throttle policy says the point is worth keeping.
   */
  upsert(obs: Observation): boolean {
    const prev = this.map.get(obs.objectId);
    if (prev && obs.t < prev.obs.t) return false;
    const now = this.opts.now();

    const store = !prev || this.shouldStore(prev.stored, obs);
    const entry: Entry = {
      obs,
      seenAt: now,
      stored: store
        ? { t: obs.t, lon: obs.lon, lat: obs.lat, heading: obs.heading }
        : prev!.stored,
    };
    if (store) {
      this.pending.push(this.compactOf(entry));
      const max = this.opts.maxPending ?? 500_000;
      if (this.pending.length > max) this.pending.splice(0, this.pending.length - max);
    }
    if (prev) this.map.delete(obs.objectId);
    this.map.set(obs.objectId, entry);
    while (this.map.size > this.opts.maxObjects) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    return true;
  }

  /** Merge props into an existing object without producing a history row. */
  patchProps(objectId: string, props: Observation['props']): boolean {
    const e = this.map.get(objectId);
    if (!e) return false;
    e.obs = { ...e.obs, props: { ...e.obs.props, ...props } };
    delete e.compact;
    return true;
  }

  get(objectId: string): Observation | undefined {
    return this.map.get(objectId)?.obs;
  }

  /** Remove objects unseen for longer than timeoutMs. Returns the ids removed. */
  expire(): string[] {
    const cutoff = this.opts.now() - this.opts.timeoutMs;
    const removed: string[] = [];
    for (const [id, e] of this.map) {
      if (e.seenAt >= cutoff) break;
      this.map.delete(id);
      removed.push(id);
    }
    return removed;
  }

  /** Take the queued history rows (compact props), emptying the queue. */
  takePending(): Observation[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Put rows back at the front of the queue, e.g. after a failed write. */
  requeue(rows: Observation[]): void {
    this.pending = rows.concat(this.pending);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  count(include?: (o: Observation) => boolean): number {
    if (!include) return this.map.size;
    let n = 0;
    for (const e of this.map.values()) if (include(e.obs)) n++;
    return n;
  }

  /**
   * Compact observations inside bbox (whole world when omitted). When more than
   * `limit` match, a spatially even subset of `limit` is returned (see thinToCap),
   * `truncated` is true and `total` says how many matched.
   */
  query(opts: { bbox?: BBox; include?: (o: Observation) => boolean; limit: number }): {
    objects: Observation[];
    truncated: boolean;
    total: number;
  } {
    const bbox = opts.bbox && !isWorld(opts.bbox) ? opts.bbox : undefined;
    const objects: Observation[] = [];
    for (const e of this.map.values()) {
      if (bbox && !inBBox(e.obs.lon, e.obs.lat, bbox)) continue;
      if (opts.include && !opts.include(e.obs)) continue;
      objects.push(this.compactOf(e));
    }
    const total = objects.length;
    if (total <= opts.limit) return { objects, truncated: false, total };
    return { objects: thinToCap(objects, opts.limit, { bbox, now: this.opts.now() }), truncated: true, total };
  }

  private compactOf(e: Entry): Observation {
    if (!e.compact) e.compact = { ...e.obs, props: this.opts.compactProps(e.obs.props) };
    return e.compact;
  }

  private shouldStore(last: Entry['stored'], obs: Observation): boolean {
    const p = this.opts.throttle;
    const idle =
      p.idleSpeedMps !== undefined &&
      p.idleIntervalMs !== undefined &&
      obs.speed !== undefined &&
      obs.speed < p.idleSpeedMps;
    const interval = idle ? Math.max(p.idleIntervalMs!, p.minIntervalMs) : p.minIntervalMs;
    if (obs.t - last.t >= interval) return true;
    if (approxDistanceM(last.lat, last.lon, obs.lat, obs.lon) > p.minMoveM) return true;
    if (
      !idle &&
      last.heading !== undefined &&
      obs.heading !== undefined &&
      headingDelta(last.heading, obs.heading) > p.minHeadingDeg
    ) {
      return true;
    }
    return false;
  }
}

/** Keep only the listed keys (in that order) of props. */
export function pickProps(props: Observation['props'], keys: readonly string[]): Observation['props'] {
  const out: Observation['props'] = {};
  for (const k of keys) {
    const v = props[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}
