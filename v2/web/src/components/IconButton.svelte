<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    label: string;
    small?: boolean;
    children: Snippet;
  }
  let { label, small = false, children, class: extra = '', ...rest }: Props = $props();
</script>

<button type="button" class={['btn-icon', extra]} class:small aria-label={label} title={rest.title ?? label} {...rest}>
  {@render children()}
</button>

<style>
  .btn-icon {
    display: inline-grid;
    place-items: center;
    width: var(--control-h);
    height: var(--control-h);
    flex: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .btn-icon.small {
    width: 28px;
    height: 28px;
  }
  .btn-icon:hover {
    background: var(--hover-overlay);
    color: var(--text-primary);
  }
  .btn-icon:active {
    background: var(--active-overlay);
  }
  .btn-icon[aria-pressed='true'] {
    color: var(--accent);
    background: var(--accent-subtle);
  }
  @media (max-width: 760px) {
    .btn-icon {
      min-width: 40px;
      min-height: 40px;
    }
  }
</style>
