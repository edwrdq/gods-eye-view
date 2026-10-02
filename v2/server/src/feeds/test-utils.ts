import type { Observation } from '@gev/shared';
import type { Timers } from './types.ts';

export function clock(start = 1_760_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => (t += ms),
    set: (v: number) => (t = v),
  };
}

/** Timers that never fire on their own; tests call feed.tick() explicitly. */
export const manualTimers: Timers & { intervals: Array<() => void>; timeouts: Array<() => void> } = {
  intervals: [],
  timeouts: [],
  setInterval(fn) {
    this.intervals.push(fn);
    return fn;
  },
  clearInterval(h) {
    const i = this.intervals.indexOf(h as () => void);
    if (i >= 0) this.intervals.splice(i, 1);
  },
  setTimeout(fn) {
    this.timeouts.push(fn);
    return fn;
  },
  clearTimeout() {},
};

export function obs(over: Partial<Observation> = {}): Observation {
  return { layer: 'flights', objectId: 'abc123', t: 1000, lon: 10, lat: 20, props: {}, ...over };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}
