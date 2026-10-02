import type { DatabaseSync } from 'node:sqlite';
import type { BBox, PropValue } from '@gev/shared';

/** A point event as stored in history. */
export interface FeatureRow {
  id: string;
  /** Event time, epoch ms. */
  t: number;
  /** Source revision time, epoch ms; a row is only replaced by a newer one. */
  updated: number;
  lon: number;
  lat: number;
  /** Sort key when a response is capped; larger comes first. */
  rank: number;
  label: string | null;
  props: Record<string, PropValue>;
  /** Detail-only fields (felt reports, links, ...). */
  extra: Record<string, PropValue>;
}

export interface FeatureRepo {
  /** Insert new events and replace those with a newer revision. Returns rows written. */
  upsertMany(layer: string, rows: FeatureRow[]): number;
  query(layer: string, q: { from: number; to: number; bbox?: BBox; limit: number }): { rows: FeatureRow[]; truncated: boolean };
  get(layer: string, id: string): FeatureRow | null;
  /**
   * Remove events at or after `sinceT` whose id is not in `keepIds` (events the
   * source withdrew while still inside its feed window). Returns rows removed.
   */
  deleteMissingSince(layer: string, sinceT: number, keepIds: ReadonlySet<string>): number;
  pruneBefore(layer: string, cutoffT: number): number;
  count(layer: string): number;
}

interface DbRow {
  id: string;
  t: number;
  updated: number;
  lon: number;
  lat: number;
  rank: number;
  label: string | null;
  props: string;
  extra: string;
}

const COLUMNS = 'id, t, updated, lon, lat, rank, label, props, extra';

function toRow(r: DbRow): FeatureRow {
  return {
    id: r.id,
    t: r.t,
    updated: r.updated,
    lon: r.lon,
    lat: r.lat,
    rank: r.rank,
    label: r.label,
    props: JSON.parse(r.props) as FeatureRow['props'],
    extra: JSON.parse(r.extra) as FeatureRow['extra'],
  };
}

export function createFeatureRepo(db: DatabaseSync): FeatureRepo {
  const upsert = db.prepare(`
    INSERT INTO features (layer, id, t, updated, lon, lat, rank, label, props, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (layer, id) DO UPDATE SET
      t = excluded.t, updated = excluded.updated, lon = excluded.lon, lat = excluded.lat,
      rank = excluded.rank, label = excluded.label, props = excluded.props, extra = excluded.extra
    WHERE excluded.updated > features.updated
  `);
  const getOne = db.prepare(`SELECT ${COLUMNS} FROM features WHERE layer = ? AND id = ?`);
  const idsSince = db.prepare('SELECT id FROM features WHERE layer = ? AND t >= ?');
  const del = db.prepare('DELETE FROM features WHERE layer = ? AND id = ?');
  const prune = db.prepare('DELETE FROM features WHERE layer = ? AND t < ?');
  const countAll = db.prepare('SELECT COUNT(*) AS n FROM features WHERE layer = ?');

  function transaction<T>(fn: () => T): T {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    upsertMany(layer, rows) {
      return transaction(() => {
        let written = 0;
        for (const r of rows) {
          const res = upsert.run(layer, r.id, r.t, r.updated, r.lon, r.lat, r.rank, r.label, JSON.stringify(r.props), JSON.stringify(r.extra));
          written += Number(res.changes);
        }
        return written;
      });
    },

    query(layer, q) {
      const where = ['layer = ?', 't >= ?', 't <= ?'];
      const args: Array<string | number> = [layer, q.from, q.to];
      if (q.bbox) {
        const [west, south, east, north] = q.bbox;
        where.push('lat >= ? AND lat <= ?');
        args.push(south, north);
        if (west <= east) {
          where.push('lon >= ? AND lon <= ?');
          args.push(west, east);
        } else {
          where.push('(lon >= ? OR lon <= ?)');
          args.push(west, east);
        }
      }
      args.push(q.limit + 1);
      const rows = (db
        .prepare(`SELECT ${COLUMNS} FROM features WHERE ${where.join(' AND ')} ORDER BY rank DESC, t DESC, id LIMIT ?`)
        .all(...args) as unknown as DbRow[]);
      const truncated = rows.length > q.limit;
      if (truncated) rows.length = q.limit;
      return { rows: rows.map(toRow), truncated };
    },

    get(layer, id) {
      const r = getOne.get(layer, id) as DbRow | undefined;
      return r ? toRow(r) : null;
    },

    deleteMissingSince(layer, sinceT, keepIds) {
      return transaction(() => {
        const stored = idsSince.all(layer, sinceT) as unknown as Array<{ id: string }>;
        let removed = 0;
        for (const { id } of stored) {
          if (keepIds.has(id)) continue;
          removed += Number(del.run(layer, id).changes);
        }
        return removed;
      });
    },

    pruneBefore(layer, cutoffT) {
      return Number(prune.run(layer, cutoffT).changes);
    },

    count(layer) {
      return Number((countAll.get(layer) as { n: number }).n);
    },
  };
}
