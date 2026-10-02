import { AGE_ALPHA, type AgeBucket } from '../../lib/quakeStyle.ts';
import type { LaunchState } from '../../lib/featureStyle.ts';
import { BIKE_LEVEL_FILL, type BikeForm } from '../../lib/stationStyle.ts';
import { MAP_HALO, MAP_SELECTION, markerKey, shapePoints, type MarkerShape, type MarkerVariant } from '../../lib/markerStyle.ts';

/** Marker images are drawn once per (shape, colour) and shared by every billboard through the texture atlas. */
const SIZE = 40;
const cache = new Map<string, HTMLCanvasElement>();

function pathFor(ctx: CanvasRenderingContext2D, shape: MarkerShape): void {
  ctx.beginPath();
  const pts = shapePoints(shape);
  if (pts) {
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
    ctx.closePath();
  } else if (shape === 'rounded-square') {
    ctx.roundRect(11, 11, 18, 18, 5);
  } else {
    ctx.arc(20, 20, shape === 'ring' ? 8.5 : 9, 0, Math.PI * 2);
  }
}

export function markerCanvas(shape: MarkerShape, color: string, variant: MarkerVariant = 'standard'): { key: string; canvas: HTMLCanvasElement } {
  const key = markerKey(shape, color, variant);
  let canvas = cache.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.lineJoin = 'round';
    pathFor(ctx, shape);
    if (shape === 'ring' || variant === 'military') {
      // Outline: dark halo under and the hue on top, so it stays legible on any imagery.
      ctx.strokeStyle = MAP_HALO;
      ctx.lineWidth = variant === 'military' ? 8 : 7;
      ctx.stroke();
      if (variant === 'military') {
        // Dark interior with a bright rim: reads as an outline, and stays visible when small.
        ctx.fillStyle = MAP_HALO;
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = variant === 'military' ? 4 : 3.2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = MAP_HALO;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fill();
    }
    cache.set(key, canvas);
  }
  return { key, canvas };
}

export const SELECTION_KEY = 'gev-selection-ring';

/** White ring with a dark outer edge so it reads on snow and on dark ocean alike. */
export function selectionRingCanvas(): HTMLCanvasElement {
  const size = 64;
  let canvas = cache.get(SELECTION_KEY);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 22, 0, Math.PI * 2);
    ctx.strokeStyle = MAP_HALO;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = MAP_SELECTION;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    cache.set(SELECTION_KEY, canvas);
  }
  return canvas;
}

// --- phase 3 markers. Every image is drawn at 2x and shown at scale 0.5.

function canvasFor(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  let canvas = cache.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.lineJoin = 'round';
    draw(ctx);
    cache.set(key, canvas);
  }
  return canvas;
}

