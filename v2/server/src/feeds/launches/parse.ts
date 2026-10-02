import type { Feature, PropValue } from '@gev/shared';

export const LAYER = 'launches';

export type LaunchStatus = 'upcoming' | 'success' | 'failure' | 'partial';

/** What the server keeps per launch: a trimmed, normalised Launch Library 2 record. */
export interface LaunchRecord {
  id: string;
  /** Full LL2 name, "Falcon 9 Block 5 | Starlink Group 15-23". */
  name: string;
  /** Short label for the map. */
  label: string;
  status: LaunchStatus;
  /** LL2 status name, "Go for Launch", "Launch Successful", ... */
  statusName: string | null;
  net: number;
  netPrecision: string | null;
  windowStart: number | null;
  windowEnd: number | null;
  /** Launch probability in percent when given. */
  probability: number | null;
  failReason: string | null;
  holdReason: string | null;
  webcastLive: boolean;
  lastUpdated: number | null;
  provider: string | null;
  providerAbbrev: string | null;
  vehicle: string | null;
  mission: string | null;
  missionType: string | null;
  missionDescription: string | null;
  orbit: string | null;
  padName: string | null;
  locationName: string | null;
  country: string | null;
  lon: number;
  lat: number;
  infoUrls: Array<{ title: string | null; url: string }>;
  vidUrls: Array<{ title: string | null; url: string }>;
}

const str = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);
const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const time = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

/** Only http(s) links are passed on. */
function link(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 500) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function links(v: unknown): Array<{ title: string | null; url: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ title: string | null; url: string }> = [];
  for (const l of v.slice(0, 20) as Array<Record<string, unknown> | null>) {
    const url = link(l?.url);
    if (url) out.push({ title: str(l?.title, 120), url });
  }
  return out;
}

export function mapStatus(status: unknown): { status: LaunchStatus; name: string | null } {
  const s = status as { name?: unknown; abbrev?: unknown } | null;
  const abbrev = str(s?.abbrev)?.toLowerCase();
  const name = str(s?.name);
  const n = name?.toLowerCase() ?? '';
  if (abbrev === 'success' || n.includes('successful')) return { status: 'success', name };
  if (abbrev === 'partial failure' || n.includes('partial')) return { status: 'partial', name };
  if (abbrev === 'failure' || n.includes('failure')) return { status: 'failure', name };
  return { status: 'upcoming', name };
}

/** "Falcon 9 Block 5 | Starlink Group 15-23" -> "Starlink Group 15-23". */
export function shortName(name: string, mission: string | null): string {
  const bar = name.indexOf('|');
  const tail = bar >= 0 ? name.slice(bar + 1).trim() : '';
  return tail || mission || name;
}

/**
 * Normalise a Launch Library 2 (v2.3) list response. Launches without a time or
 * pad coordinates are skipped (they cannot be placed on the globe). The pad
 * position falls back to the location's. LL2 uses 0,0 for unknown pads; those
 * are skipped too. Throws when the payload is not a LL2 list.
 */
export function parseLaunches(payload: unknown): { launches: LaunchRecord[]; skipped: number } {
  const root = payload as { results?: unknown } | null;
  if (!root || !Array.isArray(root.results)) throw new Error('malformed Launch Library response');
  const out: LaunchRecord[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of root.results as Array<Record<string, any> | null>) {
    const id = str(raw?.id, 80);
    const name = str(raw?.name, 300);
    const net = time(raw?.net) ?? time(raw?.window_start);
    const pad = raw?.pad;
    const loc = pad?.location;
    const lat = finite(pad?.latitude) ?? finite(loc?.latitude);
    const lon = finite(pad?.longitude) ?? finite(loc?.longitude);
    if (!id || !name || net === null || lat === null || lon === null || seen.has(id) || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      skipped++;
      continue;
    }
    seen.add(id);
    const { status, name: statusName } = mapStatus(raw!.status);
    const mission = str(raw!.mission?.name, 200);
    const cfg = raw!.rocket?.configuration;
    const prob = finite(raw!.probability);
    out.push({
      id,
      name,
      label: shortName(name, mission),
      status,
      statusName,
      net,
      netPrecision: str(raw!.net_precision?.name, 40),
      windowStart: time(raw!.window_start),
      windowEnd: time(raw!.window_end),
      probability: prob !== null && prob >= 0 && prob <= 100 ? prob : null,
      failReason: str(raw!.failreason, 500),
      holdReason: str(raw!.holdreason, 500),
      webcastLive: raw!.webcast_live === true,
      lastUpdated: time(raw!.last_updated),
      provider: str(raw!.launch_service_provider?.name, 120),
      providerAbbrev: str(raw!.launch_service_provider?.abbrev, 20),
      vehicle: str(cfg?.full_name, 120) ?? str(cfg?.name, 120),
      mission,
      missionType: str(raw!.mission?.type, 80),
      missionDescription: str(raw!.mission?.description, 1500),
      orbit: str(raw!.mission?.orbit?.name, 120),
      padName: str(pad?.name, 160),
      locationName: str(loc?.name, 160),
      country: str(pad?.country?.name, 80) ?? str(loc?.country?.name, 80),
      lon,
      lat,
      infoUrls: links(raw!.info_urls),
      vidUrls: links(raw!.vid_urls),
    });
  }
  return { launches: out, skipped };
}

export function launchFeature(l: LaunchRecord): Feature {
  const props: Record<string, PropValue> = {
    part: 'pad',
    status: l.status,
    statusName: l.statusName,
    vehicle: l.vehicle,
    provider: l.provider,
    mission: l.mission,
    net: l.net,
  };
  return { id: l.id, geometry: { type: 'Point', coordinates: [l.lon, l.lat] }, t: l.net, label: l.label, props };
}
