/**
 * Settings loading, with one thing actually worth asserting: `advanced`.
 *
 * The flag decides whether a whole half of the app is visible, and it has to be off for
 * someone new without hiding a setup an existing user already completed. Both directions are
 * checked here because getting either wrong looks like data loss.
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const KEY = 'cartridge:settings';

/** Each case needs a fresh module instance, since the store reads storage at import time. */
async function loadStore(stored?: string) {
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem(KEY, stored);
  vi.resetModules();
  const mod = await import('./settings');
  return get(mod.settings);
}

describe('settings', () => {
  // The very first transform of the module graph is slow enough to trip the default
  // per-test timeout; pay for it once, outside a case, rather than making every case wait.
  beforeAll(async () => {
    await import('./settings');
  }, 30_000);

  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with the optional online half turned off', async () => {
    const settings = await loadStore();
    expect(settings.advanced).toBe(false);
    expect(settings.bridgeUrl).toBe('');
  });

  it('leaves it off for a device that saved settings before the flag existed', async () => {
    const settings = await loadStore(JSON.stringify({ theme: 'light', view: 'list' }));
    expect(settings.advanced).toBe(false);
    expect(settings.theme).toBe('light');
  });

  it('turns it on for a device that had already configured a bridge', async () => {
    // That user opted in the only way there was at the time. Hiding their working bridge
    // behind a switch they have never seen would read as the app having lost it.
    const settings = await loadStore(JSON.stringify({ bridgeUrl: 'https://bridge.example' }));
    expect(settings.advanced).toBe(true);
  });

  it('honours an explicit choice over the bridge inference', async () => {
    const settings = await loadStore(
      JSON.stringify({ bridgeUrl: 'https://bridge.example', advanced: false }),
    );
    expect(settings.advanced).toBe(false);
  });

  it('falls back to defaults when storage holds nonsense', async () => {
    const settings = await loadStore('not json');
    expect(settings.advanced).toBe(false);
    expect(settings.theme).toBe('dark');
  });
});
