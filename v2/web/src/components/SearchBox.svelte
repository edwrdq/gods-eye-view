<script lang="ts">
  import type { GeocodeResponse, GeocodeResult } from '@gev/shared';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import MapPin from '@lucide/svelte/icons/map-pin';
  import Crosshair from '@lucide/svelte/icons/crosshair';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { debounce } from '../lib/debounce.ts';
  import { formatLatLon } from '../lib/format.ts';
  import { splitMatches } from '../lib/highlight.ts';
  import { flyTo } from '../state/globe.svelte.ts';

  type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable' | 'invalid';

  const DEBOUNCE_MS = 250;
  const TIMEOUT_MS = 8000;
  const uid = $props.id();
  const listId = `${uid}-results`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  let input = $state<HTMLInputElement>();
  let root = $state<HTMLElement>();
  let query = $state('');
  let status = $state<Status>('idle');
  let results = $state<GeocodeResult[]>([]);
  let active = $state(-1);
  let open = $state(false);
  let controller: AbortController | undefined;
  let searchedQuery = $state('');

  const places = $derived(results.filter((r) => r.kind !== 'coordinates'));
  const coords = $derived(results.filter((r) => r.kind === 'coordinates'));
  // Keyboard order is the visual order: places, then coordinates.
  const ordered = $derived([...places, ...coords]);
  const expanded = $derived(open && status !== 'idle');

  const KIND_LABEL: Record<GeocodeResult['kind'], string> = {
    coordinates: 'Coordinates',
    place: 'Place',
    address: 'Address',
    poi: 'Point of interest',
  };

  const announcement = $derived(
    status === 'loading'
      ? 'Searching'
      : status === 'ready'
        ? `${results.length} ${results.length === 1 ? 'result' : 'results'}`
        : status === 'empty'
          ? 'No places found'
          : status === 'unavailable'
            ? 'Search is unavailable'
            : '',
  );

  async function run(q: string) {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    const timeout = setTimeout(() => mine.abort(new DOMException('Timed out', 'TimeoutError')), TIMEOUT_MS);
    searchedQuery = q;
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: mine.signal });
      if (res.status === 400) {
        results = [];
        status = 'invalid';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as GeocodeResponse;
      results = body.results;
      active = body.results.length > 0 ? 0 : -1;
      status = body.results.length > 0 ? 'ready' : 'empty';
    } catch (e) {
      // A newer request replaced this one; its own result will arrive.
      if (mine !== controller) return;
      results = [];
      active = -1;
      status = 'unavailable';
    } finally {
      clearTimeout(timeout);
    }
  }

  const debouncedRun = debounce(run, DEBOUNCE_MS);

  function onInput() {
    const q = query.trim();
    controller?.abort();
    controller = undefined;
    debouncedRun.cancel();
    if (!q) {
      status = 'idle';
      results = [];
      active = -1;
      return;
    }
    open = true;
    status = 'loading';
    debouncedRun(q);
  }

  function clear() {
    query = '';
    onInput();
    input?.focus();
  }

  function retry() {
    const q = query.trim();
    if (!q) return;
    status = 'loading';
    void run(q);
    input?.focus();
  }

  function choose(r: GeocodeResult) {
    open = false;
    query = r.label;
    active = -1;
    flyTo({ lon: r.lon, lat: r.lat, bbox: r.bbox, kind: r.kind });
  }

  function move(delta: number) {
    if (ordered.length === 0) return;
    open = true;
    active = (active + delta + ordered.length) % ordered.length;
    // Keep the active option in view inside the scrolling list.
    queueMicrotask(() => document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' }));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && status !== 'idle') open = true;
      else move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      const r = ordered[active] ?? (status === 'ready' ? ordered[0] : undefined);
      if (r && expanded) {
        e.preventDefault();
        choose(r);
      } else {
        debouncedRun.flush(); // search now instead of waiting out the debounce
      }
    } else if (e.key === 'Escape') {
      if (open) {
        open = false;
        e.preventDefault();
      } else if (query) {
        clear();
      }
    }
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    e.preventDefault();
    input?.focus();
    input?.select();
  }

  function onWindowPointerDown(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }

  function onFocusOut(e: FocusEvent) {
    if (root && !root.contains(e.relatedTarget as Node | null)) open = false;
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerDown} />

