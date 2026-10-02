import type { BBox, Observation } from '@gev/shared';
import { isWorld } from '../geo.ts';

/** Speed (m/s) above which an object counts as moving (about 1 knot). */
const MOVING_MPS = 0.5;

export interface ThinOptions {
  /** Area the objects were drawn from; sizes the grid. Whole world when omitted. */
  bbox?: BBox;
  /** Reference time for recency, epoch ms. */
  now: number;
}

/** True when the object carries a human name (not just its id). */
function isNamed(o: Observation): boolean {
  for (const key of ['name', 'callsign']) {
    const v = o.props[key];
    if (typeof v === 'string' && v.trim() !== '' && v.trim() !== o.objectId) return true;
  }
  return false;
}

/**
 * How much an object deserves to be kept when only some can be: moving beats
 * parked, named beats anonymous, fresh beats stale. Recency is bucketed so the
 * chosen set does not flicker from one poll to the next.
 */
export function keepScore(o: Observation, now: number): number {
  let s = 0;
  if (o.speed !== undefined && o.speed > MOVING_MPS) s += 4;
  if (isNamed(o)) s += 2;
  const age = now - o.t;
  if (age < 60_000) s += 1;
  else if (age < 600_000) s += 0.5;
  return s;
}

interface Scored<T> {
  score: number;
  o: T;
}

/** Where an item sits and how much it deserves to be kept; `id` breaks ties so the chosen set is stable. */
export interface GridThinning<T> {
  lon(item: T): number;
  lat(item: T): number;
  score(item: T): number;
  id(item: T): string;
}

/**
 * Choose `cap` of `items` spread evenly over the map. The area is cut into a
 * grid (about two cells per slot kept); every cell is allowed the same number
 * of items, the largest quota that fits the cap, so a harbour with 3,000
 * vessels gives up most of them while open sea keeps all of its own. Inside a
 * cell the best-scoring items win. Slots a quota leaves over go to the best of
 * the items still waiting. Returns the input untouched when it already fits.
 */
export function thinGrid<T>(items: T[], cap: number, box0: BBox | undefined, by: GridThinning<T>): T[] {
  if (items.length <= cap) return items;
  if (cap <= 0) return [];
  const better = (a: Scored<T>, b: Scored<T>): number => {
    if (b.score !== a.score) return b.score - a.score;
    const ia = by.id(a.o);
    const ib = by.id(b.o);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };
  const box: BBox = box0 ?? [-180, -90, 180, 90];
  const west = box[0];
  const east = box[0] <= box[2] ? box[2] : box[2] + 360;
  const widthDeg = Math.max(1e-6, Math.min(360, east - west));
  const heightDeg = Math.max(1e-6, box[3] - box[1]);
  const world = isWorld(box);
  const areaCells = Math.max(16, Math.floor(cap / 2));
  const cellDeg = Math.max(1e-4, Math.sqrt((widthDeg * heightDeg) / areaCells));
  const cols = Math.max(1, Math.ceil(widthDeg / cellDeg));

  const cells = new Map<number, Array<Scored<T>>>();
  for (const o of items) {
    let lon = by.lon(o);
    if (!world && box[0] > box[2] && lon < box[0]) lon += 360; // box crosses the antimeridian
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((lon - west) / cellDeg)));
    const cy = Math.max(0, Math.floor((by.lat(o) - box[1]) / cellDeg));
    const key = cy * cols + cx;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push({ score: by.score(o), o });
  }

  const lists = [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l.sort(better));
  // Largest per-cell quota whose total still fits.
  let lo = 1;
  let hi = lists.reduce((m, l) => Math.max(m, l.length), 1);
  const used = (q: number) => lists.reduce((n, l) => n + Math.min(l.length, q), 0);
  if (used(1) > cap) {
    // More occupied cells than slots: keep the best item of the best-scoring cells.
    const tops = lists.map((l) => l[0]!).sort(better);
    return tops.slice(0, cap).map((e) => e.o);
  }
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (used(mid) <= cap) lo = mid;
    else hi = mid - 1;
  }
  const out: T[] = [];
  const next: Array<Scored<T>> = [];
  for (const l of lists) {
    for (let i = 0; i < Math.min(l.length, lo); i++) out.push(l[i]!.o);
    // One runner-up per crowded cell; there are always more of them than free slots.
    if (l.length > lo) next.push(l[lo]!);
  }
  next.sort(better);
  for (let i = 0; out.length < cap && i < next.length; i++) out.push(next[i]!.o);
  return out;
}

/** Thin observations to `cap` (moving, named and fresh ones preferred); see thinGrid. */
export function thinToCap(objects: Observation[], cap: number, opts: ThinOptions): Observation[] {
  return thinGrid(objects, cap, opts.bbox, {
    lon: (o) => o.lon,
    lat: (o) => o.lat,
    score: (o) => keepScore(o, opts.now),
    id: (o) => o.objectId,
  });
}
