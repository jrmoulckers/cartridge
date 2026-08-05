/**
 * The playtime observation log.
 *
 * Nothing reads this store yet, which makes it unusually easy to break without noticing:
 * there is no screen that goes blank and no number that goes wrong. These tests are the only
 * thing standing between the log and a silent regression, so they cover the properties that
 * make it worth having at all —
 *
 * - a sync appends a reading, and appends **another** next time rather than overwriting;
 * - a `null` reading appends nothing, because it can never take part in a subtraction;
 * - a real `0` does, because it is a real reading;
 * - readings survive a backup round trip, since they are the one thing a user cannot rebuild;
 * - and the whole thing works with `fetch` rejecting, like everything else here.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import * as db from './db';
import { createBackup, parseBackup, restoreBackup } from './backup';
import { applyPlan } from '../connectors/apply';
import type { SyncPlan } from '../connectors/sync';
import { refreshLibrary, library } from '../stores/library';
import { refreshShelves } from '../stores/shelves';
import { get } from 'svelte/store';

const offline = vi.fn(() => Promise.reject(new Error('offline: no network in this test')));

beforeAll(() => {
  vi.stubGlobal('fetch', offline);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  await db.replaceAll({
    games: [],
    entries: [],
    platformLinks: [],
    shelves: [],
    sessionStats: [],
    playtimeObservations: [],
    meta: [],
  });
  await refreshShelves();
  await refreshLibrary();
});

/** A one-title plan, so a test reads as the fact it is checking rather than as scaffolding. */
function planAdding(externalId: string, title: string, minutesPlayed: number | null): SyncPlan {
  return {
    platform: 'steam',
    adds: [{ externalId, title, minutesPlayed, unmatched: true }],
    updates: [],
    skipped: [],
  } as unknown as SyncPlan;
}

function planUpdating(gameId: string, externalId: string, title: string, minutes: number | null) {
  return {
    platform: 'steam',
    adds: [],
    updates: [
      {
        gameId,
        externalId,
        title,
        minutesPlayed: minutes,
        confidence: 'exact',
        newLink: false,
      },
    ],
    skipped: [],
  } as unknown as SyncPlan;
}

describe('recordObservation', () => {
  it('appends a reading rather than replacing the last one', async () => {
    await db.recordObservation({
      platform: 'steam',
      externalId: '620',
      minutesPlayed: 100,
      observedAt: 1_000,
    });
    await db.recordObservation({
      platform: 'steam',
      externalId: '620',
      minutesPlayed: 340,
      observedAt: 2_000,
    });

    const rows = await db.getObservationsForLink('steam', '620');
    expect(rows.map((r) => r.minutesPlayed)).toEqual([100, 340]);
    // The whole point: the difference between two readings is the playtime in that window,
    // and it only exists because the earlier one was kept.
    expect(rows[1].minutesPlayed - rows[0].minutesPlayed).toBe(240);
  });

  it('writes nothing for a null reading, and something for a real zero', async () => {
    expect(
      await db.recordObservation({ platform: 'playstation', externalId: 'np1', minutesPlayed: null }),
    ).toBeNull();
    expect(
      await db.recordObservation({ platform: 'steam', externalId: '620', minutesPlayed: 0 }),
    ).not.toBeNull();

    const rows = await db.getAllObservations();
    expect(rows).toHaveLength(1);
    expect(rows[0].minutesPlayed).toBe(0);
    expect(rows[0].platform).toBe('steam');
  });

  it('keeps readings apart by platform even when two platforms use the same id', async () => {
    await db.recordObservation({ platform: 'steam', externalId: '1', minutesPlayed: 10 });
    await db.recordObservation({ platform: 'xbox', externalId: '1', minutesPlayed: 20 });

    expect(await db.getObservationsForLink('steam', '1')).toHaveLength(1);
    expect((await db.getObservationsForLink('xbox', '1'))[0].minutesPlayed).toBe(20);
  });

  it('orders a link’s readings oldest first, whatever order they were written in', async () => {
    await db.recordObservation({
      platform: 'steam',
      externalId: '7',
      minutesPlayed: 30,
      observedAt: 3_000,
    });
    await db.recordObservation({
      platform: 'steam',
      externalId: '7',
      minutesPlayed: 10,
      observedAt: 1_000,
    });

    expect((await db.getObservationsForLink('steam', '7')).map((r) => r.observedAt)).toEqual([
      1_000, 3_000,
    ]);
  });
});

