import { MAP_HALO, MAP_SELECTION, markerKey, shapePoints, type MarkerShape } from '../../lib/markerStyle.ts';

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

export function markerCanvas(shape: MarkerShape, color: string): { key: string; canvas: HTMLCanvasElement } {
  const key = markerKey(shape, color);
  let canvas = cache.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.lineJoin = 'round';
    pathFor(ctx, shape);
    if (shape === 'ring') {
      ctx.strokeStyle = MAP_HALO;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.2;
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
