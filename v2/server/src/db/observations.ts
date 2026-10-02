import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { BBox, Observation } from '@gev/shared';

export interface StoredObservation extends Observation {
  id: number;
}

export interface ObservationQuery {
  layer: string;
  /** [west, south, east, north]; west > east means the box crosses the antimeridian. */
  bbox?: BBox;
  /** Inclusive epoch ms bounds. */
  from?: number;
  to?: number;
  objectId?: string;
  limit: number;
}

export interface ObservationRepo {
  insertObservations(obs: Observation[]): void;
  /** Newest first. */
  queryObservations(q: ObservationQuery): StoredObservation[];
  /** Delete observations older than t (epoch ms). Returns rows removed. */
  pruneBefore(t: number): number;
}

const MAX_LIMIT = 100_000;

interface Row {
  id: number;
  layer: string;
  object_id: string;
  t: number;
  lon: number;
  lat: number;
  alt: number | null;
  heading: number | null;
  speed: number | null;
  props: string;
}

function toObservation(r: Row): StoredObservation {
  const o: StoredObservation = {
    id: r.id,
    layer: r.layer,
    objectId: r.object_id,
    t: r.t,
    lon: r.lon,
    lat: r.lat,
    props: JSON.parse(r.props),
  };
  if (r.alt !== null) o.alt = r.alt;
  if (r.heading !== null) o.heading = r.heading;
  if (r.speed !== null) o.speed = r.speed;
  return o;
}

export function createObservationRepo(db: DatabaseSync): ObservationRepo {
  const insertObs = db.prepare(
    `INSERT INTO observations (layer, object_id, t, lon, lat, alt, heading, speed, props)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTree = db.prepare(
    `INSERT INTO observations_rtree (id, min_lon, max_lon, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)`,
  );

  function inTransaction<T>(fn: () => T): T {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    insertObservations(obs) {
      if (obs.length === 0) return;
      inTransaction(() => {
        for (const o of obs) {
          const { lastInsertRowid } = insertObs.run(
            o.layer,
            o.objectId,
            o.t,
            o.lon,
            o.lat,
            o.alt ?? null,
            o.heading ?? null,
            o.speed ?? null,
            JSON.stringify(o.props),
          );
          insertTree.run(lastInsertRowid, o.lon, o.lon, o.lat, o.lat);
        }
      });
    },

    queryObservations(q) {
      const limit = Math.max(1, Math.min(Math.floor(q.limit), MAX_LIMIT));
      const where = ['o.layer = ?'];
      const params: SQLInputValue[] = [q.layer];
      let from = 'observations o';

      if (q.bbox) {
        const [west, south, east, north] = q.bbox;
        // R*Tree stores 32-bit floats, so it only pre-filters; exact checks on o.* follow.
        from = 'observations_rtree r JOIN observations o ON o.id = r.id';
        where.push('r.max_lat >= ? AND r.min_lat <= ?', 'o.lat >= ? AND o.lat <= ?');
        params.push(south, north, south, north);
        if (west <= east) {
          where.push('r.max_lon >= ? AND r.min_lon <= ?', 'o.lon >= ? AND o.lon <= ?');
          params.push(west, east, west, east);
        } else {
          where.push('(r.max_lon >= ? OR r.min_lon <= ?)', '(o.lon >= ? OR o.lon <= ?)');
          params.push(west, east, west, east);
        }
      }
      if (q.from !== undefined) {
        where.push('o.t >= ?');
        params.push(q.from);
      }
      if (q.to !== undefined) {
        where.push('o.t <= ?');
        params.push(q.to);
      }
      if (q.objectId !== undefined) {
        where.push('o.object_id = ?');
        params.push(q.objectId);
      }
      params.push(limit);

      const sql = `SELECT o.* FROM ${from} WHERE ${where.join(' AND ')}
                   ORDER BY o.t DESC, o.id DESC LIMIT ?`;
      return (db.prepare(sql).all(...params) as unknown as Row[]).map(toObservation);
    },

    pruneBefore(t) {
      return inTransaction(() => {
        db.prepare(
          'DELETE FROM observations_rtree WHERE id IN (SELECT id FROM observations WHERE t < ?)',
        ).run(t);
        return Number(db.prepare('DELETE FROM observations WHERE t < ?').run(t).changes);
      });
    },
  };
}
