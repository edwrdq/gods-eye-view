import type { LayerCategory } from '@gev/shared';
import { SlotMirror, type UpdatePacket, type UpsertSink } from '../../data/slots.ts';
import { isNamedLabel, mayLabel, selectLabels, type LabelCandidate, type Rect } from '../../lib/declutter.ts';
import { CATEGORY_MAP_COLOR, CATEGORY_SHAPE, rotatesWithHeading, type MarkerVariant } from '../../lib/markerStyle.ts';
import { markerCanvas } from './markers.ts';

type Cesium = typeof import('cesium');
type Scene = import('cesium').Scene;
type Billboard = import('cesium').Billboard;
type Label = import('cesium').Label;

/** Separator between layer id and object id in pick ids. */
export const PICK_SEP = '\u0001';
const DEG2RAD = Math.PI / 180;
const MARKER_SCALE = 0.5; // marker images are drawn at 2x for sharpness
const MARKER_PX = 20;
/** At most this many candidates are projected to the screen per update. */
const MAX_PROJECTED = 600;
/** Added to the rank of named objects so they are placed before anonymous ones however far from the centre. */
const NAMED_BONUS = 1e16;
/** Dot product with the view centre below which an object is too far to matter (about 26 degrees of arc). */
const MIN_DOT = 0.9 * 6.371e6 * 6.371e6;
const MAX_LABEL_CHARS = 24;
const clip = (t: string): string => (t.length > MAX_LABEL_CHARS ? `${t.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…` : t);

export interface PointLayerOptions {
  layer: string;
  category: LayerCategory;
  /** Marker treatment within the category; default 'standard'. */
  variant?: MarkerVariant;
  /** Most labels shown at once. */
  labelCap?: number;
}

/**
 * Renders one point layer with batched primitives: a BillboardCollection for
 * the markers and a small pooled LabelCollection. Objects are addressed by the
 * stable slot numbers the worker assigns, so an update touches only the
 * billboards whose object changed; billboards of vanished objects are hidden
 * and reused by the next new object.
 */
export class PointLayer {
  readonly layer: string;
  readonly category: LayerCategory;
  readonly mirror = new SlotMirror();
  private readonly Cesium: Cesium;
  private readonly scene: Scene;
  private readonly billboards: import('cesium').BillboardCollection;
  private readonly labels: import('cesium').LabelCollection;
  private readonly bySlot: Array<Billboard | undefined> = [];
  private readonly pool: Billboard[] = [];
  private readonly labelPool: Label[] = [];
  private labelCount = 0;
  private readonly labelCap: number;
  private readonly rotates: boolean;
  private readonly imageKey: string;
  private readonly scratch: import('cesium').Cartesian3;
  private readonly scaleByDistance: import('cesium').NearFarScalar;
  private readonly sink: UpsertSink;
  private pinnedSlot = -1;

  constructor(Cesium: Cesium, scene: Scene, opts: PointLayerOptions) {
    this.Cesium = Cesium;
    this.scene = scene;
    this.layer = opts.layer;
    this.category = opts.category;
    this.labelCap = opts.labelCap ?? 30;
    const shape = CATEGORY_SHAPE[opts.category];
    this.rotates = rotatesWithHeading(shape);
    const { key, canvas } = markerCanvas(shape, CATEGORY_MAP_COLOR[opts.category], opts.variant);
    this.imageKey = key;
    this.canvas = canvas;
    this.billboards = scene.primitives.add(new Cesium.BillboardCollection({ scene, blendOption: Cesium.BlendOption.TRANSLUCENT }));
    this.labels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
    this.scratch = new Cesium.Cartesian3();
    this.scaleByDistance = new Cesium.NearFarScalar(3e5, 1, 1.6e7, 0.55);
    this.sink = {
      upsert: (slot, created, x, y, z, headingDeg) => this.upsert(slot, created, x, y, z, headingDeg),
      remove: (slot) => this.remove(slot),
    };
  }

  private readonly canvas: HTMLCanvasElement;

  /** Apply one worker update. Returns how many primitives were written. */
  apply(packet: UpdatePacket): number {
    this.mirror.apply(packet, this.sink);
    this.trimPool();
    return packet.slots.length + packet.removed.length;
  }

  private upsert(slot: number, created: boolean, x: number, y: number, z: number, headingDeg: number): void {
    let b = this.bySlot[slot];
    if (!b) {
      b = this.pool.pop();
      if (b) {
        b.show = true;
      } else {
        b = this.billboards.add({
          position: this.Cesium.Cartesian3.ZERO,
          scale: MARKER_SCALE,
          scaleByDistance: this.scaleByDistance,
          alignedAxis: this.rotates ? this.Cesium.Cartesian3.UNIT_Z : undefined,
        });
        b.setImage(this.imageKey, this.canvas);
      }
      b.id = this.layer + PICK_SEP + this.mirror.idBySlot[slot];
      this.bySlot[slot] = b;
    } else if (created) {
      b.id = this.layer + PICK_SEP + this.mirror.idBySlot[slot];
    }
    const s = this.scratch;
    s.x = x;
    s.y = y;
    s.z = z;
    b.position = s;
    if (this.rotates) b.rotation = Number.isNaN(headingDeg) ? 0 : -headingDeg * DEG2RAD;
  }

  private remove(slot: number): void {
    const b = this.bySlot[slot];
    if (!b) return;
    b.show = false;
    this.bySlot[slot] = undefined;
    this.pool.push(b);
    if (slot === this.pinnedSlot) this.pinnedSlot = -1;
  }

