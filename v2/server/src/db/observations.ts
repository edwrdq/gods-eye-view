import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { BBox, Observation } from '@gev/shared';
import { isWorld } from '../geo.ts';

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
  /**
   * Delete observations older than t (epoch ms). Returns rows removed. With
   * maxRows, removes at most that many (oldest first) so callers can chunk a
   * large prune and yield to the event loop between chunks.
   */
  pruneBefore(t: number, maxRows?: number): number;
  /**
   * Latest observation per object with `from <= t <= to`, restricted to
   * objects whose latest observation is inside bbox. Order is unspecified.
   */
  latestPerObject(q: LatestQuery): Observation[];
  /** Most recent observation of one object at or before `to` (any age). */
  latestFor(layer: string, objectId: string, to?: number): Observation | undefined;
  /**
   * Positions of one object, oldest first. When more than maxPoints rows match,
   * the series is thinned evenly (first and last point are kept).
   */
  trackPoints(layer: string, objectId: string, from: number, to: number, maxPoints: number): TrackRow[];
  /** Oldest and newest stored observation time across all layers. */
  timeRange(): { from: number | null; to: number | null };
}

export interface LatestQuery {
  layer: string;
  from: number;
  to: number;
  bbox?: BBox;
}

export type TrackRow = [t: number, lon: number, lat: number, alt: number | null];

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
  const o = toPlainObservation(r) as StoredObservation;
  o.id = r.id;
  return o;
}

function toPlainObservation(r: Row): Observation {
  const o: Observation = {
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

    pruneBefore(t, maxRows) {
      return inTransaction(() => {
        if (maxRows === undefined) {
          db.prepare(
            'DELETE FROM observations_rtree WHERE id IN (SELECT id FROM observations WHERE t < ?)',
          ).run(t);
          return Number(db.prepare('DELETE FROM observations WHERE t < ?').run(t).changes);
        }
        const n = Math.max(1, Math.floor(maxRows));
        db.prepare(
          `DELETE FROM observations_rtree WHERE id IN
             (SELECT id FROM observations WHERE t < ? ORDER BY t LIMIT ?)`,
        ).run(t, n);
        return Number(
          db
            .prepare(
              'DELETE FROM observations WHERE id IN (SELECT id FROM observations WHERE t < ? ORDER BY t LIMIT ?)',
            )
            .run(t, n).changes,
        );
      });
    },

    latestPerObject(q) {
      // Objects that reported inside the window come from the covering index;
      // each one's newest row at or before `to` is then a single index seek.
      // (A GROUP BY MAX(t) over every row in the window reads all of them,
      // which is several times slower once history holds many points per object.)
      const params: SQLInputValue[] = [q.layer, q.from, q.to, q.layer, q.to];
      let where = '';
      if (q.bbox && !isWorld(q.bbox)) {
        const [west, south, east, north] = q.bbox;
        where = 'WHERE o.lat >= ? AND o.lat <= ? AND ' + (west <= east ? 'o.lon >= ? AND o.lon <= ?' : '(o.lon >= ? OR o.lon <= ?)');
        params.push(south, north, west, east);
      }
      const sql = `SELECT o.* FROM
          (SELECT DISTINCT object_id FROM observations WHERE layer = ? AND t >= ? AND t <= ?) d
          JOIN observations o ON o.id = (
            SELECT i.id FROM observations i
            WHERE i.layer = ? AND i.object_id = d.object_id AND i.t <= ?
            ORDER BY i.t DESC, i.id DESC LIMIT 1)
          ${where}`;
      return (db.prepare(sql).all(...params) as unknown as Row[]).map(toPlainObservation);
    },

    latestFor(layer, objectId, to) {
      const row = db
        .prepare(
          `SELECT * FROM observations WHERE layer = ? AND object_id = ? AND t <= ?
           ORDER BY t DESC, id DESC LIMIT 1`,
        )
        .get(layer, objectId, to ?? Number.MAX_SAFE_INTEGER) as unknown as Row | undefined;
      return row ? toPlainObservation(row) : undefined;
    },

    trackPoints(layer, objectId, from, to, maxPoints) {
      const rows = db
        .prepare(
          `SELECT t, lon, lat, alt FROM observations
           WHERE layer = ? AND object_id = ? AND t >= ? AND t <= ? ORDER BY t, id LIMIT ?`,
        )
        .all(layer, objectId, from, to, MAX_LIMIT) as unknown as {
        t: number;
        lon: number;
        lat: number;
        alt: number | null;
      }[];
      const pts = rows.map((r): TrackRow => [r.t, r.lon, r.lat, r.alt]);
      const cap = Math.max(2, Math.floor(maxPoints));
      if (pts.length <= cap) return pts;
      const out: TrackRow[] = [];
      for (let i = 0; i < cap; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (cap - 1))]!);
      return out;
    },

    timeRange() {
      const r = db.prepare('SELECT MIN(t) AS lo, MAX(t) AS hi FROM observations').get() as unknown as {
        lo: number | null;
        hi: number | null;
      };
      return { from: r.lo, to: r.hi };
    },
  };
}
