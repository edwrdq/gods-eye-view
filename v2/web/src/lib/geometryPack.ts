import type { Feature, FeatureGeometry, PropValue } from '@gev/shared';
import { lonLatAltToEcef } from './geo.ts';
import { LAUNCH_ORDER, launchState } from './featureStyle.ts';
import { bikeOrder } from './stationStyle.ts';

/**
 * Packs a features response into typed arrays on the worker so the main thread
 * only turns them into primitives. Points, lines and polygons travel in separate
 * tables; every table is addressed by index and carries the feature id it came from.
 */

const SEP = '\n';
/** Longest segment kept as one chord. A 0.5 degree chord sags about 60 m below the surface, below what a line shows. */
export const MAX_SEGMENT_DEG = 0.5;
/** Lines and cones sit this far above the ellipsoid so they never z-fight with the globe surface. */
export const PATH_ALT_M = 150;

/** Which props a layer's markers are styled by, so the main thread never needs the full props. */
export interface PackSchema {
  /** Two numeric props copied into `PointTable.num` (NaN when absent). */
  numKeys: [string | null, string | null];
  /** Two string props turned into small dictionary codes (see `FeaturePack.dict`). */
  codeKeys: [string | null, string | null];
  /** Draw order of points (lower first, so higher ones end up on top). */
  order?: (props: Record<string, PropValue>) => number;
}

const DEFAULT_SCHEMA: PackSchema = { numKeys: [null, null], codeKeys: [null, null] };

export const SCHEMAS: Record<string, PackSchema> = {
  // Large quakes first so small ones stay visible on top of them.
  earthquakes: { numKeys: ['mag', 'depthKm'], codeKeys: [null, null], order: (p) => -(typeof p.mag === 'number' ? p.mag : 0) },
  cyclones: { numKeys: ['intensityKt', 'tauHours'], codeKeys: ['part', 'category'] },
  // Stations that need attention (empty, full) draw on top of healthy and offline ones.
  bikeshare: { numKeys: ['fill', 'capacity'], codeKeys: ['state', null], order: (p) => bikeOrder(typeof p.state === 'string' ? p.state : '') },
  // The server sends the most listened-to stations last, so they draw on top.
  radio: { numKeys: ['clicks', 'bitrate'], codeKeys: ['play', null] },
  launches: { numKeys: ['net', null], codeKeys: ['status', null], order: (p) => LAUNCH_ORDER[launchState(typeof p.status === 'string' ? p.status : null)] },
};

export function schemaFor(layer: string): PackSchema {
  return SCHEMAS[layer] ?? DEFAULT_SCHEMA;
}

export interface PointTable {
  count: number;
  /** Feature ids joined with "\n". */
  ids: string;
  /** Labels joined with "\n" (empty when the feature has none). */
  labels: string;
  /** Earth-fixed x, y, z metres per point. */
  xyz: Float64Array;
  /** Feature.t per point, NaN when absent. */
  t: Float64Array;
  /** Two numeric props per point. */
  num: Float32Array;
  /** Two dictionary codes per point; index into `FeaturePack.dict`, 255 for none. */
  code: Uint8Array;
}

export interface PathTable {
  count: number;
  /** Feature id of each path, joined with "\n" (repeats for the parts of a MultiLineString). */
  ids: string;
  /** Earth-fixed vertices, 3 numbers each. */
  xyz: Float64Array;
  /** Vertex index where each path starts; length count + 1. */
  starts: Uint32Array;
  /** First dictionary code per path. */
  code: Uint8Array;
}

export interface FeaturePack {
  points: PointTable;
  lines: PathTable;
  polys: PathTable;
  /** Strings the codes refer to. */
  dict: string[];
  /** Features skipped for bad geometry. */
  skipped: number;
}

export const NO_CODE = 255;

const clean = (s: string) => (s.includes(SEP) ? s.replaceAll(SEP, ' ') : s);
const finite2 = (c: ArrayLike<number>) => Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[1]!) <= 90;

/**
 * Insert vertices so no segment is longer than `maxDeg` in longitude or latitude.
 * Input and output are flat [lon, lat, lon, lat, ...]; longitude steps take the short way round.
 */
export function densify(coords: ArrayLike<number>, maxDeg = MAX_SEGMENT_DEG): number[] {
  const out: number[] = [];
  const n = coords.length / 2;
  for (let i = 0; i < n; i++) {
    const lon = coords[2 * i]!;
    const lat = coords[2 * i + 1]!;
    if (i > 0) {
      const pl = coords[2 * i - 2]!;
      const pa = coords[2 * i - 1]!;
      let dl = lon - pl;
      if (dl > 180) dl -= 360;
      else if (dl < -180) dl += 360;
      const steps = Math.ceil(Math.max(Math.abs(dl), Math.abs(lat - pa)) / maxDeg);
      for (let s = 1; s < steps; s++) {
        const f = s / steps;
        out.push(pl + dl * f, pa + (lat - pa) * f);
      }
    }
    out.push(lon, lat);
  }
  return out;
}

