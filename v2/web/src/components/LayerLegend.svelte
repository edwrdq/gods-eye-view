<script lang="ts">
  import type { LayerDescriptor } from '@gev/shared';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { FORECAST_POINT_PX, LAUNCH_PX, cycloneSize } from '../lib/featureStyle.ts';
  import { readStored, writeStored } from '../lib/storage.ts';
  import { AGE_ALPHA, AGE_LABELS, magnitudeSize } from '../lib/quakeStyle.ts';

  let { layer }: { layer: LayerDescriptor } = $props();
  const KEY = $derived(`gev.v2.legend.${layer.id}`);
  // The legend is created per layer row, so the initial layer id is the one it keeps.
  // svelte-ignore state_referenced_locally
  // Open the first time (these encodings are new to the viewer), then remember the choice.
  let open = $state(readStored(`gev.v2.legend.${layer.id}`) !== 'closed');
  const uid = $props.id();

  function toggle() {
    open = !open;
    writeStored(KEY, open ? 'open' : 'closed');
  }

  const mags = [3, 5, 7];
  const storms = [
    { cat: 'TS', label: 'Tropical storm' },
    { cat: 'H1', label: 'Hurricane 1' },
    { cat: 'H3', label: 'Hurricane 3+' },
  ];
  // Star outline on a 40 grid (same points the map marker uses).
  const STAR = '20,4 24.5,15.5 36,20 24.5,24.5 20,36 15.5,24.5 4,20 15.5,15.5';
  const has = $derived(['earthquakes', 'cyclones', 'launches', 'satellites'].includes(layer.id));
</script>

{#if has}
  <div class="legend">
    <button class="toggle" type="button" aria-expanded={open} aria-controls="{uid}-key" onclick={toggle}>
      <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />Key
    </button>
    {#if open}
      <div class="key" id="{uid}-key">
        {#if layer.id === 'earthquakes'}
          <div class="row"><span class="h">Size</span>
            {#each mags as m (m)}
              {@const d = magnitudeSize(m)}
              <span class="item"><svg width={d + 2} height={d + 2} aria-hidden="true"><circle cx={(d + 2) / 2} cy={(d + 2) / 2} r={d / 2} class="quake" /></svg>M{m}</span>
            {/each}
          </div>
          <div class="row"><span class="h">Age</span>
            {#each AGE_LABELS as label, i (label)}
              <span class="item"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" class="quake" style="fill-opacity:{AGE_ALPHA[i]}" /></svg>{label}</span>
            {/each}
          </div>
          <div class="row"><span class="h">Depth</span>
            <span class="item"><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="7" class="quake" /></svg>Shallow</span>
            <span class="item"><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="7" class="quake" /><circle cx="8" cy="8" r="2.6" class="eye" /></svg>70 km or deeper</span>
          </div>
        {:else if layer.id === 'cyclones'}
          <div class="row"><span class="h">Storm</span>
            {#each storms as s (s.cat)}
              {@const d = cycloneSize(s.cat)}
              <span class="item"><svg width={d + 2} height={d + 2} aria-hidden="true"><rect x="1" y="1" width={d} height={d} rx={d * 0.28} class="storm" /><circle cx={(d + 2) / 2} cy={(d + 2) / 2} r={d * 0.17} class="eye" /></svg>{s.label}</span>
            {/each}
          </div>
          <div class="row"><span class="h">Path</span>
            <span class="item"><svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" class="line" /></svg>Recorded track</span>
            <span class="item"><svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" class="line dash" /></svg>Forecast</span>
            <span class="item"><svg width={FORECAST_POINT_PX + 2} height={FORECAST_POINT_PX + 2} aria-hidden="true"><rect x="1" y="1" width={FORECAST_POINT_PX} height={FORECAST_POINT_PX} rx="3" class="storm soft" /></svg>Forecast time</span>
            <span class="item"><svg width="26" height="14" aria-hidden="true"><path d="M1 7 L25 1 L25 13 Z" class="cone" /></svg>Likely path of the centre</span>
          </div>
        {:else if layer.id === 'launches'}
          <div class="row">
            <span class="item"><svg width={LAUNCH_PX.upcoming} height={LAUNCH_PX.upcoming} viewBox="0 0 40 40" aria-hidden="true"><polygon points={STAR} class="star solid" /></svg>Upcoming</span>
            <span class="item"><svg width={LAUNCH_PX.success} height={LAUNCH_PX.success} viewBox="0 0 40 40" aria-hidden="true"><polygon points={STAR} class="star hollow" /></svg>Launched</span>
            <span class="item"><svg width={LAUNCH_PX.failure} height={LAUNCH_PX.failure} viewBox="0 0 40 40" aria-hidden="true"><polygon points={STAR} class="star hollow fail" /><path d="M14 14 L26 26 M26 14 L14 26" class="cross" /></svg>Failed or partial</span>
          </div>
          <p class="note">Last and next 30 days, placed on the pad.</p>
        {:else}
          <div class="row">
            <span class="item"><svg width="16" height="16" viewBox="0 0 40 40" aria-hidden="true"><polygon points={STAR} class="star solid sat" /></svg>Satellite</span>
            <span class="item"><svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" class="line sat past" /></svg>Orbit so far</span>
            <span class="item"><svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" class="line sat" /></svg>Orbit ahead</span>
          </div>
          <p class="note">The selected satellite shows one orbit either side of the viewed time.</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .legend {
    grid-column: 1 / -1;
    padding-left: calc(3px + var(--space-3));
    margin-top: var(--space-2);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }
  .toggle:hover {
    color: var(--text-primary);
  }
  .toggle :global(svg) {
    transition: transform var(--dur-base) var(--ease-out);
  }
  .toggle[aria-expanded='true'] :global(svg) {
    transform: rotate(90deg);
  }
  .key {
    margin-top: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-5);
  }
  .h {
    flex-basis: 100%;
    color: var(--text-tertiary);
    font-weight: var(--weight-medium);
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .note {
    margin: 0;
    color: var(--text-tertiary);
    max-width: 34ch;
  }
  /* Colours are the map tokens: the same hues the globe uses, on a dark halo. */
  .quake {
    fill: var(--map-hazards);
    stroke: var(--map-halo);
    stroke-width: 1.5;
  }
  .eye {
    fill: var(--map-halo);
  }
  .storm {
    fill: var(--map-weather);
    stroke: var(--map-halo);
    stroke-width: 1.5;
  }
  .storm.soft {
    fill-opacity: 0.7;
  }
  .cone {
    fill: var(--map-weather);
    fill-opacity: 0.25;
    stroke: var(--map-weather);
    stroke-width: 1.2;
  }
  .line {
    stroke: var(--map-weather);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .line.dash {
    stroke-dasharray: 5 4;
  }
  .line.sat {
    stroke: var(--map-space);
  }
  .line.past {
    stroke-opacity: 0.4;
  }
  .star {
    stroke: var(--map-halo);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .star.solid {
    fill: var(--map-space);
  }
  .star.hollow {
    fill: var(--map-halo);
    stroke: var(--map-space);
    stroke-width: 3;
  }
  .star.hollow.fail {
    stroke: var(--map-hazards);
  }
  .cross {
    stroke: var(--map-hazards);
    stroke-width: 3.5;
    stroke-linecap: round;
  }
</style>
