<script lang="ts">
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { globeState, startGlobe, stopGlobe } from '../state/globe.svelte.ts';

  let { ready }: { ready: boolean } = $props();
  let container = $state<HTMLDivElement>();

  // Wait for the config (it carries the map keys) but never longer than needed;
  // the shell is already on screen while this runs.
  $effect(() => {
    if (!ready || !container) return;
    // Start after the shell has painted so Cesium's parse and init never delay first paint.
    const el = container;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => void startGlobe(el)));
    return () => {
      cancelAnimationFrame(id);
      stopGlobe();
    };
  });

  function retry() {
    if (container) void startGlobe(container);
  }
</script>

<div class="stage">
  <div class="canvas-host" bind:this={container} aria-hidden="true"></div>
  {#if globeState.status === 'error'}
    <div class="overlay">
      <div class="card" role="alert">
        <TriangleAlert size={28} strokeWidth={1.5} class="card-icon" aria-hidden="true" />
        <h2>The globe couldn't start</h2>
        <p>This usually means WebGL is turned off or unsupported in this browser. Search and the layer list still work.</p>
        {#if globeState.error}<p class="detail mono">{globeState.error}</p>{/if}
        <button class="btn" type="button" onclick={retry}>Try again</button>
      </div>
    </div>
  {:else if globeState.status !== 'ready'}
    <div class="overlay" role="status" aria-live="polite">
      <div class="loading">
        <span>Loading globe</span>
        <span class="bar" aria-hidden="true"></span>
      </div>
    </div>
  {/if}
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    z-index: var(--z-globe);
    background: #05080d; /* the stage is not themed: imagery does not follow the UI theme */
    overflow: hidden;
  }
  .canvas-host {
    position: absolute;
    inset: 0;
  }
  /* The only Cesium CSS we need; widgets.css is deliberately not loaded. */
  .canvas-host :global(.cesium-widget),
  .canvas-host :global(.cesium-widget canvas) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
  .canvas-host :global(.cesium-widget canvas) {
    cursor: grab;
  }
  .canvas-host :global(.cesium-widget canvas:active) {
    cursor: grabbing;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--space-5);
    pointer-events: none;
  }
  .loading {
    display: grid;
    gap: var(--space-3);
    justify-items: center;
    color: #a9b4c2;
    font-size: var(--text-sm);
  }
  .bar {
    position: relative;
    width: 120px;
    height: 2px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.12);
    overflow: hidden;
  }
  .bar::after {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 40%;
    background: #7c9cff;
    border-radius: 2px;
    animation: slide 1.4s var(--ease-out) infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
  .card {
    pointer-events: auto;
    max-width: 380px;
    padding: var(--space-6);
    text-align: center;
    background: var(--surface-panel);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-2);
    color: var(--text-secondary);
  }
  .card :global(.card-icon) {
    margin: 0 auto var(--space-4);
    color: var(--status-error);
  }
  h2 {
    font-size: var(--text-md);
    color: var(--text-primary);
    margin-bottom: var(--space-3);
  }
  p {
    margin: 0 auto var(--space-4);
  }
  .detail {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    overflow-wrap: anywhere;
  }
  .btn {
    height: var(--control-h);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
  }
  .btn:hover {
    background: var(--hover-overlay);
  }
</style>
