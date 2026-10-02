import type { BBox, FeedStatus, ObjectDetail, Track } from '@gev/shared';
import type { ApiConfig } from '../../api/index.ts';
import { SnapshotHub } from '../../data/hub.ts';
import type { FailedMessage, FromWorker, UpdateMessage } from '../../data/protocol.ts';
import { bboxArea, bboxContains, bboxFromRectangle } from '../../lib/bbox.ts';
import { nextPollMs } from '../../lib/cadence.ts';
import { debounce } from '../../lib/debounce.ts';
import { CATEGORY_MAP_COLOR, markerVariantFor } from '../../lib/markerStyle.ts';
import { thin } from '../../lib/trackStyle.ts';
import { selectionRingCanvas, SELECTION_KEY } from './markers.ts';
import { parsePickId, PointLayer } from './pointLayer.ts';
import { TrackLine } from './track.ts';
import type { ControllerHost, LayerController } from './host.ts';
import type { FeatureController } from './featureController.ts';
import type { OrbitController } from './orbitController.ts';
import type { DataHooks, LayerRunState, LayerSpec, Selected, UpdateMetric } from './types.ts';

type Cesium = typeof import('cesium');

/** Labels appear below this camera height. */
export const LABEL_MAX_ALTITUDE_M = 800_000;
const MOVE_DEBOUNCE_MS = 350;
const MAX_TRACK_POINTS = 1500;

export type { DataHooks, GroupInfo, LayerRunState, LayerSpec, Selected, UpdateMetric } from './types.ts';

interface Runtime {
  spec: LayerSpec;
  point: PointLayer;
  state: LayerRunState;
  timer: ReturnType<typeof setTimeout> | undefined;
  inflight: number;
  failures: number;
  requestedBBox: BBox | null;
  lastBBox: BBox | null | undefined;
  lastTruncated: boolean;
}

export interface DataLayers {
  setEnabled(spec: LayerSpec, enabled: boolean): void;
  /** Viewed instant for historical snapshots; null for live. */
  setTime(at: number | null): void;
  retry(layer: string): void;
  select(sel: Selected | null): void;
  /** Fly to the selected object and keep it centred as it moves. Resolves false when it is not drawn. */
  follow(on: boolean): boolean;
  showTrack(layer: string, points: Track['points']): boolean;
  hideTrack(): void;
  /** True while a snapshot request is in flight. */
  busy(): boolean;
  metrics(): readonly UpdateMetric[];
  /** Newer feed status from /api/feeds (the satellites layer refetches its elements when the server's data changed). */
  noteFeed(feed: FeedStatus): void;
  /** Show one satellite group (CelesTrak name), or all with null. */
  setSatelliteGroup(group: string | null): void;
  /** Detail for a satellite, computed in the browser. `drawPath` also draws its orbit for one period either side of the viewed time. */
  describeSatellite(noradId: string, drawPath: boolean): Promise<ObjectDetail | null>;
  destroy(): void;
}