describe('a sync', () => {
  it('records a reading when it adds a game', async () => {
    await applyPlan(planAdding('620', 'Portal 2', 600), [], { status: 'backlog' });

    const rows = await db.getObservationsForLink('steam', '620');
    expect(rows).toHaveLength(1);
    expect(rows[0].minutesPlayed).toBe(600);
    expect(rows[0].observedAt).toBeGreaterThan(0);
  });

  it('records a second reading when the same game syncs again', async () => {
    await applyPlan(planAdding('620', 'Portal 2', 600), [], { status: 'backlog' });
    await refreshLibrary();
    const item = get(library).find((i) => i.game.title === 'Portal 2');
    expect(item).toBeDefined();

    await applyPlan(planUpdating(item!.game.id, '620', 'Portal 2', 900), get(library), {
      status: 'backlog',
    });

    const rows = await db.getObservationsForLink('steam', '620');
    expect(rows.map((r) => r.minutesPlayed)).toEqual([600, 900]);

    // The stat itself keeps only the latest — which is exactly why the log has to exist.
    await refreshLibrary();
    const after = get(library).find((i) => i.game.title === 'Portal 2');
    expect(after?.totalMinutes).toBe(900);
  });

  it('records nothing for a platform that reports no playtime', async () => {
    await applyPlan(planAdding('np-1', 'A game with no hours', null), [], { status: 'backlog' });

    expect(await db.getAllObservations()).toHaveLength(0);
    // The game still imported. A missing number is not a failed import.
    await refreshLibrary();
    expect(get(library).map((i) => i.game.title)).toContain('A game with no hours');
  });

  it('remembers a game the platform will later forget', async () => {
    // `lastPlayedAt` erosion, concretely: a platform reports only the *last* session, so a
    // 2026 replay overwrites the evidence that 2025 ever touched this game. The log keeps it.
    await db.recordObservation({
      platform: 'steam',
      externalId: '620',
      minutesPlayed: 100,
      observedAt: Date.UTC(2025, 5, 1),
    });
    await db.recordObservation({
      platform: 'steam',
      externalId: '620',
      minutesPlayed: 260,
      observedAt: Date.UTC(2026, 5, 1),
    });

    const rows = await db.getObservationsForLink('steam', '620');
    expect(rows.map((r) => new Date(r.observedAt).getUTCFullYear())).toEqual([2025, 2026]);
  });
});

describe('a backup', () => {
  it('carries observations there and back', async () => {
    await applyPlan(planAdding('620', 'Portal 2', 600), [], { status: 'backlog' });
    const backup = await createBackup();
    expect(backup.data.playtimeObservations).toHaveLength(1);

    await db.replaceAll({
      games: [],
      entries: [],
      platformLinks: [],
      shelves: [],
      sessionStats: [],
      playtimeObservations: [],
      meta: [],
    });
    expect(await db.getAllObservations()).toHaveLength(0);

    await restoreBackup(backup);
    const rows = await db.getAllObservations();
    expect(rows).toHaveLength(1);
    expect(rows[0].minutesPlayed).toBe(600);
  });

  it('restores a backup written before the store existed', async () => {
    // Every backup taken before DB v3 has no `playtimeObservations` key at all. It must
    // restore normally and simply start its history from empty.
    const old = parseBackup({
      schema: 'cartridge/backup',
      version: 1,
      exportedAt: 1,
      data: {
        games: [{ id: 'g1', title: 'Old', sortTitle: 'old', genres: [], platforms: [] }],
        entries: [{ id: 'e1', gameId: 'g1', status: 'backlog', shelfIds: [], replays: [], tags: [] }],
        platformLinks: [],
        shelves: [{ id: 's1', name: 'Backlog', order: 1 }],
        sessionStats: [],
        meta: [],
      },
    });

    expect(old.data.playtimeObservations).toEqual([]);
    await expect(restoreBackup(old)).resolves.not.toThrow();
    expect(await db.getAllObservations()).toEqual([]);
  });
});

describe('the store’s boundaries', () => {
  it('survives disconnecting a platform', async () => {
    // Disconnecting says "stop syncing this", not "that time never happened".
    await applyPlan(planAdding('620', 'Portal 2', 600), [], { status: 'backlog' });
    await db.clearPlatformData('steam');

    expect(await db.getAllObservations()).toHaveLength(1);
  });

  it('survives deleting the game it was recorded against', async () => {
    // The log is keyed by what the platform said, not by our game id, so rearranging the
    // library cannot invalidate the history underneath it.
    await applyPlan(planAdding('620', 'Portal 2', 600), [], { status: 'backlog' });
    await refreshLibrary();
    const item = get(library).find((i) => i.game.title === 'Portal 2');
    await db.deleteGame(item!.game.id);

    expect(await db.getAllObservations()).toHaveLength(1);
  });

  it('never reached the network to do any of it', () => {
    expect(offline).not.toHaveBeenCalled();
  });
});
