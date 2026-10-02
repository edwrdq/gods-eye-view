import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyKey, cameraForm, cameraLabel, cameraOrder, confidenceNote, headingText, wedgeKey } from './cameraStyle.ts';

test('form: anything but known is estimated; video only for video', () => {
  assert.deepEqual(cameraForm('known', 'still'), { confidence: 'known', kind: 'still' });
  assert.deepEqual(cameraForm('', 'video'), { confidence: 'estimated', kind: 'video' });
  assert.deepEqual(cameraForm('weird', 'weird'), { confidence: 'estimated', kind: 'still' });
});

test('image keys differ by what changes the picture, not by heading', () => {
  const k = cameraForm('known', 'still');
  const e = cameraForm('estimated', 'still');
  assert.notEqual(bodyKey(k, '#a3d64f'), bodyKey(e, '#a3d64f'));
  assert.notEqual(bodyKey(k, '#a3d64f'), bodyKey(cameraForm('known', 'video'), '#a3d64f'));
  assert.equal(wedgeKey('#a3d64f'), 'gev-cam:wedge:#a3d64f', 'one wedge image for all');
});

test('known cameras draw above estimated ones', () => {
  assert.ok(cameraOrder('known') > cameraOrder('estimated'));
});

test('heading text and the confidence note', () => {
  assert.equal(headingText(45), 'NE 045°');
  assert.equal(headingText(359.9), 'N 000°');
  assert.equal(headingText(Number.NaN), '');
  assert.match(confidenceNote('estimated', 'placeholder'), /placeholder/);
  assert.match(confidenceNote('known', 'curated'), /by hand/);
  assert.match(confidenceNote('known', 'published'), /operator/);
});

test('labels are trimmed', () => {
  assert.equal(cameraLabel('  Short  '), 'Short');
  assert.equal(cameraLabel('x'.repeat(50)).length, 34);
});
