<script lang="ts">
  import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
</script>

<!-- Phase 1: nothing can be selected yet, so only the empty state exists. -->
<aside class="panel" aria-label="Object details">
  <div class="state">
    <MousePointer2 size={28} strokeWidth={1.5} class="state-icon" aria-hidden="true" />
    <h2>Nothing selected</h2>
    <p>Click an aircraft, ship or other object on the globe to see its details here.</p>
  </div>
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
  .state {
    padding: var(--space-7) var(--space-6);
    text-align: center;
    color: var(--text-secondary);
  }
  .state :global(.state-icon) {
    margin: 0 auto var(--space-4);
    color: var(--text-tertiary);
  }
  h2 {
    font-size: var(--text-md);
    color: var(--text-primary);
    margin-bottom: var(--space-3);
  }
  p {
    max-width: 30ch;
    margin: 0 auto;
    font-size: var(--text-sm);
  }
  /* With nothing to show, a bottom sheet on a phone would only hide the globe. */
  @media (max-width: 760px) {
    .panel {
      display: none;
    }
  }
</style>
