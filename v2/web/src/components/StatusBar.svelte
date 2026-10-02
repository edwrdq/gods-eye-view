<script lang="ts">
  import Clock from '@lucide/svelte/icons/clock';
  import AttributionPopover from './AttributionPopover.svelte';
  import { formatAltitude, formatLatLonHemi } from '../lib/format.ts';
  import { globeState } from '../state/globe.svelte.ts';

  let attributionOpen = $state(false);
  let wrap = $state<HTMLElement>();

  const shown = $derived(globeState.cursor ?? globeState.center);
  const label = $derived(globeState.cursor ? 'Cursor' : 'Center');

  function onWindowPointerDown(e: PointerEvent) {
    if (attributionOpen && wrap && !wrap.contains(e.target as Node)) attributionOpen = false;
  }
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && attributionOpen) {
      attributionOpen = false;
      (wrap?.querySelector('button.attr') as HTMLElement | null)?.focus();
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<footer class="statusbar">
  <span class="seg seg-coord"><span class="lbl">{label}</span> <b class="mono coord truncate">{shown ? formatLatLonHemi(shown.lat, shown.lon) : '—'}</b></span>
  <span class="seg seg-alt"><span class="lbl">Altitude</span> <b class="num">{globeState.altitude === null ? '—' : formatAltitude(globeState.altitude)}</b></span>
  <span class="grow"></span>
  <!-- Placeholder until feeds report freshness (phase 2). -->
  <span class="seg hide-narrow">Sources <b>No feeds yet</b></span>
  <span class="seg hide-narrow"><Clock size={12} strokeWidth={2} aria-hidden="true" />Time <b>Now</b></span>
  <span class="seg attr-wrap" bind:this={wrap}>
    <button class="attr" type="button" aria-label="Imagery and data attribution" aria-expanded={attributionOpen} aria-haspopup="dialog" onclick={() => (attributionOpen = !attributionOpen)}>
      <span class="long">Imagery &amp; data</span> attribution
    </button>
    {#if attributionOpen}<AttributionPopover onClose={() => (attributionOpen = false)} />{/if}
  </span>
</footer>

<style>
  .statusbar {
    position: absolute;
    z-index: var(--z-bar);
    left: var(--shell-gutter);
    right: var(--shell-gutter);
    bottom: var(--shell-gutter);
    height: var(--statusbar-h);
    display: flex;
    align-items: center;
    gap: var(--space-5);
    padding: 0 var(--space-4);
    background: var(--surface-bar);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    backdrop-filter: blur(var(--panel-blur));
    font-size: var(--text-xs);
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .seg {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .seg b {
    font-weight: var(--weight-regular);
    color: var(--text-primary);
  }
  /* Fixed width so the bar does not jitter as digits change. */
  .coord {
    display: inline-block;
    min-width: 25ch;
    max-width: 100%;
  }
  .grow {
    flex: 1;
  }
  .attr-wrap {
    position: relative;
    height: 100%;
  }
  .attr {
    height: 100%;
    padding: 0 var(--space-2);
    border-radius: var(--radius-xs);
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 0.2em;
    text-decoration-thickness: 1px;
  }
  .attr:hover {
    background: var(--hover-overlay);
    color: var(--accent-hover);
  }
  @media (max-width: 760px) {
    .hide-narrow {
      display: none;
    }
    .statusbar {
      gap: var(--space-4);
      padding: 0 var(--space-3);
    }
    .lbl,
    .long {
      display: none;
    }
    .seg-coord {
      min-width: 0;
      flex: 0 1 auto;
    }
    .seg-alt,
    .attr-wrap {
      flex: none;
    }
    .coord {
      min-width: 0;
    }
  }
</style>
