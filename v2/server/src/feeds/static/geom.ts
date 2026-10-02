const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Length of a polyline in km. */
export function lineLengthKm(coords: ReadonlyArray<readonly number[]>): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1]![0]!, coords[i - 1]![1]!, coords[i]![0]!, coords[i]![1]!);
  return km;
}

export interface RingInfo {
  lon: number;
  lat: number;
  /** Planar area in m2 (equirectangular around the ring; fine for building-sized rings). */
  areaM2: number;
}

/** Area-weighted centroid and area of one ring; falls back to the box centre for degenerate rings. */
export function ringInfo(ring: ReadonlyArray<readonly number[]>): RingInfo | null {
  if (ring.length === 0) return null;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of ring) {
    if (p[0]! < minLon) minLon = p[0]!;
    if (p[0]! > maxLon) maxLon = p[0]!;
    if (p[1]! < minLat) minLat = p[1]!;
    if (p[1]! > maxLat) maxLat = p[1]!;
  }
  const midLat = (minLat + maxLat) / 2;
  const kx = 111_320 * Math.cos(rad(midLat));
  const ky = 110_574;
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const x0 = (p[0]! - minLon) * kx;
    const y0 = (p[1]! - minLat) * ky;
    const x1 = (q[0]! - minLon) * kx;
    const y1 = (q[1]! - minLat) * ky;
    const cross = x0 * y1 - x1 * y0;
    a2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  const centre = { lon: (minLon + maxLon) / 2, lat: midLat };
  if (Math.abs(a2) < 1e-6) return { ...centre, areaM2: 0 };
  return { lon: minLon + cx / (3 * a2) / kx, lat: minLat + cy / (3 * a2) / ky, areaM2: Math.abs(a2) / 2 };
}
