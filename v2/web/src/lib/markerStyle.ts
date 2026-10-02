import type { LayerCategory } from '@gev/shared';

export type MarkerShape = 'triangle' | 'diamond' | 'star' | 'circle' | 'rounded-square' | 'square' | 'hexagon' | 'ring';

/** Map marker shape per category (DESIGN.md). */
export const CATEGORY_SHAPE: Record<LayerCategory, MarkerShape> = {
  air: 'triangle',
  sea: 'diamond',
  space: 'star',
  hazards: 'circle',
  weather: 'rounded-square',
  infrastructure: 'square',
  ground: 'hexagon',
  signals: 'ring',
};

/** Theme-independent map colours (the --map-* tokens); markers sit on imagery. */
export const CATEGORY_MAP_COLOR: Record<LayerCategory, string> = {
  air: '#42aef5',
  sea: '#22c4ab',
  space: '#b890fa',
  hazards: '#ff6450',
  weather: '#ffd23f',
  infrastructure: '#f28cc2',
  ground: '#a3d64f',
  signals: '#dfe6ee',
};

export const MAP_HALO = 'rgba(8, 12, 18, 0.85)';
export const MAP_SELECTION = '#ffffff';

/** Shapes that point somewhere: they rotate with the object's heading. */
export function rotatesWithHeading(shape: MarkerShape): boolean {
  return shape === 'triangle' || shape === 'diamond';
}

/**
 * Treatment within a category. 'military' keeps the category's shape and hue
 * but draws it as an outline instead of a solid, so it reads apart from civil
 * traffic by form (hollow vs solid), not by hue alone.
 */
export type MarkerVariant = 'standard' | 'military';

/** Which layers use a non-standard variant. */
export function markerVariantFor(layerId: string): MarkerVariant {
  return layerId === 'military-flights' ? 'military' : 'standard';
}

/** Cache key for a marker image. */
export function markerKey(shape: MarkerShape, color: string, variant: MarkerVariant = 'standard'): string {
  return variant === 'standard' ? `gev-marker:${shape}:${color}` : `gev-marker:${shape}:${color}:${variant}`;
}

/** Polygon outline (x, y pairs on a 40 x 40 grid, pointing up) for polygonal shapes; null for round ones. */
export function shapePoints(shape: MarkerShape): number[] | null {
  switch (shape) {
    case 'triangle':
      return [20, 5, 30, 31, 20, 26, 10, 31];
    case 'diamond':
      return [20, 4, 28, 20, 20, 36, 12, 20];
    case 'star':
      return [20, 4, 24.5, 15.5, 36, 20, 24.5, 24.5, 20, 36, 15.5, 24.5, 4, 20, 15.5, 15.5];
    case 'square':
      return [11, 11, 29, 11, 29, 29, 11, 29];
    case 'hexagon': {
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push(20 + 11 * Math.cos(a), 20 + 11 * Math.sin(a));
      }
      return pts;
    }
    default:
      return null;
  }
}
