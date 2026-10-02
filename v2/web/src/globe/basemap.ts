import type { BaseMapId, MapKeys } from '../lib/basemaps.ts';
import { gibsDefaultDate } from '../lib/basemaps.ts';
import type { BaseMapKind } from './types.ts';

type CesiumModule = typeof import('cesium');

export const ESRI_CREDIT_HTML =
  'Imagery: <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community';
export const TERRAIN_CREDIT_HTML =
  'Terrain: <a href="https://github.com/reearth/reearth-terrain" target="_blank" rel="noopener">Re:Earth Terrain</a> / Mapterhorn, CC BY 4.0';

const KEYLESS_TERRAIN_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';

/** What to show. `date` only matters for dated sources (NASA GIBS). */
export interface BaseMapRequest {
  id: BaseMapId;
  date: string;
  buildings: boolean;
  flatTerrain: boolean;
}

export interface BaseMapOutcome {
  /** The source actually on screen (differs from the request after a fallback or a failure). */
  shown: BaseMapId | null;
  /** Set when the request could not be honoured; the previous source stays on screen. */
  error: string | null;
  /** Non-fatal: a fallback was used. */
  note: string | null;
}

export interface BaseMapResult {
  kind: BaseMapKind;
  /** Non-fatal problems to log; the map still works. */
  warnings: string[];
  controller: BaseMapController;
}

export interface BaseMapController {
  apply(req: BaseMapRequest): Promise<BaseMapOutcome>;
  /** Re-apply the current request with a new day (dated sources only; others ignore it). */
  setDate(date: string): Promise<BaseMapOutcome>;
  readonly shown: BaseMapId | null;
  destroy(): void;
}

// --- provider catalogue. Verified 2026-10-02 by fetching tiles.

const gibsUrl = (date: string) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
const GIBS_MAX_LEVEL = 9;
const eoxUrl = (layer: string) => `https://tiles.maps.eox.at/wmts/1.0.0/${layer}/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg`;
const EOX_MAX_LEVEL = 14;
const OSM_URL = 'https://tile.openstreetmap.org/';
const OSM_MAX_LEVEL = 19;
const ION_BING_AERIAL = 2;
const ION_GOOGLE_3D = 2275207;
const ION_OSM_BUILDINGS = 96188;

const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const GIBS_CREDIT = (date: string) =>
  `Imagery: ${link('https://earthdata.nasa.gov/gibs', 'NASA GIBS')} / Worldview, VIIRS Suomi NPP true colour, ${date} (UTC)`;
const EOX_CREDIT = (year: string, licence: 'by' | 'by-nc-sa') =>
  `Imagery: ${link('https://s2maps.eu', 'Sentinel-2 cloudless')} ${year} by ${link('https://eox.at', 'EOX IT Services GmbH')} (contains modified Copernicus Sentinel data ${year}), ` +
  (licence === 'by'
    ? link('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')
    : `${link('https://creativecommons.org/licenses/by-nc-sa/4.0/', 'CC BY-NC-SA 4.0')}, non-commercial use only`);
const OSM_CREDIT = `© ${link('https://www.openstreetmap.org/copyright', 'OpenStreetMap')} contributors`;

