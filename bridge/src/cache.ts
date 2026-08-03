/**
 * The KV cache.
 *
 * Everything cached here is public IGDB data or the bridge's own app token. **Nothing
 * user-specific is ever written**: no library, no ratings, no identifiers. The cache keys
 * are the search term and the game id, both of which the user typed and neither of which
 * is tied to a person.
 *
 * IGDB's rate limit is four requests a second for everyone using a given client id, so the
 * cache is not an optimisation — it is what makes the bridge viable at all.
 */
import type { Env } from './types';

/** Search results move (new releases, new covers), so they age out in a day. */
export const SEARCH_TTL_S = 24 * 60 * 60;
/** A specific game barely changes once released. */
export const GAME_TTL_S = 7 * 24 * 60 * 60;

export const searchKey = (query: string) => `search:v1:${query.toLowerCase()}`;
export const gameKey = (igdbId: number) => `game:v1:${igdbId}`;

export async function readCache<T>(env: Env, key: string): Promise<T | null> {
  try {
    return await env.METADATA.get<T>(key, 'json');
  } catch {
    // A cache miss and a cache fault are the same thing to the caller: go upstream.
    return null;
  }
}

export async function writeCache(env: Env, key: string, value: unknown, ttl: number): Promise<void> {
  try {
    await env.METADATA.put(key, JSON.stringify(value), { expirationTtl: ttl });
  } catch {
    // Never fail a request because the cache couldn't be written.
  }
}
