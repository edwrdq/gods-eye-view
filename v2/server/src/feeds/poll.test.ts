import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './http.ts';
import { PollLoop } from './poll.ts';
import { clock, manualTimers } from './test-utils.ts';

function make(runs: Array<() => Promise<{ nextInMs?: number } | void>>, over: Partial<ConstructorParameters<typeof PollLoop>[0]> = {}) {
  const c = clock(1_000_000);
  const errors: unknown[] = [];
  let i = 0;
  const loop = new PollLoop({
    intervalMs: 60_000,
    now: c.now,
    timers: manualTimers,
    run: () => runs[Math.min(i++, runs.length - 1)]!(),
    onError: (e) => void errors.push(e),
    ...over,
  });
  return { loop, c, errors, count: () => i };
}

test('polls immediately, then once per interval', async () => {
  const { loop, c, count } = make([async () => {}]);
  loop.start();
  await loop.idle();
  assert.equal(count(), 1);
  await loop.tick();
  assert.equal(count(), 1, 'not due yet');
  c.advance(59_999);
  await loop.tick();
  assert.equal(count(), 1);
  c.advance(1);
  await loop.tick();
  assert.equal(count(), 2);
  await loop.stop();
  c.advance(10 * 60_000);
  await loop.tick();
  assert.equal(count(), 2, 'stopped loops never poll');
});

test('failures back off exponentially up to the cap and recover', async () => {
  const fail = async () => {
    throw new Error('boom');
  };
  const { loop, c, errors, count } = make([fail, fail, fail, async () => {}], { maxBackoffMs: 200_000 });
  loop.start();
  await loop.idle();
  assert.equal(errors.length, 1);
  assert.equal(loop.nextDue - c.now(), 60_000);
  c.advance(60_000);
  await loop.tick();
  assert.equal(loop.nextDue - c.now(), 120_000);
  c.advance(120_000);
  await loop.tick();
  assert.equal(loop.nextDue - c.now(), 200_000, 'capped');
  c.advance(200_000);
  await loop.tick();
  assert.equal(count(), 4);
  assert.equal(loop.fails, 0);
  assert.equal(loop.nextDue - c.now(), 60_000);
  await loop.stop();
});

test('Retry-After extends the wait beyond the backoff, within a one hour ceiling', async () => {
  const { loop, c } = make([async () => { throw new HttpError(429, 600_000, 'HTTP 429'); }, async () => { throw new HttpError(429, 99 * 3_600_000, 'HTTP 429'); }]);
  loop.start();
  await loop.idle();
  assert.equal(loop.nextDue - c.now(), 600_000);
  c.advance(600_000);
  await loop.tick();
  assert.equal(loop.nextDue - c.now(), 3_600_000);
  await loop.stop();
});

test('a run can choose its own next delay; overlapping ticks do not start a second poll', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { loop, c, count } = make([async () => { await gate; return { nextInMs: 5_000 }; }]);
  loop.start();
  void loop.tick();
  void loop.tick();
  assert.equal(count(), 1);
  release();
  await loop.idle();
  assert.equal(loop.nextDue - c.now(), 5_000);
  await loop.stop();
});
