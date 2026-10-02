import type { LayerCategory } from '@gev/shared';

/** Lucide icon (file name) for the detail panel tile of each layer. Layers not listed use their category's icon. */
export const LAYER_ICON: Readonly<Record<string, string>> = {
  flights: 'plane',
  'military-flights': 'plane',
  vessels: 'ship',
  satellites: 'satellite',
  launches: 'rocket',
  earthquakes: 'activity',
  fires: 'flame',
  weather: 'cloud',
  wind: 'wind',
  cyclones: 'tornado',
  'submarine-cables': 'cable',
  datacenters: 'server',
  installations: 'landmark',
  transit: 'bus',
  bikeshare: 'bike',
  traffic: 'traffic-cone',
  alpr: 'scan-eye',
  cctv: 'cctv',
  radio: 'radio',
};

export const CATEGORY_ICON: Readonly<Record<LayerCategory, string>> = {
  air: 'plane',
  sea: 'ship',
  space: 'satellite',
  hazards: 'triangle-alert',
  weather: 'cloud',
  infrastructure: 'factory',
  ground: 'video',
  signals: 'radio',
};

export function layerIconName(layerId: string | undefined, category: LayerCategory): string {
  return (layerId && LAYER_ICON[layerId]) || CATEGORY_ICON[category];
}
