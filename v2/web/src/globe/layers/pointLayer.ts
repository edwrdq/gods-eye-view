import type { LayerCategory } from '@gev/shared';
import { SlotMirror, type UpdatePacket, type UpsertSink } from '../../data/slots.ts';
import { CATEGORY_MAP_COLOR, CATEGORY_SHAPE, rotatesWithHeading } from '../../lib/markerStyle.ts';
import { markerCanvas } from './markers.ts';

type Cesium = typeof import('cesium');
type Scene = import('cesium').Scene;
type Billboard = import('cesium').Billboard;
type Label = import('cesium').Label;

/** Separator between layer id and object id in pick ids. */
export const PICK_SEP = '\u0001';
const DEG2RAD = Math.PI / 180;
const MARKER_SCALE = 0.5; // marker images are drawn at 2x for sharpness

export interface PointLayerOptions {
  layer: string;
  category: LayerCategory;
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
    this.labelCap = opts.labelCap ?? 60;
    const shape = CATEGORY_SHAPE[opts.category];
    this.rotates = rotatesWithHeading(shape);
    const { key, canvas } = markerCanvas(shape, CATEGORY_MAP_COLOR[opts.category]);
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
   * Label up to `labelCap` objects nearest the view centre, plus the pinned one.
   * `center` is the camera's look-at point in Earth-fixed metres; pass null to hide all labels.
   */
  updateLabels(center: import('cesium').Cartesian3 | null): void {
    const n = center ? this.labelCap : 0;
    const best: Array<{ slot: number; d: number }> = [];
    if (center && n > 0) {
      let worst = -Infinity;
      for (let slot = 0; slot < this.bySlot.length; slot++) {
        const b = this.bySlot[slot];
        if (!b || slot === this.pinnedSlot) continue;
        const p = b.position;
        const d = p.x * center.x + p.y * center.y + p.z * center.z; // larger = nearer the centre
        if (best.length < n) {
          best.push({ slot, d });
          if (best.length === n) worst = Math.min(...best.map((e) => e.d));
        } else if (d > worst) {
          let wi = 0;
          for (let i = 1; i < best.length; i++) if (best[i]!.d < best[wi]!.d) wi = i;
          best[wi] = { slot, d };
          worst = Math.min(...best.map((e) => e.d));
        }
      }
    }
    const slots = best.map((e) => e.slot);
    if (this.pinnedSlot >= 0 && this.bySlot[this.pinnedSlot]) slots.push(this.pinnedSlot);
    const C = this.Cesium;
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
      const text = this.mirror.labelBySlot[slot] || this.mirror.idBySlot[slot] || '';
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
