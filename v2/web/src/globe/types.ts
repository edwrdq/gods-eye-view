import type { BBox, LonLat } from '@gev/shared';
import type { ApiConfig } from '../api/index.ts';
import type { PlaceKind } from '../lib/bbox.ts';
import type { DataHooks, DataLayers } from './layers/manager.ts';
import type { BaseMapId } from '../lib/basemaps.ts';
import type { BaseMapOutcome, BaseMapRequest } from './basemap.ts';

export interface FlyTarget {
  lon: number;
  lat: number;
  bbox?: BBox;
  kind: PlaceKind;
}

export interface CameraState {
  /** Camera height above the WGS84 ellipsoid, metres. */
  altitude: number;
  /** Point under the screen centre, or null when the globe is not at the centre. */
  center: LonLat | null;
}

/** One attribution entry as safe HTML (only text, links and images survive). */
export interface Credit {
  html: string;
}

export type { BaseMapOutcome, BaseMapRequest } from './basemap.ts';

export type BaseMapKind = 'google-photorealistic' | 'cesium-ion' | 'keyless';

export interface Globe {
  readonly baseMap: BaseMapKind;
  flyTo(target: FlyTarget): void;
  getCameraState(): CameraState;
  onCameraChange(cb: (state: CameraState) => void): () => void;
  /** Pointer position on the globe, or null off-globe. One pick per animation frame at most. */
  onCursor(cb: (pos: LonLat | null) => void): () => void;
  /** Swap the base map in place (same viewer and camera). Resolves once the new source is installed. */
  setBaseMap(req: BaseMapRequest): Promise<BaseMapOutcome>;
  /** The base map actually on screen (differs from the request after a startup fallback). */
  getBaseMapShown(): BaseMapId | null;
  /** Change the day of a dated base map (NASA GIBS); other sources ignore it. */
  setBaseMapDate(date: string): Promise<BaseMapOutcome>;
  /** Load the data-layer renderer (its own chunk, fetched when the first layer is switched on). */
  loadData(hooks: DataHooks, api: ApiConfig): Promise<DataLayers>;
  getCredits(): Credit[];
  onCreditsChange(cb: () => void): () => void;
  destroy(): void;
}

export interface GlobeOptions {
  container: HTMLElement;
  googleMapsApiKey: string | null;
  cesiumIonToken: string | null;
  /** Initial base map; defaults to the best one the keys allow. */
  baseMap?: BaseMapRequest;
}
