import type { Track } from '@gev/shared';
import { fadeAlpha } from '../../lib/trackStyle.ts';

type Cesium = typeof import('cesium');

/** One polyline primitive for an object's recorded track; older segments fade out. */
export class TrackLine {
  private primitive: import('cesium').Primitive | null = null;
  private readonly Cesium: Cesium;
  private readonly scene: import('cesium').Scene;

  constructor(Cesium: Cesium, scene: import('cesium').Scene) {
    this.Cesium = Cesium;
    this.scene = scene;
  }

  /** Draw `points` (oldest first) in `color`. Fewer than two usable points draw nothing and return false. */
  show(points: Track['points'], color: string): boolean {
    this.hide();
    const C = this.Cesium;
    const flat: number[] = [];
    let lastLon = NaN;
    let lastLat = NaN;
    for (const [, lon, lat, alt] of points) {
      if (lon === lastLon && lat === lastLat) continue;
      flat.push(lon, lat, alt ?? 0);
      lastLon = lon;
      lastLat = lat;
    }
    const n = flat.length / 3;
    if (n < 2) return false;
    const base = C.Color.fromCssColorString(color);
    const colors: import('cesium').Color[] = [];
    for (let i = 0; i < n; i++) colors.push(base.withAlpha(fadeAlpha(i, n)));
    const geometry = new C.PolylineGeometry({
      positions: C.Cartesian3.fromDegreesArrayHeights(flat),
      width: 3,
      vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT,
      colors,
      colorsPerVertex: true,
      arcType: C.ArcType.NONE,
    });
    this.primitive = this.scene.primitives.add(
      new C.Primitive({
        geometryInstances: new C.GeometryInstance({ geometry }),
        appearance: new C.PolylineColorAppearance({ translucent: true }),
        asynchronous: false,
        releaseGeometryInstances: true,
      }),
    );
    this.scene.requestRender();
    return true;
  }

  hide(): void {
    if (!this.primitive) return;
    this.scene.primitives.remove(this.primitive);
    this.primitive = null;
    this.scene.requestRender();
  }

  destroy(): void {
    this.hide();
  }
}
