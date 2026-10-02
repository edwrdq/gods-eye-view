import type { ClientConfig, LayerCategory, LayerDescriptor } from '@gev/shared';
import { isToggleable } from '../lib/layers.ts';
import { readStored, writeStored } from '../lib/storage.ts';

export type ConfigStatus = 'loading' | 'ready' | 'error';

/** Layer state only; nothing renders data in this phase. */
export const layerStore = $state<{
  status: ConfigStatus;
  layers: LayerDescriptor[];
  enabled: Record<string, boolean>;
  config: ClientConfig | null;
}>({ status: 'loading', layers: [], enabled: {}, config: null });

export function toggleLayer(layer: LayerDescriptor) {
  if (!isToggleable(layer)) return;
  layerStore.enabled[layer.id] = !layerStore.enabled[layer.id];
}

export async function loadConfig(signal?: AbortSignal): Promise<ClientConfig | null> {
  layerStore.status = 'loading';
  try {
    const res = await fetch('/api/config', { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const config = (await res.json()) as ClientConfig;
    layerStore.config = config;
    layerStore.layers = config.layers;
    layerStore.status = 'ready';
    return config;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    layerStore.status = 'error';
    return null;
  }
}

// --- which groups are collapsed; persists across sessions
const GROUPS_KEY = 'gev.v2.layerGroups.collapsed';

function loadCollapsed(): LayerCategory[] {
  const raw = readStored(GROUPS_KEY);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as LayerCategory[]) : [];
  } catch {
    return [];
  }
}

export const groupState = $state<{ collapsed: LayerCategory[] }>({ collapsed: loadCollapsed() });

export function isCollapsed(category: LayerCategory): boolean {
  return groupState.collapsed.includes(category);
}

export function toggleGroup(category: LayerCategory) {
  groupState.collapsed = isCollapsed(category)
    ? groupState.collapsed.filter((c) => c !== category)
    : [...groupState.collapsed, category];
  writeStored(GROUPS_KEY, JSON.stringify(groupState.collapsed));
}
