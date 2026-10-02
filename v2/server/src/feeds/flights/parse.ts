import type { Observation, PropValue } from '@gev/shared';

export const LAYER = 'flights';

export const KNOT_TO_MPS = 0.514444;
export const FOOT_TO_M = 0.3048;
/** feet per minute -> metres per second */
export const FPM_TO_MPS = 0.00508;

/** Props that go into snapshots and history rows. Everything else is detail-only. */
export const FLIGHT_COMPACT_KEYS = [
  'callsign',
  'registration',
  'typeCode',
  'category',
  'onGround',
  'squawk',
  'military',
] as const;

/** Props carried across updates when a later report omits them (both sources drop fields intermittently). */
export const FLIGHT_STICKY_KEYS = ['callsign', 'registration', 'typeCode', 'category', 'military', 'typeName', 'operator'] as const;

// ADS-B emitter category (adsb.lol "category") -> label.
const EMITTER: Record<string, string> = {
  A1: 'Light',
  A2: 'Small',
  A3: 'Large',
  A4: 'High vortex large',
  A5: 'Heavy',
  A6: 'High performance',
  A7: 'Rotorcraft',
  B1: 'Glider',
  B2: 'Lighter than air',
  B3: 'Parachutist',
  B4: 'Ultralight',
  B6: 'Drone',
  B7: 'Space vehicle',
  C1: 'Emergency vehicle',
  C2: 'Service vehicle',
  C3: 'Obstacle',
  C4: 'Obstacle',
  C5: 'Obstacle',
};

