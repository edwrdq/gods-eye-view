import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from './config.ts';

test('defaults', () => {
  const c = loadConfig({});
  assert.equal(c.port, 8787);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.googleMapsApiKey, null);
  assert.equal(c.cesiumIonToken, null);
  assert.ok(path.isAbsolute(c.dataDir));
  assert.ok(c.dataDir.endsWith(path.join('server', 'data')));
});

test('empty strings become null; overrides apply', () => {
  const c = loadConfig({ PORT: '9000', HOST: '0.0.0.0', DATA_DIR: '/var/gev', GOOGLE_MAPS_API_KEY: '', CESIUM_ION_TOKEN: ' tok ' });
  assert.equal(c.port, 9000);
  assert.equal(c.host, '0.0.0.0');
  assert.equal(c.dataDir, '/var/gev');
  assert.equal(c.googleMapsApiKey, null);
  assert.equal(c.cesiumIonToken, 'tok');
});

test('invalid PORT throws', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }));
  assert.throws(() => loadConfig({ PORT: '70000' }));
});
