<script lang="ts">
  import type { LayerDescriptor } from '@gev/shared';
  import Clock from '@lucide/svelte/icons/clock';
  import History from '@lucide/svelte/icons/history';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import StatusChip from './StatusChip.svelte';
  import { effectiveState } from '../lib/cadence.ts';
  import { hasLivePictures, HISTORY_NOTE_LIVE_ONLY, HISTORY_NOTE_PICTURES, HISTORY_NOTE_STATIC, isStatic } from '../lib/featureWindow.ts';
  import { capNote, layerSummary, viewNote } from '../lib/layerSummary.ts';
  import { layerChip } from '../lib/viewState.ts';
  import { isRendered, layerNoun } from '../lib/layers.ts';
  import { formatAge, formatClockUtc } from '../lib/time.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { timeState } from '../state/time.svelte.ts';
  import { layerRun, retryLayer } from '../state/data.svelte.ts';
  import { feedStore } from '../state/feeds.svelte.ts';
  import { layerStore } from '../state/layers.svelte.ts';

  let { layer }: { layer: LayerDescriptor } = $props();
  const on = $derived(layerStore.enabled[layer.id] === true);
  const run = $derived(layerRun[layer.id]);
  const feed = $derived(run?.feed ?? feedStore.byLayer[layer.id] ?? null);
  const health = $derived(feed ? effectiveState(feed, clock.now) : null);
  const count = $derived(feed ? feed.count.toLocaleString('en-US') : '');
  const noun = $derived(feed ? layerNoun(layer.id, feed.count) : '');
  const age = $derived(feed?.lastSuccess != null ? formatAge(clock.now - feed.lastSuccess) : null);
  const showError = $derived(on && run?.phase === 'error' && run.error);
  const plain = $derived(layer.kind === 'tracked');
  // Features and orbits layers: one count line built from the layer's own vocabulary.
  const summary = $derived(
    layerSummary({
      layerId: layer.id,
      feedCount: feed?.count ?? 0,
      drawn: run?.drawn ?? 0,
      lines: run?.lines,
      shown: run?.orbits?.shown,
      at: layer.kind === 'features' && run?.historical ? run.at : null,
      truncated: run?.truncated === true,
    }),
  );
  const elementsAge = $derived(age);
  const viewing = $derived(timeState.at !== null);
  const chip = $derived(
    layerChip({ kind: layer.kind, viewing, drawnHistorical: run?.historical === true, currentOnly: run?.currentOnly === true, snapshot: isStatic(layer.id) && !hasLivePictures(layer.id), health, hasData: run?.hasData === true }),
  );
</script>

