/** Opacity of vertex `i` of `n` along a track: the newest end is solid, the oldest nearly gone. */
export function fadeAlpha(i: number, n: number): number {
  if (n <= 1) return 1;
  const t = i / (n - 1);
  return 0.1 + 0.9 * t * t;
}

/** Keep at most `max` evenly spaced points, always including the first and last. */
export function thin<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max || max < 2) return points.slice();
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]!);
  return out;
}
