<script lang="ts">
  import type { PropValue } from '@gev/shared';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Eye from '@lucide/svelte/icons/eye';
  import Play from '@lucide/svelte/icons/play';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { untrack } from 'svelte';
  import { CONFIDENCE_WORDS, confidenceNote, headingText } from '../lib/cameraStyle.ts';
  import { pictureAge, pictureIsOld } from '../lib/cameraRefresh.ts';
  import { formatUtc } from '../lib/time.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { picture, reloadCamera, stopCamera, watchCamera } from '../state/camera.svelte.ts';
  import { lookFromCamera } from '../state/selection.svelte.ts';
  import { timeState } from '../state/time.svelte.ts';

  let { id, name, props }: { id: string; name: string; props: Record<string, PropValue> } = $props();

  const still = $derived(props.type !== 'video' && typeof props.imageUrl === 'string');
  const imagePath = $derived(typeof props.imageUrl === 'string' ? props.imageUrl : '');
  const refreshS = $derived(typeof props.refreshS === 'number' ? props.refreshS : 60);
  const streamUrl = $derived(typeof props.streamUrl === 'string' ? props.streamUrl : '');
  const confidence = $derived(props.headingConfidence === 'known' ? 'known' : 'estimated');
  const heading = $derived(typeof props.heading === 'number' ? props.heading : Number.NaN);
  const basis = $derived(typeof props.headingBasis === 'string' ? props.headingBasis : '');
  const mine = $derived(picture.id === id);
  const age = $derived(mine && picture.frameTime !== null ? Math.max(0, clock.now - picture.frameTime) : null);

  // The picture is asked for only while this panel shows the camera. The watcher reads and writes the shared
  // picture state, so it runs untracked: this effect depends on the camera only, and watching the same camera again is a no-op.
  $effect(() => {
    const [cam, path, every, isStill] = [id, imagePath, refreshS, still];
    untrack(() => (isStill ? watchCamera(cam, path, every) : stopCamera()));
  });
  // Leaving the panel (another selection, the panel closed) ends the watch.
  $effect(() => () => untrack(() => stopCamera()));

  // A video camera: native HLS only (Safari, some mobile browsers). Playback starts on a click, never before.
  let playing = $state(false);
  const nativeHls = typeof document !== 'undefined' && document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
  $effect(() => {
    void id;
    playing = false;
  });
</script>

<div class="camera">
  {#if still}
    <figure class="frame" aria-busy={picture.phase === 'loading' && mine}>
      {#if mine && picture.src}
        <img src={picture.src} alt="Latest picture from {name}" decoding="async" />
      {:else if mine && picture.phase === 'error'}
        <div class="blank err" role="alert">
          <TriangleAlert size={22} strokeWidth={1.5} aria-hidden="true" />
          <p>{picture.message || "Couldn't load a picture."}</p>
          <button class="btn" type="button" onclick={reloadCamera}><RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />Try again</button>
        </div>
      {:else}
        <div class="blank skel" role="status"><span class="visually-hidden">Loading the picture</span></div>
      {/if}
    </figure>
    <p class="caption" role="status" aria-live="off">
      {#if mine && picture.frameTime !== null}
        <span>Picture taken <span class="mono">{formatUtc(picture.frameTime)}</span> · <span class="num" class:old={age !== null && pictureIsOld(age, refreshS)}>{pictureAge(age ?? 0)}</span></span>
      {:else}
        <span>Asking the camera for a picture…</span>
      {/if}
      <span>A new one about every {refreshS < 90 ? `${refreshS} s` : `${Math.round(refreshS / 60)} min`}, only while this panel is open.</span>
      {#if picture.failedSince}<span class="warn">Couldn't refresh: {picture.message} Showing the last picture.</span>{/if}
      {#if timeState.at !== null}<span>Pictures are live; they do not follow the time slider.</span>{/if}
    </p>
  {:else}
    <div class="video">
      {#if nativeHls && playing && streamUrl}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={streamUrl} controls autoplay playsinline></video>
      {:else}
        <p class="note">This camera publishes live video only, no still pictures.{nativeHls ? '' : ' This browser cannot play the stream here.'}</p>
        <div class="row">
          {#if nativeHls && streamUrl}
            <button class="btn primary" type="button" onclick={() => (playing = true)}><Play size={14} strokeWidth={1.75} aria-hidden="true" />Play</button>
          {/if}
          {#if streamUrl}
            <a class="btn" href={streamUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />Open stream<span class="visually-hidden"> (opens in a new tab)</span></a>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <div class="facing">
    <span class="chip" class:est={confidence === 'estimated'}>
      <svg width="14" height="14" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 20 L30 2 A21 21 0 0 0 10 2 Z" class="wedge" /></svg>
      {CONFIDENCE_WORDS[confidence]}{Number.isFinite(heading) ? ` · ${headingText(heading)}` : ''}
    </span>
    <p>{confidenceNote(confidence, basis)}</p>
  </div>
  <button class="btn look" type="button" onclick={lookFromCamera}>
    <Eye size={14} strokeWidth={1.75} aria-hidden="true" />Look from here<small>approximate</small>
  </button>
</div>

<style>
  .camera {
    padding: 0 var(--space-5) var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  .frame {
    margin: 0;
    aspect-ratio: 16 / 9;
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .frame img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .blank {
    height: 100%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }
  .blank.err {
    color: var(--status-error);
  }
  .blank p {
    margin: 0;
    max-width: 28ch;
    color: var(--text-secondary);
  }
  .skel {
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.55;
    }
  }
  .caption {
    margin: 0;
    display: grid;
    gap: 2px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: var(--leading-prose);
  }
  .caption .old,
  .warn {
    color: var(--status-stale);
  }
  .video {
    display: grid;
    gap: var(--space-3);
  }
  .video video {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
    border-radius: var(--radius-sm);
  }
  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: var(--leading-prose);
  }
  .row {
    display: flex;
    gap: var(--space-3);
  }
  .facing {
    display: grid;
    gap: var(--space-2);
  }
  .facing p {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: var(--leading-prose);
  }
  .chip {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 2px var(--space-3);
    border-radius: var(--radius-xs);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--cat-ground);
    background: color-mix(in srgb, var(--cat-ground) 14%, transparent);
  }
  .chip .wedge {
    fill: currentColor;
    fill-opacity: 0.55;
    stroke: currentColor;
    stroke-width: 3;
  }
  .chip.est {
    background: transparent;
    outline: 1px dashed var(--border-strong);
    outline-offset: -1px;
    color: var(--text-secondary);
  }
  .chip.est .wedge {
    fill: none;
    stroke-dasharray: 6 5;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: var(--control-h);
    padding: 0 var(--space-4);
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
  .look small {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    font-weight: var(--weight-regular);
  }
</style>
