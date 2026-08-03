/**
 * The KV cache.
 *
 * Everything cached here is public IGDB data or the bridge's own app token. **Nothing
 * user-specific is ever written**: no library, no ratings, no identifiers. The cache keys
 * are the search term and the game id, both of which the user typed and neither of which
 * is tied to a person.
 *
 * Phase 3 added Steam and did not weaken that. A Steam appid's achievement schema and its
 * IGDB match are public facts about a *game*, identical for every player, so they cache.
 * A user's owned-games list, playtime and achievement progress do not — there is no cache
 * key anywhere in this worker that contains a SteamID.
 *
 * IGDB's rate limit is four requests a second for everyone using a given client id, so the
 * cache is not an optimisation — it is what makes the bridge viable at all.
 */
import type { Env } from './types';

/** Search results move (new releases, new covers), so they age out in a day. */
export const SEARCH_TTL_S = 24 * 60 * 60;
/** A specific game barely changes once released. */
export const GAME_TTL_S = 7 * 24 * 60 * 60;
/**
 * A shipped game's achievement list is about the most static thing Steam knows, and it is
 * identical for every player — so it caches for a month.
 */
export const SCHEMA_TTL_S = 30 * 24 * 60 * 60;
/** Which IGDB game a Steam appid is stays true for as long as both exist. */
export const STEAM_MATCH_TTL_S = 30 * 24 * 60 * 60;
/**
 * Which IGDB game a *title* is stays true too — but this one is a judgement rather than a
 * lookup, so it ages out sooner. IGDB gains games; a title that matched nothing today may
 * match tomorrow, and a week is short enough to pick that up without re-asking constantly.
 */
export const TITLE_MATCH_TTL_S = 7 * 24 * 60 * 60;

export const searchKey = (query: string) => `search:v1:${query.toLowerCase()}`;
export const gameKey = (igdbId: number) => `game:v1:${igdbId}`;
/** Keyed by appid — public, identical for every user, and never by SteamID. */
export const schemaKey = (appid: string) => `steam:schema:v1:${appid}`;
export const steamMatchKey = (appid: string) => `steam:igdb:v1:${appid}`;
/**
 * Keyed by the *normalised* title, so "Halo Infinite", "HALO INFINITE" and "Halo Infinite
 * (PC)" are one entry. Public and identical for every user: which IGDB game a title refers to
 * says nothing about who asked. No platform, no account, no id belonging to a person.
 */
export const titleMatchKey = (normalized: string) => `title:igdb:v1:${normalized}`;

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
