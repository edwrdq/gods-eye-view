import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BBox } from '@gev/shared';
import { inBBox, isWorld } from '../../geo.ts';
import { HttpError } from '../http.ts';
import { thinGrid } from '../thin.ts';
import type { FetchLike } from '../types.ts';
import type { Camera } from './camera.ts';
import type { CameraSource } from './sources/types.ts';

const CACHE_VERSION = 1;
const MIN = 60_000;
/** A source that fails is not asked again for 1, 2, 4 ... minutes, at most this long (a Retry-After longer than that is honoured up to an hour). */
const MAX_BACKOFF_MS = 30 * MIN;

export interface CatalogDeps {
  sources: readonly CameraSource[];
  fetch: FetchLike;
  /** Directory for the per-source list caches; no caching when omitted. */
  cacheDir?: string;
  now?: () => number;
  log?: (msg: string) => void;
  /** Source lists fetched at the same time (default 3). */
  maxLoads?: number;
}

interface SourceState {
  source: CameraSource;
  cameras: Camera[];
  byId: Map<string, Camera>;
  /** When the list was fetched; null when nothing was ever loaded. */
  fetchedAt: number | null;
  loading: Promise<void> | null;
  /** Resolves when the first cameras are in (a partial answer counts) or the load failed. */
  firstData: Promise<void> | null;
  error: string | null;
  failures: number;
  nextTryAt: number;
}

interface CacheFile {
  version: number;
  fetchedAt: number;
  cameras: Camera[];
}

export interface CatalogQuery {
  cameras: Camera[];
  truncated: boolean;
}

function overlaps(a: BBox, b: BBox): boolean {
  if (a[1] > b[3] || a[3] < b[1]) return false;
  const lon = (box: BBox): Array<[number, number]> => (box[0] <= box[2] ? [[box[0], box[2]]] : [[box[0], 180], [-180, box[2]]]);
  return lon(a).some(([w1, e1]) => lon(b).some(([w2, e2]) => w1 <= e2 && w2 <= e1));
}

const isCamera = (c: unknown): c is Camera => {
  const x = c as Partial<Camera> | null;
  return !!x && typeof x.id === 'string' && typeof x.source === 'string' && typeof x.name === 'string' && Number.isFinite(x.lon) && Number.isFinite(x.lat) && Number.isFinite(x.heading) && (x.type === 'still' || x.type === 'video');
};

/**
 * The camera lists of all sources. Nothing is fetched until a view needs it: a view asks for the
 * sources whose coverage it overlaps, and only those that have no list yet are fetched (the view
 * waits for them, briefly). A list is kept on disk; once it is older than the source's TTL the
 * next view that overlaps it serves the old list at once and refreshes it in the background.
 * A failing source backs off and keeps serving its last list.
 */
export class CameraCatalog {
  private readonly deps: CatalogDeps;
  private readonly now: () => number;
  private readonly states: SourceState[];
  private readonly aborts = new Set<AbortController>();
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private stopped = false;
  /** Source list requests that went out (for tests). */
  loads = 0;

  constructor(deps: CatalogDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.states = deps.sources.map((source) => ({ source, cameras: [], byId: new Map(), fetchedAt: null, loading: null, firstData: null, error: null, failures: 0, nextTryAt: 0 }));
  }

