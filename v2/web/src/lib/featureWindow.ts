/** Time window and history behaviour of the features layers. */

const DAY = 86_400_000;

/** Layers that only know the present: cyclones and launches show current data in history mode. */
const LIVE_ONLY: ReadonlySet<string> = new Set(['cyclones', 'launches']);

export function isLiveOnly(layerId: string): boolean {
  return LIVE_ONLY.has(layerId);
}

/**
 * Bundled datasets (submarine cables, data centers, mapped military areas). They
 * are snapshots, not feeds: nothing is recorded, time does not apply, and they
 * are fetched for the viewed area instead of polled.
 */
const STATIC: ReadonlySet<string> = new Set(['submarine-cables', 'datacenters', 'installations']);

export function isStatic(layerId: string): boolean {
  return STATIC.has(layerId);
}

/** Layers that keep their data when a past time is viewed (current-only feeds and snapshots). */
export function ignoresTime(layerId: string): boolean {
  return LIVE_ONLY.has(layerId) || STATIC.has(layerId);
}

export interface FeatureWindow {
  from?: number;
  to?: number;
}

/**
 * Query window for a features layer at the viewed time `at` (null = live).
 * Earthquakes show the 24 h up to the viewed time; live asks for the server default
 * (the same 24 h ending now). Other layers send no window.
 */
export function featureWindow(layerId: string, at: number | null): FeatureWindow {
  if (layerId === 'earthquakes' && at !== null) return { from: at - DAY, to: at };
  return {};
}

/** Instant ages are measured against: the viewed time, or now. */
export function referenceTime(at: number | null, now: number): number {
  return at ?? now;
}

/** What the window is called in a status line ("24 h"); null when the layer has no window. */
export function windowLabel(layerId: string): string | null {
  return layerId === 'earthquakes' ? '24 h' : null;
}

export const HISTORY_NOTE_STATIC = 'Same at any time';
export const HISTORY_NOTE_LIVE_ONLY = 'Not recorded for past times';
