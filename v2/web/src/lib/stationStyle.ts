/** Bikeshare and radio marker encodings (see DESIGN.md, "Phase 3 map encodings"). */

// --- bikeshare: ground category, hexagon used as a gauge

export type BikeState = 'ok' | 'empty' | 'full' | 'offline' | 'unknown';

/**
 * How a station is drawn. 'level' is the gauge: the share of the hexagon filled from the
 * bottom is the share of docks holding a bike, in five steps. 'dot' is a station with bikes
 * but no dock count to measure them against. 'offline' and 'nodata' are the dashed forms.
 */
export type BikeForm = { form: 'level'; level: 0 | 1 | 2 | 3 | 4 } | { form: 'dot' } | { form: 'offline' } | { form: 'nodata' };

/** Fill height of each gauge step, as a share of the hexagon's height. 0 is empty (no bike), 4 is solid (no free dock). */
export const BIKE_LEVEL_FILL: Readonly<Record<0 | 1 | 2 | 3 | 4, number>> = { 0: 0, 1: 0.3, 2: 0.5, 3: 0.72, 4: 1 };

export function isBikeState(v: string): v is BikeState {
  return v === 'ok' || v === 'empty' || v === 'full' || v === 'offline' || v === 'unknown';
}

/**
 * The marker form for a station. The two ends of the gauge always mean something is
 * wrong for a rider (nothing to take, nowhere to return), so a station with even one bike
 * or one free dock never reads as empty or solid: the middle steps start at 1 and stop at 3.
 */
export function bikeForm(state: string, fill: number): BikeForm {
  if (state === 'offline') return { form: 'offline' };
  if (state === 'empty') return { form: 'level', level: 0 };
  if (state === 'full') return { form: 'level', level: 4 };
  if (state === 'ok') {
    if (!Number.isFinite(fill)) return { form: 'dot' };
    return { form: 'level', level: Math.max(1, Math.min(3, Math.round(fill * 4))) as 1 | 2 | 3 };
  }
  return { form: 'nodata' };
}

/** Marker diameter in px: a little larger for big stations, so a hub reads as one. */
export function bikePx(capacity: number): number {
  if (!Number.isFinite(capacity)) return 15;
  return capacity >= 40 ? 18 : capacity >= 20 ? 16 : 14;
}

/** Draw order (lower first): the stations that need attention end up on top. */
export function bikeOrder(state: string): number {
  switch (state) {
    case 'offline':
      return 0;
    case 'unknown':
      return 1;
    case 'ok':
      return 2;
    default:
      return 3;
  }
}

/** Key for the marker image; one image per form and size. */
export function bikeKey(f: BikeForm, px: number, color: string): string {
  const v = f.form === 'level' ? `l${f.level}` : f.form;
  return `gev-bike:${v}:${px}:${color}`;
}

export const BIKE_STATE_WORDS: Record<BikeState, string> = {
  ok: 'Bikes and free docks',
  empty: 'No bike to take',
  full: 'No dock free',
  offline: 'Out of service',
  unknown: 'No reading',
};

// --- radio: signals category, ring

/** Ring diameter in px by how often the station is started: three steps, because the rank only needs to say "well known". */
export function radioPx(clicks: number): number {
  if (!Number.isFinite(clicks)) return 14;
  return clicks >= 1000 ? 20 : clicks >= 100 ? 17 : 14;
}

export function radioKey(px: number, audio: boolean, color: string): string {
  return `gev-radio:${audio ? 'audio' : 'link'}:${px}:${color}`;
}

/** The label the map draws: the station name, trimmed. */
export function stationLabel(name: string, max = 34): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
