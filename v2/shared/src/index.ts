// Contract between @gev/server and @gev/web. Both sides import these types;
// change them here first, then update both implementations.

/**
 * WGS84 bounding box in degrees: [west, south, east, north].
 * west > east means the box crosses the antimeridian; clients must handle it.
 */
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
  /** Implemented, but its feed is not enabled in server config (FEEDS). */
  | 'disabled'
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
// 400 ApiError for an empty or over-long query; 502 ApiError when every
// provider failed (show "search unavailable", not "no results").

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
  props: Record<string, PropValue>;
}

/**
 * Values a feed may put in Observation.props. Keep snapshot props small.
 * Snapshot prop vocabularies:
 * - flights: callsign, registration, typeCode, category (Light, Small, Large,
 *   Heavy, High performance, Rotorcraft, Glider, Lighter than air, UAV, ...),
 *   onGround (always boolean), squawk, military.
 * - vessels: name, callsign, category (Cargo, Tanker, Passenger, Fishing, Tug,
 *   Pleasure craft, ...), navStatus, destination.
 */
export type PropValue = string | number | boolean | null;

// ---------------------------------------------------------------- /api/feeds

export type FeedState =
  /** Last fetch succeeded within the feed's freshness window. */
  | 'live'
  /** Running, but the newest data is older than the freshness window. */
  | 'stale'
  /** Last attempt failed; see lastError. Older data may still be served. */
  | 'error'
  /** Feed not running (not enabled in server config). */
  | 'off'
  /** Feed needs a key that is not configured. */
  | 'needs-key';

export interface FeedStatus {
  layer: string;
  state: FeedState;
  /** Upstream currently in use, e.g. 'OpenSky' or 'adsb.lol'. */
  source: string | null;
  /** Epoch ms of the last successful fetch / message. */
  lastSuccess: number | null;
  lastError: string | null;
  /** Objects in the most recent snapshot. */
  count: number;
  /** Data older than this many ms counts as stale for this feed. */
  freshnessMs: number;
}

/** GET /api/feeds */
export interface FeedsResponse {
  feeds: FeedStatus[];
}

// ---------------------------------------------------------------- /api/layers/:id/...

/**
 * GET /api/layers/:id/snapshot?bbox=w,s,e,n&at=<epoch ms>
 * Latest observation per object inside bbox (whole world when omitted). With
 * `at`, the latest observation per object at or before `at` within the layer's
 * lookback window (historical view); without it, the live picture.
 * 404 for an unknown layer, 409 with ApiError when the feed is off or needs a key.
 */
export interface LayerSnapshot {
  layer: string;
  /** The instant this snapshot describes (epoch ms). */
  at: number;
  /** True when `at` was requested (historical), false for live. */
  historical: boolean;
  feed: FeedStatus;
  /** Snapshot props are a compact subset (label, type, ...); see the detail endpoint. */
  objects: Observation[];
  /** True when the server capped the result; zoom in for the rest. */
  truncated: boolean;
}

/**
 * GET /api/layers/:id/objects/:objectId?at=<epoch ms>
 * Full detail for one object: its latest observation (at or before `at`) with
 * all known props, plus enrichment where the feed supports it.
 */
export interface ObjectDetail {
  layer: string;
  objectId: string;
  observation: Observation;
  /** Human-readable display title, e.g. callsign or vessel name. */
  title: string;
  subtitle: string | null;
  /** Ordered, labelled groups for the detail panel. */
  sections: DetailSection[];
  /** Upstream sources that contributed. */
  sources: string[];
  /** True when the object is in the feed's current live picture. */
  live?: boolean;
}

export interface DetailSection {
  title: string;
  rows: DetailRow[];
}

export interface DetailRow {
  label: string;
  value: PropValue;
  /** Optional unit or secondary text, rendered muted. */
  hint?: string;
  /** Render the value in the mono font (ids, coordinates, codes). */
  mono?: boolean;
}

/**
 * GET /api/layers/:id/objects/:objectId/track?from=<ms>&to=<ms>
 * Recorded positions, oldest first. Defaults: last 6 hours.
 */
export interface Track {
  layer: string;
  objectId: string;
  /** [epoch ms, lon, lat, alt metres or null] */
  points: Array<[t: number, lon: number, lat: number, alt: number | null]>;
}

/**
 * GET /api/history/range
 * Time span covered by recorded history, for the time slider.
 */
export interface HistoryRange {
  /** Epoch ms of the oldest stored observation, or null when empty. */
  from: number | null;
  to: number | null;
  /** How long history is kept, in ms. */
  retentionMs: number;
}

export interface ApiError {
  error: string;
}
