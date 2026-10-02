import { USER_AGENT } from '../http.ts';
import type { FetchLike } from '../types.ts';
import type { Camera } from './camera.ts';
import type { CameraSource } from './sources/types.ts';

/** A camera is never fetched more often than this, whatever the source or the client asks for. */
export const MIN_REFRESH_S = 30;
/** Most bytes of one picture (a JPEG from a traffic camera is 10 to 400 KB). */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;
/** After a failure, a camera is not asked again for 30 s, 60 s ... up to this long. */
const MAX_RETRY_MS = 5 * 60_000;
/** A picture older than this is no longer served as a stand-in for a failed refresh. */
const MAX_STALE_MS = 15 * 60_000;

export type FrameOrigin = 'upstream' | 'cache' | 'stale';

export interface Frame {
  body: Uint8Array;
  contentType: string;
  /** When the picture was taken, as far as the source says (Last-Modified), else when it was fetched. Epoch ms. */
  frameTime: number;
  /** When this server last got it from the source. */
  fetchedAt: number;
  /** Seconds until the server will ask the source again. */
  refreshS: number;
  /** Seconds from now until the server will accept a new pull for this camera. */
  nextInS: number;
  origin: FrameOrigin;
}

export class FrameError extends Error {
  readonly status: 404 | 502 | 504;
  readonly retryAfterS: number | null;
  constructor(status: 404 | 502 | 504, message: string, retryAfterS: number | null = null) {
    super(message);
    this.name = 'FrameError';
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

interface Entry {
  body: Uint8Array | null;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  frameTime: number;
  fetchedAt: number;
  refreshS: number;
  failures: number;
  retryAt: number;
  used: number;
}

export interface FrameDeps {
  fetch: FetchLike;
  now?: () => number;
  log?: (msg: string) => void;
  /** Total bytes of pictures kept in memory (default 24 MB). Pictures live in memory only, never on disk. */
  maxBytes?: number;
  /** Source requests in flight at once (default 6), and per host (default 2). */
  maxConcurrent?: number;
  maxPerHost?: number;
}

/** JPEG, PNG, GIF or WebP by their first bytes: a 200 answer that is an HTML page is not a picture. */
export function looksLikeImage(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;
  return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** TxDOT answers JSON whose `snippet` is the base64 JPEG. Only canonical base64 is decoded. */
export function decodeTxdotEnvelope(text: string, maxBytes = MAX_FRAME_BYTES): Uint8Array | null {
  let snippet: unknown;
  try {
    snippet = (JSON.parse(text) as { snippet?: unknown }).snippet;
  } catch {
    return null;
  }
  if (typeof snippet !== 'string') return null;
  const s = snippet.trim().replace(/^data:image\/jpeg;base64,/i, '');
  if (s.length > Math.ceil((maxBytes * 4) / 3) + 8 || !BASE64.test(s)) return null;
  const body = Buffer.from(s, 'base64');
  return body.length > 0 && body.length <= maxBytes && looksLikeImage(body) ? body : null;
}

/**
 * Pictures from the cameras' own hosts, for the camera detail panel. The browser asks this
 * server, never the agency, so that
 * - one camera is pulled at most once per refresh interval however many people (or tabs) look at it;
 * - an unchanged picture costs a conditional request (ETag / Last-Modified);
 * - only addresses registered in a camera list are fetched, on the hosts the source names, over
 *   redirects that stay on the same origin;
 * - hosts that want a browser, or wrap the JPEG in JSON, work.
 * Pictures are kept in memory for the refresh interval only (never written to disk) and are not changed.
 */
export class FrameService {
  private readonly deps: FrameDeps;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Frame>>();
  private bytes = 0;
  private clock = 0;
  private active = 0;
  private readonly perHost = new Map<string, number>();
  private readonly waiting: Array<() => void> = [];
  private readonly aborts = new Set<AbortController>();
  /** Requests that went to a source (for tests). */
  upstreamRequests = 0;

  constructor(deps: FrameDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  stop(): void {
    for (const c of this.aborts) c.abort();
  }

  /** The newest known picture time of a camera, if a picture was fetched. */
  frameTimeOf(id: string): number | null {
    return this.entries.get(id)?.body ? this.entries.get(id)!.frameTime : null;
  }

  async get(camera: Camera, source: CameraSource): Promise<Frame> {
    const spec = source.frame;
    if (!spec || !camera.imageUrl) throw new FrameError(404, 'This camera has no still picture.');
    const refreshS = Math.max(MIN_REFRESH_S, camera.refreshS ?? spec.refreshS);
    const e = this.entries.get(camera.id);
    const now = this.now();
    if (e?.body && now - e.fetchedAt < refreshS * 1000) return this.frame(e, 'cache');
    if (e && e.retryAt > now) {
      if (e.body && now - e.fetchedAt < MAX_STALE_MS) return this.frame(e, 'stale');
      throw new FrameError(502, "The camera's source did not answer. Try again in a moment.", Math.ceil((e.retryAt - now) / 1000));
    }
    let p = this.inflight.get(camera.id);
    if (!p) {
      p = this.fetchFrame(camera, source, refreshS).finally(() => this.inflight.delete(camera.id));
      this.inflight.set(camera.id, p);
    }
    return p;
  }

  private frame(e: Entry, origin: FrameOrigin): Frame {
    e.used = ++this.clock;
    const next = Math.max(0, Math.ceil((e.fetchedAt + e.refreshS * 1000 - this.now()) / 1000));
    return { body: e.body!, contentType: e.contentType, frameTime: e.frameTime, fetchedAt: e.fetchedAt, refreshS: e.refreshS, nextInS: origin === 'stale' ? Math.max(next, Math.ceil((e.retryAt - this.now()) / 1000)) : next, origin };
  }

  private async fetchFrame(camera: Camera, source: CameraSource, refreshS: number): Promise<Frame> {
    const spec = source.frame!;
    const prev = this.entries.get(camera.id);
    const ctl = new AbortController();
    this.aborts.add(ctl);
    const host = (() => {
      try {
        return new URL(camera.imageUrl!).hostname;
      } catch {
        return '';
      }
    })();
    await this.acquire(host);
    try {
      let url = camera.imageUrl!;
      if (source.resolveImage) url = (await source.resolveImage(camera, { fetch: this.deps.fetch, signal: ctl.signal, now: this.now, log: this.deps.log ?? (() => {}) })) ?? url;
      if (!allowed(url, spec)) throw new FrameError(502, 'The camera address is not one this server may fetch.');
      this.upstreamRequests++;
      const res = await this.request(url, spec, prev, ctl.signal);
      const now = this.now();
      if (res.status === 304 && prev?.body) {
        prev.fetchedAt = now;
        prev.refreshS = refreshS;
        prev.failures = 0;
        prev.retryAt = 0;
        return this.frame(prev, 'upstream');
      }
      const lm = res.headers.get('last-modified');
      const taken = lm ? Date.parse(lm) : NaN;
      const e: Entry = {
        body: res.body,
        contentType: res.contentType,
        etag: res.headers.get('etag'),
        lastModified: lm,
        // A picture dated in the future (clock skew) is dated now.
        frameTime: Number.isFinite(taken) && taken <= now + 60_000 ? taken : now,
        fetchedAt: now,
        refreshS,
        failures: 0,
        retryAt: 0,
        used: ++this.clock,
      };
      this.store(camera.id, e);
      return this.frame(e, 'upstream');
    } catch (err) {
      const now = this.now();
      const timedOut = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
      const failures = (prev?.failures ?? 0) + 1;
      const wait = Math.min(30_000 * 2 ** (failures - 1), MAX_RETRY_MS);
      if (prev) {
        prev.failures = failures;
        prev.retryAt = now + wait;
      } else {
        this.entries.set(camera.id, { body: null, contentType: '', etag: null, lastModified: null, frameTime: 0, fetchedAt: 0, refreshS, failures, retryAt: now + wait, used: ++this.clock });
      }
      this.deps.log?.(`cctv: picture of ${camera.id} failed: ${(err as Error).message}`);
      if (prev?.body && now - prev.fetchedAt < MAX_STALE_MS) return this.frame(prev, 'stale');
      if (err instanceof FrameError) throw err.retryAfterS === null ? new FrameError(err.status, err.message, Math.ceil(wait / 1000)) : err;
      throw new FrameError(timedOut ? 504 : 502, timedOut ? "The camera's source took too long to answer." : "The camera's source did not answer with a picture.", Math.ceil(wait / 1000));
    } finally {
      this.aborts.delete(ctl);
      this.release(host);
    }
  }

  /** One request, following redirects that stay on the same origin. */
  private async request(url: string, spec: NonNullable<CameraSource['frame']>, prev: Entry | undefined, signal: AbortSignal): Promise<{ status: number; body: Uint8Array; contentType: string; headers: Headers }> {
    let current = new URL(url);
    const origin = current.origin;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const headers: Record<string, string> = { 'User-Agent': spec.userAgent ?? USER_AGENT, Accept: spec.format === 'txdot-json' ? 'application/json' : 'image/*' };
      if (prev?.body) {
        if (prev.etag) headers['If-None-Match'] = prev.etag;
        if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
      }
      const res = await this.deps.fetch(current.toString(), { headers, redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) });
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const loc = res.headers.get('location');
        void res.body?.cancel().catch(() => {});
        if (!loc || hop === MAX_REDIRECTS) throw new FrameError(502, 'The source redirected too often.');
        const next = new URL(loc, current);
        if (next.origin !== origin) throw new FrameError(502, 'The source redirected to another host.');
        current = next;
        continue;
      }
      if (res.status === 304) {
        void res.body?.cancel().catch(() => {});
        return { status: 304, body: new Uint8Array(0), contentType: '', headers: res.headers };
      }
      if (!res.ok) {
        void res.body?.cancel().catch(() => {});
        throw new FrameError(502, `The source answered HTTP ${res.status}.`);
      }
      const declared = Number(res.headers.get('content-length'));
      const cap = spec.format === 'txdot-json' ? Math.ceil((MAX_FRAME_BYTES * 4) / 3) + 4096 : MAX_FRAME_BYTES;
      if (Number.isFinite(declared) && declared > cap) {
        void res.body?.cancel().catch(() => {});
        throw new FrameError(502, 'The picture is too large.');
      }
      const raw = await readCapped(res, cap);
      if (spec.format === 'txdot-json') {
        const body = decodeTxdotEnvelope(Buffer.from(raw).toString('utf8'));
        if (!body) throw new FrameError(502, 'The source did not answer with a picture.');
        return { status: 200, body, contentType: 'image/jpeg', headers: res.headers };
      }
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!type.startsWith('image/') || !looksLikeImage(raw)) throw new FrameError(502, 'The source did not answer with a picture.');
      return { status: 200, body: raw, contentType: type, headers: res.headers };
    }
    throw new FrameError(502, 'The source redirected too often.');
  }

