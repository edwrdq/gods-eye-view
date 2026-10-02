import type { LayerCategory } from '@gev/shared';
import { cycloneLabel, cycloneSize, FORECAST_POINT_PX, LAUNCH_PX, launchEta, launchState } from '../../lib/featureStyle.ts';
import { NO_CODE, splitIds, type FeaturePack } from '../../lib/geometryPack.ts';
import { CATEGORY_MAP_COLOR, CATEGORY_SHAPE, markerVariantFor } from '../../lib/markerStyle.ts';
import { quakeStyle } from '../../lib/quakeStyle.ts';
import { bikeCanvas, cameraBodyCanvas, cameraWedgeCanvas, launchCanvas, markerCanvas, quakeCanvas, radioCanvas, stormCanvas } from './markers.ts';
import { bodyKey, CAMERA_PX, cameraForm, cameraLabel, WEDGE_MAX_ALTITUDE_M, WEDGE_PX, WEDGE_SPREAD_DEG, wedgeKey, type CameraForm } from '../../lib/cameraStyle.ts';
import { bikeForm, bikeKey, bikePx, radioKey, radioPx, stationLabel } from '../../lib/stationStyle.ts';
import { LabelPool } from './labelPool.ts';
import { PICK_SEP } from './pointLayer.ts';
import { labelRect, selectLabels, type LabelCandidate, type Rect } from '../../lib/declutter.ts';

type Cesium = typeof import('cesium');
type Scene = import('cesium').Scene;
type Billboard = import('cesium').Billboard;
type Cartesian3 = import('cesium').Cartesian3;

const MARKER_SCALE = 0.5;
const DEG2RAD = Math.PI / 180;
const LABEL_CAP = 60;
/** Labels of ordinary points appear below this camera height. */
const LABEL_MAX_ALTITUDE_M = 3_000_000;
const CONE_FILL_ALPHA = 0.16;
const CONE_OUTLINE_ALPHA = 0.8;

interface PointStyle {
  key: string;
  canvas: () => HTMLCanvasElement;
  px: number;
  label: string;
  /** Label even when zoomed out (storm centres: identity, not clutter). */
  alwaysLabel: boolean;
  /** Cameras: the view wedge under the marker, rotated to the heading. */
  camera?: { form: CameraForm; heading: number };
}

interface Entry {
  id: string;
  billboard: Billboard;
  px: number;
  label: string;
  alwaysLabel: boolean;
  key: string;
  /** Cameras: the wedge billboard and the image key it shows. */
  wedge?: Billboard;
  wedgeKey?: string;
}

const truncate = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

const hash = (xyz: Float64Array, starts: Uint32Array): number => {
  let h = xyz.length * 31 + starts.length;
  const step = Math.max(1, Math.floor(xyz.length / 64));
  for (let i = 0; i < xyz.length; i += step) h = (h * 33 + xyz[i]!) % 1e12;
  return h;
};

/**
 * Renders one features layer with batched primitives: a BillboardCollection for
 * points, a PolylineCollection for lines (and cone outlines), one translucent
 * Primitive for every polygon, and a pooled LabelCollection. Points are
 * reconciled by feature id; lines and polygons are rebuilt only when their
 * geometry changed.
 */
export class FeatureLayer {
  readonly layer: string;
  readonly category: LayerCategory;
  private readonly C: Cesium;
  private readonly scene: Scene;
  private readonly billboards: import('cesium').BillboardCollection;
  private readonly polylines: import('cesium').PolylineCollection;
  /** Cameras only: view wedges, drawn under every marker. */
  private readonly wedges: import('cesium').BillboardCollection | null;
  private readonly labelPool: LabelPool;
  private polygons: import('cesium').Primitive | null = null;
  private readonly entries = new Map<string, Entry>();
  private pinned: string | null = null;
  private lineHash = -1;
  private polyHash = -1;
  private readonly scaleByDistance: import('cesium').NearFarScalar;
  private readonly color: string;
  private readonly materials = new Map<string, import('cesium').Material>();
  private last: FeaturePack | null = null;
  /** Pulls markers a little towards the camera so the lines drawn 150 m above the surface never cover them. */
  private readonly eyeOffset: Cartesian3;

