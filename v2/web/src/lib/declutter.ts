/**
 * Choosing which map labels to show. Pure and screen-space: callers project
 * their candidates to window pixels and hand them in best-first or with a rank.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelCandidate {
  id: string;
  /** Anchor in window pixels (the marker centre). */
  x: number;
  y: number;
  /** Label text; its length sizes the box. */
  text: string;
  /** Marker size in px, to keep the text clear of it. */
  px: number;
  /** Higher is placed first. */
  rank: number;
}

export interface DeclutterOptions {
  /** Most labels this call may add. */
  cap: number;
  /**
   * Boxes already taken on screen (the selected object, storm names, other layers' labels). They block
   * overlap and count towards density. The boxes of the labels this call picks are appended, so one
   * array passed through several layers declutters them against each other.
   */
  occupied?: Rect[];
  /** Density: no more than `perCell` labels in any `cellW` x `cellH` px block of the screen. */
  cellW?: number;
  cellH?: number;
  perCell?: number;
}

const CHAR_W = 6.8; // average advance of the 12px semibold label font
const LABEL_H = 18;
const GAP_X = 4;

/** The box a label occupies: marker, offset and text, vertically centred on the anchor. */
export function labelRect(x: number, y: number, text: string, px: number): Rect {
  return { x: x - px / 2, y: y - LABEL_H / 2, w: px + 6 + text.length * CHAR_W, h: LABEL_H };
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w + GAP_X && b.x < a.x + a.w + GAP_X && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Greedy pick, best rank first: skip a label whose box would overlap one already
 * taken, skip it when its screen block is already full, stop at the cap. Ties
 * keep the caller's order, so a stable input gives a stable choice.
 */
export function selectLabels<T extends LabelCandidate>(cands: readonly T[], opts: DeclutterOptions): T[] {
  const cellW = opts.cellW ?? 260;
  const cellH = opts.cellH ?? 150;
  const perCell = opts.perCell ?? 3;
  const placed = opts.occupied ?? [];
  const perBlock = new Map<string, number>();
  const block = (r: Rect) => `${Math.floor((r.x + r.w / 2) / cellW)},${Math.floor((r.y + r.h / 2) / cellH)}`;
  for (const r of placed) perBlock.set(block(r), (perBlock.get(block(r)) ?? 0) + 1);

  const order = cands.map((c, i) => ({ c, i })).sort((a, b) => b.c.rank - a.c.rank || a.i - b.i);
  const out: T[] = [];
  for (const { c } of order) {
    if (out.length >= opts.cap) break;
    const r = labelRect(c.x, c.y, c.text, c.px);
    const b = block(r);
    if ((perBlock.get(b) ?? 0) >= perCell) continue;
    let clash = false;
    for (let i = 0; i < placed.length; i++) {
      if (overlaps(r, placed[i]!)) {
        clash = true;
        break;
      }
    }
    if (clash) continue;
    placed.push(r);
    perBlock.set(b, (perBlock.get(b) ?? 0) + 1);
    out.push(c);
  }
  return out;
}

/** Camera height below which an object with only a numeric id is labelled with it (m). */
export const NUMERIC_LABEL_MAX_ALTITUDE_M = 4_000;

/**
 * True when the label says more than the object's id: a callsign, a vessel name.
 * A bare number (an MMSI) or the id itself is not a name.
 */
export function isNamedLabel(label: string, objectId: string): boolean {
  const t = label.trim();
  return t !== '' && t !== objectId && !/^[0-9]+$/.test(t);
}

/** Whether `label` may be drawn: names always (when zoomed in), numeric ids only very close or when selected. */
export function mayLabel(label: string, objectId: string, altitude: number, selected: boolean): boolean {
  if (selected) return true;
  return isNamedLabel(label, objectId) || altitude < NUMERIC_LABEL_MAX_ALTITUDE_M;
}