{#if isRendered(layer)}
  {#if on && run && run.phase === 'loading' && !run.hasData}
    <div class="layer-status" aria-busy="true">
      <StatusChip tone="loading">Loading</StatusChip>
      <span class="bar" aria-hidden="true"></span>
    </div>
  {:else if run && showError}
    <div class="layer-status">
      <StatusChip tone="error"><TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />Error</StatusChip>
      <span class="msg">{run.error?.message}{run.hasData ? ' Showing older data.' : ''}</span>
      <button class="link" type="button" onclick={() => retryLayer(layer.id)}>Retry</button>
    </div>
  {:else if on && run && !plain}
    <div class="layer-status">
      {#if chip === 'snapshot'}
        <StatusChip tone="neutral"><Clock size={12} strokeWidth={2} aria-hidden="true" />Snapshot</StatusChip>
      {:else if chip === 'current'}
        <StatusChip tone="neutral"><Clock size={12} strokeWidth={2} aria-hidden="true" />Current</StatusChip>
      {:else if chip === 'computed'}
        <StatusChip tone="history"><History size={12} strokeWidth={2} aria-hidden="true" />Computed</StatusChip>
      {:else if chip === 'recorded'}
        <StatusChip tone="history"><History size={12} strokeWidth={2} aria-hidden="true" />Recorded</StatusChip>
      {:else if chip === 'stale' || chip === 'error'}
        <StatusChip tone={chip}><Clock size={12} strokeWidth={2} aria-hidden="true" />{chip === 'error' ? 'Error' : 'Stale'}</StatusChip>
      {:else if chip === 'waiting'}
        <StatusChip tone="loading">Waiting</StatusChip>
      {:else}
        <StatusChip tone="live"><span class="dot"></span>Live</StatusChip>
      {/if}
      <span class="num">{summary}</span>
      {#if layer.kind === 'orbits' && elementsAge && !viewing}<span class="note">Elements updated {age}</span>{/if}
      {#if run.currentOnly}<span class="note">{hasLivePictures(layer.id) ? HISTORY_NOTE_PICTURES : isStatic(layer.id) ? HISTORY_NOTE_STATIC : HISTORY_NOTE_LIVE_ONLY}</span>{/if}
      {#if !run.currentOnly && isStatic(layer.id) && !hasLivePictures(layer.id) && age}<span class="note">Data from {age}</span>{/if}
      {#if layer.kind === 'orbits' && viewing && timeState.at !== null}<span class="note">Positions predicted for <span class="mono">{formatClockUtc(timeState.at)}</span></span>{/if}
      {#if run.truncated}<span class="note">{viewNote(layer.id, run.drawn, true) ?? capNote(run.drawn, run.total)}</span>{/if}
    </div>
  {:else if on && (run?.historical || viewing)}
    <div class="layer-status">
      <StatusChip tone="history"><History size={12} strokeWidth={2} aria-hidden="true" />Recorded</StatusChip>
      {#if run?.historical}
        <span class="num">{run.drawn.toLocaleString('en-US')} {layerNoun(layer.id, run.drawn)} · at <span class="mono">{run.at ? formatClockUtc(run.at) : ''}</span></span>
      {:else if timeState.at !== null}
        <span class="num">At <span class="mono">{formatClockUtc(timeState.at)}</span></span>
      {/if}
    </div>
  {:else if feed && health === 'off'}
    <div class="layer-status"><StatusChip tone="planned">Source off</StatusChip><span>Not running on this server.</span></div>
  {:else if feed && health === 'error' && (on || !feed.count)}
    <div class="layer-status">
      <StatusChip tone="error"><TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />Error</StatusChip>
      <span class="msg">{feed.lastError ?? 'Source failed.'}{age && feed.count ? ` Last data ${age}.` : ''}</span>
    </div>
  {:else if on && feed}
    <div class="layer-status">
      {#if health === 'stale' || health === 'error'}
        <StatusChip tone={health}><Clock size={12} strokeWidth={2} aria-hidden="true" />{health === 'error' ? 'Error' : 'Stale'}</StatusChip>
        {#if age}<span class="num">{count} {noun} · updated {age}</span>{:else}<span class="msg">{feed.lastError ?? 'Waiting for the first data.'}</span>{/if}
      {:else}
        <StatusChip tone="live"><span class="dot"></span>Live</StatusChip>
        <span class="num">{count} {noun}{age ? ` · ${age}` : ''}</span>
      {/if}
      {#if run?.truncated}<span class="note">{capNote(run.drawn, run.total)}</span>{/if}
    </div>
  {/if}
{/if}

<style>
  .layer-status {
    grid-column: 1 / -1;
    padding-left: calc(3px + var(--space-3));
    margin-top: var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .msg {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .note {
    flex-basis: 100%;
    color: var(--text-tertiary);
  }
  .link {
    padding: 0;
    color: var(--accent);
    font-size: var(--text-xs);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .link:hover {
    color: var(--accent-hover);
  }
  .bar {
    position: relative;
    flex: 1;
    min-width: 60px;
    height: 2px;
    border-radius: 2px;
    background: var(--border-subtle);
    overflow: hidden;
  }
  .bar::after {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 40%;
    background: var(--accent);
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
</style>
