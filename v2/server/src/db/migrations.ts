import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Append only. Never edit a migration that has shipped.
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'observations',
    sql: `
      CREATE TABLE observations (
        id INTEGER PRIMARY KEY,
        layer TEXT NOT NULL,
        object_id TEXT NOT NULL,
        t INTEGER NOT NULL,
        lon REAL NOT NULL,
        lat REAL NOT NULL,
        alt REAL,
        heading REAL,
        speed REAL,
        props TEXT NOT NULL
      );
      CREATE INDEX observations_object ON observations (layer, object_id, t);
      CREATE INDEX observations_time ON observations (layer, t);
      CREATE VIRTUAL TABLE observations_rtree USING rtree(
        id, min_lon, max_lon, min_lat, max_lat
      );
    `,
  },
  {
    version: 2,
    name: 'observations_time_indexes',
    // observations_t: history range (MIN/MAX t) and pruneBefore (t < ?) would
    // otherwise scan the whole table.
    // observations_layer_time_object replaces observations_time (layer, t) with a
    // covering version, so "which objects reported in this window" is answered
    // from the index alone (see latestPerObject). Per-object lookups stay on
    // observations_object from migration 1.
    sql: `
      CREATE INDEX observations_t ON observations (t);
      DROP INDEX observations_time;
      CREATE INDEX observations_layer_time_object ON observations (layer, t, object_id);
    `,
  },
  {
    version: 3,
    name: 'features',
    // Point events kept for time-travel queries (earthquakes). One row per event
    // id, replaced when the source publishes a newer revision (`updated`).
    // `rank` orders results when a response is capped (magnitude for quakes).
    // `extra` holds detail-only fields so history can render the detail panel.
    sql: `
      CREATE TABLE features (
        layer TEXT NOT NULL,
        id TEXT NOT NULL,
        t INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        lon REAL NOT NULL,
        lat REAL NOT NULL,
        rank REAL NOT NULL,
        label TEXT,
        props TEXT NOT NULL,
        extra TEXT NOT NULL,
        PRIMARY KEY (layer, id)
      ) WITHOUT ROWID;
      CREATE INDEX features_layer_time ON features (layer, t);
    `,
  },
];

/** Apply pending migrations in order, each in its own transaction. Returns versions applied. */
export function migrate(db: DatabaseSync, list: Migration[] = migrations): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const done = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const applied: number[] = [];
  for (const m of [...list].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        Date.now(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    applied.push(m.version);
  }
  return applied;
}
