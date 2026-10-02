<script lang="ts">
  import type { DetailSection, PropValue } from '@gev/shared';
  import Check from '@lucide/svelte/icons/check';
  import Clock from '@lucide/svelte/icons/clock';
  import Copy from '@lucide/svelte/icons/copy';
  import Crosshair from '@lucide/svelte/icons/crosshair';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import LocateFixed from '@lucide/svelte/icons/locate-fixed';
  import History from '@lucide/svelte/icons/history';
  import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
  import Route from '@lucide/svelte/icons/route';
  import Triangle from '@lucide/svelte/icons/triangle';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import CategoryIcon from './CategoryIcon.svelte';
  import IconButton from './IconButton.svelte';
  import RadioPlayer from './RadioPlayer.svelte';
  import StatusChip from './StatusChip.svelte';
  import { primaryAction, titleIsIdentifier } from '../lib/detailActions.ts';
  import { featureTimeNote } from '../lib/featureDetail.ts';
  import { isLiveOnly, isStatic } from '../lib/featureWindow.ts';
  import { formatAge, formatDuration, formatUtc } from '../lib/time.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { feedStore } from '../state/feeds.svelte.ts';
  import { layerStore } from '../state/layers.svelte.ts';
  import { copySelection, flyToSelection, retryDetail, selectObject, selection, toggleFollow, toggleTrack } from '../state/selection.svelte.ts';
  import { timeState } from '../state/time.svelte.ts';

  const detail = $derived(selection.detail);
  const category = $derived(layerStore.layers.find((l) => l.id === selection.ref?.layer)?.category ?? 'air');
  const sourceName = $derived(layerStore.layers.find((l) => l.id === selection.ref?.layer)?.name.toLowerCase() ?? 'data');
  const historical = $derived(timeState.at !== null);
  const seenAgo = $derived(detail ? Math.max(0, (historical ? timeState.at! : clock.now) - detail.observation.t) : 0);
  const freshness = $derived(feedStore.byLayer[selection.ref?.layer ?? '']?.freshnessMs ?? 60_000);
  // The server says whether the object is in the live picture; without that flag fall back to its age.
  const kind = $derived(selection.kind);
  const titleIsId = $derived(detail ? titleIsIdentifier(kind, detail.title, detail.objectId) : false);
  const notInFeed = $derived(selection.phase === 'gone' || (!historical && detail?.live === false));
  // Features and orbits: what the chip and the line beside it say.
  const currentOnly = $derived(kind === 'features' && historical && isLiveOnly(selection.ref?.layer ?? ''));
  const epochMs = $derived(typeof detail?.observation.props.epoch === 'number' ? detail.observation.props.epoch : null);
  const timeNote = $derived(
    !detail
      ? ''
      : kind === 'orbits'
        ? epochMs !== null
          ? `Elements ${formatDuration(Math.max(0, clock.now - epochMs))} old`
          : ''
        : featureTimeNote(selection.ref?.layer ?? '', detail.observation.t, historical && !currentOnly ? timeState.at! : clock.now, historical && !currentOnly),
  );
  const stale = $derived(!historical && detail?.live === undefined && seenAgo > freshness);

  const text = (v: PropValue): string => (v === null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? v.toLocaleString('en-US') : v);

  const isRadio = $derived(selection.ref?.layer === 'radio');
  const urlLabel = $derived(isRadio ? 'Open homepage' : selection.ref?.layer === 'bikeshare' ? 'Operator site' : 'Open source page');

  // Military aircraft are a separate layer; the flag on the observation covers a civil layer that carries one.
  const military = $derived(selection.ref?.layer === 'military-flights' || detail?.observation.props.military === true);

  /** Provenance is always last: add a Source section when the server did not send one. */
  const sections = $derived.by((): DetailSection[] => {
    if (!detail) return [];
    let base = detail.sections;
    if (military && !base.some((s) => s.rows.some((r) => r.label.toLowerCase() === 'class'))) {
      const i = base.findIndex((s) => s.title.toLowerCase() !== 'position');
      const row = { label: 'Class', value: 'Military aircraft', hint: 'ADS-B flag' };
      base = i >= 0 ? base.map((s, j) => (j === i ? { ...s, rows: [row, ...s.rows] } : s)) : [...base, { title: 'Aircraft', rows: [row] }];
    }
    if (base.some((s) => s.title.toLowerCase() === 'source')) return base;
    return [
      ...base,
      {
        title: 'Source',
        rows: [
          { label: 'Feed', value: detail.sources.join(', ') || 'Unknown' },
          { label: 'Received', value: formatUtc(detail.observation.t), mono: true },
        ],
      },
    ];
  });
