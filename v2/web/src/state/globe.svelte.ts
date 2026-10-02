import type { LonLat } from '@gev/shared';
import { createGlobe, type FlyTarget, type Globe } from '../globe/index.ts';
import { bindBaseMapGlobe, initialBaseMap, keysFor } from './basemap.svelte.ts';
import type { ApiConfig } from '../api/index.ts';
import type { DataHooks, DataLayers } from '../globe/index.ts';
import { layerStore } from './layers.svelte.ts';

export type GlobeStatus = 'idle' | 'loading' | 'ready' | 'error';

/** What the shell shows about the globe. The Globe itself is not reactive. */
export const globeState = $state<{
  status: GlobeStatus;
  error: string;
  cursor: LonLat | null;
  center: LonLat | null;
  altitude: number | null;
  baseMap: Globe['baseMap'] | null;
}>({ status: 'idle', error: '', cursor: null, center: null, altitude: null, baseMap: null });

let globe: Globe | null = null;
let pending: FlyTarget | null = null;
let generation = 0;
const offs: Array<() => void> = [];

export function flyTo(target: FlyTarget) {
  if (globe) globe.flyTo(target);
  else pending = target; // the globe is still loading; go there once it is up
}

export function hasGlobe(): boolean {
  return globe !== null;
}

/** Load the data-layer renderer into the running globe. */
export async function loadDataLayers(hooks: DataHooks, api: ApiConfig): Promise<DataLayers | null> {
  return globe ? globe.loadData(hooks, api) : null;
}

/** Called once the globe is up so layers switched on while it loaded get drawn. */
let onReady: (() => void) | null = null;
export function setOnGlobeReady(cb: () => void) {
  onReady = cb;
}

export function getCredits() {
  return globe?.getCredits() ?? [];
}

export function onCreditsChange(cb: () => void): () => void {
  return globe?.onCreditsChange(cb) ?? (() => {});
}

export async function startGlobe(container: HTMLElement) {
  const mine = ++generation;
  globeState.status = 'loading';
  globeState.error = '';
  try {
    const cfg = layerStore.config;
    const g = await createGlobe({
      container,
      googleMapsApiKey: cfg?.googleMapsApiKey ?? null,
      cesiumIonToken: cfg?.cesiumIonToken ?? null,
      baseMap: initialBaseMap(keysFor(cfg)),
    });
    if (mine !== generation) {
      g.destroy();
      return;
    }
    globe = g;
    bindBaseMapGlobe(g);
    offs.push(
      g.onCameraChange((s) => {
        globeState.altitude = s.altitude;
        globeState.center = s.center;
      }),
      g.onCursor((p) => {
        globeState.cursor = p;
      }),
    );
    const initial = g.getCameraState();
    globeState.altitude = initial.altitude;
    globeState.center = initial.center;
    globeState.baseMap = g.baseMap;
    globeState.status = 'ready';
    performance.mark('gev:globe-ready');
    if (pending) {
      g.flyTo(pending);
      pending = null;
    }
    onReady?.();
  } catch (e) {
    if (mine !== generation) return;
    globeState.status = 'error';
    globeState.error = e instanceof Error ? e.message : String(e);
  }
}

export function stopGlobe() {
  generation++;
  for (const off of offs.splice(0)) off();
  bindBaseMapGlobe(null);
  globe?.destroy();
  globe = null;
}
