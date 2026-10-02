import type { DetailRow, PropValue } from '@gev/shared';

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

export function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
}

export function fmtLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
}

/** 2026-10-02 04:19:43Z */
export function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ') + 'Z';
}

export function pad3(deg: number): string {
  return String(Math.round(deg) % 360).padStart(3, '0');
}

/** Row builder that skips rows whose value is missing. */
export function rows(...entries: Array<DetailRow | null | undefined | false>): DetailRow[] {
  return entries.filter((r): r is DetailRow => !!r && r.value !== undefined && r.value !== null && r.value !== '');
}

export function row(label: string, value: PropValue | undefined, extra: Partial<DetailRow> = {}): DetailRow | null {
  if (value === undefined || value === null || value === '') return null;
  return { label, value, ...extra };
}

/** "5 min ago", "3 h 12 min ago", "in 2 d 4 h"; `deltaMs` is now minus then. */
export function fmtAgo(deltaMs: number): string {
  const future = deltaMs < 0;
  const mins = Math.round(Math.abs(deltaMs) / 60_000);
  if (mins < 1) return 'just now';
  let body: string;
  if (mins < 60) body = `${mins} min`;
  else if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    body = m ? `${h} h ${m} min` : `${h} h`;
  } else {
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    body = h ? `${d} d ${h} h` : `${d} d`;
  }
  return future ? `in ${body}` : `${body} ago`;
}
