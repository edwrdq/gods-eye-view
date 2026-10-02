import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createFeatureRepo, type FeatureRepo } from './features.ts';
import { migrate } from './migrations.ts';
import { createObservationRepo, type ObservationRepo } from './observations.ts';

export interface Db {
  path: string;
  raw: DatabaseSync;
  observations: ObservationRepo;
  features: FeatureRepo;
  sizeBytes(): number;
  close(): void;
}

/** Open (creating if needed) the history database and bring its schema up to date. */
export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA synchronous = NORMAL');
  raw.exec('PRAGMA busy_timeout = 5000');
  migrate(raw);
  return {
    path: file,
    raw,
    observations: createObservationRepo(raw),
    features: createFeatureRepo(raw),
    sizeBytes() {
      if (file === ':memory:') return 0;
      let total = 0;
      for (const f of [file, `${file}-wal`]) {
        try {
          total += statSync(f).size;
        } catch {
          // file may not exist yet
        }
      }
      return total;
    },
    close() {
      raw.close();
    },
  };
}