{#snippet highlighted(text: string)}
  {#each splitMatches(text, searchedQuery) as seg}{#if seg.match}<b>{seg.text}</b>{:else}{seg.text}{/if}{/each}
{/snippet}

{#snippet option(r: GeocodeResult, i: number)}
  <!-- Keyboard use goes through the combobox input (aria-activedescendant), so options take no key events. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="result"
    id={optionId(i)}
    role="option"
    aria-selected={i === active}
    tabindex="-1"
    onpointerdown={(e) => e.preventDefault()}
    onclick={() => choose(r)}
    onpointermove={() => (active = i)}
  >
    <span class="result-icon" aria-hidden="true">
      {#if r.kind === 'coordinates'}<Crosshair size={14} strokeWidth={1.75} />{:else}<MapPin size={14} strokeWidth={1.75} />{/if}
    </span>
    <div class="result-main">
      <div class="result-title truncate">{@render highlighted(r.label)}</div>
      {#if r.detail && r.kind !== 'coordinates'}<div class="result-detail truncate">{r.detail}</div>{/if}
      <div class="result-sub mono">{formatLatLon(r.lat, r.lon)}</div>
    </div>
    <span class="result-type">{r.kind === 'place' || r.kind === 'coordinates' ? '' : KIND_LABEL[r.kind]}</span>
  </div>
{/snippet}

<div class="search" role="search" bind:this={root} onfocusout={onFocusOut}>
  <div class="search-box">
    <Search size={18} strokeWidth={1.75} aria-hidden="true" />
    <input
      bind:this={input}
      bind:value={query}
      oninput={onInput}
      onkeydown={onKeydown}
      onfocus={() => {
        if (status !== 'idle') open = true;
      }}
      type="text"
      role="combobox"
      aria-label="Search places or coordinates"
      aria-expanded={expanded}
      aria-controls={listId}
      aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
      aria-autocomplete="list"
      aria-busy={status === 'loading'}
      placeholder="Search places or coordinates"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      maxlength="200"
    />
    {#if query}
      <button class="clear" type="button" aria-label="Clear search" onclick={clear}><X size={14} strokeWidth={1.75} /></button>
    {:else}
      <span class="kbd" aria-hidden="true">/</span>
    {/if}
  </div>

  <div class="visually-hidden" role="status" aria-live="polite">{announcement}</div>

  <div class="results scroll-y" id={listId} role="listbox" aria-label="Search results" hidden={!expanded || status === 'unavailable' || status === 'empty' || status === 'invalid' || status === 'loading'}>
    {#if places.length > 0}
      <div class="results-group" role="presentation">Places</div>
      {#each places as r, i (r.source + r.lon + r.lat + r.label)}
        {@render option(r, i)}
      {/each}
    {/if}
    {#if coords.length > 0}
      <div class="results-group" role="presentation">Coordinates</div>
      {#each coords as r, i (r.source + r.lon + r.lat + r.label)}
        {@render option(r, places.length + i)}
      {/each}
    {/if}
    <div class="results-foot" aria-hidden="true">
      <span><span class="kbd">&uarr;</span><span class="kbd">&darr;</span> to move</span>
      <span><span class="kbd">Enter</span> to go</span>
      <span><span class="kbd">Esc</span> to close</span>
    </div>
  </div>

  {#if expanded && (status === 'loading' || status === 'unavailable' || status === 'empty' || status === 'invalid')}
    <div class="results message" aria-live="off">
      {#if status === 'loading'}
        <div class="skeletons" aria-hidden="true">
          {#each [0, 1, 2] as n (n)}
            <div class="skel-row"><span class="skel dot"></span><span class="skel-lines"><span class="skel" style="width:{70 - n * 12}%"></span><span class="skel" style="width:34%"></span></span></div>
          {/each}
        </div>
      {:else if status === 'unavailable'}
        <div class="msg-body" role="alert">
          <TriangleAlert size={16} strokeWidth={1.75} class="msg-icon msg-error" aria-hidden="true" />
          <div>
            <p>Search is unavailable right now. Check your connection and try again.</p>
            <button class="btn-sm" type="button" onclick={retry}>Try again</button>
          </div>
        </div>
      {:else if status === 'invalid'}
        <div class="msg-body" role="alert">
          <TriangleAlert size={16} strokeWidth={1.75} class="msg-icon" aria-hidden="true" />
          <p>That search is too long. Try a shorter place name or a coordinate.</p>
        </div>
      {:else}
        <div class="msg-body">
          <Search size={16} strokeWidth={1.75} class="msg-icon" aria-hidden="true" />
          <p>No places match &lsquo;{searchedQuery}&rsquo;. Try a larger area or enter coordinates.</p>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .search {
    position: relative;
    justify-self: center;
    width: 100%;
  }
  .search-box {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--topbar-h);
    padding: 0 var(--space-4);
    background: var(--surface-bar);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-1);
    backdrop-filter: blur(var(--panel-blur));
    color: var(--text-secondary);
  }
  .search-box:focus-within {
    border-color: var(--accent);
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 0;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    background: none;
    border: 0;
    outline: none;
    font-size: var(--text-md);
    color: var(--text-primary);
    text-overflow: ellipsis;
  }
  .kbd {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xs);
    padding: 1px 6px;
    line-height: 1.4;
  }
  .clear {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
  }
  .clear:hover {
    background: var(--hover-overlay);
    color: var(--text-primary);
  }
  .results {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 0;
    right: 0;
    max-height: min(70vh, 460px);
    background: var(--surface-panel);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    backdrop-filter: blur(var(--panel-blur));
    padding: var(--space-2);
    z-index: var(--z-popover);
  }
  .results[hidden] {
    display: none;
  }
  .results-group {
    padding: var(--space-3) var(--space-3) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
  }
  .result {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    gap: var(--space-3);
    align-items: center;
    min-height: 40px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    cursor: pointer;
  }
  .result[aria-selected='true'] {
    background: var(--selected-bg);
    box-shadow: inset 0 0 0 1px var(--accent-subtle);
  }
  .result-icon {
    display: grid;
    place-items: center;
    color: var(--text-secondary);
  }
  .result-title {
    font-size: var(--text-sm);
  }
  .result-title :global(b) {
    font-weight: var(--weight-semibold);
  }
  .result-detail,
  .result-sub {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .result-sub {
    color: var(--text-tertiary);
  }
  .result-type {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .results-foot {
    display: flex;
    gap: var(--space-5);
    padding: var(--space-3) var(--space-3) var(--space-2);
    margin-top: var(--space-2);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .results-foot > span {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
  }
  .message {
    padding: var(--space-4);
  }
  .skeletons {
    display: grid;
    gap: var(--space-4);
  }
  .skel-row {
    display: grid;
    grid-template-columns: 14px 1fr;
    gap: var(--space-3);
    align-items: center;
  }
  .skel-lines {
    display: grid;
    gap: var(--space-2);
  }
  .skel {
    display: block;
    height: 10px;
    border-radius: 3px;
    background: var(--surface-raised);
    animation: pulse 1.4s ease-in-out infinite;
  }
  .skel.dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  .msg-body {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .msg-body p {
    max-width: 44ch;
    margin-bottom: var(--space-3);
  }
  .msg-body :global(.msg-icon) {
    margin-top: 2px;
    color: var(--text-tertiary);
  }
  .msg-body :global(.msg-error) {
    color: var(--status-error);
  }
  .msg-body p:last-child {
    margin-bottom: 0;
  }
  .btn-sm {
    height: 26px;
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
  }
  .btn-sm:hover {
    background: var(--hover-overlay);
  }
  @media (max-width: 760px) {
    .results-foot,
    .result-type,
    .kbd {
      display: none;
    }
    .search-box {
      padding: 0 var(--space-3);
    }
  }
</style>
