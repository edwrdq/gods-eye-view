import type { BBox, LonLat } from '@gev/shared';
import type { PlaceKind } from '../lib/bbox.ts';

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

export type BaseMapKind = 'google-photorealistic' | 'cesium-ion' | 'keyless';

export interface Globe {
  readonly baseMap: BaseMapKind;
  flyTo(target: FlyTarget): void;
  getCameraState(): CameraState;
  onCameraChange(cb: (state: CameraState) => void): () => void;
  /** Pointer position on the globe, or null off-globe. One pick per animation frame at most. */
  onCursor(cb: (pos: LonLat | null) => void): () => void;
  getCredits(): Credit[];
  onCreditsChange(cb: () => void): () => void;
  destroy(): void;
}

export interface GlobeOptions {
  container: HTMLElement;
  googleMapsApiKey: string | null;
  cesiumIonToken: string | null;
}
