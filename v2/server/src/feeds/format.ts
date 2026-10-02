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
