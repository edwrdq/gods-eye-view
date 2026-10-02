/**
 * Compass words to a heading, ported from the original app's directionToHeading.
 *
 * Two modes, because the same words appear in two kinds of field:
 * - a field that holds a direction by itself (Caltrans `direction`, NSW `direction`) says which
 *   way the camera looks, so bare words ("West") count: pass `bare = true`;
 * - free text (a camera name such as "5TH ST / WEST AVE") is full of street names. There only
 *   explicit travel forms ("WESTBOUND", "WB") count; a bare "West" would invent a facing.
 *
 * Returns degrees clockwise from true north, or null when nothing is recognised.
 */
export function directionToHeading(value: unknown, bare = false): number | null {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!text) return null;
  if (/\bNORTHBOUND\b|\bNB\b/.test(text)) return 0;
  if (/\bSOUTHBOUND\b|\bSB\b/.test(text)) return 180;
  if (/\bEASTBOUND\b|\bEB\b/.test(text)) return 90;
  if (/\bWESTBOUND\b|\bWB\b/.test(text)) return 270;
  if (/\bNORTHEAST\b|\bNE\b/.test(text)) return 45;
  if (/\bNORTHWEST\b|\bNW\b/.test(text)) return 315;
  if (/\bSOUTHEAST\b|\bSE\b/.test(text)) return 135;
  if (/\bSOUTHWEST\b|\bSW\b/.test(text)) return 225;
  if (bare) {
    if (/\bNORTH\b/.test(text)) return 0;
    if (/\bSOUTH\b/.test(text)) return 180;
    if (/\bEAST\b/.test(text)) return 90;
    if (/\bWEST\b/.test(text)) return 270;
  }
  return null;
}
