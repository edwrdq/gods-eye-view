export interface Flags {
  /** Serve synthetic feeds instead of calling /api (development without a server). */
  fixtures: boolean;
  /** Number of synthetic aircraft for the performance bench; 0 when off. */
  bench: number;
  /** Fixture feed states from `?feedstate=vessels:error,military-flights:stale`. */
  feedStates: Record<string, string>;
}

export interface FlagEnv {
  /** True in `vite dev`. */
  dev: boolean;
  /** VITE_FIXTURES=1 at build or dev time. */
  fixturesEnv: boolean;
}

/**
 * Resolve development flags. `?bench=12000` and `?fixtures` only work when the
 * build allows them (dev server or VITE_FIXTURES=1), so a normal production
 * build never serves synthetic data.
 */
export function parseFlags(search: string, env: FlagEnv): Flags {
  const allowed = env.dev || env.fixturesEnv;
  if (!allowed) return { fixtures: false, bench: 0, feedStates: {} };
  const params = new URLSearchParams(search);
  const rawBench = params.get('bench');
  const n = rawBench === null ? 0 : Math.floor(Number(rawBench));
  const bench = Number.isFinite(n) && n > 0 ? Math.min(n, 200_000) : 0;
  const fixtures = env.fixturesEnv || bench > 0 || params.has('fixtures');
  const feedStates: Record<string, string> = {};
  for (const part of (params.get('feedstate') ?? '').split(',')) {
    const [layer, state] = part.split(':');
    if (layer && state) feedStates[layer] = state;
  }
  return { fixtures, bench, feedStates };
}

export function currentFlags(): Flags {
  return parseFlags(typeof location === 'undefined' ? '' : location.search, {
    dev: import.meta.env.DEV,
    fixturesEnv: import.meta.env.VITE_FIXTURES === '1',
  });
}
