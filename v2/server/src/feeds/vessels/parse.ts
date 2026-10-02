import type { Observation, PropValue } from '@gev/shared';
import { KNOT_TO_MPS } from '../flights/parse.ts';

export const LAYER = 'vessels';

/** Props that go into snapshots and history rows. */
export const VESSEL_COMPACT_KEYS = ['name', 'category', 'navStatus'] as const;

export interface VesselStatic {
  name?: string;
  callsign?: string;
  imo?: string;
  shipType?: number;
  destination?: string;
  /** "MM-DD HH:MMZ" (AIS carries no year). */
  eta?: string;
  length?: number;
  beam?: number;
  draught?: number;
}

export type ParsedAis = {
  mmsi: string;
  position?: Observation;
  static?: VesselStatic;
};

export const POSITION_TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'];
export const STATIC_TYPES = ['ShipStaticData', 'StaticDataReport'];
export const MESSAGE_TYPES = [...POSITION_TYPES, ...STATIC_TYPES];

const NAV_STATUS = [
  'Under way using engine',
  'At anchor',
  'Not under command',
  'Restricted manoeuvrability',
  'Constrained by draught',
  'Moored',
  'Aground',
  'Engaged in fishing',
  'Under way sailing',
  undefined,
  undefined,
  'Towing astern',
  'Pushing or towing alongside',
  undefined,
  'AIS-SART active',
];

/** ITU-R M.1371 ship type code -> readable category. */
export function shipCategory(code: number | undefined): string | undefined {
  if (code === undefined || !Number.isInteger(code) || code <= 0 || code > 99) return undefined;
  if (code >= 60 && code < 70) return 'Passenger';
  if (code >= 70 && code < 80) return 'Cargo';
  if (code >= 80 && code < 90) return 'Tanker';
  if (code >= 40 && code < 50) return 'High-speed craft';
  if (code >= 20 && code < 30) return 'Wing in ground';
  if (code >= 90) return 'Other';
  switch (code) {
    case 30:
      return 'Fishing';
    case 31:
    case 32:
    case 52:
      return 'Tug or towing';
    case 33:
    case 34:
      return 'Dredging or diving';
    case 35:
      return 'Military';
    case 36:
      return 'Sailing';
    case 37:
      return 'Pleasure craft';
    case 50:
      return 'Pilot';
    case 51:
      return 'Search and rescue';
    case 53:
      return 'Port tender';
    case 54:
      return 'Anti-pollution';
    case 55:
      return 'Law enforcement';
    case 58:
      return 'Medical transport';
    case 59:
      return 'Non-combatant';
    default:
      return 'Other';
  }
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** AIS text fields are padded with '@' and spaces. */
function aisText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/@+/g, ' ').trim().replace(/\s+/g, ' ');
  return t === '' ? undefined : t;
}

/** "2022-12-29 18:22:32.318353 +0000 UTC" -> epoch ms. */
export function parseAisTime(value: unknown, fallbackMs: number): number {
  if (typeof value !== 'string' || value === '') return fallbackMs;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?/);
  if (!m) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : fallbackMs;
  }
  const ms = Date.parse(`${m[1]}T${m[2]}.${(m[3] ?? '0').padEnd(3, '0').slice(0, 3)}Z`);
  return Number.isFinite(ms) ? ms : fallbackMs;
}

const MMSI_RE = /^\d{5,10}$/;

function mmsiOf(meta: Record<string, unknown>, msg: Record<string, unknown>): string | undefined {
  const raw = num(meta.MMSI) ?? num(msg.UserID) ?? num(msg.UserId) ?? num(msg.Mmsi);
  if (raw === undefined) return undefined;
  const s = String(Math.trunc(raw));
  return MMSI_RE.test(s) ? s : undefined;
}

