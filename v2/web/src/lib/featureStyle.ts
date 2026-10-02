/** Cyclone and launch marker encodings (see DESIGN.md, "Phase 3 map encodings"). */

// --- cyclones: weather category, rounded square sized by intensity class

const CYCLONE_PX: Record<string, number> = { PTC: 16, TD: 16, STD: 16, TS: 18, STS: 18, H1: 20, H2: 22, H3: 25, H4: 28, H5: 30 };
export const FORECAST_POINT_PX = 10;

/** Marker side in px for a storm's intensity class (H1 to H5 for hurricanes, TS, TD). */
export function cycloneSize(category: string | null | undefined): number {
  return (category && CYCLONE_PX[category]) || 16;
}

/** Plain words for the classes the feed uses; unknown codes pass through. */
export function cycloneClassName(category: string | null | undefined): string {
  switch (category) {
    case 'TD':
    case 'STD':
      return 'Depression';
    case 'TS':
    case 'STS':
      return 'Tropical storm';
    case 'PTC':
      return 'Potential cyclone';
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
      return `Hurricane ${category.slice(1)}`;
    default:
      return category ?? 'Storm';
  }
}

/** Short map label for a storm centre: "Rachel H3", "Nolo TS". */
export function cycloneLabel(name: string, category: string | null | undefined): string {
  return category ? `${name} ${category}` : name;
}

// --- launches: space category, star

/** Marker state of a launch pad entry. 'partial' outcomes share the failure mark; the detail says which. */
export type LaunchState = 'upcoming' | 'success' | 'failure';

export function launchState(status: string | null | undefined): LaunchState {
  if (status === 'success') return 'success';
  if (status === 'failure' || status === 'partial') return 'failure';
  return 'upcoming';
}

/** Draw order: past launches first, upcoming on top so the next launch is never buried by an old one on the same pad. */
export const LAUNCH_ORDER: Record<LaunchState, number> = { success: 0, failure: 1, upcoming: 2 };
export const LAUNCH_PX: Record<LaunchState, number> = { upcoming: 26, success: 20, failure: 22 };

/** "T-3 d", "T-5 h", "T-12 min", "3 d ago" for a launch time relative to `now`. */
export function launchEta(netMs: number, now: number): string {
  if (!Number.isFinite(netMs)) return '';
  const diff = netMs - now;
  const abs = Math.abs(diff);
  const d = Math.round(abs / 86_400_000);
  const h = Math.round(abs / 3_600_000);
  const m = Math.max(1, Math.round(abs / 60_000));
  const text = abs >= 2 * 86_400_000 ? `${d} d` : abs >= 3_600_000 ? `${h} h` : `${m} min`;
  return diff >= 0 ? `T-${text}` : `${text} ago`;
}

// --- satellites

export const SATELLITE_PX = 14;