export function createDataLayers(
  Cesium: Cesium,
  widget: import('cesium').CesiumWidget,
  hooks: DataHooks,
  api: ApiConfig,
): DataLayers {
  const { scene, camera } = widget;
  const canvas = scene.canvas;
  const hub = new SnapshotHub(api);
  const layers = new Map<string, Runtime>();
  const metrics: UpdateMetric[] = [];
  const track = new TrackLine(Cesium, scene);
  let trackLayer: string | null = null;
  let timeAt: number | null = null;
  let selected: Selected | null = null;
  let following = false;
  let flying = false;
  let destroyed = false;

  // --- feature and orbit controllers: loaded on first use so flights-only sessions never fetch them
  const ctls: LayerController[] = [];
  let featureCtl: FeatureController | null = null;
  let orbitCtl: OrbitController | null = null;
  const loading: { features?: Promise<FeatureController>; orbits?: Promise<OrbitController> } = {};
  const wanted = new Map<string, LayerSpec>();
  const host: ControllerHost = {
    Cesium,
    scene,
    timeAt: () => timeAt,
    emit: (layer, state) => hooks.onLayerState(layer, state),
    metric: (m) => {
      metrics.push(m);
      if (metrics.length > 60) metrics.shift();
    },
    moved: (layer) => {
      if (selected && selected.layer === layer) {
        placeRing();
        followStep();
      }
      refreshLabels();
    },
  };
  const ctlOf = (layer: string): LayerController | undefined => ctls.find((c) => c.owns(layer));
  const needFeatures = (): Promise<FeatureController> =>
    (loading.features ??= import('./featureController.ts').then((m) => {
      featureCtl = new m.FeatureController(host, api);
      ctls.push(featureCtl);
      return featureCtl;
    }));
  const needOrbits = (): Promise<OrbitController> =>
    (loading.orbits ??= import('./orbitController.ts').then((m) => {
      orbitCtl = new m.OrbitController(host, api, api.satBench);
      ctls.push(orbitCtl);
      return orbitCtl;
    }));

  // --- selection ring: one billboard, moved to the selected object
  const ringCollection = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
  const ring = ringCollection.add({ position: Cesium.Cartesian3.ZERO, show: false, scale: 0.5 });
  ring.setImage(SELECTION_KEY, selectionRingCanvas());

  const viewCenter = (): import('cesium').Cartesian3 | null => {
    const c = camera.pickEllipsoid(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2), scene.globe.ellipsoid);
    return c ?? null;
  };

  const currentBBox = (): BBox | null => bboxFromRectangle(camera.computeViewRectangle(scene.globe.ellipsoid));

  function refreshLabels(): void {
    const show = camera.positionCartographic.height < LABEL_MAX_ALTITUDE_M;
    const center = show ? viewCenter() : null;
    for (const rt of layers.values()) rt.point.updateLabels(center);
    if (ctls.length > 0) {
      const c = viewCenter();
      for (const ctl of ctls) ctl.updateLabels(c, camera.positionCartographic.height);
    }
    scene.requestRender();
  }

  /** Earth-fixed position of the selected object, wherever it is drawn. */
  function selectedPosition(): import('cesium').Cartesian3 | undefined {
    if (!selected) return undefined;
    const rt = layers.get(selected.layer);
    if (rt) {
      const slot = rt.point.slotOf(selected.objectId);
      return slot === undefined ? undefined : rt.point.positionOf(slot);
    }
    return ctlOf(selected.layer)?.positionOf(selected.layer, selected.objectId);
  }

  /** Make `sel` the labelled object of its layer and clear the pin everywhere else. */
  function pinSelected(sel: Selected | null): void {
    for (const rt of layers.values()) {
      const slot = sel && sel.layer === rt.spec.id ? rt.point.slotOf(sel.objectId) : undefined;
      rt.point.pin(slot ?? -1);
    }
    for (const c of ctls) c.pin(sel);
  }

  function placeRing(): void {
    const pos = selectedPosition();
    if (!selected || !pos) {
      ring.show = false;
      return;
    }
    ring.position = pos;
    const px = layers.has(selected.layer) ? 20 : (ctlOf(selected.layer)?.sizeOf(selected.layer, selected.objectId) ?? 20);
    ring.scale = layers.has(selected.layer) ? 0.5 : Math.max(0.5, (px + 8) / 44);
    ring.show = true;
    pinSelected(selected);
  }

  function followStep(): void {
    if (!following || flying) return;
    const target = selectedPosition();
    const c = viewCenter();
    if (!target || !c) return;
    const a = Cesium.Cartesian3.normalize(c, new Cesium.Cartesian3());
    const b = Cesium.Cartesian3.normalize(target, new Cesium.Cartesian3());
    const angle = Math.acos(Math.max(-1, Math.min(1, Cesium.Cartesian3.dot(a, b))));
    if (angle < 1e-8) return;
    const axis = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(a, b, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    camera.rotate(axis, -angle);
  }

  // --- polling
  function emit(rt: Runtime): void {
    hooks.onLayerState(rt.spec.id, { ...rt.state });
  }

  function clearTimer(rt: Runtime): void {
    if (rt.timer !== undefined) clearTimeout(rt.timer);
    rt.timer = undefined;
  }

  function schedule(rt: Runtime): void {
    clearTimer(rt);
    if (timeAt !== null || document.hidden || destroyed) return; // history is fetched on demand, not polled
    rt.timer = setTimeout(() => request(rt), nextPollMs(rt.state.feed, rt.state.drawn, rt.failures));
  }

  function request(rt: Runtime): void {
    clearTimer(rt);
    if (destroyed) return;
    rt.requestedBBox = currentBBox();
    rt.inflight = hub.fetch(rt.spec.id, rt.requestedBBox, timeAt);
    if (!rt.state.hasData && rt.state.phase !== 'loading') {
      rt.state = { ...rt.state, phase: 'loading', error: null };
      emit(rt);
    }
  }

  function onUpdate(m: UpdateMessage): void {
    const rt = layers.get(m.layer);
    if (!rt || m.seq !== rt.inflight) return;
    const t0 = performance.now();
    const written = rt.point.apply(m.packet);
    rt.inflight = 0;
    rt.failures = 0;
    rt.lastBBox = rt.requestedBBox;
    rt.lastTruncated = m.truncated;
    rt.state = { phase: 'ready', hasData: true, feed: m.feed, truncated: m.truncated, at: m.at, historical: m.historical, drawn: m.packet.alive, error: null };
    if (selected && selected.layer === m.layer) {
      placeRing();
      followStep();
    }
    refreshLabels();
    const applyMs = performance.now() - t0;
    metrics.push({ layer: m.layer, received: m.received, written, applyMs, fetchMs: m.fetchMs, parseMs: m.parseMs });
    if (metrics.length > 60) metrics.shift();
    emit(rt);
    schedule(rt);
  }

  function onFailed(m: FailedMessage): void {
    const rt = layers.get(m.layer);
    if (!rt || m.seq !== rt.inflight) return;
    rt.inflight = 0;
    rt.failures++;
    rt.state = { ...rt.state, phase: 'error', error: { failure: m.failure, message: m.message } };
    emit(rt);
    schedule(rt);
  }

  hub.onMessage((m: FromWorker) => (m.type === 'update' ? onUpdate(m) : onFailed(m)));

  // --- camera
  const onMoveEnd = debounce(() => {
    if (destroyed) return;
    const next = currentBBox();
    for (const rt of layers.values()) {
      const covered = rt.lastBBox !== undefined && bboxContains(rt.lastBBox, next);
      // A capped answer only covered its busiest part: zooming in deserves a fresh, fuller one.
      const zoomedIn = rt.lastTruncated && bboxArea(next) < bboxArea(rt.lastBBox ?? null) * 0.6;
      if (!covered || zoomedIn) request(rt);
    }
    refreshLabels();
  }, MOVE_DEBOUNCE_MS);
  const offMoveEnd = camera.moveEnd.addEventListener(onMoveEnd);

  // --- user input releases a follow; clicks pick
  const stopFollowing = () => {
    if (flying) {
      camera.cancelFlight();
      flying = false;
    }
    if (!following) return;
    following = false;
    hooks.onFollowStopped();
  };
  canvas.addEventListener('pointerdown', stopFollowing);
  canvas.addEventListener('wheel', stopFollowing, { passive: true });

  const handler = new Cesium.ScreenSpaceEventHandler(canvas);
  handler.setInputAction((e: { position: import('cesium').Cartesian2 }) => {
    const picked = scene.pick(e.position, 8, 8) as { id?: unknown } | undefined;
    hooks.onPick(parsePickId(picked?.id));
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // --- tab visibility: no polling while hidden, refresh on return
  const onVisibility = () => {
    for (const rt of layers.values()) {
      if (document.hidden) clearTimer(rt);
      else if (timeAt === null) request(rt);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const api_: DataLayers = {
    setEnabled(spec, enabled) {
      if (spec.kind !== 'tracked') {
        // Features and orbit layers live in their own controllers (lazy chunks).
        if (enabled) wanted.set(spec.id, spec);
        else wanted.delete(spec.id);
        if (!enabled && !ctlOf(spec.id) && !loading[spec.kind === 'orbits' ? 'orbits' : 'features']) return;
        const ready = spec.kind === 'orbits' ? needOrbits() : needFeatures();
        void ready.then((ctl) => {
          if (destroyed) return;
          if (wanted.has(spec.id)) {
            ctl.enable(spec);
            ctl.setTime(timeAt);
          } else {
            ctl.disable(spec.id);
            if (selected?.layer === spec.id) {
              api_.select(null);
              hooks.onPick(null);
            }
          }
        });
        return;
      }
      const existing = layers.get(spec.id);
      if (!enabled) {
        if (!existing) return;
        clearTimer(existing);
        hub.drop(spec.id);
        existing.point.destroy();
        layers.delete(spec.id);
        hooks.onLayerState(spec.id, null);
        if (selected?.layer === spec.id) {
          api_.select(null);
          hooks.onPick(null);
        }
        scene.requestRender();
        return;
      }
      if (existing) return;
      const rt: Runtime = {
        spec,
        point: new PointLayer(Cesium, scene, { layer: spec.id, category: spec.category, variant: markerVariantFor(spec.id) }),
        state: { phase: 'loading', hasData: false, feed: null, truncated: false, at: null, historical: false, drawn: 0, error: null },
        timer: undefined,
        inflight: 0,
        failures: 0,
        requestedBBox: null,
        lastBBox: undefined,
        lastTruncated: false,
      };
      layers.set(spec.id, rt);
      emit(rt);
      request(rt);
    },
    setTime(at) {
      if (at === timeAt) return;
      timeAt = at;
      for (const rt of layers.values()) request(rt);
      for (const c of ctls) c.setTime(at);
    },
    retry(layer) {
      const rt = layers.get(layer);
      if (rt) {
        rt.failures = 0;
        request(rt);
      } else ctlOf(layer)?.retry(layer);
    },
    select(sel) {
      selected = sel;
      orbitCtl?.select(sel && sel.layer === 'satellites' ? sel.objectId : null);
      if (!sel) {
        ring.show = false;
        pinSelected(null);
        stopFollowing();
        api_.hideTrack();
      } else {
        placeRing();
        if (following) stopFollowing();
      }
      refreshLabels();
    },
    follow(on) {
      if (!on) {
        stopFollowing();
        return true;
      }
      const target = selectedPosition();
      if (!target) return false;
      flying = true;
      following = true;
      const range = Math.min(Math.max(camera.positionCartographic.height, 40_000), 1_500_000);
      camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.clone(target), 0), {
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.2,
        offset: new Cesium.HeadingPitchRange(camera.heading, -Math.PI / 2, range),
        complete: () => {
          flying = false;
          followStep();
        },
        cancel: () => {
          flying = false;
        },
      });
      scene.requestRender();
      return true;
    },
    showTrack(layer, points) {
      const rt = layers.get(layer);
      const category = rt?.spec.category ?? 'air';
      trackLayer = layer;
      return track.show(thin(points, MAX_TRACK_POINTS), CATEGORY_MAP_COLOR[category]);
    },
    hideTrack() {
      if (trackLayer === null) return;
      trackLayer = null;
      track.hide();
    },
    busy() {
      for (const rt of layers.values()) if (rt.inflight !== 0) return true;
      return ctls.some((c) => c.busy());
    },
    metrics: () => metrics,
    noteFeed(feed) {
      for (const c of ctls) c.noteFeed(feed);
    },
    setSatelliteGroup(group) {
      void needOrbits().then((c) => c.setGroup(group));
    },
    async describeSatellite(noradId, drawPath) {
      return (await needOrbits()).describe(noradId, drawPath);
    },
    destroy() {
      destroyed = true;
      onMoveEnd.cancel();
      offMoveEnd();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', stopFollowing);
      canvas.removeEventListener('wheel', stopFollowing);
      handler.destroy();
      for (const rt of layers.values()) {
        clearTimer(rt);
        rt.point.destroy();
      }
      layers.clear();
      for (const c of ctls) c.destroy();
      ctls.length = 0;
      track.destroy();
      scene.primitives.remove(ringCollection);
      hub.destroy();
    },
  };
  return api_;
}
