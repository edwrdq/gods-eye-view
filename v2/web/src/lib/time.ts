/** "just now", "2 s ago", "14 min ago", "3 h ago", "2 d ago". */
export function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs)) return 'unknown';
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 1) return 'just now';
  if (s < 60) return `${s} s ago`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** Age without the "ago", for phrases like "elements 3 h old". */
export function formatDuration(ms: number): string {
  const t = formatAge(ms);
  return t.endsWith(' ago') ? t.slice(0, -4) : t;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "2026-10-02 04:19:43Z" (UTC, as the detail panel shows received times). */
export function formatUtc(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

/** "04:19:43Z" */
export function formatClockUtc(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

/** "2 Oct 04:19Z" for slider ends where the date matters more than seconds. */
export function formatShortUtc(epochMs: number): string {
  const d = new Date(epochMs);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

/** "2 Oct 13:21:17Z" for the viewed instant: date matters because history spans days. */
export function formatViewUtc(epochMs: number): string {
  const d = new Date(epochMs);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}
