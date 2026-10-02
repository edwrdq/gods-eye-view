<script lang="ts">
  import type { LayerDescriptor } from '@gev/shared';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { FORECAST_POINT_PX, LAUNCH_PX, cycloneSize } from '../lib/featureStyle.ts';
  import { readStored, writeStored } from '../lib/storage.ts';
  import { AGE_ALPHA, AGE_LABELS, magnitudeSize } from '../lib/quakeStyle.ts';
  import { BIKE_LEVEL_FILL } from '../lib/stationStyle.ts';
  import { shapePoints } from '../lib/markerStyle.ts';

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
  const has = $derived(['earthquakes', 'cyclones', 'launches', 'satellites', 'submarine-cables', 'datacenters', 'installations', 'bikeshare', 'radio'].includes(layer.id));
  // Hexagon outline on the 40 grid, the same points the map marker uses; the gauge fills from y = 31 upwards over 22 units.
  const HEX = shapePoints('hexagon')!.join(' ');
  const levels = [
    { level: 0 as const, label: 'No bike' },
    { level: 1 as const, label: 'Few' },
    { level: 2 as const, label: 'Half' },
    { level: 3 as const, label: 'Most' },
    { level: 4 as const, label: 'No free dock' },
  ];
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
        {:else if layer.id === 'submarine-cables'}
          <div class="row">
            <span class="item"><svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" class="line infra" /></svg>Cable route</span>
            <span class="item"><svg width="16" height="16" viewBox="0 0 40 40" aria-hidden="true"><rect x="8" y="8" width="24" height="24" rx="3" class="sq solid" /></svg>Landing point</span>
          </div>
          <p class="note">Owners and service dates are not in this dataset.</p>
        {:else if layer.id === 'datacenters'}
          <div class="row">
            <span class="item"><svg width="18" height="18" viewBox="0 0 40 40" aria-hidden="true"><rect x="8" y="8" width="24" height="24" rx="3" class="sq solid" /></svg>Data center</span>
          </div>
          <p class="note">Only what mappers have tagged; coverage is incomplete.</p>
        {:else if layer.id === 'installations'}
          <div class="row">
            <span class="item"><svg width="18" height="18" viewBox="0 0 40 40" aria-hidden="true"><rect x="8" y="8" width="24" height="24" rx="3" class="sq hollow" /></svg>Mapped military area</span>
          </div>
          <p class="note">Shows where an area is mapped, not what happens there. Biggest areas show first when zoomed out.</p>
        {:else if layer.id === 'bikeshare'}
          <div class="row"><span class="h">Bikes at the station</span>
            {#each levels as l (l.level)}
              {@const h = 22 * BIKE_LEVEL_FILL[l.level]}
              <span class="item"><svg width="20" height="20" viewBox="0 0 40 40" aria-hidden="true">
                <defs><clipPath id="{uid}-hex{l.level}"><polygon points={HEX} /></clipPath></defs>
                <polygon points={HEX} class="hex body" />
                {#if h > 0}<rect x="9" y={31 - h} width="22" height={h} class="hex-fill" clip-path="url(#{uid}-hex{l.level})" />{/if}
                <polygon points={HEX} class="hex rim" />
              </svg>{l.label}</span>
            {/each}
          </div>
          <div class="row"><span class="h">Other</span>
            <span class="item"><svg width="18" height="18" viewBox="0 0 40 40" aria-hidden="true"><polygon points={HEX} class="hex body" /><polygon points={HEX} class="hex rim" /><circle cx="20" cy="20" r="3.6" class="hex-fill" /></svg>Bikes, docks not counted</span>
            <span class="item"><svg width="18" height="18" viewBox="0 0 40 40" aria-hidden="true"><polygon points={HEX} class="hex body dim" /><polygon points={HEX} class="hex rim dashed dim" /><path d="M15.5 15.5 L24.5 24.5 M24.5 15.5 L15.5 24.5" class="hex-x" /></svg>Out of service</span>
            <span class="item"><svg width="18" height="18" viewBox="0 0 40 40" aria-hidden="true"><polygon points={HEX} class="hex rim dashed" /></svg>No reading</span>
          </div>
          <p class="note">Filled share is bikes over docks. Counts are as the operator last reported them.</p>
        {:else if layer.id === 'radio'}
          <div class="row">
            <span class="item"><svg width="18" height="18" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="12" class="ring" /><circle cx="20" cy="20" r="4.5" class="ring-dot" /></svg>Plays here</span>
            <span class="item"><svg width="18" height="18" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="12" class="ring" /></svg>Opens as a link</span>
          </div>
          <div class="row"><span class="h">Size</span>
            {#each [14, 17, 20] as d, i (d)}
              <span class="item"><svg width={d + 2} height={d + 2} aria-hidden="true"><circle cx={(d + 2) / 2} cy={(d + 2) / 2} r={d / 2 - 1.5} class="ring thin" /></svg>{['Few listens', 'Some', 'Many'][i]}</span>
            {/each}
          </div>
          <p class="note">Positions are as entered by the station list's contributors.</p>
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
  .line.infra {
    stroke: var(--map-infrastructure);
  }
  .sq {
    stroke-linejoin: round;
  }
  .sq.solid {
    fill: var(--map-infrastructure);
    stroke: var(--map-halo);
    stroke-width: 3;
  }
  .sq.hollow {
    fill: var(--map-halo);
    stroke: var(--map-infrastructure);
    stroke-width: 4;
  }
  .cross {
    stroke: var(--map-hazards);
    stroke-width: 3.5;
    stroke-linecap: round;
  }
  .hex {
    stroke-linejoin: round;
  }
  .hex.body {
    fill: var(--map-halo);
  }
  .hex.rim {
    fill: none;
    stroke: var(--map-ground);
    stroke-width: 3;
  }
  .hex.dashed {
    stroke-dasharray: 5 4;
  }
  .hex.dim {
    opacity: 0.6;
  }
  .hex-fill {
    fill: var(--map-ground);
  }
  .hex-x {
    stroke: var(--map-ground);
    stroke-width: 3;
    stroke-linecap: round;
    opacity: 0.7;
  }
  .ring {
    fill: none;
    stroke: var(--map-signals);
    stroke-width: 3.4;
  }
  .ring.thin {
    stroke-width: 1.8;
  }
  .ring-dot {
    fill: var(--map-signals);
  }
</style>