  constructor(Cesium: Cesium, scene: Scene, layer: string, category: LayerCategory) {
    this.C = Cesium;
    this.scene = scene;
    this.layer = layer;
    this.category = category;
    this.color = CATEGORY_MAP_COLOR[category];
    // Polygons first so lines and markers draw over them.
    this.polylines = scene.primitives.add(new Cesium.PolylineCollection());
    this.wedges = layer === 'cctv' ? scene.primitives.add(new Cesium.BillboardCollection({ scene, blendOption: Cesium.BlendOption.TRANSLUCENT })) : null;
    this.billboards = scene.primitives.add(new Cesium.BillboardCollection({ scene, blendOption: Cesium.BlendOption.TRANSLUCENT }));
    this.labelPool = new LabelPool(Cesium, scene, layer);
    this.scaleByDistance = new Cesium.NearFarScalar(3e5, 1, 1.6e7, 0.6);
    this.eyeOffset = new Cesium.Cartesian3(0, 0, -2000);
  }

  // --- styling

  private styleOf(pack: FeaturePack, i: number, ref: number, now: number, label: string): PointStyle {
    const num0 = pack.points.num[2 * i]!;
    const num1 = pack.points.num[2 * i + 1]!;
    const c0 = pack.points.code[2 * i]!;
    const c1 = pack.points.code[2 * i + 1]!;
    const code0 = c0 === NO_CODE ? '' : (pack.dict[c0] ?? '');
    const code1 = c1 === NO_CODE ? '' : (pack.dict[c1] ?? '');
    const color = this.color;
    switch (this.layer) {
      case 'earthquakes': {
        const q = quakeStyle(num0, num1, pack.points.t[i]!, ref);
        return { key: q.key, canvas: () => quakeCanvas(q.key, q.sizePx, q.age, q.deep, color), px: q.sizePx, label, alwaysLabel: false };
      }
      case 'cyclones': {
        if (code0 === 'forecast') {
          const key = `gev-storm:fc:${color}`;
          return { key, canvas: () => stormCanvas(key, FORECAST_POINT_PX, color, true), px: FORECAST_POINT_PX, label, alwaysLabel: false };
        }
        const px = cycloneSize(code1);
        const key = `gev-storm:${px}:${color}`;
        return { key, canvas: () => stormCanvas(key, px, color, false), px, label: cycloneLabel(label, code1), alwaysLabel: true };
      }
      case 'launches': {
        const state = launchState(code0);
        const px = LAUNCH_PX[state];
        const key = `gev-launch:${state}:${color}`;
        const eta = launchEta(num0, now);
        return {
          key,
          canvas: () => launchCanvas(key, state, px, color, CATEGORY_MAP_COLOR.hazards),
          px,
          label: eta ? `${truncate(label, 30)} · ${eta}` : truncate(label, 36),
          alwaysLabel: false,
        };
      }
      case 'bikeshare': {
        // fill, capacity numeric; state coded. A station with no reading has NaN fill and the 'unknown' state.
        const f = bikeForm(code0, num0);
        const px = bikePx(num1);
        const key = bikeKey(f, px, color);
        return { key, canvas: () => bikeCanvas(key, f, px, color), px, label: stationLabel(label), alwaysLabel: false };
      }
      case 'radio': {
        const px = radioPx(num0);
        const audio = code0 === 'audio';
        const key = radioKey(px, audio, color);
        return { key, canvas: () => radioCanvas(key, px, audio, color), px, label: stationLabel(label), alwaysLabel: false };
      }
      case 'cctv': {
        // heading numeric; headingConfidence and type coded. A camera always has a heading: when the source
        // gives none it is a placeholder and the confidence says 'estimated'.
        const form = cameraForm(code0, code1);
        const key = bodyKey(form, color);
        return { key, canvas: () => cameraBodyCanvas(key, form, CAMERA_PX, color), px: CAMERA_PX, label: cameraLabel(label), alwaysLabel: false, camera: { form, heading: num0 } };
      }
      default: {
        const shape = CATEGORY_SHAPE[this.category];
        // Infrastructure layers share a shape and hue; form tells them apart: solid square for
        // data centers, hollow (outline) for mapped military areas, a smaller one for cable landings.
        const m = markerCanvas(shape, color, markerVariantFor(this.layer));
        return { key: m.key, canvas: () => m.canvas, px: this.layer === 'submarine-cables' ? 14 : 20, label, alwaysLabel: false };
      }
    }
  }

