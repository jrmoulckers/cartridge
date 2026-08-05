/**
 * The local database — the whole of Cartridge's durable state.
 *
 * Everything the user owns lives here, on their device. There is no server copy: the
 * bridge worker (phase 2) caches public game metadata and nothing else. The app is fully
 * usable with this file and no network at all.
 *
 * Every write stamps `updatedAt`; every delete writes a tombstone rather than dropping the
 * row, so a backup restored on another device can still learn about the deletion.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Entry,
  Game,
  ID,
  Platform,
  PlatformLink,
  PlaytimeObservation,
  Record_,
  SessionStat,
  Shelf,
  Status,
} from '../types';
import { STATUSES, STATUS_LABELS } from '../types';
import { uid, normalizeTitle } from '../util';
import { reportStorageError } from '../stores/storage';

export const DB_NAME = 'cartridge';
export const DB_VERSION = 3;

interface CartridgeDB extends DBSchema {
  games: { key: string; value: Game; indexes: { bySortTitle: string; byIgdbId: number } };
  platformLinks: {
    key: string;
    value: PlatformLink;
    indexes: { byGame: string; byPlatform: string };
  };
  entries: { key: string; value: Entry; indexes: { byGame: string; byStatus: string; byUpdated: number } };
  shelves: { key: string; value: Shelf; indexes: { byOrder: number } };
  sessionStats: { key: string; value: SessionStat; indexes: { byGame: string } };
  meta: { key: string; value: { key: string; value: unknown } };
  /**
   * Platform credentials, one row per platform. Its own store rather than a `meta` key for
   * one reason: **backups must never carry a credential**. A backup is a file people email
   * themselves and drop in cloud storage; a Steam ID is mild, but the OAuth tokens phases
   * 4–6 will put here are not, and the right time to get that boundary right is before
   * there is anything sensitive in it. `getAllForBackup` and `replaceAll` skip this store,
   * so restoring a backup means reconnecting — which is the correct trade.
   */
  credentials: { key: string; value: StoredCredentials };
  /**
   * Append-only playtime history. See {@link PlaytimeObservation} — the store is written on
   * every sync and read by nothing yet, on purpose. It is *not* dead code: it is the only
   * way Cartridge will ever be able to say how many hours a year took, and it can only
   * answer for the window it has been collecting over, so it collects from now.
   *
   * Unlike `credentials`, this **is** carried in a backup. It is the user's own history, and
   * losing it on a device move would throw away exactly the thing that took time to build.
   */
  playtimeObservations: {
    key: string;
    value: PlaytimeObservation;
    indexes: { byLink: [string, string]; byObservedAt: number };
  };
}

let dbp: Promise<IDBPDatabase<CartridgeDB>> | null = null;

/** Strip Svelte `$state` proxies so values are structured-clonable for IndexedDB. */
const raw = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function db(): Promise<IDBPDatabase<CartridgeDB>> {
  if (!dbp) {
    dbp = openDB<CartridgeDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
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
        }
        if (oldVersion < 2) {
          // Phase 3. Additive: an existing v1 database keeps every row it had.
          database.createObjectStore('credentials', { keyPath: 'platform' });
        }
        if (oldVersion < 3) {
          // Additive again — no existing row is touched, read or migrated. The history
          // starts empty and starts today, which is the whole point of landing it early.
          const observations = database.createObjectStore('playtimeObservations', {
            keyPath: 'id',
          });
          // Both indexes are the access patterns a delta calculation needs: one link's
          // readings in order, and every reading in a window. Cheap now, another migration
          // later.
          observations.createIndex('byLink', ['platform', 'externalId']);
          observations.createIndex('byObservedAt', 'observedAt');
        }
      },
      // Another tab holds an older connection open and blocks the upgrade, or the
      // connection was force-closed (storage cleared, corruption). Either way the durable
      // layer isn't reliable — say so rather than fail silently.
      blocked() {
        reportStorageError(
          'Cartridge is open in another tab that is out of date — close it and reload to keep saving.',
        );
      },
      terminated() {
        reportStorageError();
      },
    }).catch((err) => {
      // openDB rejects when IndexedDB is unavailable (some private-browsing modes,
      // disabled storage). Surface it and let a later call retry a fresh open rather
      // than caching the rejected promise.
      reportStorageError();
      dbp = null;
      throw err;
    });
  }
  return dbp;
}

/** Test hook: forget the cached connection so a fresh `openDB` runs next call. */
export function resetConnection(): void {
  dbp = null;
}

function stamp<T extends { createdAt: number; updatedAt: number }>(value: T): T {
  return raw({ ...value, updatedAt: Date.now() });
}

