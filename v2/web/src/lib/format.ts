/** Wrap a longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** "37.7749, -122.4194" for search results and the status bar (signed decimal). */
export function formatLatLon(lat: number, lon: number, digits = 4): string {
  return `${lat.toFixed(digits)}, ${wrapLon(lon).toFixed(digits)}`;
}

/** "37.6190° N, 122.3750° W" with hemisphere letters; used for the cursor readout. */
export function formatLatLonHemi(lat: number, lon: number, digits = 4): string {
  const l = wrapLon(lon);
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = l >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(l).toFixed(digits)}° ${ew}`;
}

/** Camera height: metres below 10 km, kilometres above, with thousands separators. */
export function formatAltitude(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  const m = Math.max(0, meters);
  if (m < 10_000) return `${Math.round(m).toLocaleString('en-US')} m`;
  return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
}
