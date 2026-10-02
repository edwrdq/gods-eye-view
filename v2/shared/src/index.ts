// Contract between @gev/server and @gev/web. Both sides import these types;
// change them here first, then update both implementations.

/** WGS84 bounding box in degrees: [west, south, east, north]. */
export type BBox = [west: number, south: number, east: number, north: number];

export interface LonLat {
  lon: number;
  lat: number;
}

// ---------------------------------------------------------------- /api/health

export interface HealthResponse {
  ok: true;
  version: string;
  uptimeS: number;
  db: { path: string; sizeBytes: number };
}

// ---------------------------------------------------------------- /api/config

/** Browser-safe configuration. Never includes server-only secrets. */
export interface ClientConfig {
  /** Google Maps Platform key for Photorealistic 3D Tiles, or null when unset. */
  googleMapsApiKey: string | null;
  /** Cesium ion token for terrain/imagery, or null when unset. */
  cesiumIonToken: string | null;
  layers: LayerDescriptor[];
}

export type LayerCategory =
  | 'air'
  | 'sea'
  | 'space'
  | 'hazards'
  | 'weather'
  | 'infrastructure'
  | 'ground'
  | 'signals';

export type LayerStatus =
  /** Implemented and usable. */
  | 'available'
  /** Implemented but missing a required key. */
  | 'needs-key'
  /** Planned for v2, not yet ported. */
  | 'planned';

export interface LayerDescriptor {
  id: string;
  name: string;
  category: LayerCategory;
  description: string;
  status: LayerStatus;
  /** Name of the env var needed when status is 'needs-key'. */
  requiredKey?: string;
  /** Upstream data source(s), for attribution and freshness display. */
  sources: string[];
}

// ---------------------------------------------------------------- /api/geocode?q=

export interface GeocodeResult {
  label: string;
  /** Secondary line, e.g. region and country. */
  detail?: string;
  lon: number;
  lat: number;
  /** Suggested view extent when the place has one. */
  bbox?: BBox;
  kind: 'coordinates' | 'place' | 'address' | 'poi';
  source: 'local' | 'photon' | 'nominatim';
}

export interface GeocodeResponse {
  query: string;
  results: GeocodeResult[];
}

// ---------------------------------------------------------------- feed records (phase 2+)

/** One observation of a tracked object, as stored in history. */
export interface Observation {
  layer: string;
  /** Stable id within the layer (ICAO hex, MMSI, NORAD id, ...). */
  objectId: string;
  /** Epoch milliseconds when the source observed it. */
  t: number;
  lon: number;
  lat: number;
  /** Metres above WGS84 ellipsoid, when known. */
  alt?: number;
  /** Degrees clockwise from true north, when known. */
  heading?: number;
  /** Metres per second, when known. */
  speed?: number;
  props: Record<string, string | number | boolean | null>;
}

export interface ApiError {
  error: string;
}