  /** Read the cached lists (a missing or unreadable cache just means the first view fetches). */
  start(): void {
    this.stopped = false;
    const dir = this.deps.cacheDir;
    if (!dir) return;
    for (const st of this.states) {
      try {
        const c = JSON.parse(readFileSync(path.join(dir, `${st.source.id}.json`), 'utf8')) as CacheFile;
        if (c.version !== CACHE_VERSION || !Number.isFinite(c.fetchedAt) || !Array.isArray(c.cameras)) continue;
        const cams = c.cameras.filter(isCamera);
        if (cams.length > 0) this.setCameras(st, cams, c.fetchedAt);
      } catch {
        // first run
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const c of this.aborts) c.abort();
    await Promise.allSettled(this.states.map((s) => s.loading));
  }

  private setCameras(st: SourceState, cameras: Camera[], fetchedAt: number | null): void {
    st.cameras = cameras;
    st.byId = new Map(cameras.map((c) => [c.id, c]));
    if (fetchedAt !== null) st.fetchedAt = fetchedAt;
  }

  private saveCache(st: SourceState): void {
    const dir = this.deps.cacheDir;
    if (!dir || st.fetchedAt === null) return;
    try {
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${st.source.id}.json`);
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, fetchedAt: st.fetchedAt, cameras: st.cameras } satisfies CacheFile));
      renameSync(tmp, file);
    } catch (err) {
      this.deps.log?.(`cctv: cache write failed for ${st.source.id}: ${(err as Error).message}`);
    }
  }

  // --- loading

  private slot(): Promise<void> {
    const max = this.deps.maxLoads ?? 3;
    if (this.active < max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }

  private startLoad(st: SourceState): void {
    if (st.loading || this.stopped) return;
    let resolveFirst!: () => void;
    st.firstData = st.cameras.length > 0 ? null : new Promise<void>((r) => (resolveFirst = r));
    st.loading = this.run(st, resolveFirst).finally(() => {
      st.loading = null;
      st.firstData = null;
      resolveFirst?.();
    });
  }

  private async run(st: SourceState, firstData: () => void): Promise<void> {
    await this.slot();
    const ctl = new AbortController();
    this.aborts.add(ctl);
    const cold = st.cameras.length === 0;
    const log = this.deps.log ?? (() => {});
    try {
      if (this.stopped) return;
      this.loads++;
      const t0 = this.now();
      const res = await st.source.load({
        fetch: this.deps.fetch,
        signal: ctl.signal,
        now: this.now,
        log,
        // A first load shows what has arrived; a refresh swaps the whole list at once so nothing flickers.
        partial: cold ? (cams) => { this.setCameras(st, cams, null); firstData(); } : undefined,
      });
      let cameras = res.cameras;
      if (res.failedGroups?.length) {
        const failed = new Set(res.failedGroups);
        cameras = [...cameras, ...st.cameras.filter((c) => c.group !== undefined && failed.has(c.group) && !cameras.some((n) => n.id === c.id))];
      }
      this.setCameras(st, cameras, this.now());
      st.error = null;
      st.failures = 0;
      st.nextTryAt = 0;
      this.saveCache(st);
      log(`cctv: ${st.source.id}: ${cameras.length} cameras in ${this.now() - t0} ms`);
    } catch (err) {
      if (this.stopped) return;
      st.error = (err as Error).message;
      st.failures++;
      let wait = Math.min(MIN * 2 ** (st.failures - 1), MAX_BACKOFF_MS);
      if (err instanceof HttpError && err.retryAfterMs !== null) wait = Math.max(wait, Math.min(err.retryAfterMs, 60 * MIN));
      st.nextTryAt = this.now() + wait;
      log(`cctv: ${st.source.id} failed (${st.error}); next try in ${Math.round(wait / 1000)} s`);
    } finally {
      this.aborts.delete(ctl);
      this.release();
    }
  }

  /**
   * Make sure the sources a view needs have lists. Sources without any list are fetched and the
   * call waits for them, up to `waitMs` (a source with several parts counts as ready once its first
   * part is in); stale lists are refreshed in the background. Resolves with `pending` true when a
   * needed source is still loading, so the client asks again soon.
   */
  async ensure(view: BBox | undefined, waitMs: number): Promise<{ pending: boolean }> {
    if (this.stopped) return { pending: false };
    const now = this.now();
    const box = view && !isWorld(view) ? view : undefined;
    const centre = box ? [(box[0] + (box[0] <= box[2] ? box[2] : box[2] + 360)) / 2, (box[1] + box[3]) / 2] : [0, 0];
    const needed = this.states
      .filter((st) => !box || overlaps(st.source.coverage, box))
      .sort((a, b) => dist(a.source.coverage, centre) - dist(b.source.coverage, centre));
    const waiting: Array<Promise<void>> = [];
    for (const st of needed) {
      const empty = st.cameras.length === 0;
      const stale = st.fetchedAt !== null && now - st.fetchedAt > st.source.catalogTtlMs;
      if ((empty || stale) && !st.loading && now >= st.nextTryAt) this.startLoad(st);
      if (empty && st.loading) waiting.push(st.firstData ?? st.loading);
    }
    // A wide view needs many sources; it shows what is quick and asks again rather than wait for the slowest.
    if (needed.length > 3) waitMs = Math.min(waitMs, 2_500);
    if (waiting.length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((r) => (timer = setTimeout(r, waitMs)));
      await Promise.race([Promise.all(waiting), timeout]);
      clearTimeout(timer);
    }
    return { pending: needed.some((st) => st.loading !== null && (st.cameras.length === 0 || st.fetchedAt === null)) };
  }

  // --- reading

  /** Cameras inside the view, thinned evenly over it when there are more than `cap`. */
  query(view: BBox | undefined, cap: number): CatalogQuery {
    const box = view && !isWorld(view) ? view : undefined;
    let hits: Camera[] = [];
    for (const st of this.states) {
      if (st.cameras.length === 0 || (box && !overlaps(st.source.coverage, box))) continue;
      if (!box) hits = hits.concat(st.cameras);
      else for (const c of st.cameras) if (inBBox(c.lon, c.lat, box)) hits.push(c);
    }
    let truncated = false;
    if (hits.length > cap) {
      // Cameras whose facing is a fact, then live-video ones (rarer), win a cell.
      hits = thinGrid(hits, cap, box, { lon: (c) => c.lon, lat: (c) => c.lat, score: (c) => (c.headingConfidence === 'known' ? 2 : 0) + (c.type === 'video' ? 1 : 0), id: (c) => c.id });
      truncated = true;
    }
    return { cameras: hits, truncated };
  }

  get(id: string): { camera: Camera; source: CameraSource } | undefined {
    for (const st of this.states) {
      const camera = st.byId.get(id);
      if (camera) return { camera, source: st.source };
    }
    return undefined;
  }

  source(id: string): CameraSource | undefined {
    return this.states.find((s) => s.source.id === id)?.source;
  }

  summary(): { count: number; lastSuccess: number | null; lastError: string | null; loading: boolean; failing: string[] } {
    let count = 0;
    let lastSuccess: number | null = null;
    let lastError: string | null = null;
    let loading = false;
    const failing: string[] = [];
    for (const st of this.states) {
      count += st.cameras.length;
      if (st.fetchedAt !== null && (lastSuccess === null || st.fetchedAt > lastSuccess)) lastSuccess = st.fetchedAt;
      if (st.loading) loading = true;
      if (st.error) {
        failing.push(st.source.name);
        lastError = `${st.source.name}: ${st.error}`;
      }
    }
    return { count, lastSuccess, lastError, loading, failing };
  }
}

function dist(box: BBox, c: number[]): number {
  const lon = (box[0] + box[2]) / 2;
  const lat = (box[1] + box[3]) / 2;
  const dl = Math.min(Math.abs(lon - c[0]!), 360 - Math.abs(lon - c[0]!));
  return Math.hypot(dl, lat - c[1]!);
}
