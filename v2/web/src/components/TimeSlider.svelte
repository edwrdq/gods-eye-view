<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import IconButton from './IconButton.svelte';
  import { sliderFraction } from '../lib/timeline.ts';
  import { formatShortUtc, formatUtc, formatViewUtc } from '../lib/time.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { goLive, setDockOpen, setSpeed, SPEEDS, timeState, togglePlay, viewAt, type Speed } from '../state/time.svelte.ts';

  const STEPS = 1000;
  const from = $derived(timeState.range?.from ?? null);
  const usable = $derived(timeState.rangeStatus === 'ready' && from !== null && clock.now - from > 60_000);
  const live = $derived(timeState.at === null);
  const value = $derived(Math.round(sliderFraction(timeState.at, timeState.range, clock.now) * STEPS));

  function onInput(e: Event) {
    if (from === null) return;
    const v = Number((e.currentTarget as HTMLInputElement).value);
    viewAt(from + (v / STEPS) * (clock.now - from));
  }
  const valueText = $derived(live ? 'Live' : `Viewing ${formatUtc(timeState.at!)}`);
  const message = $derived(
    timeState.rangeStatus === 'loading' ? 'Checking recorded history' : timeState.rangeStatus === 'error' ? "History isn't available right now" : 'No recorded history yet. It builds up while layers are on.',
  );
</script>

<section id="time-dock" class="dock" class:is-history={!live} aria-label="Time">
  <div class="row">
    <button class="play" type="button" aria-label={timeState.playing ? 'Pause playback' : 'Play recorded history'} disabled={!usable} onclick={togglePlay}>
      {#if timeState.playing}<Pause size={16} strokeWidth={2} aria-hidden="true" />{:else}<Play size={16} strokeWidth={2} aria-hidden="true" />{/if}
    </button>
    <label class="speed">
      <span class="visually-hidden">Playback speed</span>
      <select disabled={!usable} value={timeState.speed} onchange={(e) => setSpeed(Number(e.currentTarget.value) as Speed)} title="Playback speed: seconds of history per second">
        {#each SPEEDS as s (s)}<option value={s}>{s.toLocaleString('en-US')}×</option>{/each}
      </select>
    </label>
    <div class="readout" aria-live="polite">
      {#if live}
        <span class="live"><span class="dot"></span>Live</span>
        <span class="hint">Drag back to view recorded history</span>
      {:else}
        <span class="viewing"><span class="lbl">Viewing</span> <span class="mono">{formatViewUtc(timeState.at!)}</span></span>
      {/if}
    </div>
    {#if !live}
      <button class="return" type="button" onclick={goLive}><RotateCcw size={13} strokeWidth={2} aria-hidden="true" />Return to live</button>
    {/if}
    <IconButton label="Hide time slider" small onclick={() => setDockOpen(false)}><ChevronDown size={16} strokeWidth={1.75} /></IconButton>
  </div>
  {#if usable && from !== null}
    <div class="scrub">
      <span class="end num">{formatShortUtc(from)}</span>
      <input type="range" min="0" max={STEPS} step="2" {value} oninput={onInput} aria-label="Viewed time" aria-valuetext={valueText} style="--fill:{value / 10}%" />
      <span class="end">Now</span>
    </div>
  {:else}
    <p class="scrub none" role="status">{message}</p>
  {/if}
</section>

<style>
  .dock {
    position: absolute;
    z-index: var(--z-bar);
    left: calc(var(--shell-gutter) * 2 + var(--panel-left-w));
    right: calc(var(--shell-gutter) * 2 + var(--panel-right-w));
    bottom: calc(var(--statusbar-h) + var(--shell-gutter) * 2);
    height: 76px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    background: var(--surface-panel);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-2);
    backdrop-filter: blur(var(--panel-blur));
    font-size: var(--text-xs);
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .dock.is-history {
    border-color: var(--accent);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .hint {
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .play {
    flex: none;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-on);
  }
  .play:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .play:disabled {
    background: transparent;
    border: 1.5px dashed var(--border-strong);
    color: var(--text-tertiary);
    opacity: 0.6;
  }
  .speed select {
    height: 28px;
    padding: 0 var(--space-3);
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .speed select:disabled {
    color: var(--text-tertiary);
  }
  .scrub {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .scrub.none {
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .end {
    flex: none;
  }
  input[type='range'] {
    flex: 1;
    min-width: 80px;
    height: 24px;
    margin: 0;
    background: transparent;
    appearance: none;
    cursor: pointer;
  }
  input[type='range']::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--fill), var(--border-strong) var(--fill));
  }
  input[type='range']::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: var(--border-strong);
  }
  input[type='range']::-moz-range-progress {
    height: 4px;
    border-radius: 2px;
    background: var(--accent);
  }
  input[type='range']::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -6px;
    border-radius: 50%;
    background: var(--text-primary);
    border: 3px solid var(--accent);
  }
  input[type='range']::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-primary);
    border: 3px solid var(--accent);
  }
  input[type='range']:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-xs);
  }
  .readout {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 20px;
    padding: 0 var(--space-3) 0 var(--space-2);
    border-radius: var(--radius-xs);
    color: var(--status-live);
    background: var(--status-live-bg);
    font-weight: var(--weight-medium);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .viewing {
    color: var(--text-primary);
  }
  .lbl {
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }
  .return {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 28px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-on);
    font-weight: var(--weight-medium);
  }
  .return:hover {
    background: var(--accent-hover);
  }
  @media (max-width: 1380px) {
    .dock {
      left: var(--shell-gutter);
      right: var(--shell-gutter);
    }
  }
  @media (max-width: 760px) {
    .dock {
      height: auto;
      padding: var(--space-3);
    }
    .row {
      flex-wrap: wrap;
    }
    .readout {
      flex-basis: 100%;
      order: 5;
    }
    .hint {
      display: none;
    }
  }
</style>