function etaText(eta: unknown): string | undefined {
  const e = eta as { Month?: unknown; Day?: unknown; Hour?: unknown; Minute?: unknown } | null | undefined;
  if (!e || typeof e !== 'object') return undefined;
  const mo = num(e.Month);
  const d = num(e.Day);
  const h = num(e.Hour);
  const mi = num(e.Minute);
  // 0 month/day and 24:60 time are AIS "not available".
  if (mo === undefined || d === undefined || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const hh = h !== undefined && h >= 0 && h <= 23 ? h : undefined;
  const mm = mi !== undefined && mi >= 0 && mi <= 59 ? mi : undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(mo)}-${p(d)}` + (hh !== undefined && mm !== undefined ? ` ${p(hh)}:${p(mm)}Z` : '');
}

function dimensions(dim: unknown): { length?: number; beam?: number } {
  const d = dim as Record<string, unknown> | null | undefined;
  if (!d || typeof d !== 'object') return {};
  const [a, b, c, e] = [num(d.A), num(d.B), num(d.C), num(d.D)];
  const out: { length?: number; beam?: number } = {};
  if (a !== undefined && b !== undefined && a + b > 0) out.length = a + b;
  if (c !== undefined && e !== undefined && c + e > 0) out.beam = c + e;
  return out;
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

function staticFrom(msg: Record<string, unknown>, meta: Record<string, unknown>): VesselStatic {
  const reportA = (msg.ReportA ?? {}) as Record<string, unknown>;
  const reportB = (msg.ReportB ?? {}) as Record<string, unknown>;
  const type = num(msg.Type ?? msg.ShipType ?? reportB.ShipType);
  const imo = num(msg.ImoNumber ?? msg.IMO);
  const draught = num(msg.MaximumStaticDraught);
  return clean({
    name: aisText(msg.Name ?? msg.ShipName ?? reportA.Name) ?? aisText(meta.ShipName),
    callsign: aisText(msg.CallSign ?? reportB.CallSign),
    imo: imo !== undefined && imo > 0 ? String(Math.trunc(imo)) : undefined,
    shipType: type !== undefined && type > 0 && type <= 99 ? Math.trunc(type) : undefined,
    destination: aisText(msg.Destination),
    eta: etaText(msg.Eta),
    ...dimensions(msg.Dimension ?? reportB.Dimension),
    draught: draught !== undefined && draught > 0 ? draught : undefined,
  });
}

/** Static fields as Observation props (for merging into the live picture). */
export function staticProps(s: VesselStatic): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  if (s.name) out.name = s.name;
  if (s.callsign) out.callsign = s.callsign;
  if (s.imo) out.imo = s.imo;
  if (s.shipType !== undefined) {
    out.shipType = s.shipType;
    const cat = shipCategory(s.shipType);
    if (cat) out.category = cat;
  }
  if (s.destination) out.destination = s.destination;
  if (s.eta) out.eta = s.eta;
  if (s.length !== undefined) out.length = s.length;
  if (s.beam !== undefined) out.beam = s.beam;
  if (s.draught !== undefined) out.draught = s.draught;
  return out;
}

export function mergeStatic(prev: VesselStatic | undefined, next: VesselStatic): VesselStatic {
  return { ...prev, ...next };
}

/**
 * Decode one AISStream envelope. Returns null for anything that is not a
 * recognised AIS record with an MMSI (error frames, unknown types, junk).
 *
 * Sentinels: latitude 91 / longitude 181 (position unavailable), true heading
 * 511, speed over ground 102.3 kn, course over ground 360 degrees. Invalid
 * fields are dropped; a position report with an invalid position yields no
 * position.
 */
export function parseAisEnvelope(envelope: unknown, nowMs: number): ParsedAis | null {
  const env = envelope as { MessageType?: unknown; Message?: Record<string, unknown>; MetaData?: unknown; Metadata?: unknown } | null;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
  const type = env.MessageType;
  if (typeof type !== 'string' || !MESSAGE_TYPES.includes(type)) return null;
  const msg = env.Message?.[type] as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== 'object') return null;
  const meta = ((env.MetaData ?? env.Metadata) ?? {}) as Record<string, unknown>;
  const mmsi = mmsiOf(meta, msg);
  if (!mmsi) return null;

  const result: ParsedAis = { mmsi };
  const isPosition = POSITION_TYPES.includes(type);
  const hasStatic = STATIC_TYPES.includes(type) || type === 'ExtendedClassBPositionReport';
  if (hasStatic) {
    const s = staticFrom(msg, meta);
    if (Object.keys(s).length > 0) result.static = s;
  }
  if (!isPosition) return result;

  const lat = num(msg.Latitude) ?? num(meta.latitude) ?? num(meta.Latitude);
  const lon = num(msg.Longitude) ?? num(meta.longitude) ?? num(meta.Longitude);
  if (lat === undefined || lon === undefined || lat < -90 || lat > 90 || lon < -180 || lon > 180) return result;
  if (lat === 0 && lon === 0) return result; // null island: a common bad fix

  const sog = num(msg.Sog ?? msg.SOG);
  const cog = num(msg.Cog ?? msg.COG);
  const th = num(msg.TrueHeading ?? msg.Heading);
  const speedKn = sog !== undefined && sog >= 0 && sog < 102.3 ? sog : undefined;
  const course = cog !== undefined && cog >= 0 && cog < 360 ? cog : undefined;
  const heading = th !== undefined && th >= 0 && th < 360 ? th : undefined;
  const nav = num(msg.NavigationalStatus);

  const obs: Observation = {
    layer: LAYER,
    objectId: mmsi,
    t: Math.min(parseAisTime(meta.time_utc ?? meta.TimeUtc, nowMs), nowMs + 60_000),
    lon,
    lat,
    props: clean({
      navStatus: nav !== undefined ? NAV_STATUS[nav] : undefined,
      cog: course,
    }) as Record<string, PropValue>,
  };
  const hdg = heading ?? course;
  if (hdg !== undefined) obs.heading = hdg;
  if (speedKn !== undefined) obs.speed = Math.round(speedKn * KNOT_TO_MPS * 100) / 100;
  result.position = obs;
  return result;
}

/** Classify an error frame ({"error": "..."}) the way the original adapter did. */
export function classifyAisError(message: string): 'auth' | 'rate' | 'transport' {
  if (/(unauthori[sz]|forbidden|invalid\s*api[\s_-]*key|invalid\s*key|bad\s*api[\s_-]*key|authentic|api\s*key\s*(is\s*)?(invalid|required|missing|not\s*valid))/i.test(message)) return 'auth';
  if (/(rate[\s_-]*limit|too\s*many\s*(requests|connections)|quota\s*exceeded|429)/i.test(message)) return 'rate';
  return 'transport';
}
