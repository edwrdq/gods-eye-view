export interface Flags {
  /** Serve synthetic feeds instead of calling /api (development without a server). */
  fixtures: boolean;
  /** Number of synthetic aircraft for the performance bench; 0 when off. */
  bench: number;
  /** Fixture feed states from `?feedstate=vessels:error,military-flights:stale`. */
  feedStates: Record<string, string>;
  /** `?satbench=10000`: synthetic satellites (a Starlink-sized constellation) instead of the server's. */
  satBench: number;
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
  if (!allowed) return { fixtures: false, bench: 0, feedStates: {}, satBench: 0 };
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
  const rawSat = params.get('satbench');
  const sn = rawSat === null ? 0 : Math.floor(Number(rawSat));
  const satBench = Number.isFinite(sn) && sn > 0 ? Math.min(sn, 19_999) : 0;
  return { fixtures, bench, feedStates, satBench };
}

export function currentFlags(): Flags {
  return parseFlags(typeof location === 'undefined' ? '' : location.search, {
    dev: import.meta.env.DEV,
    fixturesEnv: import.meta.env.VITE_FIXTURES === '1',
  });
}
