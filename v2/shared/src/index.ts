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
  /**
   * How the client gets and draws the layer:
   * - 'tracked': moving objects via /snapshot, /objects, /track (flights, ships)
   * - 'features': events and shapes via /features (earthquakes, cyclones, launches)
   * - 'orbits': orbital elements via /elements, propagated client-side (satellites)
   */
  kind: LayerKind;
}

export type LayerKind = 'tracked' | 'features' | 'orbits';

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

// ---------------------------------------------------------------- features layers

/** GeoJSON geometry subset used by feature layers, coordinates [lon, lat(, alt m)]. */
export type FeatureGeometry =
  | { type: 'Point'; coordinates: [number, number] | [number, number, number] }
  | { type: 'LineString'; coordinates: Array<[number, number] | [number, number, number]> }
  | { type: 'MultiLineString'; coordinates: Array<Array<[number, number] | [number, number, number]>> }
  | { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };

export interface Feature {
  /** Stable id within the layer (USGS event id, storm id + part, launch id, ...). */
  id: string;
  geometry: FeatureGeometry;
  /** Epoch ms the feature describes (event time, forecast time), when meaningful. */
  t?: number;
  /** Display label for the map, short. */
  label?: string;
  /**
   * Compact props for styling/filtering. Vocabularies:
   * - earthquakes: mag, depthKm, place, tsunami, alert ('green'|'yellow'|'orange'|'red'|null),
   *   type ('earthquake', 'quarry blast', 'explosion', ...)
   * - cyclones: stormId, name, part ('track'|'forecast'|'cone'|'position'),
   *   intensityKt, gustKt, category, basin, movementDir, movementKt; forecast
   *   points are Point features with part 'forecast' and tauHours (the forecast
   *   line is a LineString with the same part). Multi-part cones are split into
   *   ids '<stormId>:cone', '<stormId>:cone:1', ...
   * - launches: status ('upcoming'|'success'|'failure'|'partial'), statusName,
   *   vehicle, provider, mission, part ('pad'), net (epoch ms)
   */
  props: Record<string, PropValue>;
}

/**
 * GET /api/layers/:id/features?bbox=w,s,e,n&from=<ms>&to=<ms>
 * Features intersecting bbox (world when omitted). `from`/`to` filter by
 * Feature.t where the layer is time-based; defaults are layer-specific
 * (earthquakes: last 24 h). With `to` in the past the response reflects what
 * was known then where history allows. 404 unknown layer, 409 off/needs-key.
 */
export interface FeaturesResponse {
  layer: string;
  feed: FeedStatus;
  features: Feature[];
  truncated: boolean;
}

/**
 * GET /api/layers/:id/features/:featureId
 * Detail for one feature, rendered like ObjectDetail.
 */
export interface FeatureDetail {
  layer: string;
  featureId: string;
  feature: Feature;
  title: string;
  subtitle: string | null;
  sections: DetailSection[];
  sources: string[];
  /** Link to the authoritative source page (USGS event page, NHC advisory, ...). */
  url?: string;
}

// ---------------------------------------------------------------- orbits layers

export interface OrbitalElements {
  /** NORAD catalog number as a string. */
  noradId: string;
  name: string;
  /** Grouping for filtering: 'stations', 'starlink', 'gps', 'weather', ... */
  group: string;
  /** Two-line element set. */
  tle1: string;
  tle2: string;
  /** Epoch ms of the element set. */
  epoch: number;
}

/**
 * GET /api/layers/:id/elements?group=<g>
 * Groups use CelesTrak names ('stations', 'gps-ops', 'glo-ops', ...); an
 * unknown group is 404. Without `group`, all groups with duplicates removed.
 * Current element sets (refreshed server-side at most every few hours per
 * CelesTrak's guidance). The client propagates positions with SGP4.
 */
export interface ElementsResponse {
  layer: string;
  feed: FeedStatus;
  groups: string[];
  elements: OrbitalElements[];
}

export interface ApiError {
  error: string;
}
