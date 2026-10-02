<script lang="ts">
  import type { PropValue } from '@gev/shared';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import { playStation, radio, setVolume, stopRadio, verdictFor } from '../state/radio.svelte.ts';

  let { id, props }: { id: string; props: Record<string, PropValue> } = $props();

  const streamUrl = $derived(typeof props.streamUrl === 'string' ? props.streamUrl : '');
  const verdict = $derived(
    verdictFor({ play: String(props.play ?? ''), codec: String(props.codec ?? ''), streamUrl, hls: props.hls === true }),
  );
  const mine = $derived(radio.id === id);
  const phase = $derived(mine ? radio.phase : 'idle');

  // Leaving this station (another one selected, or the panel closed) ends the stream.
  $effect(() => {
    const current = id;
    return () => {
      if (radio.id === current) stopRadio();
    };
  });
</script>

<div class="player" aria-label="Listen">
  {#if verdict.mode === 'audio'}
    <div class="row">
      {#if phase === 'idle' || phase === 'error'}
        <button class="btn primary" type="button" onclick={() => playStation(id, streamUrl)}>
          <Play size={14} strokeWidth={1.75} aria-hidden="true" />{phase === 'error' ? 'Try again' : 'Play'}
        </button>
      {:else}
        <button class="btn" type="button" onclick={stopRadio}>
          <Square size={14} strokeWidth={1.75} aria-hidden="true" />Stop
        </button>
      {/if}
      <label class="vol">
        <Volume2 size={14} strokeWidth={1.75} aria-hidden="true" />
        <span class="visually-hidden">Volume</span>
        <input type="range" min="0" max="1" step="0.05" value={radio.volume} oninput={(e) => setVolume(e.currentTarget.valueAsNumber)} />
      </label>
    </div>
    <p class="status" role="status" aria-live="polite">
      {#if phase === 'loading'}Connecting to the station…
      {:else if phase === 'playing'}Playing. The audio comes straight from the station's server.
      {:else if phase === 'error'}{radio.message}
      {:else}Starts only when you press Play. The audio comes straight from the station's server.{/if}
    </p>
    {#if phase === 'error'}
      <a class="link" href={streamUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />Open stream<span class="visually-hidden"> (opens in a new tab)</span></a>
    {/if}
  {:else}
    <div class="row">
      <a class="btn" href={streamUrl} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />Open stream<span class="visually-hidden"> (opens in a new tab)</span>
      </a>
    </div>
    <p class="status">{verdict.reason} The link opens the station's own stream.</p>
  {/if}
</div>

<style>
  .player {
    padding: 0 var(--space-5) var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  .row {
    display: flex;
    gap: var(--space-4);
    align-items: center;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: var(--control-h);
    min-width: 96px;
    padding: 0 var(--space-5);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    font-weight: var(--weight-medium);
    color: inherit;
    text-decoration: none;
    white-space: nowrap;
  }
  .btn:hover {
    background: var(--hover-overlay);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-on);
  }
  .btn.primary:hover {
    background: var(--accent-hover);
  }
  .vol {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--text-secondary);
    min-width: 0;
  }
  .vol input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .status {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-prose);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--accent);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }
</style>
