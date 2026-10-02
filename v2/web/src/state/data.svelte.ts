import type { LayerDescriptor } from '@gev/shared';
import type { DataLayers, LayerRunState } from '../globe/index.ts';
import { currentFlags } from '../lib/flags.ts';
import { isRendered } from '../lib/layers.ts';
import { loadDataLayers, hasGlobe, setOnGlobeReady } from './globe.svelte.ts';
import { noteFeed, onFeedsUpdated } from './feeds.svelte.ts';
import { writeStored } from '../lib/storage.ts';
import { SAT_GROUP_KEY, layerStore } from './layers.svelte.ts';
import { selectFromGlobe, onFollowStopped } from './selection.svelte.ts';
import { onTimeCommit, setBusyProbe, timeState } from './time.svelte.ts';

/** What each enabled layer is doing right now. */
export const layerRun = $state<Record<string, LayerRunState>>({});

let data: DataLayers | null = null;
let loading: Promise<DataLayers | null> | null = null;

export function getData(): DataLayers | null {
  return data;
}

async function ensureData(): Promise<DataLayers | null> {
  if (data) return data;
  if (!hasGlobe()) return null;
  loading ??= loadDataLayers(
    {
      onLayerState(layer, state) {
        if (state) {
          layerRun[layer] = state;
          if (state.feed) noteFeed(state.feed);
        } else delete layerRun[layer];
      },
      onPick: selectFromGlobe,
      onFollowStopped,
    },
    (() => {
      const f = currentFlags();
      return { fixtures: f.fixtures, bench: f.bench, feedStates: f.feedStates, satBench: f.satBench };
    })(),
  ).then((d) => {
    if (!d) {
      loading = null;
      return null;
    }
    data = d;
    if (import.meta.env.DEV || import.meta.env.VITE_FIXTURES) (window as unknown as { __gevData?: unknown }).__gevData = d;
    setBusyProbe(() => d.busy());
    d.setTime(timeState.at);
    if (layerStore.satGroup !== null) d.setSatelliteGroup(layerStore.satGroup);
    return d;
  });
  return loading;
}

/** Make the renderer match the switches. Safe to call any time; waits for the globe. */
export async function syncData(): Promise<void> {
  const wanted = layerStore.layers.filter((l) => isRendered(l) && layerStore.enabled[l.id] === true);
  if (wanted.length === 0 && !data) return;
  const d = await ensureData();
  if (!d) return;
  for (const l of layerStore.layers) {
    if (!isRendered(l)) continue;
    d.setEnabled({ id: l.id, category: l.category, kind: l.kind }, layerStore.enabled[l.id] === true);
  }
}

/** Switch a layer on or off from the layer list. */
export function setLayerEnabled(layer: LayerDescriptor, on: boolean): void {
  layerStore.enabled[layer.id] = on;
  void syncData();
}

/** Show one satellite group (CelesTrak name) or all (null); remembered between sessions. */
export function setSatelliteGroup(group: string | null): void {
  layerStore.satGroup = group;
  writeStored(SAT_GROUP_KEY, group ?? '');
  data?.setSatelliteGroup(group);
}

export function retryLayer(layerId: string): void {
  data?.retry(layerId);
}

onTimeCommit((at) => data?.setTime(at));

setOnGlobeReady(() => void syncData());

// The server refreshed its element sets: let the satellites layer fetch them again.
onFeedsUpdated((feed) => data?.noteFeed(feed));
