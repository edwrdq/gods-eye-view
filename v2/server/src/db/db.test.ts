import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Observation } from '@gev/shared';
import { openDb } from './index.ts';
import { migrate, migrations } from './migrations.ts';

function obs(over: Partial<Observation> = {}): Observation {
  return { layer: 'flights', objectId: 'abc123', t: 1000, lon: 10, lat: 20, props: {}, ...over };
}

test('migrations are idempotent and recorded', () => {
  const raw = new DatabaseSync(':memory:');
  assert.deepEqual(migrate(raw), migrations.map((m) => m.version));
  assert.deepEqual(migrate(raw), []);
  const rows = raw.prepare('SELECT version, name FROM schema_migrations').all();
  assert.equal(rows.length, migrations.length);
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'observations%'").all() as { name: string }[];
  assert.ok(tables.some((t) => t.name === 'observations_rtree'));
});

test('a failing migration rolls back and is not recorded', () => {
  const raw = new DatabaseSync(':memory:');
  assert.throws(() =>
    migrate(raw, [{ version: 1, name: 'bad', sql: 'CREATE TABLE a (x); SELECT * FROM missing_table;' }]),
  );
  assert.equal(raw.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n, 0);
  assert.equal(raw.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'a'").get()!.n, 0);
});

test('openDb creates the directory, uses WAL, and reopens cleanly', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-'));
  try {
    const file = path.join(dir, 'nested', 'gev.db');
    const db = openDb(file);
    assert.equal(db.raw.prepare('PRAGMA journal_mode').get()!.journal_mode, 'wal');
    db.observations.insertObservations([obs()]);
    assert.ok(db.sizeBytes() > 0);
    db.close();
    const again = openDb(file);
    assert.equal(again.observations.queryObservations({ layer: 'flights', limit: 10 }).length, 1);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('insert and round-trip incl. optional fields and props', () => {
  const db = openDb(':memory:');
  db.observations.insertObservations([
    obs({ alt: 10000, heading: 90, speed: 220, props: { callsign: 'UAL1', onGround: false, sq: null, n: 3 } }),
    obs({ objectId: 'bare', t: 2000 }),
  ]);
  const [bare, full] = db.observations.queryObservations({ layer: 'flights', limit: 10 });
  assert.equal(bare?.objectId, 'bare');
  assert.equal('alt' in bare!, false);
  assert.equal(full?.alt, 10000);
  assert.equal(full?.heading, 90);
  assert.equal(full?.speed, 220);
  assert.deepEqual(full?.props, { callsign: 'UAL1', onGround: false, sq: null, n: 3 });
  db.close();
});

test('insert is atomic: a bad row rolls back the whole batch', () => {
  const db = openDb(':memory:');
  assert.throws(() =>
    db.observations.insertObservations([obs(), obs({ lon: undefined as unknown as number })]),
  );
  assert.equal(db.observations.queryObservations({ layer: 'flights', limit: 10 }).length, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM observations_rtree').get()!.n, 0);
  db.close();
});

test('filters by layer, object, time range; newest first; limit', () => {
  const db = openDb(':memory:');
  db.observations.insertObservations([
    obs({ t: 100 }),
    obs({ t: 200 }),
    obs({ t: 300 }),
    obs({ t: 250, objectId: 'other' }),
    obs({ t: 250, layer: 'ships' }),
  ]);
  const q = db.observations.queryObservations.bind(db.observations);
  assert.deepEqual(q({ layer: 'flights', limit: 10 }).map((o) => o.t), [300, 250, 200, 100]);
  assert.deepEqual(q({ layer: 'flights', objectId: 'abc123', limit: 10 }).map((o) => o.t), [300, 200, 100]);
  assert.deepEqual(q({ layer: 'flights', from: 200, to: 250, limit: 10 }).map((o) => o.t), [250, 200]);
  assert.deepEqual(q({ layer: 'flights', limit: 2 }).map((o) => o.t), [300, 250]);
  assert.equal(q({ layer: 'ships', limit: 10 }).length, 1);
  assert.equal(q({ layer: 'nope', limit: 10 }).length, 0);
  db.close();
});

test('bbox query, inclusive edges, combined with time', () => {
  const db = openDb(':memory:');
  db.observations.insertObservations([
    obs({ objectId: 'in', lon: 5, lat: 5, t: 1 }),
    obs({ objectId: 'edge', lon: 10, lat: 10, t: 2 }),
    obs({ objectId: 'out-lon', lon: 11, lat: 5, t: 3 }),
    obs({ objectId: 'out-lat', lon: 5, lat: -1, t: 4 }),
  ]);
  const ids = (q: Parameters<typeof db.observations.queryObservations>[0]) =>
    db.observations.queryObservations(q).map((o) => o.objectId).sort();
  assert.deepEqual(ids({ layer: 'flights', bbox: [0, 0, 10, 10], limit: 10 }), ['edge', 'in']);
  assert.deepEqual(ids({ layer: 'flights', bbox: [0, 0, 10, 10], from: 2, limit: 10 }), ['edge']);
  assert.deepEqual(ids({ layer: 'flights', bbox: [-180, -90, 180, 90], limit: 10 }), ['edge', 'in', 'out-lat', 'out-lon']);
  db.close();
});

test('bbox crossing the antimeridian', () => {
  const db = openDb(':memory:');
  db.observations.insertObservations([
    obs({ objectId: 'fiji-e', lon: 179.5, lat: -17 }),
    obs({ objectId: 'fiji-w', lon: -179.5, lat: -17 }),
    obs({ objectId: 'edge-e', lon: 170, lat: -17 }),
    obs({ objectId: 'edge-w', lon: -170, lat: -17 }),
    obs({ objectId: 'greenwich', lon: 0, lat: -17 }),
    obs({ objectId: 'north', lon: 180, lat: 40 }),
  ]);
  const ids = (bbox: [number, number, number, number]) =>
    db.observations.queryObservations({ layer: 'flights', bbox, limit: 10 }).map((o) => o.objectId).sort();
  assert.deepEqual(ids([170, -30, -170, 0]), ['edge-e', 'edge-w', 'fiji-e', 'fiji-w']);
  assert.deepEqual(ids([175, -30, -175, 0]), ['fiji-e', 'fiji-w']);
  // the same corners unwrapped select the other side of the globe
  assert.deepEqual(ids([-175, -30, 175, 0]), ['edge-e', 'edge-w', 'greenwich']);
  db.close();
});

test('pruneBefore removes rows and rtree entries', () => {
  const db = openDb(':memory:');
  db.observations.insertObservations([obs({ t: 100 }), obs({ t: 200 }), obs({ t: 300 })]);
  assert.equal(db.observations.pruneBefore(250), 2);
  assert.deepEqual(db.observations.queryObservations({ layer: 'flights', limit: 10 }).map((o) => o.t), [300]);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM observations_rtree').get()!.n, 1);
  assert.equal(db.observations.pruneBefore(250), 0);
  db.close();
});
