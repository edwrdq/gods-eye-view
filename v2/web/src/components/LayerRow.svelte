<script lang="ts">
  import type { LayerDescriptor } from '@gev/shared';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import LayerStatus from './LayerStatus.svelte';
  import StatusChip from './StatusChip.svelte';
  import { isToggleable, switchLabel } from '../lib/layers.ts';
  import { setLayerEnabled } from '../state/data.svelte.ts';
  import { feedStore } from '../state/feeds.svelte.ts';
  import { layerStore } from '../state/layers.svelte.ts';

  let { layer }: { layer: LayerDescriptor } = $props();
  const on = $derived(layerStore.enabled[layer.id] === true && isToggleable(layer));
  const sourceOff = $derived(feedStore.byLayer[layer.id]?.state === 'off');
  const planned = $derived(layer.status === 'planned');
  const uid = $props.id();
</script>

<div class="layer" class:is-on={on} class:is-planned={planned}>
  <div class="layer-name" id="{uid}-name">{layer.name}</div>
  <button
    class="switch"
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={switchLabel(layer)}
    aria-describedby="{uid}-desc"
    disabled={!isToggleable(layer) || sourceOff}
    onclick={() => setLayerEnabled(layer, !on)}
  ></button>
  <div class="layer-desc" id="{uid}-desc">{layer.description}</div>
  {#if planned}
    <div class="layer-status"><StatusChip tone="planned">Planned</StatusChip></div>
  {:else if layer.status === 'needs-key'}
    <div class="layer-status">
      <StatusChip tone="key"><KeyRound size={12} strokeWidth={2} aria-hidden="true" />Needs API key</StatusChip>
      {#if layer.requiredKey}<span>Set <span class="mono">{layer.requiredKey}</span> in .env</span>{/if}
    </div>
  {:else}
    <LayerStatus {layer} />
  {/if}
</div>

<style>
  .layer {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-1) var(--space-4);
    padding: var(--space-3) var(--space-4);
    margin: 0 var(--space-2) 1px;
    border-radius: var(--radius-sm);
  }
  .layer:hover {
    background: var(--hover-overlay);
  }
  .layer.is-on {
    background: var(--selected-bg);
  }
  .layer-name {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .layer-name::before {
    content: '';
    width: 3px;
    height: 14px;
    border-radius: 2px;
    background: var(--cat);
    opacity: 0.35;
  }
  .layer.is-on .layer-name::before {
    opacity: 1;
  }
  .layer-desc {
    grid-column: 1;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: 1.4;
    padding-left: calc(3px + var(--space-3));
  }
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
  .is-planned .layer-name,
  .is-planned .layer-desc {
    color: var(--text-tertiary);
  }
  .is-planned:hover {
    background: none;
  }
  .switch {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: start;
    margin-top: 1px;
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: var(--radius-full);
    border: 1.5px solid var(--border-strong);
    background: transparent;
    flex: none;
    transition:
      background var(--dur-base) var(--ease-out),
      border-color var(--dur-base) var(--ease-out);
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--text-secondary);
    transition:
      transform var(--dur-base) var(--ease-out),
      background var(--dur-base) var(--ease-out);
  }
  .switch[aria-checked='true'] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch[aria-checked='true']::after {
    transform: translateX(16px);
    background: var(--accent-on);
  }
  .switch:disabled {
    opacity: 0.45;
    border-style: dashed;
  }
  .switch:focus-visible {
    border-radius: var(--radius-full);
  }
  /* 40 px touch target without enlarging the drawn switch */
  .switch::before {
    content: '';
    position: absolute;
    inset: -10px -4px;
  }
</style>
