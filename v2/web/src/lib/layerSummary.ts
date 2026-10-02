import { layerNoun } from './layers.ts';
import { windowLabel } from './featureWindow.ts';

export interface SummaryInput {
  layerId: string;
  /** Count the feed reports (storms for cyclones). */
  feedCount: number;
  /** Primitives of the layer drawn (features), or satellites loaded. */
  drawn: number;
  /** Satellites shown after the group filter. */
  shown?: number;
  /** Viewed instant when not live. */
  at: number | null;
}

const n = (v: number) => v.toLocaleString('en-US');
const hhmm = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;

/**
 * The count line of a layer row: "27 earthquakes · 24 h", "2 active storms",
 * "No active storms", "41 launches", "956 satellites", "120 of 956 satellites".
 */
export function layerSummary(i: SummaryInput): string {
  switch (i.layerId) {
    case 'cyclones':
      return i.feedCount === 0 ? 'No active storms' : `${n(i.feedCount)} ${layerNoun('cyclones', i.feedCount)}`;
    case 'satellites': {
      if (i.drawn === 0) return 'Waiting for orbital elements';
      const shown = i.shown ?? i.drawn;
      return shown === i.drawn ? `${n(i.drawn)} ${layerNoun('satellites', i.drawn)}` : `${n(shown)} of ${n(i.drawn)} satellites`;
    }
    default: {
      const noun = layerNoun(i.layerId, i.drawn);
      const win = windowLabel(i.layerId);
      const base = i.drawn === 0 ? `No ${layerNoun(i.layerId, 2)}` : `${n(i.drawn)} ${noun}`;
      const tail = win ? ` · ${win}` : '';
      return i.at !== null && win ? `${base}${tail} to ${hhmm(i.at)}` : `${base}${tail}`;
    }
  }
}
