<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronsLeft from '@lucide/svelte/icons/chevrons-left';
  import Layers from '@lucide/svelte/icons/layers';
  import Search from '@lucide/svelte/icons/search';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import CategoryIcon from './CategoryIcon.svelte';
  import IconButton from './IconButton.svelte';
  import LayerRow from './LayerRow.svelte';
  import { countOn, groupLayers } from '../lib/layers.ts';
  import { isCollapsed, layerStore, loadConfig, toggleGroup } from '../state/layers.svelte.ts';

  let { drawerOpen }: { drawerOpen: boolean } = $props();

  let collapsed = $state(false);
  let filter = $state('');
  const filtering = $derived(filter.trim().length > 0);
  const groups = $derived(groupLayers(layerStore.layers, filter));
  const totalOn = $derived(countOn(layerStore.layers, layerStore.enabled));
  const uid = $props.id();
</script>

{#if collapsed}
  <button class="rail" type="button" aria-label="Expand layers panel" title="Layers" aria-expanded="false" aria-controls="layers-panel" onclick={() => (collapsed = false)}>
    <Layers size={18} strokeWidth={1.75} />
    {#if totalOn > 0}<span class="rail-count num">{totalOn}</span>{/if}
  </button>
{/if}

<aside id="layers-panel" class="panel" class:drawer-open={drawerOpen} class:is-collapsed={collapsed} aria-label="Layers">
  <div class="panel-head">
    <h2 class="panel-title">Layers</h2>
    <span class="panel-meta num">{totalOn} on</span>
    <span class="collapse"><IconButton label="Collapse layers panel" aria-expanded="true" aria-controls="layers-panel" onclick={() => (collapsed = true)}><ChevronsLeft size={18} strokeWidth={1.75} /></IconButton></span>
  </div>
  <div class="filter">
    <label class="field">
      <Search size={14} strokeWidth={1.75} aria-hidden="true" />
      <input type="text" placeholder="Filter layers" aria-label="Filter layers" bind:value={filter} autocomplete="off" spellcheck="false" />
    </label>
  </div>
  <div class="panel-body scroll-y" aria-busy={layerStore.status === 'loading'}>
    {#if layerStore.status === 'loading'}
      <div class="skeletons" aria-hidden="true">
        {#each [0, 1, 2, 3, 4] as n (n)}
          <div class="skel-block"><span class="skel" style="width:{55 + (n % 3) * 12}%"></span><span class="skel" style="width:88%"></span></div>
        {/each}
      </div>
      <span class="visually-hidden" role="status">Loading layers</span>
    {:else if layerStore.status === 'error'}
      <div class="state" role="alert">
        <TriangleAlert size={28} strokeWidth={1.5} class="state-icon" aria-hidden="true" />
        <h3>Couldn't load layers</h3>
        <p>The server didn't respond. Check that it is running, then try again.</p>
        <button class="btn" type="button" onclick={() => loadConfig()}>Try again</button>
      </div>
    {:else if groups.length === 0}
      <div class="state">
        <Search size={28} strokeWidth={1.5} class="state-icon" aria-hidden="true" />
        <h3>No layers match</h3>
        <p>Nothing matches &lsquo;{filter.trim()}&rsquo;. Try a category name such as air or weather.</p>
      </div>
    {:else}
      {#each groups as group (group.category)}
        {@const all = layerStore.layers.filter((l) => l.category === group.category)}
        {@const open = filtering || !isCollapsed(group.category)}
        <section class="group" style="--cat: var(--cat-{group.category})">
          <h3 class="group-h">
            <button class="group-head" type="button" aria-expanded={open} aria-controls="{uid}-{group.category}" onclick={() => toggleGroup(group.category)} disabled={filtering}>
              <span class="cat-icon"><CategoryIcon category={group.category} /></span>
              {group.label}
              <span class="count num">{countOn(all, layerStore.enabled)} of {all.length} on</span>
              <span class="chev"><ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" /></span>
            </button>
          </h3>
          <div class="group-body" id="{uid}-{group.category}" hidden={!open}>
            {#each group.layers as layer (layer.id)}
              <LayerRow {layer} />
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .panel {
    position: absolute;
    z-index: var(--z-panel);
    top: calc(var(--shell-gutter) * 2 + var(--topbar-h));
    bottom: calc(var(--statusbar-h) + var(--shell-gutter) * 2);
    left: var(--shell-gutter);
    width: var(--panel-left-w);
    background: var(--surface-panel);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-2);
    backdrop-filter: blur(var(--panel-blur));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel.is-collapsed {
    display: none;
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
    min-height: 48px;
  }
  .panel-title {
    font-size: var(--text-md);
    flex: 1;
  }
  .panel-meta {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .panel-body {
    flex: 1;
    min-height: 0;
    padding-bottom: var(--space-3);
  }
  .filter {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
  }
  .field {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--control-h);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--text-tertiary);
  }
  .field:focus-within {
    border-color: var(--accent);
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 0;
  }
  .field input {
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    outline: none;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .rail {
    position: absolute;
    z-index: var(--z-panel);
    top: calc(var(--shell-gutter) * 2 + var(--topbar-h));
    left: var(--shell-gutter);
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    background: var(--surface-bar);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-2);
    backdrop-filter: blur(var(--panel-blur));
    color: var(--text-secondary);
  }
  .rail:hover {
    color: var(--text-primary);
    background: var(--surface-panel);
  }
  .rail-count {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-on);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    line-height: 18px;
    text-align: center;
  }

  .group + .group {
    border-top: 1px solid var(--border-subtle);
  }
  .group-h {
    font-size: inherit;
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    height: 40px;
    padding: 0 var(--space-4);
    font-weight: var(--weight-semibold);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }
  .group-head:hover:not(:disabled) {
    background: var(--hover-overlay);
  }
  .group-head:disabled {
    cursor: default;
  }
  .group-head:disabled .chev {
    visibility: hidden;
  }
  .cat-icon {
    display: inline-grid;
    color: var(--cat);
  }
  .count {
    margin-left: auto;
    font-weight: var(--weight-regular);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .chev {
    display: inline-grid;
    color: var(--text-tertiary);
    transition: transform var(--dur-base) var(--ease-out);
  }
  .group-head[aria-expanded='false'] .chev {
    transform: rotate(-90deg);
  }
  .group-body[hidden] {
    display: none;
  }

  .skeletons {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-5);
  }
  .skel-block {
    display: grid;
    gap: var(--space-3);
  }
  .skel {
    display: block;
    height: 12px;
    border-radius: 3px;
    background: var(--surface-raised);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  .state {
    padding: var(--space-7) var(--space-6);
    text-align: center;
    color: var(--text-secondary);
  }
  .state :global(.state-icon) {
    margin: 0 auto var(--space-4);
    color: var(--text-tertiary);
  }
  .state h3 {
    font-size: var(--text-md);
    color: var(--text-primary);
    margin-bottom: var(--space-3);
  }
  .state p {
    max-width: 30ch;
    margin: 0 auto var(--space-4);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--control-h);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    font-weight: var(--weight-medium);
  }
  .btn:hover {
    background: var(--hover-overlay);
  }

  @media (max-width: 1100px) {
    .panel {
      width: var(--panel-left-w);
    }
  }
  @media (max-width: 760px) {
    .panel {
      right: var(--shell-gutter);
      width: auto;
    }
    .panel:not(.drawer-open),
    .rail,
    .collapse {
      display: none;
    }
    .panel.drawer-open {
      display: flex;
    }
  }
</style>
