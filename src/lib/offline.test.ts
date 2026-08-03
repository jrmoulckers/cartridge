/**
 * The offline guarantee, as a test.
 *
 * Cartridge's first non-negotiable is that the app is completely usable with zero platform
 * accounts connected and no network at all. This test enforces it: `fetch` is replaced with
 * a function that always rejects, and the full local journey — add a game, shelve it, rate
 * it, review it, search for it, back it up and restore it — has to succeed anyway.
 *
 * If a change makes any of this reach for the network, this test fails.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { get } from 'svelte/store';

import { library, refreshLibrary, addGame, updateEntry, setStatus } from './stores/library';
import { shelves, refreshShelves, createShelf, toggleShelf } from './stores/shelves';
import { storageError } from './stores/storage';
import { searchLibrary } from './library/search';
import { createBackup, parseBackup, restoreBackup, countBackup } from './storage/backup';
import { renderMarkdown } from './markdown';

const offline = vi.fn(() => Promise.reject(new Error('offline: no network in this test')));

beforeAll(() => {
  vi.stubGlobal('fetch', offline);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('the app with no connectors and no network', () => {
  it('completes the whole local journey without touching the network', async () => {
    await refreshShelves();
    await refreshLibrary();

    // The five built-in shelves exist on a first run.
    expect(get(shelves).filter((s) => s.builtinStatus).map((s) => s.builtinStatus)).toEqual([
      'playing',
      'backlog',
      'played',
      'wishlist',
      'abandoned',
    ]);

    // Manual entry: no metadata lookup, no bridge, no account.
    const added = await addGame({
      title: 'Outer Wilds',
      status: 'playing',
      genres: ['Adventure'],
      platforms: ['xbox'],
      developer: 'Mobius Digital',
    });
    expect(added).toBeDefined();

    // A custom shelf, and the game placed on it.
    const shelf = await createShelf('Comfort games');
    expect(shelf).toBeDefined();
    await toggleShelf(added!.entry, shelf!.id);

    // Rating (half stars + the optional precision score) and a Markdown review.
    const current = get(library).find((i) => i.game.id === added!.game.id)!;
    await updateEntry(current.entry, {
      rating: 4.5,
      score: 92,
      review: '**Best** ending in games. See [notes](https://example.test/x).',
      notes: 'Third loop: check the quantum moon.',
      startedAt: Date.UTC(2026, 0, 2),
    });

    // Finishing stamps a finish date.
    const rated = get(library)[0];
    await setStatus(rated.entry, 'played');

    const item = get(library)[0];
    expect(item.entry.rating).toBe(4.5);
    expect(item.entry.score).toBe(92);
    expect(item.entry.status).toBe('played');
    expect(item.entry.finishedAt).toBeTypeOf('number');
    expect(item.entry.shelfIds).toContain(shelf!.id);

    // Reviews render locally.
    expect(renderMarkdown(item.entry.review!)).toContain('<strong>Best</strong>');

    // Search and filter work over the in-memory library.
    expect(searchLibrary(get(library), { query: 'outer' })).toHaveLength(1);
    expect(searchLibrary(get(library), { query: '', status: 'played' })).toHaveLength(1);
    expect(searchLibrary(get(library), { query: '', status: 'wishlist' })).toHaveLength(0);

    // Backup and restore round-trip, still offline.
    const backup = await createBackup();
    expect(countBackup(backup).games).toBe(1);

    const roundTripped = parseBackup(JSON.parse(JSON.stringify(backup)));
    await restoreBackup(roundTripped);
    await refreshLibrary();
    await refreshShelves();

    const restored = get(library)[0];
    expect(restored.game.title).toBe('Outer Wilds');
    expect(restored.entry.rating).toBe(4.5);
    expect(restored.entry.review).toContain('Best');

    // Nothing above may have reached for the network, and storage stayed healthy.
    expect(offline).not.toHaveBeenCalled();
    expect(get(storageError)).toBeNull();
  });
});
