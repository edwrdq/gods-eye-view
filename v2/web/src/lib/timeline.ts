import type { HistoryRange } from '@gev/shared';

/** Within this of "now" the view counts as live. */
export const LIVE_SNAP_MS = 90_000;

/** Clamp a requested instant into recorded history. */
export function clampToRange(at: number, range: HistoryRange | null, now: number): number {
  const lo = range?.from ?? now;
  return Math.max(Math.min(lo, now), Math.min(now, at));
}

/** True when `at` is close enough to now to be treated as the live view. */
export function isLiveTime(at: number, now: number): boolean {
  return now - at <= LIVE_SNAP_MS;
}

/** Next playback instant after one second of real time at `speed`; null means playback reached live. */
export function nextPlayTime(at: number, speed: number, now: number): number | null {
  const next = at + speed * 1000;
  return isLiveTime(next, now) ? null : next;
}

/** Where playback starts when the user presses play while live: up to 15 min back, never before recorded history. */
export function playbackStart(range: HistoryRange | null, now: number): number | null {
  if (!range || range.from === null) return null;
  return Math.max(range.from, now - 15 * 60_000);
}

/** Slider position (0..1) of `at` between the start of history and now. */
export function sliderFraction(at: number | null, range: HistoryRange | null, now: number): number {
  const from = range?.from;
  if (at === null || from === null || from === undefined || now <= from) return 1;
  return Math.max(0, Math.min(1, (at - from) / (now - from)));
}
