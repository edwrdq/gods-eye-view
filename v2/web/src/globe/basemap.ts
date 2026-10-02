import type { BaseMapKind } from './types.ts';

type CesiumModule = typeof import('cesium');

export const ESRI_CREDIT_HTML =
  'Imagery: <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community';
export const TERRAIN_CREDIT_HTML =
  'Terrain: <a href="https://github.com/reearth/reearth-terrain" target="_blank" rel="noopener">Re:Earth Terrain</a> / Mapterhorn, CC BY 4.0';

const KEYLESS_TERRAIN_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';

export interface BaseMapResult {
  kind: BaseMapKind;
  /** Non-fatal problems to log; the map still works. */
  warnings: string[];
}

/**
 * Pick and install the base map. Order of preference:
 *  1. Google key: Photorealistic 3D Tiles; the Cesium globe is hidden beneath them.
 *  2. Cesium ion token: ion world imagery plus world terrain.
 *  3. Keyless: Esri World Imagery (the original app's keyless default, with the
 *     required credit) and Re:Earth terrain (CC BY 4.0), falling back to a flat ellipsoid.
 * A failed upgrade falls through to the next option rather than leaving a blank globe.
 */
export async function installBaseMap(
  Cesium: CesiumModule,
  viewer: import('cesium').CesiumWidget,
  { googleMapsApiKey, cesiumIonToken }: { googleMapsApiKey: string | null; cesiumIonToken: string | null },
): Promise<BaseMapResult> {
  const { scene } = viewer;
  const warnings: string[] = [];

  if (googleMapsApiKey) {
    try {
      const tileset = await Cesium.createGooglePhotorealistic3DTileset(
        { key: googleMapsApiKey },
        { asynchronouslyLoadImagery: true },
      );
      scene.primitives.add(tileset);
      // The tiles are the surface; a globe underneath only costs fill rate and z-fights.
      scene.globe.show = false;
      scene.requestRender();
      return { kind: 'google-photorealistic', warnings };
    } catch (e) {
      warnings.push(`Google Photorealistic 3D Tiles unavailable: ${String(e)}`);
    }
  }

  // Ocean-coloured backdrop under every real imagery layer. Without it, tiles whose
  // imagery is still loading (or failed) render white once terrain arrives first.
  await addBackdrop(Cesium, viewer).catch(() => {});

  if (cesiumIonToken) {
    try {
      Cesium.Ion.defaultAccessToken = cesiumIonToken;
      const [imagery, terrain] = await Promise.all([
        Cesium.IonImageryProvider.fromAssetId(2), // Bing Maps Aerial with labels
        Cesium.createWorldTerrainAsync({ requestVertexNormals: true }),
      ]);
      scene.imageryLayers.addImageryProvider(imagery);
      scene.terrainProvider = terrain;
      scene.requestRender();
      return { kind: 'cesium-ion', warnings };
    } catch (e) {
      warnings.push(`Cesium ion imagery unavailable: ${String(e)}`);
    }
  }

  installKeyless(Cesium, viewer);
  return { kind: 'keyless', warnings };
}

function installKeyless(Cesium: CesiumModule, viewer: import('cesium').CesiumWidget) {
  const { scene } = viewer;
  // Imagery and terrain load independently so slow terrain never delays the picture.
  const esri = Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    { credit: new Cesium.Credit(ESRI_CREDIT_HTML, false), enablePickFeatures: false },
  );
  const slow = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out after 8 s')), 8000));
  void Promise.race([esri, slow])
    .catch((e) => {
      console.warn(`[globe] Esri imagery unavailable, using OpenStreetMap: ${String(e)}`);
      return new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
        credit: new Cesium.Credit('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors', false),
      });
    })
    .then((provider) => {
      if (viewer.isDestroyed()) return;
      scene.imageryLayers.addImageryProvider(provider);
      scene.requestRender();
    });

  void Cesium.CesiumTerrainProvider.fromUrl(KEYLESS_TERRAIN_URL, {
    credit: new Cesium.Credit(TERRAIN_CREDIT_HTML, false),
  })
    .then((provider) => {
      if (viewer.isDestroyed()) return;
      scene.terrainProvider = provider;
      scene.requestRender();
    })
    .catch((e) => console.warn(`[globe] Terrain unavailable, using a flat globe: ${String(e)}`));

  // Imagery and terrain stream in behind the first frame; nothing here blocks the globe becoming ready.
}

function backdropUrl(): string {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c2438';
  g.fillRect(0, 0, 4, 4);
  return c.toDataURL('image/png');
}

async function addBackdrop(Cesium: CesiumModule, viewer: import('cesium').CesiumWidget) {
  const provider = await Cesium.SingleTileImageryProvider.fromUrl(backdropUrl(), { rectangle: Cesium.Rectangle.MAX_VALUE });
  if (viewer.isDestroyed()) return;
  viewer.scene.imageryLayers.addImageryProvider(provider);
}
