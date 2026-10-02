import type { FeedStatus } from '@gev/shared';

export const MIN_POLL_MS = 5_000;
export const MAX_POLL_MS = 120_000;
const DEFAULT_POLL_MS = 15_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * How often to poll a layer's snapshot. A feed is stale after `freshnessMs`;
 * polling three times per window keeps the picture fresh without hammering the
 * server, and never faster than every 5 s.
 */
export function cadenceMs(freshnessMs: number | undefined): number {
  if (freshnessMs === undefined || !Number.isFinite(freshnessMs) || freshnessMs <= 0) return DEFAULT_POLL_MS;
  return Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, Math.round(freshnessMs / 3)));
}

/** Delay before the next attempt after `failures` consecutive failures (0 = last one succeeded). */
export function retryDelayMs(baseMs: number, failures: number): number {
  if (failures <= 0) return baseMs;
  return Math.max(baseMs, Math.min(MAX_BACKOFF_MS, baseMs * 2 ** Math.min(failures, 8)));
}

export type Health = 'live' | 'stale' | 'error' | 'off' | 'needs-key';

/** The state to show: a feed the server calls live is still stale if its newest data is older than its window. */
export function effectiveState(feed: FeedStatus, now: number): Health {
  if (feed.state !== 'live') return feed.state;
  if (feed.lastSuccess !== null && now - feed.lastSuccess > feed.freshnessMs) return 'stale';
  return 'live';
}

export interface Freshness {
  fresh: number;
  total: number;
}

/** "2 of 2 sources fresh": counts feeds that are running (live, stale or failing). */
export function freshnessSummary(feeds: readonly FeedStatus[], now: number): Freshness {
  let fresh = 0;
  let total = 0;
  for (const f of feeds) {
    if (f.state === 'off' || f.state === 'needs-key') continue;
    total++;
    if (effectiveState(f, now) === 'live') fresh++;
  }
  return { fresh, total };
}
