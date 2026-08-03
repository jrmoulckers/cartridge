/**
 * The bridge client — the only code in the app that makes a network request.
 *
 * Everything here is optional by construction. Each call has a timeout, is abortable, and
 * returns an empty result rather than throwing at the UI. If the bridge is missing,
 * misconfigured, offline or broken, the app degrades to exactly what it was in phase 1:
 * a local library you type into yourself.
 */
import { derived, writable, get } from 'svelte/store';
import { settings } from '../stores/settings';
import type { GameMetadata, SearchResponse } from './types';
import { rememberSearch, recallSearch, rememberGame, recallGame } from './cache';

/** How long any single bridge request may take before it is abandoned. */
const TIMEOUT_MS = 8000;
/** One retry, for the "the worker was cold" case only. */
const RETRIES = 1;

/**
 * The bridge URL: a per-device Settings override beats the build-time default. Empty
 * string means "no bridge", which is a fully supported configuration.
 */
export const bridgeUrl = derived(settings, ($settings) => {
  const configured = $settings.bridgeUrl || import.meta.env.VITE_BRIDGE_URL || '';
  return configured.trim().replace(/\/+$/, '');
});

/** null = not tried yet, true = reachable, false = tried and failed. */
export const bridgeAvailable = writable<boolean | null>(null);

export const bridgeConfigured = derived(bridgeUrl, ($url) => $url.length > 0);

async function request<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const base = get(bridgeUrl);
  if (!base) return null;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    // Abort our request if the caller aborts theirs (a new keystroke, a page change).
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      const response = await fetch(base + path, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
        // The bridge is stateless and anonymous: never send cookies or credentials.
        credentials: 'omit',
        mode: 'cors',
      });
      if (!response.ok) {
        // 4xx is our fault and will not improve on a retry; 5xx might.
        if (response.status < 500) {
          bridgeAvailable.set(true);
          return null;
        }
        throw new Error(`bridge ${response.status}`);
      }
      bridgeAvailable.set(true);
      return (await response.json()) as T;
    } catch {
      if (signal?.aborted) return null;
      if (attempt === RETRIES) {
        bridgeAvailable.set(false);
        return null;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  return null;
}

/**
 * Search the metadata backbone. Returns `[]` for every failure mode — no bridge, no
 * network, a bad response — because from the user's point of view they are the same thing:
 * nothing came back, so type it in yourself.
 */
export async function searchGames(query: string, signal?: AbortSignal): Promise<GameMetadata[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const cached = recallSearch(q);
  if (cached) return cached;

  const data = await request<SearchResponse>(
    `/igdb/search?q=${encodeURIComponent(q)}&limit=12`,
    signal,
  );
  const results = data?.results ?? [];
  if (results.length) rememberSearch(q, results);
  return results;
}

/** Full metadata for one game, or null when it can't be fetched. */
export async function getGame(igdbId: number, signal?: AbortSignal): Promise<GameMetadata | null> {
  const cached = recallGame(igdbId);
  if (cached) return cached;

  const game = await request<GameMetadata>(`/igdb/game/${igdbId}`, signal);
  if (game) rememberGame(game);
  return game;
}

/** Probe the bridge so Settings can report a status. Never throws. */
export async function checkBridge(): Promise<boolean> {
  const base = get(bridgeUrl);
  if (!base) {
    bridgeAvailable.set(null);
    return false;
  }
  const health = await request<{ ok: boolean }>('/health');
  const ok = health?.ok === true;
  bridgeAvailable.set(ok);
  return ok;
}
