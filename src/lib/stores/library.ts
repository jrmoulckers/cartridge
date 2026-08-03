/**
 * The library store — the single place components read and write the user's games.
 *
 * Loads the whole database into memory on boot and keeps it there. A personal library is
 * small, and holding it in memory is what makes search instant and keeps every screen
 * working with no network. Writes go to IndexedDB first, then refresh the store.
 */
import { writable, derived, get } from 'svelte/store';
import type {
  Entry,
  Game,
  ID,
  LibraryItem,
  MetadataSource,
  Platform,
  PlatformLink,
  SessionStat,
  Status,
} from '../types';
import * as db from '../storage/db';
import { reportStorageError } from './storage';
import { normalizeTitle } from '../util';

export const games = writable<Game[]>([]);
export const entries = writable<Entry[]>([]);
export const links = writable<PlatformLink[]>([]);
export const stats = writable<SessionStat[]>([]);
/** False until the first load resolves, so the UI can tell "empty" from "not loaded". */
export const libraryLoaded = writable(false);

/** Summed playtime across platforms that report it. `null` when none do. */
function totalMinutes(rows: SessionStat[]): number | null {
  const reported = rows.filter((r) => r.minutesPlayed != null);
  if (!reported.length) return null;
  return reported.reduce((sum, r) => sum + (r.minutesPlayed ?? 0), 0);
}

/**
 * Games joined with the user's relationship to them. A game with no entry is not in the
 * library yet (it is only cached metadata) and is deliberately excluded.
 */
export const library = derived([games, entries, links, stats], ([$games, $entries, $links, $stats]) => {
  const byGame = new Map<ID, Game>($games.map((g) => [g.id, g] as const));
  const linksByGame = groupBy($links, (l) => l.gameId);
  const statsByGame = groupBy($stats, (s) => s.gameId);

  const items: LibraryItem[] = [];
  for (const entry of $entries) {
    const game = byGame.get(entry.gameId);
    if (!game) continue;
    const gameStats = statsByGame.get(entry.gameId) ?? [];
    items.push({
      game,
      entry,
      links: linksByGame.get(entry.gameId) ?? [],
      stats: gameStats,
      totalMinutes: totalMinutes(gameStats),
    });
  }
  return items;
});

/** Count per status — the shelf tab badges. */
export const statusCounts = derived(library, ($library) => {
  const counts = new Map<Status, number>();
  for (const item of $library) {
    counts.set(item.entry.status, (counts.get(item.entry.status) ?? 0) + 1);
  }
  return counts;
});

function groupBy<T>(rows: T[], key: (row: T) => ID): Map<ID, T[]> {
  const map = new Map<ID, T[]>();
  for (const row of rows) {
    const k = key(row);
    const existing = map.get(k);
    if (existing) existing.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Reload everything from IndexedDB. Safe to call as often as you like. */
export async function refreshLibrary(): Promise<void> {
  try {
    const [g, e, l, s] = await Promise.all([
      db.getAllGames(),
      db.getAllEntries(),
      db.getAllLinks(),
      db.getAllStats(),
    ]);
    games.set(g);
    entries.set(e);
    links.set(l);
    stats.set(s);
  } catch {
    reportStorageError();
  } finally {
    libraryLoaded.set(true);
  }
}

export function findItem(gameId: ID): LibraryItem | undefined {
  return get(library).find((item) => item.game.id === gameId);
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface NewGameInput {
  title: string;
  status: Status;
  platforms?: Platform[];
  genres?: string[];
  releasedAt?: number;
  developer?: string;
  publisher?: string;
  summary?: string;
  coverUrl?: string;
  coverData?: string;
  igdbId?: number;
  source?: MetadataSource;
}

/**
 * Add a game and the entry that puts it on a shelf. Manual entry is the primary path and
 * must never require the bridge — metadata fields are all optional.
 */
export async function addGame(input: NewGameInput): Promise<LibraryItem | undefined> {
  try {
    const game = await db.createGame({
      title: input.title,
      genres: input.genres ?? [],
      platforms: input.platforms ?? [],
      releasedAt: input.releasedAt,
      developer: input.developer,
      publisher: input.publisher,
      summary: input.summary,
      coverUrl: input.coverUrl,
      coverData: input.coverData,
      igdbId: input.igdbId,
      source: input.source ?? 'manual',
      fetchedAt: input.igdbId ? Date.now() : undefined,
    });
    await db.createEntry(game.id, input.status);
    await refreshLibrary();
    return findItem(game.id);
  } catch {
    reportStorageError();
    return undefined;
  }
}

/** Patch a game's metadata. */
export async function updateGame(game: Game, patch: Partial<Game>): Promise<void> {
  try {
    const next = { ...game, ...patch };
    if (patch.title) next.sortTitle = normalizeTitle(patch.title);
    await db.putGame(next);
    await refreshLibrary();
  } catch {
    reportStorageError();
  }
}

/** Patch the user's entry — status, rating, review, dates, tags, shelves. */
export async function updateEntry(entry: Entry, patch: Partial<Entry>): Promise<void> {
  try {
    await db.putEntry({ ...entry, ...patch });
    await refreshLibrary();
  } catch {
    reportStorageError();
  }
}

/**
 * Move an entry to a status. Finishing a game with no finish date recorded stamps today,
 * because "I finished it" and "I finished it at some point" are the same intent.
 */
export async function setStatus(entry: Entry, status: Status): Promise<void> {
  const patch: Partial<Entry> = { status };
  if (status === 'played' && entry.finishedAt == null) patch.finishedAt = Date.now();
  if (status === 'playing' && entry.startedAt == null) patch.startedAt = Date.now();
  await updateEntry(entry, patch);
}

export async function toggleFavourite(entry: Entry): Promise<void> {
  await updateEntry(entry, { favourite: !entry.favourite });
}

export async function removeGame(gameId: ID): Promise<void> {
  try {
    await db.deleteGame(gameId);
    await refreshLibrary();
  } catch {
    reportStorageError();
  }
}

export async function addLink(
  gameId: ID,
  platform: Platform,
  externalId: string,
  externalTitle?: string,
): Promise<void> {
  try {
    await db.createLink({ gameId, platform, externalId, externalTitle, confidence: 'manual' });
    await refreshLibrary();
  } catch {
    reportStorageError();
  }
}

export async function removeLink(id: ID): Promise<void> {
  try {
    await db.deleteLink(id);
    await refreshLibrary();
  } catch {
    reportStorageError();
  }
}
