import { writable } from 'svelte/store';

/**
 * A persistent, app-level storage fault. Non-null when IndexedDB can't be opened or
 * written — private-browsing lockout, a corrupt store, an exhausted quota. Surfaced as a
 * banner so a device that can't persist your library says so out loud rather than
 * silently booting to an empty "where did my games go?" state.
 */
export const storageError = writable<string | null>(null);

/** Record a storage fault (first one wins so the message stays stable). */
export function reportStorageError(
  message = "Storage is unavailable on this device — your library can't be saved right now.",
): void {
  storageError.update((current) => current ?? message);
}

/** Clear the storage fault (e.g. after a successful reload or recovery). */
export function clearStorageError(): void {
  storageError.set(null);
}
