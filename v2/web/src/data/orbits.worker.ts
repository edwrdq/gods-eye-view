// Propagates satellites with SGP4 off the main thread and posts Earth-fixed positions.
import type { OrbitalElements } from '@gev/shared';
import { ApiRequestError, configureApi, fetchElements, isAbort } from '../api/index.ts';
import { synthElements, tleSummary } from '../lib/tle.ts';
import type { FromOrbitWorker, GroupCount, ToOrbitWorker } from './orbitProtocol.ts';
import { makeSatrec, orbitPath, propagateAll, stateAt, type SatRec } from './sgp4.ts';

const scope = self as unknown as { postMessage(m: FromOrbitWorker, t?: Transferable[]): void; onmessage: ((e: MessageEvent<ToOrbitWorker>) => void) | null };

const TICK_MS = 1000;
const SELECTED_TICK_MS = 250;

let bench = 0;
let elements: OrbitalElements[] = [];
let satrecs: Array<SatRec | null> = [];
let indexById = new Map<string, number>();
let groupIdx = new Uint8Array(0);
let groupNames: string[] = [];
let group: string | null = null;
let active = new Uint32Array(0);
let at: number | null = null;
let paused = false;
let selected: string | null = null;
let loadCtl: AbortController | null = null;
let tickTimer: ReturnType<typeof setInterval> | undefined;
let selTimer: ReturnType<typeof setInterval> | undefined;
let buf = new Float64Array(0);

function chooseActive(): void {
  const gi = group === null ? -1 : groupNames.indexOf(group);
  if (group !== null && gi < 0) {
    active = new Uint32Array(0);
  } else {
    const list: number[] = [];
    for (let i = 0; i < elements.length; i++) if (gi < 0 || groupIdx[i] === gi) list.push(i);
    active = Uint32Array.from(list);
  }
  scope.postMessage({ type: 'active', indices: active.slice() });
}

const instant = () => at ?? Date.now();

function tick(): void {
  if (paused || active.length === 0) return;
  const t = instant();
  if (buf.length !== 3 * active.length) buf = new Float64Array(3 * active.length);
  const t0 = performance.now();
  const failed = propagateAll(satrecs, active, t, buf);
  const ms = performance.now() - t0;
  const xyz = buf;
  buf = new Float64Array(0); // ownership moves with the message
  scope.postMessage({ type: 'positions', t, xyz, ms, failed }, [xyz.buffer as ArrayBuffer]);
}

function selectedTick(): void {
  if (paused || selected === null) return;
  const i = indexById.get(selected);
  const sat = i === undefined ? null : satrecs[i];
  if (!sat) return;
  const t = instant();
  const s = stateAt(sat, t);
  if (!s) return;
  const xyz = Float64Array.from(s.ecef);
  scope.postMessage({ type: 'selected', noradId: selected, t, xyz, lon: s.lon, lat: s.lat, alt: s.alt, speedKms: s.speedKms }, [xyz.buffer as ArrayBuffer]);
}

/** Run live ticks only while following the clock; a fixed viewed time needs one pass per change. */
function restartTimers(): void {
  clearInterval(tickTimer);
  clearInterval(selTimer);
  tickTimer = selTimer = undefined;
  if (paused) return;
  if (at === null) {
    tickTimer = setInterval(tick, TICK_MS);
    if (selected !== null) selTimer = setInterval(selectedTick, SELECTED_TICK_MS);
  }
  tick();
  selectedTick();
}

async function load(seq: number): Promise<void> {
  loadCtl?.abort();
  const ctl = (loadCtl = new AbortController());
  const t0 = performance.now();
  try {
    let feed;
    let list: OrbitalElements[];
    if (bench > 0) {
      list = synthElements(bench, Date.now());
      const now = Date.now();
      feed = { layer: 'satellites', state: 'live' as const, source: 'synthetic bench', lastSuccess: now, lastError: null, count: list.length, freshnessMs: 43_200_000 };
    } else {
      const res = await fetchElements('satellites', null, ctl.signal);
      list = res.elements;
      feed = res.feed;
    }
    if (ctl.signal.aborted) return;
    const t1 = performance.now();
    elements = list;
    satrecs = list.map((e) => makeSatrec(e.tle1, e.tle2));
    indexById = new Map(list.map((e, i) => [e.noradId, i]));
    const names: string[] = [];
    const counts = new Map<string, number>();
    groupNames = [];
    groupIdx = new Uint8Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const g = list[i]!.group;
      let gi = groupNames.indexOf(g);
      if (gi < 0) gi = groupNames.push(g) - 1;
      groupIdx[i] = Math.min(gi, 255);
      counts.set(g, (counts.get(g) ?? 0) + 1);
      names.push(list[i]!.name.replaceAll('\n', ' '));
    }
    const groups: GroupCount[] = groupNames.map((name) => ({ name, count: counts.get(name) ?? 0 }));
    let oldest: number | null = null;
    let newest: number | null = null;
    for (const e of list) {
      if (oldest === null || e.epoch < oldest) oldest = e.epoch;
      if (newest === null || e.epoch > newest) newest = e.epoch;
    }
    const initMs = performance.now() - t1;
    scope.postMessage({
      type: 'loaded',
      seq,
      feed,
      groups,
      total: list.length,
      ids: list.map((e) => e.noradId).join('\n'),
      names: names.join('\n'),
      groupOf: groupIdx.slice(),
      groupNames: groupNames.slice(),
      oldestEpoch: oldest,
      newestEpoch: newest,
      fetchMs: t1 - t0,
      initMs,
    });
    chooseActive();
    restartTimers();
  } catch (e) {
    if (isAbort(e) || ctl.signal.aborted) return;
    const err = e instanceof ApiRequestError ? e : new ApiRequestError('network', 0, e instanceof Error ? e.message : 'Request failed');
    scope.postMessage({ type: 'failed', seq, failure: err.failure, status: err.status, message: err.message });
  }
}

function inspect(reqId: number, noradId: string): void {
  const i = indexById.get(noradId);
  const el = i === undefined ? null : (elements[i] ?? null);
  const sat = i === undefined ? null : (satrecs[i] ?? null);
  const t = instant();
  if (!el || !sat) {
    scope.postMessage({ type: 'inspected', reqId, noradId, elements: el, t, state: null, path: new Float64Array(0), nowIndex: 0 });
    return;
  }
  const s = stateAt(sat, t);
  const period = tleSummary(el.tle1, el.tle2)?.periodMin ?? 95;
  const p = orbitPath(sat, t, period);
  scope.postMessage(
    { type: 'inspected', reqId, noradId, elements: el, t, state: s ? { lon: s.lon, lat: s.lat, alt: s.alt, speedKms: s.speedKms } : null, path: p.xyz, nowIndex: p.nowIndex },
    [p.xyz.buffer as ArrayBuffer],
  );
}

scope.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      configureApi(m.api);
      bench = m.bench;
      break;
    case 'load':
      void load(m.seq);
      break;
    case 'group':
      group = m.group;
      chooseActive();
      tick();
      break;
    case 'time':
      at = m.at;
      restartTimers();
      break;
    case 'select':
      selected = m.noradId;
      restartTimers();
      break;
    case 'pause':
      paused = m.paused;
      restartTimers();
      break;
    case 'inspect':
      inspect(m.reqId, m.noradId);
      break;
  }
};
