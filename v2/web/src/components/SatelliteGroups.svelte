<script lang="ts">
  import { groupLabel } from '../lib/satDetail.ts';
  import { layerRun, setSatelliteGroup } from '../state/data.svelte.ts';
  import { layerStore } from '../state/layers.svelte.ts';

  const orbits = $derived(layerRun['satellites']?.orbits);
  const groups = $derived(orbits?.groups ?? []);
  // A remembered group the server no longer offers falls back to all.
  const value = $derived(groups.some((g) => g.name === layerStore.satGroup) ? (layerStore.satGroup ?? '') : '');
  const uid = $props.id();
</script>

{#if orbits && groups.length > 1}
  <div class="groups">
    <label for="{uid}-group">Group</label>
    <select id="{uid}-group" {value} onchange={(e) => setSatelliteGroup(e.currentTarget.value || null)}>
      <option value="">All groups ({orbits.total.toLocaleString('en-US')})</option>
      {#each groups as g (g.name)}
        <option value={g.name}>{groupLabel(g.name)} ({g.count.toLocaleString('en-US')})</option>
      {/each}
    </select>
  </div>
{/if}

<style>
  .groups {
    grid-column: 1 / -1;
    padding-left: calc(3px + var(--space-3));
    margin-top: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  select {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-size: var(--text-xs);
  }
</style>
