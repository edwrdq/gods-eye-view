<script lang="ts">
  import type { LayerCategory } from '@gev/shared';
  import Plane from '@lucide/svelte/icons/plane';
  import Ship from '@lucide/svelte/icons/ship';
  import Satellite from '@lucide/svelte/icons/satellite';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Cloud from '@lucide/svelte/icons/cloud';
  import Factory from '@lucide/svelte/icons/factory';
  import Video from '@lucide/svelte/icons/video';
  import Radio from '@lucide/svelte/icons/radio';

  let { category, size = 18 }: { category: LayerCategory; size?: number } = $props();
  const icons = { air: Plane, sea: Ship, space: Satellite, hazards: TriangleAlert, weather: Cloud, infrastructure: Factory, ground: Video, signals: Radio };
  const Icon = $derived(icons[category]);
</script>

<Icon {size} strokeWidth={1.75} aria-hidden="true" />
