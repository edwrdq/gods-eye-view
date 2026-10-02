import { PICK_SEP } from './pointLayer.ts';

type Cesium = typeof import('cesium');
type Label = import('cesium').Label;

export interface LabelItem {
  id: string;
  text: string;
  position: import('cesium').Cartesian3;
  /** Marker size in px, to keep the text clear of it. */
  px: number;
}

/** A small pool of labels (one LabelCollection) reused as the set of labelled objects changes. */
export class LabelPool {
  private readonly C: Cesium;
  private readonly scene: import('cesium').Scene;
  private readonly layer: string;
  private readonly labels: import('cesium').LabelCollection;
  private readonly pool: Label[] = [];
  private shown = 0;

  constructor(Cesium: Cesium, scene: import('cesium').Scene, layer: string) {
    this.C = Cesium;
    this.scene = scene;
    this.layer = layer;
    this.labels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
  }

  show(items: readonly LabelItem[]): void {
    const C = this.C;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      let l = this.pool[i];
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
          scale: 1,
        });
        this.pool[i] = l;
      }
      if (l.text !== it.text) l.text = it.text;
      l.pixelOffset = new C.Cartesian2(it.px / 2 + 6, 0);
      l.position = it.position;
      l.id = this.layer + PICK_SEP + it.id;
      l.show = it.text !== '';
    }
    for (let i = items.length; i < this.shown; i++) this.pool[i]!.show = false;
    this.shown = items.length;
  }

  destroy(): void {
    this.scene.primitives.remove(this.labels);
    this.pool.length = 0;
  }
}
