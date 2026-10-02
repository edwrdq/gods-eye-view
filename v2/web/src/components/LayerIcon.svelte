<script lang="ts">
  import type { LayerCategory } from '@gev/shared';
  import Activity from '@lucide/svelte/icons/activity';
  import Bike from '@lucide/svelte/icons/bike';
  import Bus from '@lucide/svelte/icons/bus';
  import Cable from '@lucide/svelte/icons/cable';
  import Cctv from '@lucide/svelte/icons/cctv';
  import Cloud from '@lucide/svelte/icons/cloud';
  import Factory from '@lucide/svelte/icons/factory';
  import Flame from '@lucide/svelte/icons/flame';
  import Landmark from '@lucide/svelte/icons/landmark';
  import Plane from '@lucide/svelte/icons/plane';
  import Radio from '@lucide/svelte/icons/radio';
  import Rocket from '@lucide/svelte/icons/rocket';
  import Satellite from '@lucide/svelte/icons/satellite';
  import ScanEye from '@lucide/svelte/icons/scan-eye';
  import Server from '@lucide/svelte/icons/server';
  import Ship from '@lucide/svelte/icons/ship';
  import Tornado from '@lucide/svelte/icons/tornado';
  import TrafficCone from '@lucide/svelte/icons/traffic-cone';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Video from '@lucide/svelte/icons/video';
  import Wind from '@lucide/svelte/icons/wind';
  import { layerIconName } from '../lib/layerIcons.ts';

  /** The detail panel's icon for a layer (its own, e.g. a bike for bikeshare), else its category's. */
  let { layerId, category, size = 18 }: { layerId: string | undefined; category: LayerCategory; size?: number } = $props();
  const icons = {
    activity: Activity, bike: Bike, bus: Bus, cable: Cable, cctv: Cctv, cloud: Cloud, factory: Factory, flame: Flame, landmark: Landmark, plane: Plane, radio: Radio, rocket: Rocket,
    satellite: Satellite, 'scan-eye': ScanEye, server: Server, ship: Ship, tornado: Tornado, 'traffic-cone': TrafficCone, 'triangle-alert': TriangleAlert, video: Video, wind: Wind,
  } as const;
  const Icon = $derived(icons[layerIconName(layerId, category) as keyof typeof icons]);
</script>

<Icon {size} strokeWidth={1.75} aria-hidden="true" />
