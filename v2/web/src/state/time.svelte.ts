import type { HistoryRange } from '@gev/shared';
import { fetchHistoryRange, isAbort } from '../api/index.ts';
import { debounce } from '../lib/debounce.ts';
import { readStored, writeStored } from '../lib/storage.ts';
import { clampToRange, isLiveTime, nextPlayTime, playbackStart } from '../lib/timeline.ts';
import { clock } from './clock.svelte.ts';

/** Data seconds per real second. */
export const SPEEDS = [10, 60, 300, 1800] as const;
export type Speed = (typeof SPEEDS)[number];
const DOCK_KEY = 'gev.v2.timeDock';

/** The time the whole app is viewing. `at === null` is live. */
export const timeState = $state<{
  at: number | null;
  range: HistoryRange | null;
  rangeStatus: 'loading' | 'ready' | 'error';
  playing: boolean;
  speed: Speed;
  dockOpen: boolean;
}>({ at: null, range: null, rangeStatus: 'loading', playing: false, speed: 60, dockOpen: readStored(DOCK_KEY) !== 'closed' });

type CommitFn = (at: number | null) => void;
const sinks: CommitFn[] = [];
let busyProbe: () => boolean = () => false;

/** Be told whenever the viewed time changes (after dragging settles). */
export function onTimeCommit(cb: CommitFn): () => void {
  sinks.push(cb);
  return () => {
    const i = sinks.indexOf(cb);
    if (i >= 0) sinks.splice(i, 1);
  };
}

export function setBusyProbe(fn: () => boolean): void {
  busyProbe = fn;
}

function commit(): void {
  const at = timeState.at;
  for (const cb of sinks) cb(at);
}
const commitSoon = debounce(commit, 160);

/** Move to a recorded instant (slider drag, keyboard). Near "now" it returns to live. */
export function viewAt(at: number): void {
  const now = clock.now;
  if (isLiveTime(at, now)) {
    goLive();
    return;
  }
  timeState.at = clampToRange(at, timeState.range, now);
  commitSoon();
}

export function goLive(): void {
  timeState.playing = false;
  stopPlayLoop();
  commitSoon.cancel();
  if (timeState.at === null) return;
  timeState.at = null;
  commit();
}

export function setSpeed(speed: Speed): void {
  timeState.speed = speed;
}

export function togglePlay(): void {
  if (timeState.playing) {
    timeState.playing = false;
    stopPlayLoop();
    return;
  }
  const start = playbackStart(timeState.range, clock.now);
  if (start === null) return;
  if (timeState.at === null) {
    timeState.at = start;
    commit();
  }
  timeState.playing = true;
  startPlayLoop();
}

export function setDockOpen(open: boolean): void {
  timeState.dockOpen = open;
  writeStored(DOCK_KEY, open ? 'open' : 'closed');
}

let loop: ReturnType<typeof setInterval> | undefined;
function startPlayLoop(): void {
  stopPlayLoop();
  loop = setInterval(() => {
    if (!timeState.playing || timeState.at === null) return;
    if (busyProbe()) return; // wait for the previous frame to land
    const next = nextPlayTime(timeState.at, timeState.speed, clock.now);
    if (next === null) {
      goLive();
      return;
    }
    timeState.at = next;
    commit();
  }, 1000);
}
function stopPlayLoop(): void {
  if (loop !== undefined) clearInterval(loop);
  loop = undefined;
}

export async function loadRange(signal?: AbortSignal): Promise<void> {
  try {
    timeState.range = await fetchHistoryRange(signal);
    timeState.rangeStatus = 'ready';
  } catch (e) {
    if (isAbort(e)) return;
    timeState.rangeStatus = 'error';
  }
}

/** Refresh the recorded range every minute. */
export function startRangePolling(): () => void {
  const ctl = new AbortController();
  void loadRange(ctl.signal);
  const id = setInterval(() => {
    if (!document.hidden) void loadRange(ctl.signal);
  }, 60_000);
  return () => {
    ctl.abort();
    clearInterval(id);
    stopPlayLoop();
  };
}
