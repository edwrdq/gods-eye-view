import type { BBox } from '@gev/shared';
import { isWorld } from '../../geo.ts';

/**
 * A uniform lon/lat grid over the world for in-memory bbox queries.
 *
 * An entry is registered in every cell any of its boxes touches (a point has one
 * box, a multi-part line one box per part, so a Pacific cable does not claim the
 * whole ocean). A query visits only the cells its box covers and returns each
 * matching entry once, in insertion order. The grid yields candidates: callers
 * run an exact test on them.
 */
export class SpatialIndex<E> {
  private readonly cellDeg: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: Array<number[] | undefined>;
  private readonly entries: E[] = [];
  /** Per entry, the query stamp that last returned it (dedup without a Set). */
  private marks = new Uint32Array(0);
  private stamp = 0;

  constructor(cellDeg = 4) {
    this.cellDeg = cellDeg;
    this.cols = Math.ceil(360 / cellDeg);
    this.rows = Math.ceil(180 / cellDeg);
    this.cells = new Array<number[] | undefined>(this.cols * this.rows);
  }

  get size(): number {
    return this.entries.length;
  }

  all(): readonly E[] {
    return this.entries;
  }

  private col(lon: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((lon + 180) / this.cellDeg)));
  }

  private row(lat: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((lat + 90) / this.cellDeg)));
  }

  /** Register `entry` under boxes that do not cross the antimeridian ([west, south, east, north], west <= east). */
  add(entry: E, boxes: readonly BBox[]): void {
    const idx = this.entries.length;
    this.entries.push(entry);
    for (const b of boxes) {
      const c0 = this.col(b[0]);
      const c1 = this.col(b[2]);
      const r0 = this.row(b[1]);
      const r1 = this.row(b[3]);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const k = r * this.cols + c;
          const cell = this.cells[k];
          if (!cell) this.cells[k] = [idx];
          else if (cell[cell.length - 1] !== idx) cell.push(idx);
        }
      }
    }
  }

  /** Candidate entries for `bbox` (every entry when omitted or world-sized), each once, in insertion order. */
  query(bbox?: BBox): E[] {
    if (!bbox || isWorld(bbox)) return this.entries.slice();
    if (this.marks.length !== this.entries.length) this.marks = new Uint32Array(this.entries.length);
    if (++this.stamp === 0xffffffff) {
      this.marks.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    const hits: number[] = [];
    const spans: Array<[number, number]> = bbox[0] <= bbox[2] ? [[bbox[0], bbox[2]]] : [[bbox[0], 180], [-180, bbox[2]]];
    const r0 = this.row(bbox[1]);
    const r1 = this.row(bbox[3]);
    for (const [w, e] of spans) {
      const c0 = this.col(w);
      const c1 = this.col(e);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = this.cells[r * this.cols + c];
          if (!cell) continue;
          for (const idx of cell) {
            if (this.marks[idx] === stamp) continue;
            this.marks[idx] = stamp;
            hits.push(idx);
          }
        }
      }
    }
    hits.sort((a, b) => a - b);
    return hits.map((i) => this.entries[i]!);
  }
}