  // --- memory

  private store(id: string, e: Entry): void {
    const old = this.entries.get(id);
    if (old?.body) this.bytes -= old.body.length;
    this.entries.set(id, e);
    this.bytes += e.body?.length ?? 0;
    const cap = this.deps.maxBytes ?? 24 * 1024 * 1024;
    while (this.bytes > cap && this.entries.size > 1) {
      let oldest: [string, Entry] | null = null;
      for (const kv of this.entries) if (kv[0] !== id && kv[1].body && (!oldest || kv[1].used < oldest[1].used)) oldest = kv;
      if (!oldest) break;
      this.bytes -= oldest[1].body!.length;
      this.entries.delete(oldest[0]);
    }
  }

  // --- limits on requests to sources

  private async acquire(host: string): Promise<void> {
    const maxAll = this.deps.maxConcurrent ?? 6;
    const maxHost = this.deps.maxPerHost ?? 2;
    for (;;) {
      if (this.active < maxAll && (this.perHost.get(host) ?? 0) < maxHost) {
        this.active++;
        this.perHost.set(host, (this.perHost.get(host) ?? 0) + 1);
        return;
      }
      await new Promise<void>((r) => this.waiting.push(r));
    }
  }

  private release(host: string): void {
    this.active--;
    const n = (this.perHost.get(host) ?? 1) - 1;
    if (n <= 0) this.perHost.delete(host);
    else this.perHost.set(host, n);
    for (const w of this.waiting.splice(0)) w();
  }
}

function allowed(url: string, spec: NonNullable<CameraSource['frame']>): boolean {
  try {
    const u = new URL(url);
    if (u.username || u.password) return false;
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && spec.allowHttp)) return false;
    return spec.hosts.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Read a body, giving up once it passes `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => {});
      throw new FrameError(502, 'The picture is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
