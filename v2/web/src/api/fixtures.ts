// Synthetic feeds for developing without a server (VITE_FIXTURES=1 or ?bench=N).
// Every object follows a deterministic great-circle path, so live snapshots,
// historical snapshots, details and tracks all agree with each other.
import type { ClientConfig, DetailRow, FeedState, FeedStatus, HistoryRange, LayerDescriptor, LayerSnapshot, Observation, ObjectDetail, Track } from '@gev/shared';
import { bboxHasPoint } from '../lib/bbox.ts';
import { destination } from '../lib/geo.ts';
import { ApiRequestError, type ApiConfig, type Params } from './client.ts';

const HOUR = 3_600_000;

interface Kind {
  count: (cfg: ApiConfig) => number;
  speed: [number, number];
  alt: [number, number] | null;
  freshnessMs: number;
  refreshMs: number;
  source: string;
}

const KINDS: Record<string, Kind> = {
  flights: { count: (c) => (c.bench || 700), speed: [180, 260], alt: [6000, 12000], freshnessMs: 30_000, refreshMs: 10_000, source: 'adsb.lol' },
  'military-flights': { count: (c) => (c.bench ? Math.max(40, Math.floor(c.bench / 60)) : 45), speed: [150, 300], alt: [3000, 13000], freshnessMs: 60_000, refreshMs: 15_000, source: 'adsb.lol' },
  vessels: { count: (c) => (c.bench || 320), speed: [3, 11], alt: null, freshnessMs: 120_000, refreshMs: 30_000, source: 'AISStream' },
};

// Regions as [lon, lat, spread-degrees, weight]. Aircraft over land and air corridors, ships on sea lanes.
const AIR_REGIONS: Array<[number, number, number, number]> = [
  [-98, 38, 16, 5], [-80, 33, 8, 3], [-122, 38, 5, 2], [8, 49, 11, 6], [-1, 52, 4, 2], [37, 52, 12, 1.5],
  [116, 35, 12, 3], [139, 36, 4, 2], [77, 22, 9, 2], [-45, 50, 14, 1.5], [151, -33, 5, 1], [-47, -15, 9, 1], [55, 25, 8, 1.5],
];
const SEA_REGIONS: Array<[number, number, number, number]> = [
  [-40, 35, 25, 3], [-150, 30, 25, 2], [5, 38, 6, 2], [60, 12, 15, 2], [113, 15, 9, 3], [3, 52, 4, 2], [-75, 36, 6, 1.5], [125, 30, 8, 2],
];

