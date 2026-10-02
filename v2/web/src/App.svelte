<script lang="ts">
  import { onMount } from 'svelte';
  import DetailPanel from './components/DetailPanel.svelte';
  import GlobeStage from './components/GlobeStage.svelte';
  import LayerPanel from './components/LayerPanel.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import TopBar from './components/TopBar.svelte';
  import { layerStore, loadConfig } from './state/layers.svelte.ts';

  // Narrow screens: the layer list is a drawer opened from the top bar.
  let layersOpen = $state(false);
  // The globe needs the map keys from /api/config, so it starts once that settles
  // (success or failure; without config it falls back to the keyless map).
  const configSettled = $derived(layerStore.status !== 'loading');

  onMount(() => {
    const ctl = new AbortController();
    void loadConfig(ctl.signal);
    return () => ctl.abort();
  });
</script>

<div class="shell" data-left={layersOpen ? 'open' : ''}>
  <GlobeStage ready={configSettled} />
  <TopBar {layersOpen} onToggleLayers={() => (layersOpen = !layersOpen)} />
  <LayerPanel drawerOpen={layersOpen} />
  <DetailPanel />
  <StatusBar />
</div>

<style>
  .shell {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }
</style>
