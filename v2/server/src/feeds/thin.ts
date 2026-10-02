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

const better = (a: { score: number; o: Observation }, b: { score: number; o: Observation }): number =>
  b.score - a.score || (a.o.objectId < b.o.objectId ? -1 : a.o.objectId > b.o.objectId ? 1 : 0);

/**
 * Choose `cap` of `objects` spread evenly over the map. The area is cut into a
 * grid (about two cells per slot kept); every cell is allowed the same number
 * of objects, the largest quota that fits the cap, so a harbour with 3,000
 * vessels gives up most of them while open sea keeps all of its own. Inside a
 * cell the best-scoring objects win (see keepScore). Slots a quota leaves over
 * go to the best of the objects still waiting. Returns the input untouched
 * when it already fits.
 */
export function thinToCap(objects: Observation[], cap: number, opts: ThinOptions): Observation[] {
  if (objects.length <= cap) return objects;
  if (cap <= 0) return [];
  const box: BBox = opts.bbox ?? [-180, -90, 180, 90];
  const west = box[0];
  const east = box[0] <= box[2] ? box[2] : box[2] + 360;
  const widthDeg = Math.max(1e-6, Math.min(360, east - west));
  const heightDeg = Math.max(1e-6, box[3] - box[1]);
  const world = isWorld(box);
  const areaCells = Math.max(16, Math.floor(cap / 2));
  const cellDeg = Math.max(1e-4, Math.sqrt((widthDeg * heightDeg) / areaCells));
  const cols = Math.max(1, Math.ceil(widthDeg / cellDeg));

  const cells = new Map<number, Array<{ score: number; o: Observation }>>();
  for (const o of objects) {
    let lon = o.lon;
    if (!world && box[0] > box[2] && lon < box[0]) lon += 360; // box crosses the antimeridian
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((lon - west) / cellDeg)));
    const cy = Math.max(0, Math.floor((o.lat - box[1]) / cellDeg));
    const key = cy * cols + cx;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push({ score: keepScore(o, opts.now), o });
  }

  const lists = [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l.sort(better));
  // Largest per-cell quota whose total still fits.
  let lo = 1;
  let hi = lists.reduce((m, l) => Math.max(m, l.length), 1);
  const used = (q: number) => lists.reduce((n, l) => n + Math.min(l.length, q), 0);
  if (used(1) > cap) {
    // More occupied cells than slots: keep the best object of the best-scoring cells.
    const tops = lists.map((l) => l[0]!).sort(better);
    return tops.slice(0, cap).map((e) => e.o);
  }
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (used(mid) <= cap) lo = mid;
    else hi = mid - 1;
  }
  const out: Observation[] = [];
  const next: Array<{ score: number; o: Observation }> = [];
  for (const l of lists) {
    for (let i = 0; i < Math.min(l.length, lo); i++) out.push(l[i]!.o);
    // One runner-up per crowded cell; there are always more of them than free slots.
    if (l.length > lo) next.push(l[lo]!);
  }
  next.sort(better);
  for (let i = 0; out.length < cap && i < next.length; i++) out.push(next[i]!.o);
  return out;
}
