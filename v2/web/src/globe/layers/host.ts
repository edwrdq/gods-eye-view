import type { FeedStatus } from '@gev/shared';
import type { Rect } from '../../lib/declutter.ts';
import type { LayerRunState, LayerSpec, UpdateMetric } from './types.ts';

type Cartesian3 = import('cesium').Cartesian3;

/** What the manager gives the feature and orbit controllers. */
export interface ControllerHost {
  Cesium: typeof import('cesium');
  scene: import('cesium').Scene;
  /** Viewed instant (null: live). */
  timeAt(): number | null;
  emit(layer: string, state: LayerRunState | null): void;
  metric(m: UpdateMetric): void;
  /** Positions of a layer's objects changed: the selection ring, follow and labels may need to move. */
  moved(layer: string): void;
}

/** What the manager asks of a controller that owns several layers or one special layer. */
export interface LayerController {
  enable(spec: LayerSpec): void;
  disable(layer: string): void;
  setTime(at: number | null): void;
  retry(layer: string): void;
  owns(layer: string): boolean;
  positionOf(layer: string, objectId: string): Cartesian3 | undefined;
  /** Marker size in px (for the selection ring). */
  sizeOf(layer: string, objectId: string): number;
  /** The selected object (any layer) or null: each layer labels its own and clears the rest. */
  pin(sel: { layer: string; objectId: string } | null): void;
  updateLabels(center: Cartesian3 | null, altitude: number, occupied: Rect[]): void;
  /** A newer FeedStatus arrived from /api/feeds. */
  noteFeed(feed: FeedStatus): void;
  busy(): boolean;
  destroy(): void;
}
