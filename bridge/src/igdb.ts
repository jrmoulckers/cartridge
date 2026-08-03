/**
 * IGDB, normalized.
 *
 * The app never sees an IGDB field name. Everything upstream returns is mapped into
 * {@link GameMetadata} here, which means an IGDB schema change is a bridge deploy rather
 * than an app release — and it means the app can't accidentally grow a dependency on a
 * third party's field naming.
 *
 * Auth is Twitch client-credentials: the bridge exchanges its client id and secret for an
 * app access token, caches that token in KV until shortly before it expires, and never
 * returns it to the client.
 */
import type { Env, GameMetadata, Platform } from './types';
import { bestMatch, matchKey, similarity } from './match';
import {
  readCache,
  writeCache,
  searchKey,
  gameKey,
  steamMatchKey,
  titleMatchKey,
  SEARCH_TTL_S,
  GAME_TTL_S,
  STEAM_MATCH_TTL_S,
  TITLE_MATCH_TTL_S,
} from './cache';

const TOKEN_KEY = 'twitch:token:v1';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_URL = 'https://api.igdb.com/v4';
/** Renew this long before the token actually expires, so no request races the boundary. */
const TOKEN_SAFETY_S = 300;

export class UpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** A Twitch app access token, from KV when possible. Never leaves the worker. */
async function getToken(env: Env): Promise<string> {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    throw new UpstreamError(503, 'The bridge has no IGDB credentials configured.');
  }

  const cached = await readCache<CachedToken>(env, TOKEN_KEY);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  const response = await fetch(TOKEN_URL, { method: 'POST', body });
  if (!response.ok) {
    throw new UpstreamError(502, 'The metadata provider refused the bridge’s credentials.');
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new UpstreamError(502, 'The metadata provider returned no token.');

  const ttl = Math.max(60, (json.expires_in ?? 3600) - TOKEN_SAFETY_S);
  await writeCache(env, TOKEN_KEY, { token: json.access_token, expiresAt: Date.now() + ttl * 1000 }, ttl);
  return json.access_token;
}

