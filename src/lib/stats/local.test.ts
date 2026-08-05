/**
 * Stats are local, and stay local.
 *
 * `offline.test.ts` owns the app-wide guarantee and is deliberately left untouched by this
 * phase. This is the same guarantee for the stats layer specifically: build a library in
 * IndexedDB, compute the whole stats surface over it, and assert that it all comes out with
 * `fetch` stubbed to reject — no bridge endpoint, no metadata call, nothing to be offline
 * from.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { get } from 'svelte/store';

import { refreshLibrary, addGame, updateEntry, setStatus, library } from '../stores/library';
import { refreshShelves } from '../stores/shelves';
import { computeStats } from './compute';
import { availableYears, yearInReview } from './year';
import { triageBacklog } from './backlog';

const offline = vi.fn(() => Promise.reject(new Error('offline: no network in this test')));

beforeAll(() => vi.stubGlobal('fetch', offline));
afterAll(() => vi.unstubAllGlobals());

describe('statistics with no connectors and no network', () => {
  it('computes the whole stats surface from IndexedDB alone', async () => {
    await refreshShelves();
    await refreshLibrary();

    const hades = await addGame({
      title: 'Hades',
      status: 'playing',
      genres: ['Roguelike', 'Action'],
      releasedAt: Date.UTC(2020, 8, 17),
    });
    await addGame({ title: 'Tunic', status: 'backlog', genres: ['Adventure'] });

    await updateEntry(hades!.entry, { rating: 5, favourite: true, startedAt: Date.UTC(2026, 1, 2) });
    await setStatus(get(library).find((i) => i.game.id === hades!.game.id)!.entry, 'played');

    const items = get(library);
    const stats = computeStats(items);
    expect(stats.total).toBe(2);
    expect(stats.byStatus.played).toBe(1);
    expect(stats.byStatus.backlog).toBe(1);
    expect(stats.ratings.average.value).toBe(5);
    expect(stats.ratings.rated).toBe(1);
    expect(stats.completion.finishRate.value).toBe(1);

    // Nothing reports playtime for a hand-added game, and that is said rather than zeroed.
    expect(stats.playtime.totalMinutes.value).toBeNull();
    expect(stats.playtime.unreported).toBe(2);
    expect(stats.unlinked).toBe(2);

    // The year and the backlog work off the same in-memory library.
    expect(availableYears(items)).toContain(2026);
    const review = yearInReview(items, 2026);
    expect(review.games).toBe(1);
    expect(review.finished).toBe(1);
    expect(triageBacklog(items).unknown).toHaveLength(1);

    expect(offline).not.toHaveBeenCalled();
  });
});
