import { layerNoun } from './layers.ts';
import { windowLabel } from './featureWindow.ts';

export interface SummaryInput {
  layerId: string;
  /** Count the feed reports (storms for cyclones). */
  feedCount: number;
  /** Primitives of the layer drawn (features), or satellites loaded. */
  drawn: number;
  /** Drawn features that are lines (cables). */
  lines?: number;
  /** Satellites shown after the group filter. */
  shown?: number;
  /** Viewed instant when not live. */
  at: number | null;
  /** The server held stations back (a view too wide, or more than fit). */
  truncated?: boolean;
}

const n = (v: number) => v.toLocaleString('en-US');

/**
 * The note under a capped tracked layer: "Showing 20,000 of 33,104. Zoom in for all."
 * Without the total (an older server) it falls back to a plain cap notice.
 */
export function capNote(shown: number, total: number | undefined): string {
  if (total === undefined || total <= shown) return 'Capped. Zoom in to see the rest.';
  return `Showing ${n(shown)} of ${n(total)}. Zoom in for all.`;
}
const hhmm = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;

/**
 * The count line of a layer row: "27 earthquakes · 24 h", "2 active storms",
 * "No active storms", "41 launches", "956 satellites", "120 of 956 satellites".
 */
export function layerSummary(i: SummaryInput): string {
  switch (i.layerId) {
    case 'cyclones':
      return i.feedCount === 0 ? 'No active storms' : `${n(i.feedCount)} ${layerNoun('cyclones', i.feedCount)}`;
    case 'submarine-cables': {
      const cables = i.lines ?? 0;
      const landings = Math.max(0, i.drawn - cables);
      if (i.drawn === 0) return 'No cables in view';
      return `${n(cables)} ${cables === 1 ? 'cable' : 'cables'} · ${n(landings)} landing ${landings === 1 ? 'point' : 'points'}`;
    }
    case 'satellites': {
      if (i.drawn === 0) return 'Waiting for orbital elements';
      const shown = i.shown ?? i.drawn;
      return shown === i.drawn ? `${n(i.drawn)} ${layerNoun('satellites', i.drawn)}` : `${n(shown)} of ${n(i.drawn)} satellites`;
    }
    case 'bikeshare':
      if (i.drawn > 0) return `${n(i.drawn)} ${layerNoun('bikeshare', i.drawn)}`;
      return i.truncated ? 'Zoom in to a city' : 'No bike stations in view';
    case 'radio':
      return i.drawn === 0 ? 'No radio stations in view' : `${n(i.drawn)} ${layerNoun('radio', i.drawn)}`;
    default: {
      const noun = layerNoun(i.layerId, i.drawn);
      const win = windowLabel(i.layerId);
      const base = i.drawn === 0 ? `No ${layerNoun(i.layerId, 2)}` : `${n(i.drawn)} ${noun}`;
      const tail = win ? ` · ${win}` : '';
      return i.at !== null && win ? `${base}${tail} to ${hhmm(i.at)}` : `${base}${tail}`;
    }
  }
}

/**
 * The note beside a layer that shows part of what it has because of the view, or null
 * when the generic cap note fits.
 */
export function viewNote(layerId: string, drawn: number, truncated: boolean): string | null {
  if (!truncated) return null;
  if (layerId === 'bikeshare') return drawn === 0 ? 'Stations load for one city at a time.' : `Showing ${n(drawn)} stations. Zoom in for all.`;
  if (layerId === 'radio') return `Showing the ${n(drawn)} best known. Zoom in for more.`;
  return null;
}
