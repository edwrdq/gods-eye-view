<script lang="ts">
  import Clock from '@lucide/svelte/icons/clock';
  import AttributionPopover from './AttributionPopover.svelte';
  import SourcesPopover from './SourcesPopover.svelte';
  import StatusChip from './StatusChip.svelte';
  import { freshnessSummary } from '../lib/cadence.ts';
  import { formatClockUtc } from '../lib/time.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { feedStore } from '../state/feeds.svelte.ts';
  import { setDockOpen, timeState } from '../state/time.svelte.ts';
  import { formatAltitude, formatLatLonHemi } from '../lib/format.ts';
  import { globeState } from '../state/globe.svelte.ts';

  let attributionOpen = $state(false);
  let wrap = $state<HTMLElement>();
  let sourcesOpen = $state(false);
  let sourcesWrap = $state<HTMLElement>();

  const feeds = $derived(Object.values(feedStore.byLayer));
  const summary = $derived(freshnessSummary(feeds, clock.now));
  const allFresh = $derived(summary.total > 0 && summary.fresh === summary.total);

  const shown = $derived(globeState.cursor ?? globeState.center);
  const label = $derived(globeState.cursor ? 'Cursor' : 'Center');

  function onWindowPointerDown(e: PointerEvent) {
    if (attributionOpen && wrap && !wrap.contains(e.target as Node)) attributionOpen = false;
    if (sourcesOpen && sourcesWrap && !sourcesWrap.contains(e.target as Node)) sourcesOpen = false;
  }
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && sourcesOpen) {
      sourcesOpen = false;
      (sourcesWrap?.querySelector('button') as HTMLElement | null)?.focus();
      e.stopPropagation();
    }
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
  <span class="seg src-wrap hide-narrow" bind:this={sourcesWrap}>
    <button class="seg-btn" type="button" aria-expanded={sourcesOpen} aria-haspopup="dialog" title="Show per-source freshness" onclick={() => (sourcesOpen = !sourcesOpen)}>
      {#if summary.total === 0}
        Sources <b>{feedStore.failed ? 'Unavailable' : feedStore.loaded ? 'None running' : '—'}</b>
      {:else}
        <StatusChip tone={allFresh ? 'live' : 'stale'}>{#if allFresh}<span class="dot"></span>Live{:else}<Clock size={12} strokeWidth={2} aria-hidden="true" />Stale{/if}</StatusChip>
        <span class="num">{summary.fresh} of {summary.total} sources fresh</span>
      {/if}
    </button>
    {#if sourcesOpen}<SourcesPopover onClose={() => (sourcesOpen = false)} />{/if}
  </span>
  <button class="seg seg-btn hide-narrow" type="button" aria-expanded={timeState.dockOpen} aria-controls="time-dock" title={timeState.dockOpen ? 'Hide time slider' : 'Show time slider'} onclick={() => setDockOpen(!timeState.dockOpen)}>
    <Clock size={12} strokeWidth={2} aria-hidden="true" />Time
    {#if timeState.at === null}<b>Now</b>{:else}<b class="hist num">Viewing {formatClockUtc(timeState.at)}</b>{/if}
  </button>
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
  .seg-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    padding: 0 var(--space-2);
    border-radius: var(--radius-xs);
    color: inherit;
  }
  .seg-btn:hover {
    background: var(--hover-overlay);
  }
  .src-wrap {
    position: relative;
    height: 100%;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .hist {
    color: var(--accent);
    font-weight: var(--weight-medium);
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
