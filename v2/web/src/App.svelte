<script lang="ts">
  import { onMount } from 'svelte';
  import DetailPanel from './components/DetailPanel.svelte';
  import GlobeStage from './components/GlobeStage.svelte';
  import LayerPanel from './components/LayerPanel.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import TopBar from './components/TopBar.svelte';
  import TimeSlider from './components/TimeSlider.svelte';
  import { startClock } from './state/clock.svelte.ts';
  import { startFeedPolling } from './state/feeds.svelte.ts';
  import { layerStore, loadConfig } from './state/layers.svelte.ts';
  import { selectObject, selection } from './state/selection.svelte.ts';
  import { startRangePolling, timeState } from './state/time.svelte.ts';
  import './state/data.svelte.ts';

  // Narrow screens: the layer list is a drawer opened from the top bar.
  let layersOpen = $state(false);
  // The globe needs the map keys from /api/config, so it starts once that settles
  // (success or failure; without config it falls back to the keyless map).
  const configSettled = $derived(layerStore.status !== 'loading');

  onMount(() => {
    const ctl = new AbortController();
    void loadConfig(ctl.signal);
    const stops = [startClock(), startFeedPolling(), startRangePolling()];
    return () => {
      ctl.abort();
      for (const stop of stops) stop();
    };
  });

  // Esc clears the selection unless a popover or field is using the key.
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || !selection.ref) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.closest('[role="dialog"], [role="listbox"]'))) return;
    selectObject(null);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell" class:has-dock={timeState.dockOpen} data-left={layersOpen ? 'open' : ''}>
  <GlobeStage ready={configSettled} />
  <TopBar {layersOpen} onToggleLayers={() => (layersOpen = !layersOpen)} />
  <LayerPanel drawerOpen={layersOpen} />
  <DetailPanel />
  {#if timeState.dockOpen}<TimeSlider />{/if}
  <StatusBar />
</div>

<style>
  .shell {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }
  /* Height the time dock takes where panels must make room for it. */
  .shell.has-dock {
    --dock-h: 88px;
  }
  @media (max-width: 760px) {
    .shell.has-dock {
      --dock-h: 130px;
    }
  }
</style>
