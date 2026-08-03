/**
 * An in-memory cache for bridge responses.
 *
 * Deliberately *not* persisted: metadata the user actually keeps is written into the
 * `games` store when they add a game, which is what makes covers survive offline. This
 * cache exists only so that backspacing over a search box doesn't re-ask the bridge the
 * same question, and so it dies with the tab.
 */
import type { GameMetadata } from './types';

const SEARCH_TTL_MS = 5 * 60 * 1000;
const GAME_TTL_MS = 30 * 60 * 1000;
/** Bounded so a long session can't grow the cache without limit. */
const MAX_SEARCHES = 40;

interface Entry<T> {
  at: number;
  value: T;
}

const searches = new Map<string, Entry<GameMetadata[]>>();
const gamesById = new Map<number, Entry<GameMetadata>>();

const key = (query: string) => query.trim().toLowerCase();

export function recallSearch(query: string): GameMetadata[] | undefined {
  const hit = searches.get(key(query));
  if (!hit) return undefined;
  if (Date.now() - hit.at > SEARCH_TTL_MS) {
    searches.delete(key(query));
    return undefined;
  }
  return hit.value;
}

export function rememberSearch(query: string, results: GameMetadata[]): void {
  if (searches.size >= MAX_SEARCHES) {
    const oldest = searches.keys().next().value;
    if (oldest !== undefined) searches.delete(oldest);
  }
  searches.set(key(query), { at: Date.now(), value: results });
  for (const game of results) rememberGame(game);
}

export function recallGame(igdbId: number): GameMetadata | undefined {
  const hit = gamesById.get(igdbId);
  if (!hit) return undefined;
  if (Date.now() - hit.at > GAME_TTL_MS) {
    gamesById.delete(igdbId);
    return undefined;
  }
  return hit.value;
}

export function rememberGame(game: GameMetadata): void {
  gamesById.set(game.igdbId, { at: Date.now(), value: game });
}

/** Test hook. */
export function clearMetadataCache(): void {
  searches.clear();
  gamesById.clear();
}
