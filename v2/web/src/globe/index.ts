import type { LonLat } from '@gev/shared';
import { altitudeForBBox, altitudeForKind, altitudeToFitGlobe, normalizeBBox } from '../lib/bbox.ts';
import { wrapLon } from '../lib/format.ts';
import { installBaseMap } from './basemap.ts';
import { readCredits } from './credits.ts';
import type { CameraState, Globe, GlobeOptions } from './types.ts';

export type { BaseMapKind, CameraState, Credit, FlyTarget, Globe, GlobeOptions } from './types.ts';
export type { DataHooks, DataLayers, LayerRunState, LayerSpec, Selected, UpdateMetric } from './layers/manager.ts';

const START_VIEW = { lon: -20, lat: 24 };
const STAGE_COLOR = '#05080d'; // matches the mock's globe stage; imagery does not follow the UI theme

/**
 * Create the Cesium-backed globe. Cesium is imported dynamically so it lands in
 * its own chunk and the UI shell paints before any of it downloads.
 */
export async function createGlobe(options: GlobeOptions): Promise<Globe> {
  // Cesium locates workers, wasm and textures relative to this at first use,
  // so it must be set before the module is imported.
  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium/`;
  const Cesium = await import('cesium');
  const { container } = options;

  // Cesium draws credits into DOM it owns. We keep that DOM out of sight and
  // surface it through our own attribution popover instead of widgets.css.
  const creditHost = document.createElement('div');
  creditHost.hidden = true;
  container.appendChild(creditHost);

  // CesiumWidget is the viewer minus every UI widget (timeline, animation,
  // geocoder, pickers, info box...), so nothing needs switching off.
  let widget: import('cesium').CesiumWidget;
  try {
    widget = new Cesium.CesiumWidget(container, {
    baseLayer: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    scene3DOnly: true,
    skyBox: false,
    showRenderLoopErrors: false,
    creditContainer: creditHost,
    creditViewport: creditHost,
    msaaSamples: 1,
    });
  } catch (e) {
    creditHost.remove(); // no WebGL, or the context could not be created
    throw e;
  }
  const { scene, camera } = widget;
  scene.backgroundColor = Cesium.Color.fromCssColorString(STAGE_COLOR);
  scene.globe.baseColor = Cesium.Color.fromCssColorString('#0c2438'); // shows while tiles stream in
  scene.globe.showGroundAtmosphere = false // blows out to white without a lit sun;
  scene.globe.enableLighting = false;
  scene.globe.depthTestAgainstTerrain = false;
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  const fovOf = () => (camera.frustum instanceof Cesium.PerspectiveFrustum ? (camera.frustum.fovy ?? Math.PI / 3) : Math.PI / 3);
  widget.resize();
  const startAltitude = altitudeToFitGlobe({ aspect: container.clientWidth / Math.max(1, container.clientHeight), fovY: fovOf() });
  camera.setView({ destination: Cesium.Cartesian3.fromDegrees(START_VIEW.lon, START_VIEW.lat, startAltitude) });
  camera.percentageChanged = 0.05;

  // Timing marks for the first picture and for the first time every visible tile is in.
  const removeFirstFrame = scene.postRender.addEventListener(() => {
    performance.mark('gev:globe-first-frame');
    removeFirstFrame();
  });
  const removeTilesIdle = scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
    if (n === 0) {
      performance.mark('gev:globe-tiles-idle');
      removeTilesIdle();
    }
  });

  const cameraListeners = new Set<(s: CameraState) => void>();
  const cursorListeners = new Set<(p: LonLat | null) => void>();
  const creditListeners = new Set<() => void>();
  const disposers: Array<() => void> = [];
  const canvas = scene.canvas;

  const toLonLat = (c: import('cesium').Cartesian3 | undefined): LonLat | null => {
    if (!c) return null;
    const carto = Cesium.Cartographic.fromCartesian(c);
    return { lon: wrapLon(Cesium.Math.toDegrees(carto.longitude)), lat: Cesium.Math.toDegrees(carto.latitude) };
  };

  /** Surface point under a canvas position: terrain-aware when the globe is shown, else the ellipsoid. */
  const pickSurface = (x: number, y: number): LonLat | null => {
    const pos = new Cesium.Cartesian2(x, y);
    if (scene.globe.show) {
      const ray = camera.getPickRay(pos);
      const hit = ray ? scene.globe.pick(ray, scene) : undefined;
      if (hit) return toLonLat(hit);
    }
    return toLonLat(camera.pickEllipsoid(pos, scene.globe.ellipsoid));
  };

  // --- camera: altitude and centre on change, not every frame
  const cameraState = (): CameraState => {
    const rect = canvas.getBoundingClientRect();
    return {
      altitude: camera.positionCartographic.height,
      center: pickSurface(rect.width / 2, rect.height / 2),
    };
  };
  const emitCamera = () => {
    if (cameraListeners.size === 0) return;
    const state = cameraState();
    for (const cb of cameraListeners) cb(state);
  };
  disposers.push(camera.changed.addEventListener(emitCamera));
  disposers.push(camera.moveEnd.addEventListener(emitCamera));

  // --- cursor: remember the latest pointer, resolve once per animation frame
  let pointer: { x: number; y: number } | null = null;
  let frame = 0;
  const flushCursor = () => {
    frame = 0;
    const pos = pointer ? pickSurface(pointer.x, pointer.y) : null;
    for (const cb of cursorListeners) cb(pos);
  };
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(flushCursor);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    schedule();
  };
  const onLeave = () => {
    pointer = null;
    schedule();
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);

  // --- resize: CesiumWidget only resizes inside a render, which never comes in request mode
  const ro = new ResizeObserver(() => {
    widget.resize();
    scene.requestRender();
  });
  ro.observe(container);

  // --- credits
  const mo = new MutationObserver(() => {
    for (const cb of creditListeners) cb();
  });
  mo.observe(creditHost, { childList: true, subtree: true, characterData: true });

  const base = await installBaseMap(Cesium, widget, options);
  for (const w of base.warnings) console.warn(`[globe] ${w}`);

  // Development only: lets scripts drive the camera and inspect the scene.
  if (import.meta.env.DEV || import.meta.env.VITE_FIXTURES) {
    (window as unknown as { __gev?: unknown }).__gev = { Cesium, scene, camera };
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const globe: Globe = {
    baseMap: base.kind,
    getCameraState: cameraState,
    flyTo(target) {
      let lon = target.lon;
      let lat = target.lat;
      let altitude = altitudeForKind(target.kind);
      if (target.bbox) {
        const box = normalizeBBox(target.bbox);
        lon = box.centerLon;
        lat = box.centerLat;
        const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
        const fovY = fovOf();
        // A point-like box (a building) frames tighter than a city-sized default.
        altitude = altitudeForBBox(box, { aspect, fovY, minAltitude: target.kind === 'place' ? 4_000 : 1_200 });
      }
      camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: reduceMotion.matches ? 0 : 2.2,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
      scene.requestRender();
    },
    onCameraChange(cb) {
      cameraListeners.add(cb);
      return () => cameraListeners.delete(cb);
    },
    onCursor(cb) {
      cursorListeners.add(cb);
      return () => cursorListeners.delete(cb);
    },
    // base map: delegated to the controller in basemap.ts
    setBaseMap: (req) => base.controller.apply(req),
    setBaseMapDate: (date) => base.controller.setDate(date),
    async loadData(hooks, api) {
      const { createDataLayers } = await import('./layers/manager.ts');
      return createDataLayers(Cesium, widget, hooks, api);
    },
    getCredits() {
      return readCredits(creditHost);
    },
    onCreditsChange(cb) {
      creditListeners.add(cb);
      return () => creditListeners.delete(cb);
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      ro.disconnect();
      mo.disconnect();
      for (const d of disposers) d();
      cameraListeners.clear();
      cursorListeners.clear();
      creditListeners.clear();
      base.controller.destroy();
      if (!widget.isDestroyed()) widget.destroy();
      creditHost.remove();
    },
  };
  return globe;
}