  private material(kind: 'solid' | 'dash', rgba: string): import('cesium').Material {
    const key = `${kind}:${rgba}`;
    let m = this.materials.get(key);
    if (!m) {
      const C = this.C;
      const color = C.Color.fromCssColorString(rgba);
      m =
        kind === 'dash'
          ? C.Material.fromType('PolylineDash', { color, gapColor: C.Color.TRANSPARENT, dashLength: 14 })
          : C.Material.fromType('Color', { color });
      // Many polylines share one material, and removing a polyline destroys its material: the
      // second removal would throw (and a rebuilt layer would reuse a destroyed one). Keep it alive.
      (m as { destroy: () => void }).destroy = () => undefined;
      this.materials.set(key, m);
    }
    return m;
  }

  // --- data

  /** Draw a pack. `ref` is the instant ages are measured against; `now` the wall clock (for launch countdowns). Returns primitives written. */
  apply(pack: FeaturePack, ref: number, now: number): number {
    this.last = pack;
    let written = this.applyPoints(pack, ref, now);
    written += this.applyLines(pack);
    written += this.applyPolygons(pack);
    this.scene.requestRender();
    return written;
  }

  /** Re-style the current points for a new reference time without new data. */
  restyle(ref: number, now: number): void {
    if (this.last) this.applyPoints(this.last, ref, now);
    this.scene.requestRender();
  }

  private applyPoints(pack: FeaturePack, ref: number, now: number): number {
    const p = pack.points;
    const ids = splitIds(p.ids);
    const labels = p.labels === '' ? [] : p.labels.split('\n');
    const seen = new Set<string>();
    let written = 0;
    const C = this.C;
    for (let i = 0; i < p.count; i++) {
      const id = ids[i]!;
      seen.add(id);
      const st = this.styleOf(pack, i, ref, now, labels[i] ?? '');
      let e = this.entries.get(id);
      if (!e) {
        const b = this.billboards.add({ position: C.Cartesian3.ZERO, scale: MARKER_SCALE, scaleByDistance: this.scaleByDistance, eyeOffset: this.eyeOffset });
        b.id = this.layer + PICK_SEP + id;
        e = { id, billboard: b, px: st.px, label: st.label, alwaysLabel: st.alwaysLabel, key: '' };
        this.entries.set(id, e);
      }
      if (e.key !== st.key) {
        e.billboard.setImage(st.key, st.canvas());
        e.key = st.key;
      }
      if (st.camera && this.wedges) this.applyWedge(e, st.camera, i, p.xyz);
      e.px = st.px;
      e.label = st.label;
      e.alwaysLabel = st.alwaysLabel;
      const pos = e.billboard.position;
      const x = p.xyz[3 * i]!;
      const y = p.xyz[3 * i + 1]!;
      const z = p.xyz[3 * i + 2]!;
      if (pos.x !== x || pos.y !== y || pos.z !== z) {
        e.billboard.position = new C.Cartesian3(x, y, z);
      }
      // Order matters for overlap (the pack is pre-sorted): re-adding is costly, so only new points follow it.
      written++;
    }
    for (const [id, e] of this.entries) {
      if (seen.has(id)) continue;
      this.billboards.remove(e.billboard);
      if (e.wedge) this.wedges?.remove(e.wedge);
      this.entries.delete(id);
      if (this.pinned === id) this.pinned = null;
      written++;
    }
    return written;
  }