/** Quake: circle of `sizePx` diameter, fill opacity by age, dark centre dot when deep. */
export function quakeCanvas(key: string, sizePx: number, age: AgeBucket, deep: boolean, color: string): HTMLCanvasElement {
  const size = Math.ceil(sizePx * 2 + 12);
  return canvasFor(key, size, size, (ctx) => {
    const c = size / 2;
    const r = sizePx; // radius at 2x is the CSS diameter / 2 * 2
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.strokeStyle = MAP_HALO;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = AGE_ALPHA[age];
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    // The rim fades much less than the fill, so an old quake stays a readable ring on dark ocean.
    ctx.beginPath();
    ctx.arc(c, c, r - 1, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55 + 0.45 * AGE_ALPHA[age];
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (deep) {
      ctx.beginPath();
      ctx.arc(c, c, Math.max(3, r * 0.34), 0, Math.PI * 2);
      ctx.fillStyle = MAP_HALO;
      ctx.fill();
    }
  });
}

/** Storm centre: rounded square of `sizePx`, or the smaller translucent forecast point. */
export function stormCanvas(key: string, sizePx: number, color: string, forecast: boolean): HTMLCanvasElement {
  const size = Math.ceil(sizePx * 2 + 12);
  return canvasFor(key, size, size, (ctx) => {
    const side = sizePx * 2;
    const x = (size - side) / 2;
    ctx.beginPath();
    ctx.roundRect(x, x, side, side, side * 0.28);
    ctx.strokeStyle = MAP_HALO;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = forecast ? 0.7 : 1;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (!forecast) {
      // Dark eye: marks the storm centre apart from a plain weather square.
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, side * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = MAP_HALO;
      ctx.fill();
    }
  });
}

/** Launch pad: solid star (upcoming), hollow star (flown), hollow star with a cross (failed or partial). */
export function launchCanvas(key: string, state: LaunchState, sizePx: number, color: string, failColor: string): HTMLCanvasElement {
  const size = Math.ceil(sizePx * 2 + 12);
  return canvasFor(key, size, size, (ctx) => {
    const pts = shapePoints('star')!;
    const k = (sizePx * 2) / 32; // the unit star spans 32 px (4..36)
    const o = size / 2 - 20 * k;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const x = o + pts[i]! * k;
      const y = o + pts[i + 1]! * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    if (state === 'upcoming') {
      ctx.strokeStyle = MAP_HALO;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      const hue = state === 'failure' ? failColor : color;
      ctx.strokeStyle = MAP_HALO;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.fillStyle = MAP_HALO;
      ctx.fill();
      ctx.strokeStyle = hue;
      ctx.lineWidth = 3.2;
      ctx.stroke();
      if (state === 'failure') {
        const c = size / 2;
        const d = sizePx * 0.32;
        ctx.beginPath();
        ctx.moveTo(c - d, c - d);
        ctx.lineTo(c + d, c + d);
        ctx.moveTo(c + d, c - d);
        ctx.lineTo(c - d, c + d);
        ctx.strokeStyle = hue;
        ctx.lineWidth = 3.2;
        ctx.stroke();
      }
    }
  });
}

/**
 * Bikeshare station: a hexagon used as a gauge. The dark body fills from the bottom with the
 * category hue in proportion to the bikes at the station; the rim is always the hue. Out of
 * service is a dashed dim rim with a cross, no reading a dashed rim, and bikes without a dock
 * count a centred dot.
 */
export function bikeCanvas(key: string, f: BikeForm, sizePx: number, color: string): HTMLCanvasElement {
  const size = Math.ceil(sizePx * 2 + 12);
  return canvasFor(key, size, size, (ctx) => {
    const c = size / 2;
    const r = sizePx; // 2x canvas: the CSS diameter is sizePx, so the radius in canvas px is sizePx
    const hex = () => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const x = c + r * Math.cos(a);
        const y = c + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    // dark halo, then the dark body the gauge fills
    hex();
    ctx.strokeStyle = MAP_HALO;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.globalAlpha = f.form === 'offline' ? 0.55 : f.form === 'nodata' ? 0.35 : 1;
    ctx.fillStyle = MAP_HALO;
    hex();
    ctx.fill();
    if (f.form === 'level' && f.level > 0) {
      ctx.save();
      hex();
      ctx.clip();
      const h = 2 * r * BIKE_LEVEL_FILL[f.level];
      ctx.fillStyle = color;
      ctx.fillRect(c - r, c + r - h, 2 * r, h);
      ctx.restore();
    }
    ctx.globalAlpha = f.form === 'offline' ? 0.6 : 1;
    hex();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.2;
    if (f.form === 'offline' || f.form === 'nodata') ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (f.form === 'dot') {
      ctx.beginPath();
      ctx.arc(c, c, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else if (f.form === 'offline') {
      const d = r * 0.34;
      ctx.beginPath();
      ctx.moveTo(c - d, c - d);
      ctx.lineTo(c + d, c + d);
      ctx.moveTo(c + d, c - d);
      ctx.lineTo(c - d, c + d);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

/** Radio station: a ring (the signals shape); a centred dot says it plays in the browser, a bare ring says it opens as a link. */
export function radioCanvas(key: string, sizePx: number, audio: boolean, color: string): HTMLCanvasElement {
  const size = Math.ceil(sizePx * 2 + 12);
  return canvasFor(key, size, size, (ctx) => {
    const c = size / 2;
    const r = sizePx - 2;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.strokeStyle = MAP_HALO;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.4;
    ctx.stroke();
    if (audio) {
      ctx.beginPath();
      ctx.arc(c, c, r * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = MAP_HALO;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(c, c, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  });
}
