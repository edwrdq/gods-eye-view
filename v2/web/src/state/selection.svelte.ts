import type { ObjectDetail } from '@gev/shared';
import { ApiRequestError, fetchObject, fetchTrack, isAbort } from '../api/index.ts';
import type { Selected } from '../globe/index.ts';
import { cadenceMs } from '../lib/cadence.ts';
import { formatLatLon } from '../lib/format.ts';
import { feedStore } from './feeds.svelte.ts';
import { flyTo } from './globe.svelte.ts';
import { onTimeCommit, timeState } from './time.svelte.ts';
import { getData } from './data.svelte.ts';

export type DetailPhase = 'idle' | 'loading' | 'ready' | 'error' | 'gone';
export type TrackPhase = 'off' | 'loading' | 'on' | 'empty' | 'error';

const SIX_HOURS = 6 * 3_600_000;

/** The selected object and everything the detail panel shows about it. */
export const selection = $state<{
  ref: Selected | null;
  detail: ObjectDetail | null;
  phase: DetailPhase;
  error: string;
  /** A background refresh failed while older detail is still shown. */
  refreshFailed: boolean;
  following: boolean;
  track: TrackPhase;
  copied: boolean;
}>({ ref: null, detail: null, phase: 'idle', error: '', refreshFailed: false, following: false, track: 'off', copied: false });

let detailCtl: AbortController | null = null;
let trackCtl: AbortController | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let copyTimer: ReturnType<typeof setTimeout> | undefined;

function describe(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.failure === 'upstream') return "The data source didn't respond.";
    if (e.failure === 'network') return "The server didn't respond.";
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}

async function loadDetail(): Promise<void> {
  const ref = selection.ref;
  if (!ref) return;
  detailCtl?.abort();
  const ctl = (detailCtl = new AbortController());
  clearTimeout(refreshTimer);
  try {
    const detail = await fetchObject(ref.layer, ref.objectId, timeState.at, ctl.signal);
    if (ctl.signal.aborted) return;
    selection.detail = detail;
    selection.phase = 'ready';
    selection.refreshFailed = false;
  } catch (e) {
    if (isAbort(e) || ctl.signal.aborted) return;
    if (e instanceof ApiRequestError && e.failure === 'not-found') {
      selection.phase = 'gone';
    } else if (selection.detail) {
      selection.refreshFailed = true; // keep showing the last good detail
    } else {
      selection.phase = 'error';
      selection.error = describe(e);
    }
  }
  scheduleRefresh();
}

function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  if (!selection.ref || timeState.at !== null || document.hidden) return; // history does not change
  const freshness = feedStore.byLayer[selection.ref.layer]?.freshnessMs;
  refreshTimer = setTimeout(() => {
    void loadDetail();
    if (selection.track === 'on') void loadTrack(true);
  }, cadenceMs(freshness));
}

async function loadTrack(quiet = false): Promise<void> {
  const ref = selection.ref;
  if (!ref) return;
  trackCtl?.abort();
  const ctl = (trackCtl = new AbortController());
  if (!quiet) selection.track = 'loading';
  const to = timeState.at ?? Date.now();
  try {
    const t = await fetchTrack(ref.layer, ref.objectId, { from: to - SIX_HOURS, to }, ctl.signal);
    if (ctl.signal.aborted) return;
    const drawn = getData()?.showTrack(ref.layer, t.points) ?? false;
    selection.track = drawn ? 'on' : 'empty';
  } catch (e) {
    if (isAbort(e) || ctl.signal.aborted) return;
    if (!quiet) selection.track = 'error';
  }
}

/** Select an object (or clear with null). */
export function selectObject(ref: Selected | null): void {
  const same = ref && selection.ref && ref.layer === selection.ref.layer && ref.objectId === selection.ref.objectId;
  if (same) return;
  detailCtl?.abort();
  trackCtl?.abort();
  clearTimeout(refreshTimer);
  selection.ref = ref;
  selection.detail = null;
  selection.error = '';
  selection.refreshFailed = false;
  selection.following = false;
  selection.track = 'off';
  getData()?.select(ref);
  if (!ref) {
    selection.phase = 'idle';
    return;
  }
  selection.phase = 'loading';
  void loadDetail();
}

/** A click on the globe (null: empty space). */
export function selectFromGlobe(ref: Selected | null): void {
  selectObject(ref);
}

export function onFollowStopped(): void {
  selection.following = false;
}

export function retryDetail(): void {
  if (!selection.ref) return;
  selection.phase = 'loading';
  void loadDetail();
}

export function toggleFollow(): void {
  const data = getData();
  if (!data || !selection.ref) return;
  if (selection.following) {
    data.follow(false);
    selection.following = false;
    return;
  }
  if (data.follow(true)) {
    selection.following = true;
  } else if (selection.detail) {
    // Not drawn right now (outside the loaded area): go there first.
    const o = selection.detail.observation;
    flyTo({ lon: o.lon, lat: o.lat, kind: 'place' });
  }
}

export function toggleTrack(): void {
  if (!selection.ref) return;
  if (selection.track === 'on' || selection.track === 'loading') {
    trackCtl?.abort();
    getData()?.hideTrack();
    selection.track = 'off';
    return;
  }
  void loadTrack();
}

/** "a9f3c1  37.72130, -122.28740" */
export function copyText(d: ObjectDetail): string {
  return `${d.objectId}  ${formatLatLon(d.observation.lat, d.observation.lon, 5)}`;
}

export async function copySelection(): Promise<void> {
  const d = selection.detail;
  if (!d) return;
  const text = copyText(d);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      ta.remove();
    }
  }
  selection.copied = true;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => (selection.copied = false), 1800);
}

// Viewed time changed: reload what is shown for the new instant.
onTimeCommit(() => {
  if (!selection.ref) return;
  void loadDetail();
  if (selection.track === 'on' || selection.track === 'empty') void loadTrack(true);
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && selection.ref) void loadDetail();
  });
}
