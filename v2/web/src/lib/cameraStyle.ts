/** Camera marker encodings (see DESIGN.md, "Phase 3 map encodings"): ground category, hexagon with a view wedge. */

export type CameraConfidence = 'known' | 'estimated';
export type CameraKind = 'still' | 'video';

export interface CameraForm {
  confidence: CameraConfidence;
  kind: CameraKind;
}

/** Hexagon diameter in px. One size: a camera has no magnitude to show. */
export const CAMERA_PX = 15;
/** Wedge length from the centre, in px at scale 1. */
export const WEDGE_PX = 30;
/** The wedge is a field-of-view hint, not a measured angle. */
export const WEDGE_SPREAD_DEG = 52;
/** Wedges are drawn only below this camera height (m); above it cameras are dots, not directions. */
export const WEDGE_MAX_ALTITUDE_M = 1_500_000;
/** Labels appear below this camera height. */
export const CAMERA_LABEL_MAX_ALTITUDE_M = 150_000;

export function cameraForm(confidence: string, kind: string): CameraForm {
  return { confidence: confidence === 'known' ? 'known' : 'estimated', kind: kind === 'video' ? 'video' : 'still' };
}

export function bodyKey(f: CameraForm, color: string): string {
  return `gev-cam:body:${f.confidence}:${f.kind}:${color}`;
}

/** One wedge image for every camera: only cameras with a known facing have one. */
export function wedgeKey(color: string): string {
  return `gev-cam:wedge:${color}`;
}

/** Draw order (lower first): cameras with a known facing end up on top of estimated ones. */
export function cameraOrder(confidence: string): number {
  return confidence === 'known' ? 1 : 0;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** "NE 045°" */
export function headingText(deg: number): string {
  if (!Number.isFinite(deg)) return '';
  const d = ((Math.round(deg) % 360) + 360) % 360;
  return `${COMPASS[Math.round(d / 22.5) % 16]} ${String(d).padStart(3, '0')}°`;
}

export const CONFIDENCE_WORDS: Record<CameraConfidence, string> = {
  known: 'Known direction',
  estimated: 'Estimated direction',
};

/** The short line under the picture; the detail's Heading row carries the full reason. */
export function confidenceNote(confidence: string, basis: string): string {
  if (confidence === 'known') {
    return basis === 'curated' ? 'Direction set by hand from imagery.' : basis === 'name' ? 'Direction read from the camera name.' : 'Direction published by the operator.';
  }
  return 'The source gives no direction, so none is drawn on the map. The one shown here is a placeholder, not where the lens points.';
}

/** The label the map draws: the camera name, trimmed. */
export function cameraLabel(name: string, max = 34): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
