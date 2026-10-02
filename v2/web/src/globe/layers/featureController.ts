import type { FeedStatus } from '@gev/shared';
import type { ApiConfig } from '../../api/index.ts';
import { FeatureHub } from '../../data/featureHub.ts';
import type { FeatureFailedMessage, FeaturesMessage, FromFeatureWorker } from '../../data/featureProtocol.ts';
import { nextPollMs } from '../../lib/cadence.ts';
import { featureWindow, isLiveOnly, referenceTime } from '../../lib/featureWindow.ts';
import { FeatureLayer } from './featureLayer.ts';
import type { ControllerHost, LayerController } from './host.ts';
import type { LayerRunState, LayerSpec } from './types.ts';

interface Runtime {
  spec: LayerSpec;
  view: FeatureLayer;
  state: LayerRunState;
  timer: ReturnType<typeof setTimeout> | undefined;
  inflight: number;
  failures: number;
  /** The instant ages are measured against for the data on screen. */
  ref: number;
}

/** Polls and draws every `kind: 'features'` layer (earthquakes, cyclones, launches, ...). */
export class FeatureController implements LayerController {
  private readonly hub: FeatureHub;
  private readonly layers = new Map<string, Runtime>();
  private destroyed = false;
  private readonly onVisibility = () => {
    for (const rt of this.layers.values()) {
      if (document.hidden) this.clearTimer(rt);
      else this.request(rt);
    }
  };

  constructor(
    private readonly host: ControllerHost,
    api: ApiConfig,
  ) {
    this.hub = new FeatureHub(api);
    this.hub.onMessage((m: FromFeatureWorker) => (m.type === 'features' ? this.onFeatures(m) : this.onFailed(m)));
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  owns(layer: string): boolean {
    return this.layers.has(layer);
  }

  enable(spec: LayerSpec): void {
    if (this.layers.has(spec.id) || this.destroyed) return;
    const rt: Runtime = {
      spec,
      view: new FeatureLayer(this.host.Cesium, this.host.scene, spec.id, spec.category),
      state: { phase: 'loading', hasData: false, feed: null, truncated: false, at: null, historical: false, drawn: 0, error: null },
      timer: undefined,
      inflight: 0,
      failures: 0,
      ref: Date.now(),
    };
    this.layers.set(spec.id, rt);
    this.emit(rt);
    this.request(rt);
  }

  disable(layer: string): void {
    const rt = this.layers.get(layer);
    if (!rt) return;
    this.clearTimer(rt);
    this.hub.drop(layer);
    rt.view.destroy();
    this.layers.delete(layer);
    this.host.emit(layer, null);
    this.host.scene.requestRender();
  }

  setTime(at: number | null): void {
    for (const rt of this.layers.values()) {
      if (isLiveOnly(rt.spec.id)) {
        // Current data stays; only the note in the row changes.
        rt.state = { ...rt.state, currentOnly: at !== null };
        this.emit(rt);
      } else {
        this.request(rt);
      }
    }
  }

  retry(layer: string): void {
    const rt = this.layers.get(layer);
    if (!rt) return;
    rt.failures = 0;
    this.request(rt);
  }

  noteFeed(_feed: FeedStatus): void {}

  positionOf(layer: string, objectId: string) {
    return this.layers.get(layer)?.view.positionOf(objectId);
  }

  sizeOf(layer: string, objectId: string): number {
    return this.layers.get(layer)?.view.sizeOf(objectId) ?? 20;
  }

  pin(sel: { layer: string; objectId: string } | null): void {
    for (const [id, rt] of this.layers) rt.view.pin(sel && sel.layer === id ? sel.objectId : null);
  }

  updateLabels(center: import('cesium').Cartesian3 | null, altitude: number): void {
    for (const rt of this.layers.values()) rt.view.updateLabels(center, altitude);
  }

  busy(): boolean {
    for (const rt of this.layers.values()) if (rt.inflight !== 0) return true;
    return false;
  }

  destroy(): void {
    this.destroyed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const rt of this.layers.values()) {
      this.clearTimer(rt);
      rt.view.destroy();
    }
    this.layers.clear();
    this.hub.destroy();
  }

  // --- internals

  private emit(rt: Runtime): void {
    this.host.emit(rt.spec.id, { ...rt.state });
  }

  private clearTimer(rt: Runtime): void {
    if (rt.timer !== undefined) clearTimeout(rt.timer);
    rt.timer = undefined;
  }

  private schedule(rt: Runtime): void {
    this.clearTimer(rt);
    if (document.hidden || this.destroyed) return;
    // A time-windowed layer in history mode is fetched on demand; current-only layers keep polling.
    if (this.host.timeAt() !== null && !isLiveOnly(rt.spec.id)) return;
    rt.timer = setTimeout(() => this.request(rt), nextPollMs(rt.state.feed, rt.state.drawn, rt.failures));
  }

  private request(rt: Runtime): void {
    this.clearTimer(rt);
    if (this.destroyed) return;
    const at = isLiveOnly(rt.spec.id) ? null : this.host.timeAt();
    rt.inflight = this.hub.fetch(rt.spec.id, featureWindow(rt.spec.id, at));
    if (!rt.state.hasData && rt.state.phase !== 'loading') {
      rt.state = { ...rt.state, phase: 'loading', error: null };
      this.emit(rt);
    }
  }

  private onFeatures(m: FeaturesMessage): void {
    const rt = this.layers.get(m.layer);
    if (!rt || m.seq !== rt.inflight) return;
    const t0 = performance.now();
    const at = isLiveOnly(m.layer) ? null : this.host.timeAt();
    const now = Date.now();
    rt.ref = referenceTime(at, now);
    const written = rt.view.apply(m.pack, rt.ref, now);
    rt.inflight = 0;
    rt.failures = 0;
    const drawn = m.pack.points.count + m.pack.lines.count + m.pack.polys.count;
    rt.state = {
      phase: 'ready',
      hasData: true,
      feed: m.feed,
      truncated: m.truncated,
      at: rt.ref,
      historical: at !== null,
      drawn,
      error: null,
      currentOnly: isLiveOnly(m.layer) && this.host.timeAt() !== null,
    };
    this.host.moved(m.layer);
    const applyMs = performance.now() - t0;
    this.host.metric({ layer: m.layer, received: m.received, written, applyMs, fetchMs: m.fetchMs, parseMs: m.packMs });
    this.emit(rt);
    this.schedule(rt);
  }

  private onFailed(m: FeatureFailedMessage): void {
    const rt = this.layers.get(m.layer);
    if (!rt || m.seq !== rt.inflight) return;
    rt.inflight = 0;
    rt.failures++;
    rt.state = { ...rt.state, phase: 'error', error: { failure: m.failure, message: m.message } };
    this.emit(rt);
    this.schedule(rt);
  }
}
