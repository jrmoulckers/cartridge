/**
 * The v2 → v3 migration.
 *
 * An additive migration that quietly dropped a row would be the worst kind of bug in a
 * local-first app: there is no server copy to restore from, and the user would find out
 * months later. So this opens a database shaped exactly like a real v2 one, puts real rows in
 * it, and then lets the app upgrade it — the only way to check the upgrade path that every
 * existing install will actually take.
 *
 * It lives in its own file because it has to control the database's whole lifecycle, from
 * before Cartridge has ever opened it.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';

import * as db from './db';

/** A database as phase 3 left it: v2, with every store v2 had and none it didn't. */
async function createV2Database(): Promise<void> {
  const old = await openDB(db.DB_NAME, 2, {
    upgrade(database) {
      const games = database.createObjectStore('games', { keyPath: 'id' });
      games.createIndex('bySortTitle', 'sortTitle');
      games.createIndex('byIgdbId', 'igdbId');

      const links = database.createObjectStore('platformLinks', { keyPath: 'id' });
      links.createIndex('byGame', 'gameId');
      links.createIndex('byPlatform', 'platform');

      const entries = database.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('byGame', 'gameId');
      entries.createIndex('byStatus', 'status');
      entries.createIndex('byUpdated', 'updatedAt');

      const shelves = database.createObjectStore('shelves', { keyPath: 'id' });
      shelves.createIndex('byOrder', 'order');

      const stats = database.createObjectStore('sessionStats', { keyPath: 'id' });
      stats.createIndex('byGame', 'gameId');

      database.createObjectStore('meta', { keyPath: 'key' });
      database.createObjectStore('credentials', { keyPath: 'platform' });
    },
  });

  const now = Date.now();
  await old.put('games', {
    id: 'g1',
    title: 'Portal 2',
    sortTitle: 'portal 2',
    genres: ['Puzzle'],
    platforms: ['steam'],
    source: 'igdb',
    createdAt: now,
    updatedAt: now,
  });
  await old.put('entries', {
    id: 'e1',
    gameId: 'g1',
    status: 'played',
    shelfIds: [],
    replays: [],
    tags: [],
    favourite: false,
    rating: 5,
    review: 'Still perfect.',
    createdAt: now,
    updatedAt: now,
  });
  await old.put('sessionStats', {
    id: 'st1',
    gameId: 'g1',
    platform: 'steam',
    minutesPlayed: 600,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  old.close();
}

describe('upgrading a v2 database to v3', () => {
  it('adds the store without touching a single existing row', async () => {
    await createV2Database();
    // Cartridge has never opened this database in this process — exactly the state a user's
    // browser is in the first time they load the new version.
    db.resetConnection();

    const games = await db.getAllGames();
    expect(games.map((g) => g.title)).toEqual(['Portal 2']);

    const entries = await db.getAllEntries();
    expect(entries).toHaveLength(1);
    // The user's own work is what an upgrade must never cost them.
    expect(entries[0]!.rating).toBe(5);
    expect(entries[0]!.review).toBe('Still perfect.');

    const stats = await db.getAllStats();
    expect(stats[0]!.minutesPlayed).toBe(600);

    // And the new store exists, empty, ready to start collecting.
    expect(await db.getAllObservations()).toEqual([]);

    const written = await db.recordObservation({
      platform: 'steam',
      externalId: '620',
      minutesPlayed: 600,
    });
    expect(written).not.toBeNull();
    expect(await db.getObservationsForLink('steam', '620')).toHaveLength(1);
  });
});
