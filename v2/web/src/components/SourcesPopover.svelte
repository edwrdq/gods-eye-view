<script lang="ts">
  import StatusChip from './StatusChip.svelte';
  import { effectiveState } from '../lib/cadence.ts';
  import { formatAge } from '../lib/time.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { feedStore } from '../state/feeds.svelte.ts';
  import { layerStore } from '../state/layers.svelte.ts';
  import { timeState } from '../state/time.svelte.ts';

  let { onClose }: { onClose: () => void } = $props();
  const rows = $derived(
    Object.values(feedStore.byLayer).map((f) => ({
      feed: f,
      name: layerStore.layers.find((l) => l.id === f.layer)?.name ?? f.layer,
      health: effectiveState(f, clock.now),
    })),
  );
</script>

<div class="popover" role="dialog" aria-label="Data sources">
  <h2>Data sources</h2>
  {#if timeState.at !== null}<p class="note">Status of each source right now. You are viewing recorded history.</p>{/if}
  {#if rows.length === 0}
    <p class="empty">No feeds reported yet.</p>
  {:else}
    <ul>
      {#each rows as r (r.feed.layer)}
        <li>
          <span class="name">{r.name}</span>
          {#if r.health === 'live'}<StatusChip tone="live"><span class="dot"></span>Live</StatusChip>
          {:else if r.health === 'stale'}<StatusChip tone="stale">Stale</StatusChip>
          {:else if r.health === 'error'}<StatusChip tone="error">Error</StatusChip>
          {:else if r.health === 'needs-key'}<StatusChip tone="key">Needs API key</StatusChip>
          {:else}<StatusChip tone="planned">Off</StatusChip>{/if}
          <span class="detail num">
            {#if r.health === 'error' && r.feed.lastError}{r.feed.lastError}{:else}{r.feed.source ?? 'No source'}{r.feed.lastSuccess !== null ? ` · ${formatAge(clock.now - r.feed.lastSuccess)}` : ''}{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  <button class="close" type="button" onclick={onClose}>Close</button>
</div>

<style>
  .note {
    margin: 0 0 var(--space-3);
    color: var(--text-tertiary);
  }
  .popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--space-3));
    width: min(380px, calc(100vw - var(--shell-gutter) * 2));
    padding: var(--space-4) var(--space-5);
    background: var(--surface-panel-solid);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    white-space: normal;
    z-index: var(--z-popover);
  }
  h2 {
    font-size: var(--text-sm);
    color: var(--text-primary);
    margin-bottom: var(--space-3);
  }
  ul {
    display: grid;
    gap: var(--space-3);
  }
  li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-1) var(--space-3);
    align-items: center;
  }
  .name {
    color: var(--text-primary);
    font-weight: var(--weight-medium);
    font-size: var(--text-sm);
  }
  .detail {
    grid-column: 1 / -1;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .close {
    margin-top: var(--space-4);
    height: 26px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-weight: var(--weight-medium);
  }
  .close:hover {
    background: var(--hover-overlay);
  }
</style>
