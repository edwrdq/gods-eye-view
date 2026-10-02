import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mimeFor, playVerdict, type PlayInput } from './radioPlay.ts';

const base: PlayInput = { play: 'audio', codec: 'MP3', streamUrl: 'https://s.example/live', hls: false, pageProtocol: 'http:', canPlayType: () => 'maybe' };

test('a plain MP3 or AAC stream plays in the audio element', () => {
  assert.deepEqual(playVerdict(base), { mode: 'audio', mime: 'audio/mpeg' });
  assert.deepEqual(playVerdict({ ...base, codec: 'AAC+' }), { mode: 'audio', mime: 'audio/aac' });
  assert.equal(mimeFor('ogg'), 'audio/ogg');
  assert.equal(mimeFor('UNKNOWN'), null);
});

test('HLS, unknown codecs and what the browser cannot decode are links with a reason', () => {
  assert.equal(playVerdict({ ...base, hls: true }).mode, 'link');
  assert.match((playVerdict({ ...base, hls: true }) as { reason: string }).reason, /HLS/);
  assert.equal(playVerdict({ ...base, play: 'link', codec: 'UNKNOWN' }).mode, 'link');
  assert.equal(playVerdict({ ...base, codec: 'FLV', play: 'link' }).mode, 'link');
  const v = playVerdict({ ...base, codec: 'OGG', canPlayType: (m) => (m === 'audio/ogg' ? '' : 'probably') });
  assert.deepEqual(v, { mode: 'link', reason: 'This browser cannot play OGG.' });
});

test('an http stream is not played from an https page; other schemes never play', () => {
  assert.equal(playVerdict({ ...base, streamUrl: 'http://s.example/live', pageProtocol: 'https:' }).mode, 'link');
  assert.equal(playVerdict({ ...base, streamUrl: 'http://s.example/live', pageProtocol: 'http:' }).mode, 'audio');
  assert.equal(playVerdict({ ...base, streamUrl: 'javascript:alert(1)' }).mode, 'link');
  assert.equal(playVerdict({ ...base, streamUrl: 'file:///etc/passwd' }).mode, 'link');
});
