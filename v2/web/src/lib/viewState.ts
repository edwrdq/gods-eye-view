import type { LayerKind } from '@gev/shared';
import type { Health } from './cadence.ts';

/** What a status chip says. Every place that shows live or recorded state draws it from here. */
export type ChipKind = 'snapshot' | 'live' | 'recorded' | 'computed' | 'current' | 'stale' | 'error' | 'waiting';

/**
 * The global freshness chip in the status bar. While a past time is viewed the
 * sources' freshness describes the present, not the picture on screen, so the
 * chip says "Recorded" and the sources count moves to a note about now.
 */
export function freshnessChip(i: { viewing: boolean; fresh: number; total: number }): { kind: 'live' | 'stale' | 'recorded'; text: string; label: string } {
  const counts = `${i.fresh} of ${i.total} sources fresh`;
  if (i.viewing) {
    return { kind: 'recorded', text: `${counts} now`, label: `Viewing recorded history. ${counts} now` };
  }
  const allFresh = i.total > 0 && i.fresh === i.total;
  return { kind: allFresh ? 'live' : 'stale', text: counts, label: `Data sources: ${counts}` };
}

export interface LayerChipInput {
  kind: LayerKind;
  /** A past time is being viewed (the time slider is not at "now"). */
  viewing: boolean;
  /** The drawn snapshot is historical. */
  drawnHistorical: boolean;
  /** Features layer that only knows the present. */
  currentOnly: boolean;
  /** A bundled dataset: shown as a snapshot whatever the time. */
  snapshot?: boolean;
  health: Health | null;
  hasData: boolean;
}

/** The state chip of a layer row. Viewing a past time wins over feed health: that health is about now. */
export function layerChip(i: LayerChipInput): ChipKind {
  if (i.snapshot) return 'snapshot';
  if (i.currentOnly) return 'current';
  if (i.kind === 'orbits' && i.viewing) return 'computed';
  if (i.viewing || i.drawnHistorical) return 'recorded';
  if (i.health === 'stale') return 'stale';
  if (i.health === 'error') return 'error';
  if (i.kind === 'orbits' && !i.hasData) return 'waiting';
  return 'live';
}
