/** When the camera panel asks for the next picture. The server enforces the source's interval too; this keeps the browser from asking early. */

/** Never ask a camera's picture more often than this, whatever the headers say. */
export const MIN_PICTURE_DELAY_MS = 30_000;
const MAX_FAILURE_DELAY_MS = 5 * 60_000;

export interface NextInput {
  /** The camera's interval from its details (seconds). */
  refreshS: number;
  /** X-Refresh-After from the last answer: seconds until the server will pull a new picture; null when absent. */
  refreshAfterS: number | null;
  /** Consecutive failures including the last (0 = last request succeeded). */
  failures: number;
  /** Retry-After of the failed answer (seconds), when it had one. */
  retryAfterS?: number | null;
}

/** Milliseconds until the next request. After a success: when the server will have a newer picture. After failures: 30 s, doubling to 5 min. */
export function nextPictureDelayMs(i: NextInput): number {
  if (i.failures > 0) {
    const base = Math.max(MIN_PICTURE_DELAY_MS, (i.retryAfterS ?? 0) * 1000);
    return Math.min(MAX_FAILURE_DELAY_MS, base * 2 ** Math.min(i.failures - 1, 3));
  }
  const wait = i.refreshAfterS !== null && Number.isFinite(i.refreshAfterS) ? (i.refreshAfterS + 1) * 1000 : i.refreshS * 1000;
  return Math.max(MIN_PICTURE_DELAY_MS, wait);
}

/** "12 s ago", "3 min ago", "2 h ago" for a picture of this age. */
export function pictureAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Whether a picture this old is worth flagging as old for a source that refreshes every `refreshS` seconds. */
export function pictureIsOld(ageMs: number, refreshS: number): boolean {
  return ageMs > Math.max(refreshS * 3, 900) * 1000;
}
