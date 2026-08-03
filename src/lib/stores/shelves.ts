/**
 * Shelves.
 *
 * The five statuses (Playing / Backlog / Played / Wishlist / Abandoned) are seeded as
 * built-in shelves so the UI can list them uniformly, but an entry's status is stored on
 * the entry itself — a game is on exactly one status shelf and any number of custom ones.
 */
import { writable, derived, get } from 'svelte/store';
import type { Entry, ID, Shelf } from '../types';
import * as db from '../storage/db';
import { reportStorageError } from './storage';
import { cleanText } from '../util';
import { updateEntry, refreshLibrary } from './library';

export const shelves = writable<Shelf[]>([]);

export const builtinShelves = derived(shelves, ($shelves) => $shelves.filter((s) => s.builtinStatus));
export const customShelves = derived(shelves, ($shelves) => $shelves.filter((s) => !s.builtinStatus));

export async function refreshShelves(): Promise<void> {
  try {
    shelves.set(await db.ensureBuiltinShelves());
  } catch {
    reportStorageError();
  }
}

/** Whether a custom shelf name is already taken (case-insensitive). */
export function shelfNameExists(name: string, exceptId?: ID): boolean {
  const clean = cleanText(name).toLowerCase();
  if (!clean) return false;
  return get(shelves).some((s) => s.id !== exceptId && s.name.toLowerCase() === clean);
}

export async function createShelf(name: string): Promise<Shelf | undefined> {
  const clean = cleanText(name, 60);
  if (!clean || shelfNameExists(clean)) return undefined;
  try {
    const order = get(shelves).reduce((max, s) => Math.max(max, s.order), 0) + 1;
    const shelf = await db.createShelf(clean, order);
    await refreshShelves();
    return shelf;
  } catch {
    reportStorageError();
    return undefined;
  }
}

export async function renameShelf(shelf: Shelf, name: string): Promise<void> {
  const clean = cleanText(name, 60);
  if (!clean || shelf.builtinStatus || shelfNameExists(clean, shelf.id)) return;
  try {
    await db.putShelf({ ...shelf, name: clean });
    await refreshShelves();
  } catch {
    reportStorageError();
  }
}

/** Remove a custom shelf. Built-ins are never removable. */
export async function removeShelf(shelf: Shelf): Promise<void> {
  if (shelf.builtinStatus) return;
  try {
    await db.deleteShelf(shelf.id);
    await refreshShelves();
    // Entries referencing the shelf were rewritten in the same transaction.
    await refreshLibrary();
  } catch {
    reportStorageError();
  }
}

/** Add or remove one custom shelf from an entry. */
export async function toggleShelf(entry: Entry, shelfId: ID): Promise<void> {
  const on = entry.shelfIds.includes(shelfId);
  const shelfIds = on ? entry.shelfIds.filter((id) => id !== shelfId) : [...entry.shelfIds, shelfId];
  await updateEntry(entry, { shelfIds });
}