const live = <T extends { deleted?: number }>(rows: T[]): T[] => rows.filter((r) => !r.deleted);

// ── Games ───────────────────────────────────────────────────────────────────

export async function getAllGames(): Promise<Game[]> {
  return live(await (await db()).getAll('games'));
}

export async function getGame(id: ID): Promise<Game | undefined> {
  const game = await (await db()).get('games', id);
  return game && !game.deleted ? game : undefined;
}

/** Find a locally cached game by its IGDB id, so re-adding doesn't duplicate it. */
export async function getGameByIgdbId(igdbId: number): Promise<Game | undefined> {
  const game = await (await db()).getFromIndex('games', 'byIgdbId', igdbId);
  return game && !game.deleted ? game : undefined;
}

export type NewGame = Omit<Game, keyof Record_ | 'sortTitle'> & Partial<Pick<Game, 'id'>>;

export async function putGame(game: Game): Promise<Game> {
  const next = stamp({ ...game, sortTitle: normalizeTitle(game.title) });
  await (await db()).put('games', next);
  return next;
}

export async function createGame(input: NewGame): Promise<Game> {
  const now = Date.now();
  const game: Game = {
    ...input,
    id: input.id ?? uid(),
    sortTitle: normalizeTitle(input.title),
    createdAt: now,
    updatedAt: now,
  };
  await (await db()).put('games', raw(game));
  return game;
}

// ── Entries ─────────────────────────────────────────────────────────────────

export async function getAllEntries(): Promise<Entry[]> {
  return live(await (await db()).getAll('entries'));
}

export async function getEntryForGame(gameId: ID): Promise<Entry | undefined> {
  const rows = await (await db()).getAllFromIndex('entries', 'byGame', gameId);
  return live(rows)[0];
}

export async function putEntry(entry: Entry): Promise<Entry> {
  const next = stamp(entry);
  await (await db()).put('entries', next);
  return next;
}

export async function createEntry(gameId: ID, status: Status): Promise<Entry> {
  const now = Date.now();
  const entry: Entry = {
    id: uid(),
    gameId,
    status,
    shelfIds: [],
    replays: [],
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
  };
  await (await db()).put('entries', raw(entry));
  return entry;
}

// ── Platform links ──────────────────────────────────────────────────────────

export async function getAllLinks(): Promise<PlatformLink[]> {
  return live(await (await db()).getAll('platformLinks'));
}

export async function putLink(link: PlatformLink): Promise<PlatformLink> {
  const next = stamp(link);
  await (await db()).put('platformLinks', next);
  return next;
}

export async function createLink(
  input: Omit<PlatformLink, keyof Record_>,
): Promise<PlatformLink> {
  const now = Date.now();
  const link: PlatformLink = { ...input, id: uid(), createdAt: now, updatedAt: now };
  await (await db()).put('platformLinks', raw(link));
  return link;
}

// ── Session stats ───────────────────────────────────────────────────────────

export async function getAllStats(): Promise<SessionStat[]> {
  return live(await (await db()).getAll('sessionStats'));
}

export async function putStat(stat: SessionStat): Promise<SessionStat> {
  const next = stamp(stat);
  await (await db()).put('sessionStats', next);
  return next;
}

// ── Playtime observations ───────────────────────────────────────────────────

/**
 * Append one reading. There is no update and no delete on purpose: this store only ever
 * grows, and a row in it is a fact about a moment rather than a value that can go stale.
 *
 * A `null` reading is not written — see {@link PlaytimeObservation}. Callers pass what the
 * platform said and this decides, so no caller has to remember the rule.
 *
 * Deliberately quiet on failure. A sync that imported nine hundred games must not be
 * reported as failed because a history row didn't land; the history is valuable but it is
 * never the reason the user pressed the button.
 */
export async function recordObservation(input: {
  platform: Platform;
  externalId: string;
  minutesPlayed: number | null;
  observedAt?: number;
}): Promise<PlaytimeObservation | null> {
  if (input.minutesPlayed == null) return null;
  const row: PlaytimeObservation = {
    id: uid(),
    platform: input.platform,
    externalId: input.externalId,
    minutesPlayed: input.minutesPlayed,
    observedAt: input.observedAt ?? Date.now(),
  };
  try {
    await (await db()).add('playtimeObservations', raw(row));
    return row;
  } catch {
    return null;
  }
}

/** Every reading, oldest first. Exists for tests and for whatever eventually reads this. */
export async function getAllObservations(): Promise<PlaytimeObservation[]> {
  return (await db()).getAllFromIndex('playtimeObservations', 'byObservedAt');
}