/** POST an APIcalypse query to IGDB. */
async function query<T>(env: Env, endpoint: string, body: string): Promise<T[]> {
  const token = await getToken(env);
  const response = await fetch(`${IGDB_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body,
  });

  if (response.status === 429) {
    throw new UpstreamError(429, 'The metadata provider is rate-limiting us. Try again shortly.');
  }
  if (!response.ok) {
    throw new UpstreamError(502, 'The metadata provider returned an error.');
  }
  return (await response.json()) as T[];
}

// ── Normalization ───────────────────────────────────────────────────────────

/** IGDB platform ids we care about, mapped to Cartridge's vocabulary. */
const PLATFORM_BY_ID: Record<number, Platform> = {
  3: 'pc', // Linux
  6: 'pc', // PC (Microsoft Windows)
  14: 'pc', // Mac
  // Xbox family
  11: 'xbox',
  12: 'xbox',
  49: 'xbox',
  169: 'xbox',
  // PlayStation family
  7: 'playstation',
  8: 'playstation',
  9: 'playstation',
  48: 'playstation',
  167: 'playstation',
  // Nintendo family
  4: 'nintendo',
  5: 'nintendo',
  18: 'nintendo',
  19: 'nintendo',
  20: 'nintendo',
  21: 'nintendo',
  22: 'nintendo',
  24: 'nintendo',
  37: 'nintendo',
  41: 'nintendo',
  130: 'nintendo',
  159: 'nintendo',
  508: 'nintendo',
};

/** IGDB's external-game category for Steam. */
const EXTERNAL_STEAM = 1;

interface IgdbImage {
  image_id?: string;
}

interface IgdbCompany {
  developer?: boolean;
  publisher?: boolean;
  company?: { name?: string };
}

interface IgdbGame {
  id: number;
  name?: string;
  summary?: string;
  first_release_date?: number;
  cover?: IgdbImage;
  genres?: { name?: string }[];
  platforms?: { id?: number }[];
  involved_companies?: IgdbCompany[];
  external_games?: { category?: number; uid?: string }[];
}

/** IGDB serves covers from a CDN with a size token in the path. */
const cover = (image: IgdbImage | undefined, size: 'cover_small' | 'cover_big') =>
  image?.image_id ? `https://images.igdb.com/igdb/image/upload/t_${size}/${image.image_id}.jpg` : undefined;

function normalize(game: IgdbGame): GameMetadata {
  const platforms = new Set<Platform>();
  for (const p of game.platforms ?? []) {
    const mapped = p.id != null ? PLATFORM_BY_ID[p.id] : undefined;
    if (mapped) platforms.add(mapped);
  }

  const companies = game.involved_companies ?? [];
  const developer = companies.find((c) => c.developer)?.company?.name;
  const publisher = companies.find((c) => c.publisher)?.company?.name;
  const steam = game.external_games?.find((e) => e.category === EXTERNAL_STEAM)?.uid;

  return {
    igdbId: game.id,
    title: game.name ?? 'Untitled',
    coverUrl: cover(game.cover, 'cover_small'),
    coverUrlLarge: cover(game.cover, 'cover_big'),
    genres: (game.genres ?? []).map((g) => g.name).filter((n): n is string => Boolean(n)),
    platforms: [...platforms],
    // IGDB dates are seconds; Cartridge stores milliseconds everywhere.
    releasedAt: game.first_release_date ? game.first_release_date * 1000 : undefined,
    developer,
    publisher,
    summary: game.summary,
    externalIds: steam ? { steam } : undefined,
  };
}

/** The fields both endpoints request. Kept identical so the cache shapes match. */
const FIELDS =
  'fields id,name,summary,first_release_date,cover.image_id,genres.name,platforms.id,' +
  'involved_companies.developer,involved_companies.publisher,involved_companies.company.name,' +
  'external_games.category,external_games.uid;';

// ── Endpoints ───────────────────────────────────────────────────────────────

export async function searchGames(env: Env, q: string, limit: number): Promise<GameMetadata[]> {
  const key = searchKey(`${q}|${limit}`);
  const cached = await readCache<GameMetadata[]>(env, key);
  if (cached) return cached;

  // `search` is IGDB's relevance search; the category filter drops DLC and bundles, which
  // are almost never what someone means when they type a game's name.
  const body =
    `search "${q.replace(/"/g, '')}"; ${FIELDS} ` +
    `where category = (0,8,9,10,11); limit ${limit};`;

  const results = (await query<IgdbGame>(env, 'games', body)).map(normalize);
  await writeCache(env, key, results, SEARCH_TTL_S);
  return results;
}

export async function getGame(env: Env, igdbId: number): Promise<GameMetadata | null> {
  const key = gameKey(igdbId);
  const cached = await readCache<GameMetadata>(env, key);
  if (cached) return cached;

  const rows = await query<IgdbGame>(env, 'games', `${FIELDS} where id = ${igdbId}; limit 1;`);
  if (!rows.length) return null;

  const game = normalize(rows[0]);
  await writeCache(env, key, game, GAME_TTL_S);
  return game;
}

/**
 * Resolve Steam appids to IGDB games in bulk.
 *
 * IGDB carries Steam's own ids in `external_games`, so this is a lookup rather than a
 * guess — which is exactly what a library import needs. Matching a thousand owned games by
 * title would be a thousand fuzzy comparisons and a handful of confident mistakes; matching
 * them by the id Valve already assigned is neither.
 *
 * Keyed and cached per appid (a public fact about a game, not about a player), so a second
 * sync costs nothing and a shared appid between two users is served from one entry.
 * Unmatched appids are cached as misses too, so the tail is only paid for once.
 */
export async function matchSteamAppids(
  env: Env,
  appids: string[],
): Promise<Record<string, GameMetadata>> {
  const matches: Record<string, GameMetadata> = {};
  const missing: string[] = [];

  for (const appid of appids) {
    const cached = await readCache<{ game: GameMetadata | null }>(env, steamMatchKey(appid));
    if (cached) {
      if (cached.game) matches[appid] = cached.game;
    } else {
      missing.push(appid);
    }
  }

  if (!missing.length) return matches;

  // `external_games` rows carry the appid and a nested game, so one query covers the batch.
  const list = missing.map((id) => `"${id}"`).join(',');
  const rows = await query<{ uid?: string; game?: IgdbGame }>(
    env,
    'external_games',
    `fields uid,game.id,game.name,game.summary,game.first_release_date,game.cover.image_id,` +
      `game.genres.name,game.platforms.id,game.involved_companies.developer,` +
      `game.involved_companies.publisher,game.involved_companies.company.name; ` +
      `where category = ${EXTERNAL_STEAM} & uid = (${list}); limit ${missing.length};`,
  );

  const found = new Set<string>();
  for (const row of rows) {
    if (!row.uid || !row.game?.id) continue;
    const game = normalize(row.game);
    matches[row.uid] = game;
    found.add(row.uid);
    await writeCache(env, steamMatchKey(row.uid), { game }, STEAM_MATCH_TTL_S);
  }

  // Remember the misses too — an appid IGDB doesn't know (a delisted demo, a soundtrack)
  // will not start being known tomorrow, and re-asking every sync is pure waste.
  for (const appid of missing) {
    if (!found.has(appid)) await writeCache(env, steamMatchKey(appid), { game: null }, STEAM_MATCH_TTL_S);
  }

  return matches;
}

/**
 * Resolve plain titles to IGDB games — the fallback for a platform IGDB has no ids for.
 *
 * This is the expensive, fallible cousin of {@link matchSteamAppids} and it exists because
 * Xbox needs it: IGDB carries Steam's appids in `external_games` but not Xbox's title ids, so
 * there is nothing to look *up* and the only thing left is to compare strings. That is a
 * judgement, and judgements about identity are how a games library quietly ends up with a
 * rating attached to the wrong game.
 *
 * So it is built to refuse. A title is resolved only when one candidate clears
 * {@link TITLE_MATCH_THRESHOLD} *and* is clear of the runner-up by
 * {@link TITLE_MATCH_MARGIN} — see `match.ts` for why both halves are needed. Everything else
 * comes back absent, and absent is a perfectly good outcome: the caller keeps the game with
 * the platform's own title and flags it as unidentified.
 *
 * Cost control, because this is one IGDB search per uncached title against a four-per-second
 * shared rate limit:
 *
 * - **Cached per normalised title**, so "Halo Infinite" is resolved once for everybody who
 *   ever asks. Which IGDB game a title refers to is a public fact and reveals nothing about
 *   who wanted to know.
 * - **Misses are cached too**, so an obscure title is paid for once rather than every sync.
 * - **Sequential**, never a fan-out: one user's import must not be able to fire twenty
 *   simultaneous searches and get the bridge throttled for everyone.
 * - **Bounded by the caller**, which caps the batch.
 */
export async function matchTitles(
  env: Env,
  titles: string[],
): Promise<Record<string, GameMetadata>> {
  const matches: Record<string, GameMetadata> = {};
  // Several platform titles can normalise to the same key ("Hades" and "Hades™"). Resolve the
  // key once and hand the answer to every title that shares it.
  const byKey = new Map<string, string[]>();
  for (const title of titles) {
    const key = matchKey(title);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), title]);
  }

  for (const [key, originals] of byKey) {
    const cacheKey = titleMatchKey(key);
    const cached = await readCache<{ game: GameMetadata | null }>(env, cacheKey);
    if (cached) {
      if (cached.game) for (const title of originals) matches[title] = cached.game;
      continue;
    }

    // Search on the normalised key rather than the raw title: "Forza Horizon 5 Premium
    // Edition (PC)" finds nothing, "forza horizon 5" finds the game.
    const rows = await query<IgdbGame>(
      env,
      'games',
      `search "${key}"; ${FIELDS} where category = (0,8,9,10,11); limit 10;`,
    );

    const game = bestMatch(
      rows
        .filter((row) => typeof row.name === 'string' && row.name)
        .map((row) => ({ item: row, score: similarity(key, row.name as string) })),
    );

    const normalized = game ? normalize(game) : null;
    await writeCache(env, cacheKey, { game: normalized }, TITLE_MATCH_TTL_S);
    if (normalized) for (const title of originals) matches[title] = normalized;
  }

  return matches;
}
