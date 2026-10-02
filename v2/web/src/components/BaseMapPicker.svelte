<script lang="ts">
  import { tick } from 'svelte';
  import Map from '@lucide/svelte/icons/map';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import IconButton from './IconButton.svelte';
  import {
    BASE_MAPS,
    GIBS_FIRST_DATE,
    availability,
    gibsDefaultDate,
    getBaseMap,
    type BaseMapId,
  } from '../lib/basemaps.ts';
  import { basemap, keysFor, selectBaseMap, setBaseMapDate, setBuildings, setFlatTerrain } from '../state/basemap.svelte.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { layerStore } from '../state/layers.svelte.ts';

  let open = $state(false);
  let wrap = $state<HTMLElement>();
  let list = $state<HTMLElement>();

  const keys = $derived(keysFor(layerStore.config));
  const options = $derived(BASE_MAPS.map((o) => ({ ...o, ...availability(o.id, keys) })));
  const current = $derived(getBaseMap(basemap.id));
  const buildingsNote = $derived(
    !keys.cesiumIonToken ? 'Needs CESIUM_ION_TOKEN in .env' : current?.tiles3d ? 'Already part of the 3D tiles' : 'Cesium OSM Buildings, drawn over the imagery',
  );
  const buildingsOff = $derived(!keys.cesiumIonToken || Boolean(current?.tiles3d));
  const terrainOff = $derived(Boolean(current?.tiles3d));
  // Re-evaluated as the clock ticks so "Latest" stays right across UTC midnight.
  const latest = $derived((clock.now, gibsDefaultDate()));

  async function toggle() {
    open = !open;
    if (open) {
      await tick();
      (list?.querySelector('[role="radio"][tabindex="0"]') as HTMLElement | null)?.focus();
    }
  }

  function close(refocus: boolean) {
    open = false;
    if (refocus) (wrap?.querySelector('button.trigger') as HTMLElement | null)?.focus();
  }

  function onWindowPointerDown(e: PointerEvent) {
    if (open && wrap && !wrap.contains(e.target as Node)) close(false);
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close(true);
    }
  }

  /** Arrow keys move through the enabled options and select, as a native radio group does. */
  function onRadioKeydown(e: KeyboardEvent) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const radios = Array.from(list?.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])') ?? []);
    if (radios.length === 0) return;
    const at = radios.indexOf(e.currentTarget as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1 : (at + step + radios.length) % radios.length;
    const target = radios[next];
    target?.focus();
    target?.click();
  }

  function choose(id: BaseMapId, available: boolean) {
    if (available) selectBaseMap(id);
  }

  function onDate(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (v) setBaseMapDate(v);
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="wrap" bind:this={wrap} onkeydown={onKeydown} role="presentation">
  <span class="trigger-wrap">
    <IconButton
      class="trigger"
      label="Base map"
      title={`Base map: ${current?.label ?? ''}${current?.dated ? ` (${basemap.date})` : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="basemap-popover"
      aria-pressed={open}
      onclick={toggle}
    >
      <Map size={18} strokeWidth={1.75} />
    </IconButton>
  </span>

  {#if open}
    <div class="popover" id="basemap-popover" role="dialog" aria-label="Base map">
      <h2>Base map</h2>
      <div class="list" role="radiogroup" aria-label="Base map imagery" bind:this={list}>
        {#each options as o (o.id)}
          {@const checked = basemap.id === o.id}
          <div class="opt" class:checked class:disabled={!o.available}>
            <button
              type="button"
              class="radio"
              role="radio"
              aria-checked={checked}
              aria-disabled={!o.available}
              aria-describedby="bm-desc-{o.id}"
              tabindex={checked ? 0 : -1}
              onclick={() => choose(o.id, o.available)}
              onkeydown={onRadioKeydown}
            >
              <span class="dot" aria-hidden="true"></span>
              <span class="text">
                <span class="name">{o.label}{#if o.tag}<span class="tag">{o.tag}</span>{/if}</span>
                <span class="desc" id="bm-desc-{o.id}">
                  {o.description}
                  {#if o.note}
                    <span class="note" class:needs={!o.available}>
                      {#if !o.available}<KeyRound size={12} strokeWidth={1.75} aria-hidden="true" />{/if}
                      {o.note}
                    </span>
                  {/if}
                </span>
              </span>
            </button>
            {#if o.dated && checked}
              <div class="date">
                <label for="bm-date">Date (UTC)</label>
                <input id="bm-date" type="date" class="num" value={basemap.date} min={GIBS_FIRST_DATE} max={latest} disabled={basemap.followingTime} onchange={onDate} />
                <button type="button" class="link" disabled={basemap.followingTime || basemap.date === latest} onclick={() => setBaseMapDate(latest)}>Latest</button>
              </div>
              {#if basemap.followingTime}
                <p class="date-note">Following the time slider. Return to live to pick a day.</p>
              {/if}
            {/if}
          </div>
        {/each}
      </div>

      <div class="toggles">
        <label class="toggle" class:off={buildingsOff}>
          <span class="t-text">
            <span class="name">3D buildings</span>
            <span class="desc">{buildingsNote}</span>
          </span>
          <input type="checkbox" role="switch" checked={basemap.buildings} disabled={buildingsOff} onchange={(e) => setBuildings(e.currentTarget.checked)} />
          <span class="switch" aria-hidden="true"></span>
        </label>
        <label class="toggle" class:off={terrainOff}>
          <span class="t-text">
            <span class="name">Flat globe</span>
            <span class="desc">{terrainOff ? 'The 3D tiles carry their own ground' : 'Ignore terrain heights'}</span>
          </span>
          <input type="checkbox" role="switch" checked={basemap.flatTerrain} disabled={terrainOff} onchange={(e) => setFlatTerrain(e.currentTarget.checked)} />
          <span class="switch" aria-hidden="true"></span>
        </label>
      </div>

      <div class="status" aria-live="polite">
        {#if basemap.error}
          <p class="msg error" role="alert"><TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />{basemap.error}</p>
        {:else if basemap.busy}
          <p class="msg">Loading {current?.label ?? 'base map'}…</p>
        {:else if basemap.note}
          <p class="msg">{basemap.note}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    display: flex;
  }
  .popover {
    position: absolute;
    top: calc(100% + var(--space-3) + 2px);
    right: calc(var(--space-2) * -1);
    width: min(344px, calc(100vw - var(--shell-gutter) * 2));
    max-height: calc(100vh - var(--topbar-h) - var(--statusbar-h) - var(--shell-gutter) * 5);
    overflow-y: auto;
    padding: var(--space-3);
    background: var(--surface-panel-solid);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    z-index: var(--z-popover);
    color: var(--text-secondary);
  }
  h2 {
    font-size: var(--text-md);
    color: var(--text-primary);
    padding: var(--space-2) var(--space-3) var(--space-3);
  }
  .list {
    display: grid;
    gap: var(--space-1);
  }
  .opt {
    border-radius: var(--radius-sm);
  }
  .opt:hover:not(.checked):not(.disabled) {
    background: var(--hover-overlay);
  }
  .opt.checked {
    background: var(--selected-bg);
  }
  .radio {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    align-items: start;
  }
  .radio:focus-visible {
    outline-offset: -2px;
  }
  .opt.disabled .radio {
    cursor: not-allowed;
  }
  .opt.disabled .name {
    color: var(--text-tertiary);
  }
  .dot {
    width: 16px;
    height: 16px;
    margin-top: 1px;
    border-radius: var(--radius-full);
    border: 1.5px solid var(--border-strong);
    display: grid;
    place-items: center;
  }
  .checked .dot {
    border-color: var(--accent);
  }
  .checked .dot::after {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }
  .opt.disabled .dot {
    border-style: dashed;
    opacity: 0.6;
  }
  .text {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
  }
  .tag {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--status-stale);
    background: var(--status-stale-bg);
    border-radius: var(--radius-xs);
    padding: 0 var(--space-2);
    line-height: 18px;
  }
  .desc {
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
  }
  .note {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
    color: var(--text-tertiary);
  }
  .note.needs {
    color: var(--status-key);
  }
  .date {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-3) var(--space-3) calc(var(--space-3) + 16px + var(--space-3));
    font-size: var(--text-xs);
  }
  .date input {
    height: 28px;
    padding: 0 var(--space-3);
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    color-scheme: dark light;
  }
  .date-note {
    padding: 0 var(--space-3) var(--space-3) calc(var(--space-3) + 16px + var(--space-3));
    margin-top: calc(var(--space-2) * -1);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .date input:disabled {
    color: var(--text-secondary);
    border-style: dashed;
  }
  .link {
    color: var(--accent);
    height: 28px;
    padding: 0 var(--space-2);
    font-weight: var(--weight-medium);
  }
  .link:disabled {
    color: var(--text-tertiary);
  }
  .toggles {
    display: grid;
    margin-top: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-subtle);
  }
  .toggle {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 36px;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .toggle:hover:not(.off) {
    background: var(--hover-overlay);
  }
  .toggle.off {
    cursor: not-allowed;
  }
  .toggle.off .name {
    color: var(--text-tertiary);
  }
  .t-text {
    display: grid;
    gap: var(--space-1);
  }
  .toggle input {
    position: absolute;
    right: var(--space-3);
    width: 36px;
    height: 20px;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }
  .switch {
    width: 36px;
    height: 20px;
    border-radius: var(--radius-full);
    border: 1.5px solid var(--border-strong);
    position: relative;
    transition: background var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out);
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 13px;
    height: 13px;
    border-radius: var(--radius-full);
    background: var(--text-tertiary);
    transition: transform var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out);
  }
  input:checked ~ .switch {
    background: var(--accent);
    border-color: var(--accent);
  }
  input:checked ~ .switch::after {
    transform: translateX(16px);
    background: var(--accent-on);
  }
  input:disabled ~ .switch {
    border-style: dashed;
    opacity: 0.45;
  }
  input:focus-visible ~ .switch {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .status:not(:empty) {
    margin-top: var(--space-2);
  }
  .msg {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .msg.error {
    color: var(--status-error);
    background: var(--status-error-bg);
    border-radius: var(--radius-sm);
  }
  @media (max-width: 760px) {
    /* Anchor to the whole tools island and fill the width between the gutters. */
    .wrap {
      position: static;
    }
    .popover {
      width: calc(100vw - var(--shell-gutter) * 2);
      right: 0;
      top: calc(100% + var(--space-3));
    }
    .radio {
      min-height: 44px;
    }
    .popover {
      /* leave room for the time slider docked above the status bar */
      max-height: calc(100dvh - 250px);
    }
  }
</style>
