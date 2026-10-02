<script lang="ts">
  import Menu from '@lucide/svelte/icons/menu';
  import Layers from '@lucide/svelte/icons/layers';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Monitor from '@lucide/svelte/icons/monitor';
  import IconButton from './IconButton.svelte';
  import BaseMapPicker from './BaseMapPicker.svelte';
  import SearchBox from './SearchBox.svelte';
  import { cycleTheme, theme, type ThemeMode } from '../state/theme.svelte.ts';

  let { layersOpen, onToggleLayers }: { layersOpen: boolean; onToggleLayers: () => void } = $props();

  const NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' };
  const NAME: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' };
  const label = $derived(`Theme: ${NAME[theme.mode].toLowerCase()}. Switch to ${NAME[NEXT[theme.mode]].toLowerCase()}.`);
</script>

<header class="topbar">
  <div class="island brand">
    <span class="only-narrow">
      <IconButton label="Layers" aria-pressed={layersOpen} aria-expanded={layersOpen} aria-controls="layers-panel" onclick={onToggleLayers}>
        <Layers size={18} strokeWidth={1.75} />
      </IconButton>
    </span>
    <!-- Stub: the menu (Settings, API keys, About) arrives with the settings UI. -->
    <IconButton label="App menu" aria-disabled="true" title="App menu (not available yet)">
      <Menu size={18} strokeWidth={1.75} />
    </IconButton>
    <span class="brand-name">God's Eye View</span>
  </div>

  <SearchBox />

  <div class="island tools">
    <BaseMapPicker />
    <IconButton {label} title={label} onclick={cycleTheme}>
      {#if theme.mode === 'light'}<Sun size={18} strokeWidth={1.75} />{:else if theme.mode === 'dark'}<Moon size={18} strokeWidth={1.75} />{:else}<Monitor size={18} strokeWidth={1.75} />{/if}
    </IconButton>
  </div>
</header>

<style>
  .topbar {
    position: absolute;
    z-index: var(--z-bar);
    top: var(--shell-gutter);
    left: var(--shell-gutter);
    right: var(--shell-gutter);
    height: var(--topbar-h);
    display: grid;
    grid-template-columns: 1fr minmax(0, 440px) 1fr;
    align-items: center;
    gap: var(--space-4);
    pointer-events: none;
  }
  .topbar > :global(*) {
    pointer-events: auto;
  }
  .island {
    display: flex;
    align-items: center;
    height: var(--topbar-h);
    background: var(--surface-bar);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-1);
    backdrop-filter: blur(var(--panel-blur));
  }
  .brand {
    justify-self: start;
    gap: var(--space-2);
    padding: 0 var(--space-4) 0 var(--space-2);
  }
  .brand-name {
    font-weight: var(--weight-semibold);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .tools {
    justify-self: end;
    gap: var(--space-2);
    padding: 0 var(--space-2);
  }
  .only-narrow {
    display: none;
  }
  @media (max-width: 1100px) {
    .brand-name {
      display: none;
    }
    .brand {
      padding-right: var(--space-2);
    }
  }
  @media (max-width: 760px) {
    .topbar {
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: var(--space-3);
    }
    .brand,
    .tools {
      padding: 0 var(--space-1);
    }
    .only-narrow {
      display: contents;
    }
  }
</style>