/** One platform link's readings, oldest first — the shape a delta calculation wants. */
export async function getObservationsForLink(
  platform: Platform,
  externalId: string,
): Promise<PlaytimeObservation[]> {
  const rows = await (await db()).getAllFromIndex('playtimeObservations', 'byLink', [
    platform,
    externalId,
  ]);
  return rows.sort((a, b) => a.observedAt - b.observedAt);
}

// ── Shelves ─────────────────────────────────────────────────────────────────

export async function getAllShelves(): Promise<Shelf[]> {
  const rows = live(await (await db()).getAll('shelves'));
  return rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export async function putShelf(shelf: Shelf): Promise<Shelf> {
  const next = stamp(shelf);
  await (await db()).put('shelves', next);
  return next;
}

export async function createShelf(name: string, order: number): Promise<Shelf> {
  const now = Date.now();
  const shelf: Shelf = { id: uid(), name, order, createdAt: now, updatedAt: now };
  await (await db()).put('shelves', raw(shelf));
  return shelf;
}

/**
 * Ensure the five built-in shelves exist. Idempotent: run on every boot so a restored
 * backup from an older schema still lands on a complete set.
 */
export async function ensureBuiltinShelves(): Promise<Shelf[]> {
  const existing = await getAllShelves();
  const have = new Set(existing.map((s) => s.builtinStatus).filter(Boolean));
  const now = Date.now();
  const missing: Shelf[] = STATUSES.filter((status) => !have.has(status)).map((status, i) => ({
    id: uid(),
    name: STATUS_LABELS[status],
    order: STATUSES.indexOf(status),
    builtinStatus: status,
    createdAt: now,
    updatedAt: now + i,
  }));
  if (missing.length) {
    const database = await db();
    const tx = database.transaction('shelves', 'readwrite');
    for (const shelf of missing) await tx.store.put(raw(shelf));
    await tx.done;
  }
  return getAllShelves();
}

// ── Deletion ────────────────────────────────────────────────────────────────

/**
 * Tombstone a game and everything hanging off it. Cascading via tombstones (rather than
 * a hard delete) keeps the removal propagatable through a backup/restore round trip.
 */
export async function deleteGame(id: ID): Promise<void> {
  const database = await db();
  const now = Date.now();
  const tx = database.transaction(['games', 'entries', 'platformLinks', 'sessionStats'], 'readwrite');
  const game = await tx.objectStore('games').get(id);
  if (game) await tx.objectStore('games').put(raw({ ...game, deleted: now, updatedAt: now }));
  for (const store of ['entries', 'platformLinks', 'sessionStats'] as const) {
    const rows = await tx.objectStore(store).index('byGame').getAll(id);
    for (const row of rows) {
      await tx.objectStore(store).put(raw({ ...row, deleted: now, updatedAt: now }));
    }
  }
  await tx.done;
}

export async function deleteLink(id: ID): Promise<void> {
  const database = await db();
  const existing = await database.get('platformLinks', id);
  if (!existing) return;
  const now = Date.now();
  await database.put('platformLinks', raw({ ...existing, deleted: now, updatedAt: now }));
}

/** Tombstone a custom shelf. Built-in shelves are never deletable. */
export async function deleteShelf(id: ID): Promise<void> {
  const database = await db();
  const existing = await database.get('shelves', id);
  if (!existing || existing.builtinStatus) return;
  const now = Date.now();
  const tx = database.transaction(['shelves', 'entries'], 'readwrite');
  await tx.objectStore('shelves').put(raw({ ...existing, deleted: now, updatedAt: now }));
  // Drop the shelf id from every entry that referenced it, so no entry points at a ghost.
  for (const entry of await tx.objectStore('entries').getAll()) {
    if (!entry.shelfIds.includes(id)) continue;
    await tx.objectStore('entries').put(
      raw({ ...entry, shelfIds: entry.shelfIds.filter((s) => s !== id), updatedAt: now }),
    );
  }
  await tx.done;
}

// ── Meta (settings and schema bookkeeping) ──────────────────────────────────

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await (await db()).get('meta', key);
  return row ? (row.value as T) : undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', { key, value: raw(value) });
}

// ── Credentials ─────────────────────────────────────────────────────────────

/**
 * One platform's credential as it sits on the device. `values` is whatever that connector
 * needs — for Steam, a single SteamID64.
 *
 * These never leave the device except to the bridge, per request, and they are deliberately
 * excluded from backups. See the store's declaration above.
 */
export interface StoredCredentials {
  platform: Platform;
  values: Record<string, string | number>;
  connectedAt: number;
  /** When a sync last completed against this credential. */
  syncedAt?: number;
}

