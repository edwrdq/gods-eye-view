import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getJson, getText, HttpError, retryAfterMs, USER_AGENT } from './http.ts';

const res = (status: number, body = '', headers: Record<string, string> = {}) => new Response(body, { status, headers });

test('retryAfterMs reads delta-seconds and HTTP dates', () => {
  assert.equal(retryAfterMs(res(429, '', { 'retry-after': '120' })), 120_000);
  assert.equal(retryAfterMs(res(429, '', { 'retry-after': '0' })), 0);
  assert.equal(retryAfterMs(res(429)), null);
  assert.equal(retryAfterMs(res(429, '', { 'retry-after': 'soon' })), null);
  const now = Date.parse('2026-10-02T12:00:00Z');
  assert.equal(retryAfterMs(res(503, '', { 'retry-after': 'Fri, 02 Oct 2026 12:01:30 GMT' }), now), 90_000);
  assert.equal(retryAfterMs(res(503, '', { 'retry-after': 'Fri, 02 Oct 2026 11:00:00 GMT' }), now), 0);
});

test('getText sends a polite User-Agent and throws HttpError with Retry-After', async () => {
  let seen: RequestInit | undefined;
  const ok = await getText(async (_u, init) => ((seen = init), res(200, 'hi')), 'https://x.test/');
  assert.equal(ok.text, 'hi');
  assert.equal((seen!.headers as Record<string, string>)['User-Agent'], USER_AGENT);
  assert.match(USER_AGENT, /gods-eye-view/);

  await assert.rejects(
    getText(async () => res(503, 'down', { 'retry-after': '30' }), 'https://x.test/'),
    (e: unknown) => e instanceof HttpError && e.status === 503 && e.retryAfterMs === 30_000,
  );
});

test('a 429 without a header takes the wait from the body (Launch Library 2 style)', async () => {
  await assert.rejects(
    getText(async () => res(429, '{"detail":"Request was throttled. Expected available in 2315 seconds."}'), 'https://x.test/'),
    (e: unknown) => e instanceof HttpError && e.status === 429 && e.retryAfterMs === 2_315_000,
  );
  await assert.rejects(
    getText(async () => res(429, 'slow down'), 'https://x.test/'),
    (e: unknown) => e instanceof HttpError && e.retryAfterMs === null,
  );
});

test('getText allows listed statuses, caps the body, and honours timeouts and aborts', async () => {
  assert.equal((await getText(async () => new Response(null, { status: 304 }), 'https://x.test/', { allow: [304] })).status, 304);
  await assert.rejects(getText(async () => res(200, 'x'.repeat(100)), 'https://x.test/', { maxBytes: 10 }), /too large/);
  await assert.rejects(getText(async () => res(200, 'x', { 'content-length': '999' }), 'https://x.test/', { maxBytes: 10 }), /too large/);
  const hang = (_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init!.signal!.addEventListener('abort', () => rej(new Error('aborted'))));
  const keepAlive = setTimeout(() => {}, 2000); // AbortSignal.timeout timers are unref'd
  await assert.rejects(getText(hang, 'https://x.test/', { timeoutMs: 20 }), /aborted/);
  const ac = new AbortController();
  const p = getText(hang, 'https://x.test/', { signal: ac.signal, timeoutMs: 10_000 });
  ac.abort();
  await assert.rejects(p, /aborted/);
  clearTimeout(keepAlive);
});

test('getJson rejects malformed JSON', async () => {
  assert.deepEqual(await getJson(async () => res(200, '{"a":1}'), 'https://x.test/'), { a: 1 });
  await assert.rejects(getJson(async () => res(200, '<html>'), 'https://x.test/'), /malformed JSON/);
});
