import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debounce } from './debounce.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('debounce fires once with the last arguments', async () => {
  const calls: number[] = [];
  const d = debounce((n: number) => calls.push(n), 20);
  d(1);
  d(2);
  d(3);
  await sleep(50);
  assert.deepEqual(calls, [3]);
});

test('cancel drops the pending call', async () => {
  const calls: number[] = [];
  const d = debounce((n: number) => calls.push(n), 20);
  d(1);
  d.cancel();
  await sleep(40);
  assert.deepEqual(calls, []);
});

test('flush runs immediately and only once', async () => {
  const calls: number[] = [];
  const d = debounce((n: number) => calls.push(n), 20);
  d(7);
  d.flush();
  d.flush();
  await sleep(40);
  assert.deepEqual(calls, [7]);
});
