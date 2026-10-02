import type { FetchLike } from './types.ts';

/** Sent with every request to a public data provider. */
export const USER_AGENT = 'gods-eye-view-v2 (+https://github.com/bilawalsidhu/gods-eye-view)';

export class HttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  constructor(status: number, retryAfterMs: number | null, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Parse Retry-After (delta-seconds or HTTP date) into milliseconds, or null. */
export function retryAfterMs(res: Pick<Response, 'headers'>, now: number = Date.now()): number | null {
  const raw = res.headers.get('retry-after');
  if (raw === null || raw.trim() === '') return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return secs >= 0 ? secs * 1000 : null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

export interface GetOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Reject bodies larger than this many bytes. */
  maxBytes?: number;
  headers?: Record<string, string>;
  now?: () => number;
}

export interface TextResponse {
  status: number;
  headers: Headers;
  /** Empty for 304. */
  text: string;
}

/**
 * GET a URL as text. Throws HttpError for any non-2xx status except those in
 * `allow` (e.g. 304), carrying Retry-After so callers can back off.
 */
export async function getText(
  fetchFn: FetchLike,
  url: string,
  opts: GetOptions & { allow?: readonly number[] } = {},
): Promise<TextResponse> {
  const signals = [AbortSignal.timeout(opts.timeoutMs ?? 20_000)];
  if (opts.signal) signals.push(opts.signal);
  const res = await fetchFn(url, {
    headers: { 'User-Agent': USER_AGENT, ...opts.headers },
    signal: AbortSignal.any(signals),
  });
  if (!res.ok && !opts.allow?.includes(res.status)) {
    let wait = retryAfterMs(res, opts.now?.());
    if (res.status === 429 && wait === null) {
      // Launch Library 2 states the wait only in the body: "Expected available in 2315 seconds."
      const body = await res.text().catch(() => '');
      const m = body.slice(0, 2000).match(/available in (\d+) seconds/i);
      if (m) wait = Number(m[1]) * 1000;
    } else {
      void res.body?.cancel().catch(() => {});
    }
    throw new HttpError(res.status, wait, `HTTP ${res.status}`);
  }
  const max = opts.maxBytes ?? 32 * 1024 * 1024;
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    void res.body?.cancel().catch(() => {});
    throw new Error(`response too large (${declared} bytes)`);
  }
  const text = await res.text();
  if (text.length > max) throw new Error('response too large');
  return { status: res.status, headers: res.headers, text };
}

export async function getJson(fetchFn: FetchLike, url: string, opts: GetOptions = {}): Promise<unknown> {
  const { text } = await getText(fetchFn, url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('malformed JSON response');
  }
}
