import {
  BASEMAP_STORAGE_KEY,
  availability,
  getBaseMap,
  gibsDefaultDate,
  parseChoice,
  serializeChoice,
  validateGibsDate,
  type BaseMapChoice,
  type BaseMapId,
  type MapKeys,
} from '../lib/basemaps.ts';
import { readStored, writeStored } from '../lib/storage.ts';
import type { BaseMapRequest, Globe } from '../globe/types.ts';

/** What the picker shows. The Globe applies it; this store never touches Cesium. */
export const basemap = $state<{
  id: BaseMapId;
  buildings: boolean;
  flatTerrain: boolean;
  /** Day for dated sources (UTC, YYYY-MM-DD). Not persisted: it starts at the latest complete day. */
  date: string;
  busy: boolean;
  /** Last request that could not be honoured, in plain words. Cleared by the next change. */
  error: string | null;
  /** A fallback is on screen (for example Esri was unreachable). */
  note: string | null;
}>({ id: 'esri', buildings: false, flatTerrain: false, date: gibsDefaultDate(), busy: false, error: null, note: null });

let globe: Globe | null = null;
let keys: MapKeys = { googleMapsApiKey: null, cesiumIonToken: null };
let startedWith = '';
let seq = 0;

const choice = (): BaseMapChoice => ({ id: basemap.id, buildings: basemap.buildings, flatTerrain: basemap.flatTerrain });
const request = (): BaseMapRequest => ({ ...choice(), date: basemap.date });
const same = (a: BaseMapChoice, b: BaseMapChoice) => a.id === b.id && a.buildings === b.buildings && a.flatTerrain === b.flatTerrain;

/** Resolve the stored choice against the keys and hand the globe its starting request. */
export function initialBaseMap(k: MapKeys): BaseMapRequest {
  keys = k;
  Object.assign(basemap, parseChoice(readStored(BASEMAP_STORAGE_KEY), k));
  basemap.date = gibsDefaultDate();
  startedWith = JSON.stringify(request());
  return request();
}

export function keysFor(config: { googleMapsApiKey?: string | null; cesiumIonToken?: string | null } | null): MapKeys {
  return { googleMapsApiKey: config?.googleMapsApiKey ?? null, cesiumIonToken: config?.cesiumIonToken ?? null };
}

export function bindBaseMapGlobe(g: Globe | null) {
  globe = g;
  const shown = g?.getBaseMapShown();
  if (g && shown && shown !== basemap.id) {
    // A startup fallback (bad key, network): show what is really on the globe and say why.
    const wanted = getBaseMap(basemap.id)?.label ?? 'The chosen base map';
    basemap.id = shown;
    basemap.error = `${wanted} could not start. Check the key's restrictions, quota and network.`;
    startedWith = JSON.stringify(request());
    return;
  }
  // The user may have changed the choice while the globe was still starting.
  if (g && JSON.stringify(request()) !== startedWith) void commit(choice());
}

async function commit(previous: BaseMapChoice) {
  const mine = ++seq;
  basemap.error = null;
  basemap.note = null;
  if (!globe) {
    writeStored(BASEMAP_STORAGE_KEY, serializeChoice(choice()));
    return;
  }
  basemap.busy = true;
  const out = await globe.setBaseMap(request()).catch((e: unknown) => ({
    shown: null,
    error: e instanceof Error ? e.message : String(e),
    note: null,
  }));
  if (mine !== seq) return; // a newer change owns the state now
  basemap.busy = false;
  if (out.error && !same(previous, choice())) {
    // Keep the globe and the picker in agreement: go back to what is on screen.
    const failed = out.error;
    Object.assign(basemap, previous);
    basemap.error = failed;
    void globe.setBaseMap(request()).catch(() => {});
    return;
  }
  basemap.error = out.error;
  basemap.note = out.note;
  writeStored(BASEMAP_STORAGE_KEY, serializeChoice(choice()));
}

export function selectBaseMap(id: BaseMapId) {
  if (id === basemap.id || !availability(id, keys).available) return;
  const previous = choice();
  basemap.id = id;
  void commit(previous);
}

export function setBuildings(on: boolean) {
  if (on === basemap.buildings || (on && !keys.cesiumIonToken)) return;
  const previous = choice();
  basemap.buildings = on;
  void commit(previous);
}

export function setFlatTerrain(on: boolean) {
  if (on === basemap.flatTerrain) return;
  const previous = choice();
  basemap.flatTerrain = on;
  void commit(previous);
}

/** Phase 2's time slider calls this to drive dated imagery. Invalid days are ignored. */
export function setBaseMapDate(date: string) {
  const ok = validateGibsDate(date);
  if (!ok || ok === basemap.date) return;
  basemap.date = ok;
  if (basemap.id !== 'gibs' || !globe) return;
  const mine = ++seq;
  basemap.busy = true;
  void globe.setBaseMapDate(ok).then((out) => {
    if (mine !== seq) return;
    basemap.busy = false;
    basemap.error = out.error;
  });
}
