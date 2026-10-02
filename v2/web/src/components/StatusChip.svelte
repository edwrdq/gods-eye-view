<script lang="ts">
  import type { Snippet } from 'svelte';
  let { tone, children }: { tone: 'live' | 'stale' | 'error' | 'key' | 'planned' | 'loading' | 'history'; children: Snippet } = $props();
</script>

<span class="chip {tone}">{@render children()}</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 20px;
    padding: 0 var(--space-3) 0 var(--space-2);
    border-radius: var(--radius-xs);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--c);
    background: var(--bg);
    white-space: nowrap;
  }
  .live { --c: var(--status-live); --bg: var(--status-live-bg); }
  .stale { --c: var(--status-stale); --bg: var(--status-stale-bg); }
  .error { --c: var(--status-error); --bg: var(--status-error-bg); }
  .key { --c: var(--status-key); --bg: var(--status-key-bg); }
  .loading { --c: var(--status-loading); --bg: var(--hover-overlay); }
  .history { --c: var(--accent); --bg: var(--accent-subtle); }
  .planned { --c: var(--status-planned); --bg: transparent; border: 1px dashed var(--border-strong); padding-left: var(--space-3); }
</style>
