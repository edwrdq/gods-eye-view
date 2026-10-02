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