class PathBuilder {
  ids: string[] = [];
  codes: number[] = [];
  starts: number[] = [0];
  verts: number[] = []; // lon/lat pairs awaiting ECEF conversion
  vertCount = 0;

  add(id: string, code: number, input: number[], close: boolean): void {
    let flat = input;
    if (close && flat.length >= 4 && (flat[0] !== flat[flat.length - 2] || flat[1] !== flat[flat.length - 1])) flat = [...flat, flat[0]!, flat[1]!];
    const dense = densify(flat);
    if (dense.length < 4) return;
    for (const v of dense) this.verts.push(v);
    this.vertCount += dense.length / 2;
    this.ids.push(id);
    this.codes.push(code);
    this.starts.push(this.vertCount);
  }

  build(): PathTable {
    const xyz = new Float64Array(3 * this.vertCount);
    for (let i = 0; i < this.vertCount; i++) lonLatAltToEcef(this.verts[2 * i]!, this.verts[2 * i + 1]!, PATH_ALT_M, xyz, 3 * i);
    return { count: this.ids.length, ids: this.ids.map(clean).join(SEP), xyz, starts: Uint32Array.from(this.starts), code: Uint8Array.from(this.codes) };
  }
}

function flatten(coords: Array<ArrayLike<number>>): number[] | null {
  const flat: number[] = [];
  for (const c of coords) {
    if (!finite2(c)) return null;
    flat.push(c[0]!, c[1]!);
  }
  return flat;
}

/** Pack the features of one layer. Features with unusable geometry are counted in `skipped`, never thrown on. */
export function packFeatures(layer: string, features: readonly Feature[]): FeaturePack {
  const schema = schemaFor(layer);
  const dict: string[] = [];
  const codeOf = (v: PropValue | undefined): number => {
    if (typeof v !== 'string' || v === '') return NO_CODE;
    let i = dict.indexOf(v);
    if (i < 0) {
      if (dict.length >= NO_CODE) return NO_CODE;
      i = dict.push(v) - 1;
    }
    return i;
  };
  const numOf = (v: PropValue | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN);

  const pts: Feature[] = [];
  const lines = new PathBuilder();
  const polys = new PathBuilder();
  let skipped = 0;

  for (const f of features) {
    const g: FeatureGeometry | undefined = f.geometry;
    const code0 = codeOf(f.props[schema.codeKeys[0] ?? '']);
    if (!g) {
      skipped++;
    } else if (g.type === 'Point') {
      if (finite2(g.coordinates)) pts.push(f);
      else skipped++;
    } else if (g.type === 'LineString') {
      const flat = flatten(g.coordinates);
      if (flat) lines.add(f.id, code0, flat, false);
      else skipped++;
    } else if (g.type === 'MultiLineString') {
      let any = false;
      for (const part of g.coordinates) {
        const flat = flatten(part);
        if (flat) {
          lines.add(f.id, code0, flat, false);
          any = true;
        }
      }
      if (!any) skipped++;
    } else if (g.type === 'Polygon') {
      const ring = g.coordinates[0];
      const flat = ring ? flatten(ring) : null;
      if (flat) polys.add(f.id, code0, flat, true);
      else skipped++;
    } else skipped++;
  }

  if (schema.order) {
    const order = schema.order;
    // Stable: equal keys keep server order.
    pts.sort((a, b) => order(a.props) - order(b.props));
  }
  const n = pts.length;
  const xyz = new Float64Array(3 * n);
  const t = new Float64Array(n);
  const num = new Float32Array(2 * n);
  const code = new Uint8Array(2 * n);
  const ids: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = pts[i]!;
    const c = (f.geometry as Extract<FeatureGeometry, { type: 'Point' }>).coordinates;
    lonLatAltToEcef(c[0], c[1], c[2] ?? 0, xyz, 3 * i);
    t[i] = typeof f.t === 'number' && Number.isFinite(f.t) ? f.t : Number.NaN;
    num[2 * i] = numOf(f.props[schema.numKeys[0] ?? '']);
    num[2 * i + 1] = numOf(f.props[schema.numKeys[1] ?? '']);
    code[2 * i] = codeOf(f.props[schema.codeKeys[0] ?? '']);
    code[2 * i + 1] = codeOf(f.props[schema.codeKeys[1] ?? '']);
    ids.push(clean(f.id));
    labels.push(clean(f.label ?? ''));
  }
  return {
    points: { count: n, ids: ids.join(SEP), labels: labels.join(SEP), xyz, t, num, code },
    lines: lines.build(),
    polys: polys.build(),
    dict,
    skipped,
  };
}

/** Buffers to transfer with the pack. */
export function packTransfer(p: FeaturePack): ArrayBuffer[] {
  return [p.points.xyz, p.points.t, p.points.num, p.points.code, p.lines.xyz, p.lines.starts, p.lines.code, p.polys.xyz, p.polys.starts, p.polys.code].map((a) => a.buffer as ArrayBuffer);
}

export function splitIds(joined: string): string[] {
  return joined === '' ? [] : joined.split(SEP);
}