</script>

<aside class="panel" class:is-empty={selection.phase === 'idle'} aria-label="Object details" aria-busy={selection.phase === 'loading'} style="--cat: var(--cat-{category})">
  {#if selection.phase === 'idle'}
    <div class="state">
      <MousePointer2 size={28} strokeWidth={1.5} class="state-icon" aria-hidden="true" />
      <h2>Nothing selected</h2>
      <p>Click an aircraft, ship, earthquake, storm, launch, satellite, bike station or radio station on the globe to see its details here.</p>
    </div>
  {:else if selection.phase === 'loading' && !detail}
    <div class="head">
      <div class="tile"><CategoryIcon {category} /></div>
      <div class="skels"><span class="skel" style="width:55%;height:20px"></span><span class="skel" style="width:80%"></span></div>
      <IconButton label="Close details" onclick={() => selectObject(null)}><X size={18} strokeWidth={1.75} /></IconButton>
    </div>
    <div class="body skel-body" role="status"><span class="visually-hidden">Loading details</span>
      <span class="skel" style="width:90%"></span><span class="skel" style="width:70%"></span><span class="skel" style="width:85%;margin-top:20px"></span><span class="skel" style="width:75%"></span><span class="skel" style="width:80%"></span>
    </div>
  {:else if selection.phase === 'error' && !detail}
    <div class="head">
      <div class="tile"><CategoryIcon {category} /></div>
      <div class="titles"><h2 class="title mono">{selection.ref?.objectId}</h2></div>
      <IconButton label="Close details" onclick={() => selectObject(null)}><X size={18} strokeWidth={1.75} /></IconButton>
    </div>
    <div class="state" role="alert">
      <TriangleAlert size={28} strokeWidth={1.5} class="state-icon err" aria-hidden="true" />
      <h3>Couldn't load this object</h3>
      <p>{selection.error || `The ${sourceName} source didn't respond.`}</p>
      <button class="btn" type="button" onclick={retryDetail}>Try again</button>
    </div>
  {:else if detail}
    <div class="head">
      <div class="tile"><CategoryIcon {category} /></div>
      <div class="titles">
        <h2 class="title truncate" class:mono={titleIsId} title={detail.title}>{detail.title}</h2>
        {#if detail.subtitle}<div class="sub">{detail.subtitle}</div>{/if}
      </div>
      <IconButton label="Close details" onclick={() => selectObject(null)}><X size={18} strokeWidth={1.75} /></IconButton>
    </div>
    <div class="actions">
      {#if primaryAction(kind) === 'follow'}
        <button class="btn primary" type="button" aria-pressed={selection.following} onclick={toggleFollow}>
          <Crosshair size={14} strokeWidth={1.75} aria-hidden="true" />{selection.following ? 'Following' : 'Follow'}
        </button>
      {:else}
        <button class="btn" class:primary={!isRadio} type="button" onclick={flyToSelection}>
          <LocateFixed size={14} strokeWidth={1.75} aria-hidden="true" />Fly to
        </button>
      {/if}
      {#if kind === 'tracked'}
        <button class="btn" type="button" aria-pressed={selection.track === 'on' || selection.track === 'loading'} disabled={false} onclick={toggleTrack}>
          <Route size={14} strokeWidth={1.75} aria-hidden="true" />{selection.track === 'on' ? 'Hide track' : selection.track === 'loading' ? 'Loading track' : 'Show track'}
        </button>
      {:else if selection.url}
        <a class="btn" href={selection.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />{urlLabel}<span class="visually-hidden"> (opens in a new tab)</span>
        </a>
      {/if}
      <button class="icon-outline" type="button" aria-label={selection.copied ? 'Copied' : 'Copy id and coordinates'} title="Copy id and coordinates" onclick={copySelection}>
        {#if selection.copied}<Check size={14} strokeWidth={2} aria-hidden="true" />{:else}<Copy size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
      </button>
    </div>
    {#if isRadio}<RadioPlayer id={detail.objectId} props={detail.observation.props} />{/if}
    <div class="fresh">
      {#if military}<StatusChip tone="neutral"><Triangle size={12} strokeWidth={2} aria-hidden="true" />Military</StatusChip>{/if}
      {#if kind !== 'tracked' && !notInFeed}
        {#if isStatic(selection.ref?.layer ?? '')}
          <StatusChip tone="neutral"><Clock size={12} strokeWidth={2} aria-hidden="true" />Snapshot</StatusChip>
          <span class="meta num">{timeNote}</span>
        {:else if currentOnly}
          <StatusChip tone="neutral"><Clock size={12} strokeWidth={2} aria-hidden="true" />Current</StatusChip>
          <span class="meta num">{timeNote}</span>
        {:else if kind === 'orbits' && historical}
          <StatusChip tone="history"><History size={12} strokeWidth={2} aria-hidden="true" />Computed</StatusChip>
          <span class="meta num">{timeNote}</span>
        {:else if historical}
          <StatusChip tone="history"><History size={12} strokeWidth={2} aria-hidden="true" />Recorded</StatusChip>
          <span class="meta num">{timeNote}</span>
        {:else}
          <StatusChip tone="live"><span class="dot"></span>Live</StatusChip>
          <span class="meta num">{timeNote}</span>
        {/if}
      {:else if notInFeed}
        <StatusChip tone="stale"><Clock size={12} strokeWidth={2} aria-hidden="true" />{historical ? 'Not recorded' : 'Not in feed'}</StatusChip>
        <span class="meta num">Last seen {formatAge(clock.now - detail.observation.t)}</span>
      {:else if historical}
        <StatusChip tone="history"><History size={12} strokeWidth={2} aria-hidden="true" />Recorded</StatusChip>
        <span class="meta num">Last seen {formatDuration(seenAgo)} before this time</span>
      {:else if stale}
        <StatusChip tone="stale"><Clock size={12} strokeWidth={2} aria-hidden="true" />Stale</StatusChip>
        <span class="meta num">Last seen {formatAge(seenAgo)}</span>
      {:else}
        <StatusChip tone="live"><span class="dot"></span>Live</StatusChip>
        <span class="meta num">Last seen {formatAge(seenAgo)}</span>
      {/if}
    </div>
    {#if notInFeed}
      <p class="notice" role="status">
        {#if kind !== 'tracked'}This {kind === 'orbits' ? 'satellite' : 'item'} is no longer in the feed. The last details received are shown.{:else if historical}This object wasn't recorded at the viewed time. The last details received are shown.{:else}This object is no longer in the feed. It may have landed, left coverage or stopped transmitting. The last known details are shown.{/if}
      </p>
    {/if}
    {#if currentOnly}<p class="notice" role="status">Not recorded for past times. This shows the current data.</p>{/if}
    {#if selection.track === 'empty'}<p class="notice" role="status">No recorded track for this object in the last 6 hours.</p>{/if}
    {#if selection.track === 'error'}<p class="notice err" role="alert">Couldn't load the track. Try again.</p>{/if}
    {#if selection.refreshFailed}<p class="notice" role="status">Couldn't refresh. Showing the last details received.</p>{/if}
    <div class="body scroll-y">
      {#each sections as section (section.title)}
        <section class="section">
          <h3>{section.title}</h3>
          <dl class="kv">
            {#each section.rows as row (row.label)}
              <dt>{row.label}</dt>
              <dd class:mono={row.mono}>{text(row.value)}{#if row.hint}<small>{row.hint}</small>{/if}</dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .panel {
    position: absolute;
    z-index: var(--z-panel);
    top: calc(var(--shell-gutter) * 2 + var(--topbar-h));
    right: var(--shell-gutter);
    width: var(--panel-right-w);
    max-height: calc(100% - var(--topbar-h) - var(--statusbar-h) - var(--shell-gutter) * 4);
    background: var(--surface-panel);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-2);
    backdrop-filter: blur(var(--panel-blur));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .head {
    display: grid;
    grid-template-columns: 36px 1fr auto;
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-4) var(--space-3) var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
  }
  .tile {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--cat) 16%, transparent);
    color: var(--cat);
  }
  .titles {
    min-width: 0;
  }
  .title {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    line-height: 1.2;
  }
  .sub {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-top: 2px;
  }
  .actions {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
  }
  .btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: var(--control-h);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    color: inherit;
    text-decoration: none;
  }
  .btn:hover {
    background: var(--hover-overlay);
  }
  .btn[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-subtle);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-on);
  }
  .btn.primary:hover {
    background: var(--accent-hover);
  }
  .btn.primary[aria-pressed='true'] {
    background: var(--accent-pressed);
    color: var(--accent-on);
  }
  .icon-outline {
    flex: none;
    width: var(--control-h);
    height: var(--control-h);
    display: grid;
    place-items: center;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
  }
  .icon-outline:hover {
    background: var(--hover-overlay);
    color: var(--text-primary);
  }
  .fresh {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-5) var(--space-4);
    flex-wrap: wrap;
  }
  .meta {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .notice {
    margin: 0 var(--space-5) var(--space-4);
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-xs);
    line-height: var(--leading-prose);
    color: var(--text-secondary);
    background: var(--surface-sunken);
    border-radius: var(--radius-sm);
  }
  .notice.err {
    color: var(--status-error);
  }
  .body {
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--border-subtle);
  }
  .section {
    padding: var(--space-4) var(--space-5);
  }
  .section + .section {
    border-top: 1px solid var(--border-subtle);
  }
  .section h3 {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--text-secondary);
    margin-bottom: var(--space-3);
  }
  .kv {
    display: grid;
    grid-template-columns: 112px 1fr;
    align-items: baseline;
    gap: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
  }
  .kv dt {
    color: var(--text-secondary);
  }
  .kv dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .kv dd small {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    margin-left: var(--space-2);
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
  .state :global(.state-icon.err) {
    color: var(--status-error);
  }
  h2,
  h3 {
    color: var(--text-primary);
  }
  .state h2,
  .state h3 {
    font-size: var(--text-md);
    margin-bottom: var(--space-3);
  }
  .state p {
    max-width: 30ch;
    margin: 0 auto var(--space-4);
    font-size: var(--text-sm);
  }
  .skels {
    display: grid;
    gap: var(--space-3);
  }
  .skel-body {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-5);
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
  @media (max-width: 1380px) {
    .panel {
      max-height: calc(100% - var(--topbar-h) - var(--statusbar-h) - var(--shell-gutter) * 4 - var(--dock-h, 0px));
    }
  }
  /* Phone: a bottom sheet above the time dock, only while something is selected. */
  @media (max-width: 760px) {
    .panel {
      top: auto;
      left: var(--shell-gutter);
      width: auto;
      bottom: calc(var(--statusbar-h) + var(--shell-gutter) * 2 + var(--dock-h, 0px));
      max-height: 45%;
      border-radius: var(--radius-lg);
    }
    .panel.is-empty {
      display: none;
    }
  }
</style>
