import { readStored, writeStored } from '../lib/storage.ts';

export type ThemeMode = 'system' | 'light' | 'dark';
const KEY = 'gev.v2.theme';
const ORDER: ThemeMode[] = ['system', 'light', 'dark'];

function load(): ThemeMode {
  const v = readStored(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function apply(mode: ThemeMode) {
  const root = document.documentElement;
  // 'system' means no attribute, so tokens.css follows prefers-color-scheme.
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
}

export const theme = $state<{ mode: ThemeMode }>({ mode: load() });

export function setTheme(mode: ThemeMode) {
  theme.mode = mode;
  apply(mode);
  writeStored(KEY, mode);
}

export function cycleTheme() {
  const next = ORDER[(ORDER.indexOf(theme.mode) + 1) % ORDER.length] ?? 'system';
  setTheme(next);
}

apply(theme.mode);