  /** Release hidden billboards once they clearly outnumber the live ones. */
  private trimPool(): void {
    if (this.pool.length <= 2000 || this.pool.length <= this.mirror.alive) return;
    while (this.pool.length > Math.max(1000, this.mirror.alive)) this.billboards.remove(this.pool.pop()!);
  }

  /** Slot of an object, or undefined when it is not drawn. */
  slotOf(objectId: string): number | undefined {
    const s = this.mirror.slotById.get(objectId);
    return s !== undefined && this.bySlot[s] ? s : undefined;
  }

  /** Earth-fixed position of a drawn object (a live reference; copy before keeping). */
  positionOf(slot: number): import('cesium').Cartesian3 | undefined {
    return this.bySlot[slot]?.position;
  }

  /** Always label this object (the selected one), regardless of distance. */
  pin(slot: number): void {
    this.pinnedSlot = slot;
  }

  /**
   * Choose the labels: named objects nearest the view centre that fit on screen without
   * overlapping (also with the boxes in `occupied`, shared with the other layers), at most `labelCap` and
   * a few per screen block (see selectLabels), plus the pinned one. Objects known only by a numeric id or hex code are labelled only when very
   * close or selected. `center` is the camera's look-at point in Earth-fixed metres; null hides all labels.
   */
  updateLabels(center: import('cesium').Cartesian3 | null, altitude: number, occupied: Rect[]): void {
    const C = this.Cesium;
    const pinnedBb = this.pinnedSlot >= 0 ? this.bySlot[this.pinnedSlot] : undefined;
    const slots: number[] = [];
    const win = new C.Cartesian2();
    const project = (p: import('cesium').Cartesian3) => C.SceneTransforms.worldToWindowCoordinates(this.scene, p, win);
    if (center && this.labelCap > 0) {
      // Nearest to the view centre first, but only those that may carry a label at this zoom.
      const near: Array<{ slot: number; rank: number }> = [];
      for (let slot = 0; slot < this.bySlot.length; slot++) {
        const b = this.bySlot[slot];
        if (!b || !b.show || slot === this.pinnedSlot) continue;
        const id = this.mirror.idBySlot[slot] ?? '';
        const label = this.mirror.labelBySlot[slot] ?? '';
        if (!mayLabel(label, id, altitude, false)) continue;
        const p = b.position;
        const d = p.x * center.x + p.y * center.y + p.z * center.z; // larger = nearer the centre
        if (d < MIN_DOT) continue; // over the horizon or far from the view
        near.push({ slot, rank: (isNamedLabel(label, id) ? NAMED_BONUS : 0) + d });
      }
      if (near.length > MAX_PROJECTED) {
        near.sort((x, y) => y.rank - x.rank);
        near.length = MAX_PROJECTED;
      }
      const w = this.scene.canvas.clientWidth;
      const h = this.scene.canvas.clientHeight;
      const cands: Array<LabelCandidate & { slot: number }> = [];
      for (const e of near) {
        const b = this.bySlot[e.slot]!;
        const xy = project(b.position);
        if (!xy || xy.x < 0 || xy.y < 0 || xy.x > w || xy.y > h) continue;
        const id = this.mirror.idBySlot[e.slot] ?? '';
        const text = clip(this.mirror.labelBySlot[e.slot] || id);
        cands.push({ id, slot: e.slot, x: xy.x, y: xy.y, text, px: MARKER_PX, rank: e.rank });
      }
      for (const c of selectLabels(cands, { cap: this.labelCap, occupied })) slots.push(c.slot);
    }
    if (pinnedBb) slots.push(this.pinnedSlot);
    for (let i = 0; i < slots.length; i++) {
      let l = this.labelPool[i];
      if (!l) {
        l = this.labels.add({
          position: C.Cartesian3.ZERO,
          font: '600 12px ui-sans-serif, system-ui, sans-serif',
          fillColor: C.Color.WHITE,
          outlineColor: C.Color.fromCssColorString('#080c12'),
          outlineWidth: 3,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: C.HorizontalOrigin.LEFT,
          verticalOrigin: C.VerticalOrigin.CENTER,
          pixelOffset: new C.Cartesian2(11, 0),
          scale: 1,
        });
        this.labelPool[i] = l;
      }
      const slot = slots[i]!;
      const text = clip(this.mirror.labelBySlot[slot] || this.mirror.idBySlot[slot] || '');
      if (l.text !== text) l.text = text;
      l.position = this.bySlot[slot]!.position;
      l.id = this.layer + PICK_SEP + this.mirror.idBySlot[slot];
      l.show = true;
    }
    for (let i = slots.length; i < this.labelCount; i++) this.labelPool[i]!.show = false;
    this.labelCount = slots.length;
  }

  setShow(show: boolean): void {
    this.billboards.show = show;
    this.labels.show = show;
  }

  destroy(): void {
    this.scene.primitives.remove(this.billboards);
    this.scene.primitives.remove(this.labels);
    this.mirror.clear();
    this.bySlot.length = 0;
    this.pool.length = 0;
    this.labelPool.length = 0;
  }
}

/** Split a pick id into layer and object id; null when it is not one of ours. */
export function parsePickId(id: unknown): { layer: string; objectId: string } | null {
  if (typeof id !== 'string') return null;
  const i = id.indexOf(PICK_SEP);
  if (i <= 0) return null;
  return { layer: id.slice(0, i), objectId: id.slice(i + 1) };
}