  /** Keep the wedge under a camera marker with a known facing at its position, pointing along its heading (rotation is about the camera's up axis, so north stays north whatever the view). */
  private applyWedge(e: Entry, cam: { form: CameraForm; heading: number }, i: number, xyz: Float64Array): void {
    const C = this.C;
    const wc = this.wedges!;
    // An estimated facing is a placeholder: drawing it as a wedge would show a direction nobody measured, and most
    // cameras of a source without one would fill the map with them. Only a known facing gets a wedge.
    if (cam.form.confidence !== 'known') {
      if (e.wedge) {
        wc.remove(e.wedge);
        e.wedge = undefined;
        e.wedgeKey = undefined;
      }
      return;
    }
    if (!e.wedge) {
      e.wedge = wc.add({ position: C.Cartesian3.ZERO, scale: MARKER_SCALE, scaleByDistance: this.scaleByDistance, eyeOffset: this.eyeOffset, alignedAxis: C.Cartesian3.UNIT_Z });
      e.wedge.id = e.billboard.id; // a click on the wedge selects its camera
    }
    const k = wedgeKey(this.color);
    if (e.wedgeKey !== k) {
      e.wedge.setImage(k, cameraWedgeCanvas(k, WEDGE_PX, WEDGE_SPREAD_DEG, this.color));
      e.wedgeKey = k;
    }
    const x = xyz[3 * i]!;
    const y = xyz[3 * i + 1]!;
    const z = xyz[3 * i + 2]!;
    const pos = e.wedge.position;
    if (pos.x !== x || pos.y !== y || pos.z !== z) e.wedge.position = new C.Cartesian3(x, y, z);
    e.wedge.rotation = Number.isFinite(cam.heading) ? -cam.heading * DEG2RAD : 0;
  }

  private applyLines(pack: FeaturePack): number {
    const h = hash(pack.lines.xyz, pack.lines.starts) * 7 + hash(pack.polys.xyz, pack.polys.starts) + pack.lines.count;
    if (h === this.lineHash) return 0;
    this.lineHash = h;
    this.polylines.removeAll();
    const C = this.C;
    const rgb = this.color;
    const cyclone = this.layer === 'cyclones';
    const add = (xyz: Float64Array, a: number, b: number, id: string, width: number, material: import('cesium').Material) => {
      const positions: Cartesian3[] = [];
      for (let v = a; v < b; v++) positions.push(new C.Cartesian3(xyz[3 * v]!, xyz[3 * v + 1]!, xyz[3 * v + 2]!));
      this.polylines.add({ positions, width, material, id: this.layer + PICK_SEP + id });
    };
    const lids = splitIds(pack.lines.ids);
    for (let k = 0; k < pack.lines.count; k++) {
      const code = pack.lines.code[k]!;
      const part = code === NO_CODE ? '' : (pack.dict[code] ?? '');
      // Forecast is dashed (it has not happened yet); the recorded track is solid.
      const material = cyclone && part === 'forecast' ? this.material('dash', rgb) : this.material('solid', withAlpha(rgb, 0.85));
      add(pack.lines.xyz, pack.lines.starts[k]!, pack.lines.starts[k + 1]!, lids[k]!, cyclone && part === 'forecast' ? 2 : 2, material);
    }
    // Cone outlines ride in the same collection.
    const pids = splitIds(pack.polys.ids);
    const outline = this.material('solid', withAlpha(rgb, CONE_OUTLINE_ALPHA));
    for (let k = 0; k < pack.polys.count; k++) add(pack.polys.xyz, pack.polys.starts[k]!, pack.polys.starts[k + 1]!, pids[k]!, 1.5, outline);
    return pack.lines.count + pack.polys.count;
  }

