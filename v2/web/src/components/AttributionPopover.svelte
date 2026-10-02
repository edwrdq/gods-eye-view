<script lang="ts">
  import { getCredits, onCreditsChange } from '../state/globe.svelte.ts';
  import type { Credit } from '../globe/index.ts';
  import { creditsFor } from '../lib/dataCredits.ts';
  import { layerStore } from '../state/layers.svelte.ts';

  let { onClose }: { onClose: () => void } = $props();
  let credits = $state<Credit[]>(getCredits());

  $effect(() => onCreditsChange(() => (credits = getCredits())));
  const dataCredits = $derived(creditsFor(layerStore.enabled));
</script>

<div class="popover" role="dialog" aria-label="Imagery and data attribution">
  <h2>Imagery &amp; data attribution</h2>
  {#if credits.length === 0}
    <p class="empty">No imagery is loaded yet. Credits appear here once the globe has a base map.</p>
  {:else}
    <ul>
      {#each credits as c}
        <li>{@html c.html}</li>
      {/each}
    </ul>
  {/if}
  {#if dataCredits.length > 0}
    <ul class="data">
      {#each dataCredits as d (d.layer)}
        <li><strong>{d.lead}:</strong> {d.text} <a href={d.link.href} target="_blank" rel="noopener noreferrer">{d.link.label}</a> ({d.licence})</li>
      {/each}
    </ul>
  {/if}
  <p class="foot">Search: Photon and Nominatim, &copy; OpenStreetMap contributors.</p>
  <button class="close" type="button" onclick={onClose}>Close</button>
</div>

<style>
  .popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--space-3));
    width: min(380px, calc(100vw - var(--shell-gutter) * 2));
    max-height: min(60vh, 420px);
    overflow: auto;
    padding: var(--space-4) var(--space-5);
    background: var(--surface-panel-solid);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    white-space: normal;
    text-align: left;
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
  li :global(img) {
    display: inline-block;
    max-height: 24px;
    width: auto;
    vertical-align: middle;
  }
  .data {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }
  .data strong {
    color: var(--text-primary);
    font-weight: var(--weight-medium);
  }
  .data a {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .empty,
  .foot {
    line-height: var(--leading-prose);
  }
  .foot {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
    color: var(--text-tertiary);
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
