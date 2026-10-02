import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitMatches } from './highlight.ts';

test('marks matching words case-insensitively', () => {
  assert.deepEqual(splitMatches('San Francisco, California', 'san fran'), [
    { text: 'San', match: true },
    { text: ' ', match: false },
    { text: 'Fran', match: true },
    { text: 'cisco, California', match: false },
  ]);
});

test('returns one plain segment for no match or empty query', () => {
  assert.deepEqual(splitMatches('Paris', ''), [{ text: 'Paris', match: false }]);
  assert.deepEqual(splitMatches('Paris', 'xyz'), [{ text: 'Paris', match: false }]);
});

test('escapes regex characters', () => {
  assert.deepEqual(splitMatches('a (b) c', '(b)'), [
    { text: 'a ', match: false },
    { text: '(b)', match: true },
    { text: ' c', match: false },
  ]);
});
