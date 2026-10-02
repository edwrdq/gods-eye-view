import type { LayerCategory, LayerDescriptor } from '@gev/shared';

/** Display order from DESIGN.md. */
export const CATEGORY_ORDER: readonly LayerCategory[] = [
  'air',
  'sea',
  'space',
  'hazards',
  'weather',
  'infrastructure',
  'ground',
  'signals',
];

export const CATEGORY_LABEL: Record<LayerCategory, string> = {
  air: 'Air',
  sea: 'Sea',
  space: 'Space',
  hazards: 'Hazards',
  weather: 'Weather',
  infrastructure: 'Infrastructure',
  ground: 'Ground',
  signals: 'Signals',
};

export interface LayerGroup {
  category: LayerCategory;
  label: string;
  layers: LayerDescriptor[];
}

/** Only 'available' layers can be switched on. */
export function isToggleable(layer: LayerDescriptor): boolean {
  return layer.status === 'available';
}

/** Case-insensitive match on name, description and category label. */
export function matchesFilter(layer: LayerDescriptor, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    layer.name.toLowerCase().includes(q) ||
    layer.description.toLowerCase().includes(q) ||
    CATEGORY_LABEL[layer.category].toLowerCase().includes(q)
  );
}

/** Group by category in display order, dropping empty groups. Keeps server order within a group. */
export function groupLayers(layers: readonly LayerDescriptor[], query = ''): LayerGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABEL[category],
    layers: layers.filter((l) => l.category === category && matchesFilter(l, query)),
  })).filter((g) => g.layers.length > 0);
}

export function countOn(layers: readonly LayerDescriptor[], enabled: Readonly<Record<string, boolean>>): number {
  let n = 0;
  for (const l of layers) if (enabled[l.id] && isToggleable(l)) n++;
  return n;
}

/** Label for a row whose switch is unavailable, for assistive tech. */
export function switchLabel(layer: LayerDescriptor): string {
  return layer.status === 'planned' ? `${layer.name} (planned)` : layer.status === 'needs-key' ? `${layer.name} (needs API key)` : layer.name;
}

/** Layers the data renderer can draw today (everything else shows a placeholder when switched on). */
export const RENDERED_LAYERS: ReadonlySet<string> = new Set(['flights', 'military-flights', 'vessels']);

export function isRendered(layer: LayerDescriptor): boolean {
  return layer.status === 'available' && RENDERED_LAYERS.has(layer.id);
}

/** What the layer's objects are called in "11,482 aircraft". */
export function layerNoun(layerId: string, count: number): string {
  switch (layerId) {
    case 'flights':
    case 'military-flights':
      return 'aircraft';
    case 'vessels':
      return count === 1 ? 'ship' : 'ships';
    default:
      return count === 1 ? 'object' : 'objects';
  }
}