export async function getCredentials(platform: Platform): Promise<StoredCredentials | undefined> {
  return (await db()).get('credentials', platform);
}

export async function getAllCredentials(): Promise<StoredCredentials[]> {
  return (await db()).getAll('credentials');
}

export async function setCredentials(value: StoredCredentials): Promise<void> {
  await (await db()).put('credentials', raw(value));
}

/** Forget a platform's credential. Nothing else is touched — see `stores/connectors.ts`. */
export async function clearCredentials(platform: Platform): Promise<void> {
  await (await db()).delete('credentials', platform);
}

// ── Platform links, in bulk ─────────────────────────────────────────────────

/**
 * Tombstone every link and stat for one platform — what disconnecting means.
 *
 * Deliberately narrow. Games, entries, ratings, reviews, notes and shelf placement are the
 * user's own work and survive a disconnect untouched; only the platform-sourced rows go.
 * Returns how many rows were affected so the UI can say something true.
 *
 * `playtimeObservations` survives too, and deliberately. A disconnect says "stop syncing
 * this", not "that time never happened" — and a user who reconnects later would otherwise
 * find a hole in their history that nothing can refill.
 */
export async function clearPlatformData(
  platform: Platform,
): Promise<{ links: number; stats: number }> {
  const database = await db();
  const now = Date.now();
  const tx = database.transaction(['platformLinks', 'sessionStats'], 'readwrite');

  const linkStore = tx.objectStore('platformLinks');
  const linkRows = (await linkStore.index('byPlatform').getAll(platform)).filter((l) => !l.deleted);
  for (const link of linkRows) await linkStore.put(raw({ ...link, deleted: now, updatedAt: now }));

  const statStore = tx.objectStore('sessionStats');
  const statRows = (await statStore.getAll()).filter((s) => s.platform === platform && !s.deleted);
  for (const stat of statRows) await statStore.put(raw({ ...stat, deleted: now, updatedAt: now }));

  await tx.done;
  return { links: linkRows.length, stats: statRows.length };
}

// ── Bulk (backup / restore) ─────────────────────────────────────────────────

export interface DbSnapshot {
  games: Game[];
  entries: Entry[];
  platformLinks: PlatformLink[];
  shelves: Shelf[];
  sessionStats: SessionStat[];
  playtimeObservations: PlaytimeObservation[];
  meta: { key: string; value: unknown }[];
}

/**
 * Everything in the database, **tombstones included** — the raw material for a backup.
 * The live getters above hide tombstones; a backup must keep them so deletions survive a
 * restore on another device.
 *
 * `credentials` is deliberately absent, and so it stays: a backup is a file people share,
 * and a platform credential has no business travelling in one. `playtimeObservations` is
 * deliberately *present* for the mirror-image reason — it is history the user built and
 * cannot rebuild, so it has to survive a device move.
 */
export async function getAllForBackup(): Promise<DbSnapshot> {
  const database = await db();
  const [games, entries, platformLinks, shelves, sessionStats, playtimeObservations, meta] =
    await Promise.all([
      database.getAll('games'),
      database.getAll('entries'),
      database.getAll('platformLinks'),
      database.getAll('shelves'),
      database.getAll('sessionStats'),
      database.getAll('playtimeObservations'),
      database.getAll('meta'),
    ]);
  return { games, entries, platformLinks, shelves, sessionStats, playtimeObservations, meta };
}

/** Replace the whole database with a snapshot. Used by restore. */
export async function replaceAll(snapshot: DbSnapshot): Promise<void> {
  const database = await db();
  // `credentials` is not in this list on purpose: a restore must not clear the connection
  // you are sitting in, and no backup can supply one anyway.
  const names = [
    'games',
    'entries',
    'platformLinks',
    'shelves',
    'sessionStats',
    'playtimeObservations',
    'meta',
  ] as const;
  const tx = database.transaction(names, 'readwrite');
  for (const name of names) await tx.objectStore(name).clear();
  for (const game of snapshot.games) await tx.objectStore('games').put(raw(game));
  for (const entry of snapshot.entries) await tx.objectStore('entries').put(raw(entry));
  for (const link of snapshot.platformLinks) await tx.objectStore('platformLinks').put(raw(link));
  for (const shelf of snapshot.shelves) await tx.objectStore('shelves').put(raw(shelf));
  for (const stat of snapshot.sessionStats) await tx.objectStore('sessionStats').put(raw(stat));
  for (const row of snapshot.playtimeObservations) {
    await tx.objectStore('playtimeObservations').put(raw(row));
  }
  for (const row of snapshot.meta) await tx.objectStore('meta').put(raw(row));
  await tx.done;
}
