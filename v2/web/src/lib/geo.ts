const A = 6_378_137; // WGS84 semi-major axis, metres
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const RAD = Math.PI / 180;

/** Geodetic degrees and metres to Earth-fixed Cartesian metres; writes out[offset..offset+2]. */
export function lonLatAltToEcef(lonDeg: number, latDeg: number, altM: number, out: Float64Array, offset = 0): void {
  const lon = lonDeg * RAD;
  const lat = latDeg * RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  out[offset] = (n + altM) * cosLat * Math.cos(lon);
  out[offset + 1] = (n + altM) * cosLat * Math.sin(lon);
  out[offset + 2] = (n * (1 - E2) + altM) * sinLat;
}

/** Great-circle destination on a sphere: where you end up going `distM` along `headingDeg`. */
export function destination(lonDeg: number, latDeg: number, headingDeg: number, distM: number): { lon: number; lat: number } {
  const d = distM / 6_371_008;
  const lat1 = latDeg * RAD;
  const lon1 = lonDeg * RAD;
  const brg = headingDeg * RAD;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lon: ((((lon2 / RAD + 180) % 360) + 360) % 360) - 180, lat: lat2 / RAD };
}