/** Deterministic hash to [0, 1). */
function rnd(i: number, k: number): number {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

function gauss(i: number, k: number): number {
  return (rnd(i, k) + rnd(i, k + 1) + rnd(i, k + 2) - 1.5) * 2;
}

interface Params0 {
  lon: number;
  lat: number;
  heading: number;
  speed: number;
  alt: number | null;
  offsetS: number;
}

function params0(layer: string, i: number): Params0 {
  const kind = KINDS[layer]!;
  const sea = layer === 'vessels';
  const regions = sea ? SEA_REGIONS : AIR_REGIONS;
  const total = regions.reduce((a, r) => a + r[3], 0);
  let pick = rnd(i, 1) * total;
  let region = regions[0]!;
  for (const r of regions) {
    pick -= r[3];
    if (pick <= 0) {
      region = r;
      break;
    }
  }
  return {
    lon: region[0] + gauss(i, 2) * region[2],
    lat: Math.max(-70, Math.min(75, region[1] + gauss(i, 5) * region[2] * 0.6)),
    heading: rnd(i, 8) * 360,
    speed: kind.speed[0] + rnd(i, 9) * (kind.speed[1] - kind.speed[0]),
    alt: kind.alt ? kind.alt[0] + rnd(i, 10) * (kind.alt[1] - kind.alt[0]) : null,
    offsetS: rnd(i, 11) * 14_400,
  };
}

/** Objects shuttle back and forth along a line (out for a while, then back), so they stay near their region. */
function positionAt(p: Params0, t: number, layer: string): { lon: number; lat: number; heading: number } {
  const leg = layer === 'vessels' ? 7200 : 2400; // seconds per leg
  const s = (t / 1000 + p.offsetS) % (2 * leg);
  const out = s < leg;
  const d = out ? s : 2 * leg - s;
  const pos = destination(p.lon, p.lat, p.heading, p.speed * d);
  return { ...pos, heading: out ? p.heading : (p.heading + 180) % 360 };
}

const AIRLINES = ['UAL', 'DAL', 'AAL', 'SWA', 'BAW', 'DLH', 'AFR', 'KLM', 'UAE', 'QFA', 'ANA', 'JAL', 'RYR', 'EZY', 'ACA'];
const AIRCRAFT: Array<[string, string]> = [['B738', 'Boeing 737-800'], ['A320', 'Airbus A320'], ['B739', 'Boeing 737-900ER'], ['A359', 'Airbus A350-900'], ['B77W', 'Boeing 777-300ER'], ['E190', 'Embraer 190'], ['A21N', 'Airbus A321neo']];
const MIL_TYPES: Array<[string, string]> = [['C17', 'Boeing C-17A Globemaster III'], ['K35R', 'Boeing KC-135R Stratotanker'], ['P8', 'Boeing P-8A Poseidon'], ['E3CF', 'Boeing E-3 Sentry']];
const SHIP_NAMES = ['MAERSK', 'EVER', 'MSC', 'COSCO', 'CMA CGM', 'ONE', 'NORDIC', 'PACIFIC', 'ATLANTIC', 'STAR'];
const SHIP_TYPES = ['Container ship', 'Bulk carrier', 'Tanker', 'Cargo ship', 'Passenger ship'];
const pickOf = <T>(arr: readonly T[], i: number, k: number): T => arr[Math.floor(rnd(i, k) * arr.length)]!;

function objectId(layer: string, i: number): string {
  if (layer === 'vessels') return String(200_000_000 + ((i * 7919) % 500_000_000));
  const base = layer === 'military-flights' ? 0xae0000 : 0xa00000;
  return (base + ((i * 7919) % 0xfff00)).toString(16);
}

function labelOf(layer: string, i: number): string {
  if (layer === 'vessels') return `${pickOf(SHIP_NAMES, i, 20)} ${100 + Math.floor(rnd(i, 21) * 900)}`;
  if (layer === 'military-flights') return `${pickOf(['RCH', 'NATO', 'KING', 'REACH', 'FORTE'], i, 22)}${Math.floor(rnd(i, 23) * 99)}`;
  return `${pickOf(AIRLINES, i, 24)}${100 + Math.floor(rnd(i, 25) * 8900)}`;
}

function indexOfId(layer: string, id: string, cfg: ApiConfig): number {
  const n = KINDS[layer]!.count(cfg);
  // ids are a bijection of the index within a layer; scan is fine for fixtures.
  for (let i = 0; i < n; i++) if (objectId(layer, i) === id) return i;
  return -1;
}

function observe(layer: string, i: number, t: number, full: boolean): Observation {
  const p = params0(layer, i);
  const pos = positionAt(p, t, layer);
  const obs: Observation = {
    layer,
    objectId: objectId(layer, i),
    t: t - Math.floor(rnd(i, 30) * 4000),
    lon: pos.lon,
    lat: pos.lat,
    heading: Math.round(pos.heading * 10) / 10,
    speed: Math.round(p.speed * 10) / 10,
    props: layer === 'vessels' ? { name: labelOf(layer, i) } : { callsign: labelOf(layer, i), military: layer === 'military-flights', onGround: false },
  };
  if (p.alt !== null) obs.alt = Math.round(p.alt);
  if (full) {
    if (layer === 'vessels') obs.props = { ...obs.props, category: pickOf(SHIP_TYPES, i, 40), navStatus: 'Under way using engine', destination: 'ROTTERDAM' };
    else obs.props = { ...obs.props, typeCode: pickOf(layer === 'flights' ? AIRCRAFT : MIL_TYPES, i, 41)[0], squawk: String(1000 + Math.floor(rnd(i, 42) * 6000)) };
  }
  return obs;
}

function feedStatus(layer: string, now: number, cfg: ApiConfig): FeedStatus {
  const kind = KINDS[layer]!;
  const state = (cfg.feedStates[layer] ?? 'live') as FeedState;
  let lastSuccess = Math.floor(now / kind.refreshMs) * kind.refreshMs;
  if (state === 'stale') lastSuccess = now - 14 * 60_000;
  if (state === 'error') lastSuccess = now - 5 * 60_000;
  return {
    layer,
    state,
    source: kind.source,
    lastSuccess,
    lastError: state === 'error' ? 'Source timed out.' : null,
    count: kind.count(cfg),
    freshnessMs: kind.freshnessMs,
  };
}

const CONFIG_LAYERS: LayerDescriptor[] = [
  { id: 'flights', name: 'Flights', category: 'air', description: 'Live positions of aircraft that broadcast ADS-B, with altitude, speed and heading.', status: 'available', sources: ['adsb.lol'] },
  { id: 'military-flights', name: 'Military flights', category: 'air', description: 'Aircraft flagged as military in public ADS-B data, shown apart from civil traffic.', status: 'available', sources: ['adsb.lol'] },
  { id: 'vessels', name: 'Ships', category: 'sea', description: 'Live ship positions from AIS transponders, with vessel type, course and speed.', status: 'available', sources: ['AISStream'] },
  { id: 'satellites', name: 'Satellites', category: 'space', description: 'Orbiting satellites computed from public orbital elements, grouped by purpose.', status: 'planned', sources: ['CelesTrak'] },
  { id: 'earthquakes', name: 'Earthquakes', category: 'hazards', description: 'Earthquakes from the last 24 hours, sized by magnitude.', status: 'planned', sources: ['USGS'] },
  { id: 'fires', name: 'Active fires', category: 'hazards', description: 'Satellite fire detections from the last 24 hours.', status: 'needs-key', requiredKey: 'FIRMS_MAP_KEY', sources: ['NASA FIRMS'] },
  { id: 'weather', name: 'Observed weather', category: 'weather', description: 'Current conditions from weather stations worldwide.', status: 'planned', sources: [] },
];

export function fixtureConfig(): ClientConfig {
  return { googleMapsApiKey: null, cesiumIonToken: null, layers: CONFIG_LAYERS };
}

function detailFor(layer: string, i: number, t: number): ObjectDetail {
  const obs = observe(layer, i, t, true);
  const label = String(obs.props.callsign ?? obs.props.name);
  const kind = KINDS[layer]!;
  const rows = (r: DetailRow[]) => r;
  const lat = obs.lat;
  const lon = obs.lon;
  const hemi = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const hemiLon = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
  const heading = obs.heading ?? 0;
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = dirs[Math.round(heading / 22.5) % 16]!;
  const knots = Math.round((obs.speed ?? 0) * 1.94384);
  const sections: ObjectDetail['sections'] = [
    {
      title: 'Position',
      rows: rows([
        { label: 'Latitude', value: hemi, mono: true },
        { label: 'Longitude', value: hemiLon, mono: true },
        ...(obs.alt !== undefined ? [{ label: 'Altitude', value: `${obs.alt.toLocaleString('en-US')} m`, hint: `FL${Math.round((obs.alt * 3.28084) / 100)} · barometric` }] : []),
        { label: layer === 'vessels' ? 'Speed over ground' : 'Ground speed', value: `${knots} kt`, hint: `${Math.round((obs.speed ?? 0) * 3.6)} km/h` },
        { label: layer === 'vessels' ? 'Course' : 'Heading', value: `${Math.round(heading).toString().padStart(3, '0')}°`, hint: compass },
      ]),
    },
  ];
  let title = label;
  let subtitle: string | null;
  if (layer === 'vessels') {
    subtitle = `${String(obs.props.category)} · MMSI ${obs.objectId}`;
    sections.push({ title: 'Vessel', rows: rows([{ label: 'Name', value: label }, { label: 'MMSI', value: obs.objectId, mono: true }, { label: 'Type', value: String(obs.props.category) }]) });
  } else {
    const [code, name] = pickOf(layer === 'flights' ? AIRCRAFT : MIL_TYPES, i, 41);
    const reg = layer === 'flights' ? `N${10000 + Math.floor(rnd(i, 43) * 89999)}` : null;
    subtitle = [name, reg, layer === 'military-flights' ? 'Military' : pickOf(['United Airlines', 'Delta Air Lines', 'Lufthansa', 'Emirates', 'Ryanair'], i, 44)].filter(Boolean).join(' · ');
    sections.push({
      title: 'Aircraft',
      rows: rows([
        ...(reg ? [{ label: 'Registration', value: reg, mono: true }] : []),
        { label: 'Type', value: name, hint: code, mono: false },
        { label: 'ICAO address', value: obs.objectId.toUpperCase(), mono: true },
        { label: 'Squawk', value: String(obs.props.squawk), mono: true },
      ]),
    });
  }
  title = label;
  sections.push({
    title: 'Source',
    rows: rows([
      { label: 'Feed', value: kind.source },
      { label: 'Position', value: layer === 'vessels' ? 'Reported by vessel' : 'Reported by aircraft', hint: 'not estimated' },
    ]),
  });
  return { layer, objectId: obs.objectId, observation: obs, title, subtitle, sections, sources: [kind.source], live: true };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Route a /api path to a synthetic response. Throws ApiRequestError like the real client. */
export async function handleFixture(path: string, params: Params, cfg: ApiConfig): Promise<unknown> {
  const now = Date.now();
  if (path === '/feeds') return { feeds: Object.keys(KINDS).map((l) => feedStatus(l, now, cfg)) };
  if (path === '/history/range') {
    const range: HistoryRange = { from: now - 3 * HOUR, to: now, retentionMs: 24 * HOUR };
    return range;
  }
  const m = /^\/layers\/([^/]+)(?:\/(snapshot)|\/objects\/([^/]+)(?:\/(track))?)$/.exec(path);
  if (!m) throw new ApiRequestError('not-found', 404, 'Unknown route');
  const layer = decodeURIComponent(m[1]!);
  const kind = KINDS[layer];
  if (!kind) throw new ApiRequestError('not-found', 404, 'Unknown layer');
  const state = cfg.feedStates[layer];
  if (state === 'off' || state === 'needs-key') throw new ApiRequestError('unavailable', 409, 'This feed is not running.');
  const at = params.at !== undefined ? Number(params.at) : null;
  const t = at ?? now;
  if (m[2]) {
    const box = typeof params.bbox === 'string' ? (params.bbox.split(',').map(Number) as [number, number, number, number]) : null;
    const n = kind.count(cfg);
    const objects: Observation[] = [];
    for (let i = 0; i < n; i++) {
      const o = observe(layer, i, t, false);
      if (bboxHasPoint(box, o.lon, o.lat)) objects.push(o);
    }
    if (!cfg.bench) await delay(60);
    const snap: LayerSnapshot = { layer, at: t, historical: at !== null, feed: feedStatus(layer, now, cfg), objects, truncated: false };
    return snap;
  }
  const i = indexOfId(layer, decodeURIComponent(m[3]!), cfg);
  if (i < 0) throw new ApiRequestError('not-found', 404, 'Object not found');
  if (!m[4]) {
    await delay(120);
    return detailFor(layer, i, t);
  }
  const to = params.to !== undefined ? Number(params.to) : t;
  const from = params.from !== undefined ? Number(params.from) : to - 6 * HOUR;
  const p = params0(layer, i);
  const points: Track['points'] = [];
  const step = Math.max(60_000, Math.floor((to - from) / 400));
  for (let ts = from; ts <= to; ts += step) {
    const pos = positionAt(p, ts, layer);
    points.push([ts, pos.lon, pos.lat, p.alt]);
  }
  await delay(80);
  return { layer, objectId: objectId(layer, i), points } satisfies Track;
}
