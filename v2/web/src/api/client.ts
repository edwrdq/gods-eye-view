import type { ApiError } from '@gev/shared';

/** Why a request failed, in terms the UI can act on. */
export type ApiFailure =
  /** 404: unknown layer, or the object is no longer in the feed. */
  | 'not-found'
  /** 409: the feed is off or needs a key. */
  | 'unavailable'
  /** 502: the upstream source failed. */
  | 'upstream'
  /** 400 and other client errors: a bug on our side. */
  | 'bad-request'
  /** The server was unreachable or answered with a server error. */
  | 'network';

export class ApiRequestError extends Error {
  readonly failure: ApiFailure;
  readonly status: number;
  constructor(failure: ApiFailure, status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.failure = failure;
    this.status = status;
  }
}

export function isAbort(e: unknown): boolean {
  return (e instanceof DOMException && e.name === 'AbortError') || (e instanceof Error && e.name === 'AbortError');
}

export function failureFromStatus(status: number): ApiFailure {
  if (status === 404) return 'not-found';
  if (status === 409) return 'unavailable';
  if (status === 502) return 'upstream';
  if (status >= 400 && status < 500) return 'bad-request';
  return 'network';
}

export interface ApiConfig {
  fixtures: boolean;
  bench: number;
  feedStates: Record<string, string>;
  /** Synthetic satellites for the satellites performance bench; 0 = off. */
  satBench: number;
}

let cfg: ApiConfig = { fixtures: false, bench: 0, feedStates: {}, satBench: 0 };

/** Called once per thread (main and worker) before any request. */
export function configureApi(next: ApiConfig): void {
  cfg = next;
}

export type Params = Record<string, string | number | undefined | null>;

export function buildQuery(params: Params | undefined): string {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** GET `path` (under /api) as JSON. Rejects with ApiRequestError, or an AbortError when aborted. */
export async function getJson<T>(path: string, params: Params | undefined, signal?: AbortSignal): Promise<T> {
  if (import.meta.env.DEV || import.meta.env.VITE_FIXTURES) {
    if (cfg.fixtures) {
      const { handleFixture } = await import('./fixtures.ts');
      signal?.throwIfAborted();
      return (await handleFixture(path, params ?? {}, cfg)) as T;
    }
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}${buildQuery(params)}`, { signal, headers: { accept: 'application/json' } });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiRequestError('network', 0, 'The server did not respond.');
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as Partial<ApiError>;
      if (typeof body.error === 'string' && body.error) message = body.error;
    } catch {
      /* body was not JSON */
    }
    throw new ApiRequestError(failureFromStatus(res.status), res.status, message);
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiRequestError('network', res.status, 'The server sent an unreadable response.');
  }
}