const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000} s`)), ms));

export function kindOf(id: BaseMapId): BaseMapKind {
  return id === 'google-3d' ? 'google-photorealistic' : id === 'ion-aerial' ? 'cesium-ion' : 'keyless';
}

/**
 * Own the base map: one surface (an imagery layer, or a 3D tileset that hides the globe),
 * optional OSM Buildings, and terrain. Switching adds the new source first, then retires the
 * old one once the new picture is in, so the camera never moves and the globe never flashes empty.
 * Terrain: ion world terrain with a token, else Re:Earth (keyless), else the ellipsoid.
 */
function createController(Cesium: CesiumModule, viewer: import('cesium').CesiumWidget, keys: MapKeys): BaseMapController {
  const { scene } = viewer;
  const ionToken = keys.cesiumIonToken?.trim() || null;
  const googleKey = keys.googleMapsApiKey?.trim() || null;
  if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

  let gen = 0;
  let shown: BaseMapId | null = null;
  let current: BaseMapRequest | null = null;
  let imageryLayer: import('cesium').ImageryLayer | null = null;
  let surfaceKey = ''; // id + date of what is installed
  let tileset: import('cesium').Cesium3DTileset | null = null;
  let buildings: import('cesium').Cesium3DTileset | null = null;
  let retiring: import('cesium').ImageryLayer[] = [];
  let terrainFlat: boolean | null = null;
  let realTerrain: Promise<import('cesium').TerrainProvider> | null = null;
  let destroyed = false;

  const alive = () => !destroyed && !viewer.isDestroyed();
  const keyOf = (r: BaseMapRequest) => (r.id === 'gibs' ? `${r.id}:${r.date}` : r.id);

  function removeLayer(layer: import('cesium').ImageryLayer) {
    if (alive() && scene.imageryLayers.contains(layer)) scene.imageryLayers.remove(layer, true);
  }
  /** Remove superseded layers now (a newer switch started, or the new picture is in). */
  function flushRetiring() {
    for (const l of retiring) removeLayer(l);
    retiring = [];
  }
  function removeTileset(ts: import('cesium').Cesium3DTileset | null) {
    if (ts && alive() && scene.primitives.contains(ts)) scene.primitives.remove(ts);
  }

  /** Resolves when the globe has no tiles left to load, or after `ms`. */
  function whenIdle(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      let off = () => {};
      const finish = () => {
        if (done) return;
        done = true;
        off();
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      off = scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
        if (n === 0) finish();
      });
    });
  }

  async function imageryProvider(req: BaseMapRequest): Promise<{ provider: import('cesium').ImageryProvider; note: string | null }> {
    const credit = (html: string) => new Cesium.Credit(html, false);
    const template = (url: string, maximumLevel: number, html: string) =>
      new Cesium.UrlTemplateImageryProvider({
        url,
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        minimumLevel: 0,
        maximumLevel,
        credit: credit(html),
        enablePickFeatures: false,
      });
    const osm = () => new Cesium.OpenStreetMapImageryProvider({ url: OSM_URL, maximumLevel: OSM_MAX_LEVEL, credit: credit(OSM_CREDIT) });
    switch (req.id) {
      case 'esri':
        try {
          const esri = Cesium.ArcGisMapServerImageryProvider.fromUrl(
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
            { credit: credit(ESRI_CREDIT_HTML), enablePickFeatures: false },
          );
          return { provider: await Promise.race([esri, timeout(8000)]), note: null };
        } catch (e) {
          console.warn(`[globe] Esri imagery unavailable, using OpenStreetMap: ${String(e)}`);
          return { provider: osm(), note: 'Esri did not respond; showing OpenStreetMap instead.' };
        }
      case 'gibs':
        return { provider: template(gibsUrl(req.date), GIBS_MAX_LEVEL, GIBS_CREDIT(req.date)), note: null };
      case 's2-2016':
        return { provider: template(eoxUrl('s2cloudless_3857'), EOX_MAX_LEVEL, EOX_CREDIT('2016', 'by')), note: null };
      case 's2-2025':
        return { provider: template(eoxUrl('s2cloudless-2025_3857'), EOX_MAX_LEVEL, EOX_CREDIT('2025', 'by-nc-sa')), note: null };
      case 'osm':
        return { provider: osm(), note: null };
      case 'ion-aerial':
        if (!ionToken) throw new Error('Needs CESIUM_ION_TOKEN in .env');
        return { provider: await Cesium.IonImageryProvider.fromAssetId(ION_BING_AERIAL, { accessToken: ionToken }), note: null };
      default:
        throw new Error('Not an imagery source');
    }
  }

  /** Direct with a Google key; through ion when only a token exists (or the key fails). */
  async function googleTileset(): Promise<import('cesium').Cesium3DTileset> {
    const errors: string[] = [];
    if (googleKey) {
      try {
        return await Cesium.createGooglePhotorealistic3DTileset({ key: googleKey }, { asynchronouslyLoadImagery: true });
      } catch (e) {
        errors.push(String(e));
      }
    }
    if (ionToken) {
      try {
        const resource = await Cesium.IonResource.fromAssetId(ION_GOOGLE_3D, { accessToken: ionToken });
        return await Cesium.Cesium3DTileset.fromUrl(resource, { enableCollision: true });
      } catch (e) {
        errors.push(String(e));
      }
    }
    throw new Error(
      googleKey || ionToken
        ? "Google 3D tiles unavailable: check the key's API restrictions, quota and network."
        : 'Needs GOOGLE_MAPS_API_KEY in .env',
    );
  }

  async function switchSurface(req: BaseMapRequest, mine: number): Promise<BaseMapOutcome | 'stale'> {
    if (req.id === 'google-3d') {
      const ts = await googleTileset();
      if (mine !== gen || !alive()) {
        ts.destroy();
        return 'stale';
      }
      scene.primitives.add(ts);
      flushRetiring();
      removeTileset(tileset);
      tileset = ts;
      if (imageryLayer) retiring.push(imageryLayer);
      imageryLayer = null;
      flushRetiring();
      // The tiles are the surface; a globe underneath only costs fill rate and z-fights.
      scene.globe.show = false;
      return { shown: req.id, error: null, note: null };
    }
    const { provider, note } = await imageryProvider(req);
    if (mine !== gen || !alive()) return 'stale';
    flushRetiring(); // a quick second switch drops the half-loaded one
    const layer = scene.imageryLayers.addImageryProvider(provider);
    if (imageryLayer) retiring.push(imageryLayer);
    imageryLayer = layer;
    scene.globe.show = true;
    removeTileset(tileset);
    tileset = null;
    void whenIdle(5000).then(() => {
      if (mine === gen) flushRetiring();
    });
    return { shown: note ? 'osm' : req.id, error: null, note };
  }

  function getRealTerrain() {
    realTerrain ??= (async () => {
      try {
        return ionToken
          ? await Cesium.createWorldTerrainAsync({ requestVertexNormals: true })
          : await Cesium.CesiumTerrainProvider.fromUrl(KEYLESS_TERRAIN_URL, { credit: new Cesium.Credit(TERRAIN_CREDIT_HTML, false) });
      } catch (e) {
        console.warn(`[globe] Terrain unavailable, using a flat globe: ${String(e)}`);
        return new Cesium.EllipsoidTerrainProvider();
      }
    })();
    return realTerrain;
  }

  async function applyTerrain(flat: boolean, mine: number) {
    if (terrainFlat === flat) return;
    terrainFlat = flat;
    const provider = flat ? new Cesium.EllipsoidTerrainProvider() : await getRealTerrain();
    if (mine !== gen || !alive()) {
      terrainFlat = null;
      return;
    }
    scene.terrainProvider = provider;
    scene.requestRender();
  }

  async function applyBuildings(on: boolean, mine: number) {
    if (!on) {
      removeTileset(buildings);
      buildings = null;
      return;
    }
    if (buildings || !ionToken) return;
    const resource = await Cesium.IonResource.fromAssetId(ION_OSM_BUILDINGS, { accessToken: ionToken });
    const ts = await Cesium.Cesium3DTileset.fromUrl(resource);
    if (mine !== gen || !alive()) {
      ts.destroy();
      return;
    }
    scene.primitives.add(ts);
    buildings = ts;
  }

  const outcome = (error: string | null, note: string | null = null): BaseMapOutcome => ({ shown, error, note });

  async function apply(req: BaseMapRequest): Promise<BaseMapOutcome> {
    const mine = ++gen;
    const want = { ...req };
    let result: BaseMapOutcome = outcome(null);
    try {
      if (keyOf(want) !== surfaceKey) {
        const r = await switchSurface(want, mine);
        if (r === 'stale') return outcome(null);
        surfaceKey = keyOf(want);
        shown = r.shown;
        result = r;
      }
    } catch (e) {
      // Keep what is on screen. Only the very first install has nothing to fall back to.
      current ??= want;
      return outcome(e instanceof Error ? e.message : String(e));
    }
    current = want;
    // Terrain and buildings never delay the picture; the 3D tiles carry their own ground.
    if (want.id !== 'google-3d') {
      void applyTerrain(want.flatTerrain, mine).catch((e) => console.warn(`[globe] Terrain change failed: ${String(e)}`));
      try {
        await applyBuildings(want.buildings, mine);
      } catch (e) {
        result = { ...result, error: `OSM Buildings unavailable: ${e instanceof Error ? e.message : String(e)}` };
      }
    } else {
      removeTileset(buildings);
      buildings = null;
    }
    scene.requestRender();
    return result;
  }

  return {
    apply,
    setDate(date) {
      if (!current) return Promise.resolve(outcome(null));
      return apply({ ...current, date });
    },
    get shown() {
      return shown;
    },
    destroy() {
      destroyed = true;
      gen++;
      retiring = [];
    },
  };
}

/**
 * Install the initial base map. If the chosen source cannot start (bad key, network), fall
 * through to the next best rather than leaving a blank globe. Order of the chain:
 * the request, ion aerial (token), Esri, OpenStreetMap.
 */
export async function installBaseMap(
  Cesium: CesiumModule,
  viewer: import('cesium').CesiumWidget,
  keys: MapKeys & { baseMap?: BaseMapRequest },
): Promise<BaseMapResult> {
  const warnings: string[] = [];
  // Ocean-coloured backdrop under every real imagery layer. Without it, tiles whose
  // imagery is still loading (or failed) render white once terrain arrives first.
  await addBackdrop(Cesium, viewer).catch(() => {});

  const controller = createController(Cesium, viewer, keys);
  const base: BaseMapRequest = keys.baseMap ?? {
    id: keys.googleMapsApiKey ? 'google-3d' : keys.cesiumIonToken ? 'ion-aerial' : 'esri',
    date: gibsDefaultDate(),
    buildings: false,
    flatTerrain: false,
  };
  const chain: BaseMapRequest[] = [base];
  if (base.id !== 'esri') chain.push({ ...base, id: 'esri' });
  chain.push({ ...base, id: 'osm' });

  const tryChain = async () => {
    for (const req of chain) {
      const r = await controller.apply(req);
      if (!r.error || controller.shown === req.id) {
        if (r.error) warnings.push(r.error);
        return;
      }
      warnings.push(`${req.id}: ${r.error}`);
    }
  };
  // Imagery that needs no handshake streams in behind the first frame; sources that
  // need a handshake (3D tiles, ion) are awaited as before so failure can fall through.
  if (base.id === 'google-3d' || base.id === 'ion-aerial') await tryChain();
  else void tryChain();
  viewer.scene.requestRender();
  return { kind: kindOf(base.id), warnings, controller };
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