// OpenSky extended category integer -> label (0/1 mean no information).
const OPENSKY_CATEGORY: Record<number, string> = {
  2: 'Light',
  3: 'Small',
  4: 'Large',
  5: 'High vortex large',
  6: 'Heavy',
  7: 'High performance',
  8: 'Rotorcraft',
  9: 'Glider',
  10: 'Lighter than air',
  11: 'Parachutist',
  12: 'Ultralight',
  14: 'Drone',
  15: 'Space vehicle',
  16: 'Emergency vehicle',
  17: 'Service vehicle',
  18: 'Obstacle',
  19: 'Obstacle',
  20: 'Obstacle',
};

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function validPosition(lat: number | undefined, lon: number | undefined): lat is number {
  return lat !== undefined && lon !== undefined && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** Remove undefined entries so JSON stays compact. */
function clean(props: Record<string, PropValue | undefined>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

/** Normalise adsb.lol/readsb `type` (message source) to a small vocabulary. */
export function adsbPositionSource(type: unknown): string | undefined {
  const t = text(type)?.toLowerCase();
  if (!t) return undefined;
  if (t.includes('mlat')) return 'mlat';
  if (t.includes('tisb')) return 'tisb';
  if (t.includes('adsc')) return 'adsc';
  if (t.includes('adsb') || t.includes('adsr')) return 'adsb';
  if (t.includes('mode_s')) return 'modes';
  return 'other';
}

/**
 * Parse an adsb.lol / readsb-style response ({ now, ac: [...] }).
 * Units on the wire: altitudes in feet, gs in knots, rates in ft/min, track in
 * degrees, `seen_pos` in seconds. Aircraft without a valid position are skipped.
 * `military` marks every row (the /v2/mil endpoint); rows with dbFlags bit 0 set
 * are military regardless.
 */
export function parseAdsbLol(
  payload: unknown,
  fallbackNowMs: number,
  opts: { military?: boolean } = {},
): Observation[] {
  const p = payload as { now?: unknown; ac?: unknown } | null;
  const list = Array.isArray(p?.ac) ? (p!.ac as Record<string, unknown>[]) : [];
  const rawNow = num(p?.now);
  // Older readsb builds report epoch seconds, newer ones milliseconds.
  const nowMs = rawNow === undefined ? fallbackNowMs : rawNow > 1e11 ? rawNow : rawNow * 1000;

  const out: Observation[] = [];
  for (const ac of list) {
    if (!ac || typeof ac !== 'object') continue;
    const hex = text(ac.hex)?.toLowerCase();
    const lat = num(ac.lat);
    const lon = num(ac.lon);
    if (!hex || !validPosition(lat, lon) || lon === undefined) continue;

    const seenPos = Math.max(0, num(ac.seen_pos) ?? num(ac.seen) ?? 0);
    const onGround = ac.alt_baro === 'ground';
    const altBaroFt = onGround ? undefined : num(ac.alt_baro);
    const altGeomFt = onGround ? undefined : num(ac.alt_geom);
    const gs = num(ac.gs);
    const vrateFpm = num(ac.baro_rate) ?? num(ac.geom_rate);
    const heading = num(ac.track) ?? num(ac.true_heading);
    const dbFlags = num(ac.dbFlags) ?? 0;
    const military = opts.military === true || (dbFlags & 1) === 1;
    const category = text(ac.category);

    const o: Observation = {
      layer: LAYER,
      objectId: hex,
      t: Math.round(nowMs - seenPos * 1000),
      lon,
      lat,
      props: clean({
        callsign: text(ac.flight),
        registration: text(ac.r),
        typeCode: text(ac.t),
        category: category ? (EMITTER[category.toUpperCase()] ?? undefined) : undefined,
        onGround: onGround ? true : false,
        squawk: text(ac.squawk),
        military: military ? true : undefined,
        // detail-only
        typeName: text(ac.desc),
        operator: text(ac.ownOp),
        altBaro: altBaroFt === undefined ? undefined : round(altBaroFt * FOOT_TO_M, 1),
        altGeom: altGeomFt === undefined ? undefined : round(altGeomFt * FOOT_TO_M, 1),
        vrate: vrateFpm === undefined ? undefined : round(vrateFpm * FPM_TO_MPS, 2),
        posSrc: adsbPositionSource(ac.type),
        src: 'adsb.lol',
      }),
    };
    const alt = altGeomFt ?? altBaroFt;
    if (alt !== undefined) o.alt = round(alt * FOOT_TO_M, 1);
    if (heading !== undefined) o.heading = normHeading(heading);
    if (gs !== undefined) o.speed = round(gs * KNOT_TO_MPS, 2);
    out.push(o);
  }
  return out;
}

const OPENSKY_POSITION_SOURCE = ['adsb', 'asterix', 'mlat', 'flarm'];

/**
 * Parse an OpenSky /states/all?extended=1 response ({ time, states: [[...]] }).
 * Units on the wire are already SI: metres, m/s, degrees, epoch seconds.
 * Index: 0 icao24, 1 callsign, 2 origin_country, 3 time_position, 4 last_contact,
 * 5 lon, 6 lat, 7 baro_altitude, 8 on_ground, 9 velocity, 10 true_track,
 * 11 vertical_rate, 12 sensors, 13 geo_altitude, 14 squawk, 15 spi,
 * 16 position_source, 17 category.
 */
export function parseOpenSky(payload: unknown, fallbackNowMs: number): Observation[] {
  const p = payload as { time?: unknown; states?: unknown } | null;
  const states = Array.isArray(p?.states) ? (p!.states as unknown[][]) : [];
  const time = num(p?.time);
  const respMs = time === undefined ? fallbackNowMs : time * 1000;

  const out: Observation[] = [];
  for (const s of states) {
    if (!Array.isArray(s)) continue;
    const hex = text(s[0])?.toLowerCase();
    const lon = num(s[5]);
    const lat = num(s[6]);
    if (!hex || !validPosition(lat, lon) || lon === undefined) continue;

    const timePos = num(s[3]);
    const lastContact = num(s[4]);
    const tSec = timePos ?? lastContact;
    const onGround = s[8] === true;
    const baro = onGround ? undefined : num(s[7]);
    const geo = onGround ? undefined : num(s[13]);
    const velocity = num(s[9]);
    const track = num(s[10]);
    const vrate = num(s[11]);
    const catNum = num(s[17]);
    const psrc = num(s[16]);

    const o: Observation = {
      layer: LAYER,
      objectId: hex,
      t: tSec === undefined ? Math.round(respMs) : Math.round(tSec * 1000),
      lon,
      lat,
      props: clean({
        callsign: text(s[1]),
        category: catNum === undefined ? undefined : OPENSKY_CATEGORY[catNum],
        onGround,
        squawk: text(s[14]),
        country: text(s[2]),
        altBaro: baro === undefined ? undefined : round(baro, 1),
        altGeom: geo === undefined ? undefined : round(geo, 1),
        vrate: vrate === undefined ? undefined : round(vrate, 2),
        posSrc: psrc === undefined ? undefined : OPENSKY_POSITION_SOURCE[psrc],
        src: 'OpenSky Network',
      }),
    };
    const alt = geo ?? baro;
    if (alt !== undefined) o.alt = round(alt, 1);
    if (track !== undefined) o.heading = normHeading(track);
    if (velocity !== undefined) o.speed = round(velocity, 2);
    out.push(o);
  }
  return out;
}

function normHeading(deg: number): number {
  return round(((deg % 360) + 360) % 360, 1) % 360;
}

function round(v: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}