  private applyPolygons(pack: FeaturePack): number {
    const h = hash(pack.polys.xyz, pack.polys.starts);
    if (h === this.polyHash) return 0;
    this.polyHash = h;
    if (this.polygons) {
      this.scene.primitives.remove(this.polygons);
      this.polygons = null;
    }
    const C = this.C;
    const instances: import('cesium').GeometryInstance[] = [];
    const fill = C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString(this.color).withAlpha(CONE_FILL_ALPHA));
    for (let k = 0; k < pack.polys.count; k++) {
      const a = pack.polys.starts[k]!;
      let b = pack.polys.starts[k + 1]!;
      b -= 1; // the ring is closed with a repeated first vertex; the geometry closes itself
      if (b - a < 3) continue;
      const positions: Cartesian3[] = [];
      for (let v = a; v < b; v++) positions.push(new C.Cartesian3(pack.polys.xyz[3 * v]!, pack.polys.xyz[3 * v + 1]!, pack.polys.xyz[3 * v + 2]!));
      instances.push(
        new C.GeometryInstance({
          geometry: new C.PolygonGeometry({
            polygonHierarchy: new C.PolygonHierarchy(positions),
            perPositionHeight: true,
            vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
          }),
          attributes: { color: fill },
        }),
      );
    }
    if (instances.length > 0) {
      this.polygons = this.scene.primitives.add(
        new C.Primitive({
          geometryInstances: instances,
          appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
          asynchronous: false,
          allowPicking: false, // a large translucent area must not swallow clicks meant for what lies under it
          releaseGeometryInstances: true,
        }),
      );
      // Keep the cone under the lines and markers drawn after it.
      this.scene.primitives.lowerToBottom(this.polygons);
    }
    return instances.length;
  }

  // --- lookups used by the manager

  has(id: string): boolean {
    return this.entries.has(id);
  }

  positionOf(id: string): Cartesian3 | undefined {
    return this.entries.get(id)?.billboard.position;
  }

  /** Marker size in px, for scaling the selection ring. */
  sizeOf(id: string): number {
    return this.entries.get(id)?.px ?? 20;
  }

  pin(id: string | null): void {
    this.pinned = id;
  }

  /**
   * Show labels: storm centres always, other points nearest the view centre while
   * zoomed in, and the pinned (selected) one regardless. `center` is the camera's
   * look-at point in Earth-fixed metres, null when none.
   */
  updateLabels(center: Cartesian3 | null, altitude: number, occupied: Rect[]): void {
    // From high up a direction is noise: cameras are plain dots until the view is regional.
    if (this.wedges) this.wedges.show = altitude < WEDGE_MAX_ALTITUDE_M;
    const chosen: Entry[] = [];
    const zoomed = center !== null && altitude < LABEL_MAX_ALTITUDE_M;
    // Several features can share one spot (launches from the same pad): label only the one drawn on top.
    const stacks = new Map<string, { e: Entry; n: number }>();
    for (const e of this.entries.values()) {
      if (e.id === this.pinned) continue;
      if (e.alwaysLabel) {
        chosen.push(e);
        continue;
      }
      if (!zoomed) continue;
      const p = e.billboard.position;
      const key = `${Math.round(p.x / 200)},${Math.round(p.y / 200)},${Math.round(p.z / 200)}`;
      const prev = stacks.get(key);
      stacks.set(key, { e, n: (prev?.n ?? 0) + 1 });
    }
    const near: Array<{ e: Entry; d: number }> = [];
    if (center) {
      for (const { e, n } of stacks.values()) {
        const p = e.billboard.position;
        near.push({ e: n > 1 ? { ...e, label: `${e.label} · +${n - 1} more here` } : e, d: p.x * center.x + p.y * center.y + p.z * center.z });
      }
    }
    // Screen-space declutter (shared with the tracked layers): nearest the view centre first, no overlaps, a few per screen block.
    const win = new this.C.Cartesian2();
    const project = (e: Entry) => this.C.SceneTransforms.worldToWindowCoordinates(this.scene, e.billboard.position, win);
    for (const e of chosen) {
      const xy = project(e);
      if (xy) occupied.push(labelRect(xy.x, xy.y, e.label, e.px));
    }
    const byId = new Map<string, Entry>();
    const cands: LabelCandidate[] = [];
    for (const { e, d } of near) {
      const xy = project(e);
      if (!xy) continue;
      byId.set(e.id, e);
      cands.push({ id: e.id, x: xy.x, y: xy.y, text: e.label, px: e.px, rank: d });
    }
    for (const c of selectLabels(cands, { cap: LABEL_CAP, occupied })) chosen.push(byId.get(c.id)!);
    const pinned = this.pinned ? this.entries.get(this.pinned) : undefined;
    if (pinned) chosen.push(pinned);
    this.labelPool.show(chosen.map((e) => ({ id: e.id, text: e.label, position: e.billboard.position, px: e.px })));
  }

  destroy(): void {
    if (this.wedges) this.scene.primitives.remove(this.wedges);
    this.scene.primitives.remove(this.billboards);
    this.scene.primitives.remove(this.polylines);
    this.labelPool.destroy();
    if (this.polygons) this.scene.primitives.remove(this.polygons);
    this.entries.clear();
  }
}

/** "#rrggbb" plus an alpha as a CSS rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
