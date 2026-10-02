import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFlags } from './flags.ts';

test('flags are inert in a production build', () => {
  assert.deepEqual(parseFlags('?bench=12000&fixtures=1', { dev: false, fixturesEnv: false }), { fixtures: false, bench: 0, feedStates: {} });
});

test('bench implies fixtures in dev', () => {
  assert.deepEqual(parseFlags('?bench=12000', { dev: true, fixturesEnv: false }), { fixtures: true, bench: 12000, feedStates: {} });
});

test('VITE_FIXTURES enables fixtures without bench', () => {
  assert.deepEqual(parseFlags('', { dev: false, fixturesEnv: true }), { fixtures: true, bench: 0, feedStates: {} });
});

test('bad bench values are ignored and capped', () => {
  assert.equal(parseFlags('?bench=abc', { dev: true, fixturesEnv: false }).bench, 0);
  assert.equal(parseFlags('?bench=-4', { dev: true, fixturesEnv: false }).bench, 0);
  assert.equal(parseFlags('?bench=9999999', { dev: true, fixturesEnv: false }).bench, 200_000);
});

test('fixture feed states parse', () => {
  assert.deepEqual(parseFlags('?feedstate=vessels:error,flights:stale', { dev: true, fixturesEnv: false }).feedStates, { vessels: 'error', flights: 'stale' });
});
