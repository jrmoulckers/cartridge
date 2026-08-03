/**
 * Device settings: appearance and the optional bridge override.
 *
 * Stored in `localStorage`, not IndexedDB — they describe *this device*, not the library,
 * so they deliberately do not travel in a backup.
 */
import { writable, get } from 'svelte/store';

export type Theme = 'dark' | 'dark-oled' | 'light' | 'high-contrast';
export type ViewMode = 'grid' | 'list';

export interface Settings {
  theme: Theme;
  view: ViewMode;
  /** Per-device bridge URL override, beating the build-time `VITE_BRIDGE_URL`. */
  bridgeUrl: string;
}

const KEY = 'cartridge:settings';

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', view: 'grid', bridgeUrl: '' };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // A corrupt or inaccessible localStorage must not stop the app booting.
    return { ...DEFAULT_SETTINGS };
  }
}

export const settings = writable<Settings>(load());

settings.subscribe((value) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* Private browsing can refuse writes; appearance simply won't persist. */
  }
});

/** Push the current theme onto <html>, which is what the token themes key off. */
export function applySettings(): void {
  const { theme } = get(settings);
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme): void {
  settings.update((s) => ({ ...s, theme }));
  applySettings();
}

export function setView(view: ViewMode): void {
  settings.update((s) => ({ ...s, view }));
}

export function setBridgeUrl(bridgeUrl: string): void {
  settings.update((s) => ({ ...s, bridgeUrl: bridgeUrl.trim().replace(/\/+$/, '') }));
}
