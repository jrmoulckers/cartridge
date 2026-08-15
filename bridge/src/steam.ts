/**
 * Steam, brokered.
 *
 * Two reasons every Steam call goes through the bridge rather than the browser:
 * the Web API requires a server-side key, and it sends no CORS headers at all. So this
 * module is the whole of Cartridge's Steam integration on the network side.
 *
 * What it holds: `STEAM_API_KEY`. What it stores: nothing about a user. The SteamID arrives
 * as a query parameter, is used for that request, and is gone when the request ends — it is
 * never written to KV, never logged, never turned into an identifier. The only Steam data
 * cached here is {@link getSchema}, a game's public achievement list keyed by appid, which
 * is the same for everybody.
 */
import type { Env, SteamAchievements, SteamGame } from './types';
import { readCache, writeCache, schemaKey, SCHEMA_TTL_S } from './cache';
import { UpstreamError } from './igdb';

const API = 'https://api.steampowered.com';
const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
/** Steam's own OpenID provider endpoint, as it must appear in a valid response. */
const OPENID_OP = 'https://steamcommunity.com/openid/login';
/** A SteamID64 is always seventeen digits. Anything else never reaches upstream. */
const STEAMID = /^\d{17}$/;
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

/** Where a user turns their profile public. Travels with every private-profile error. */
export const PRIVACY_HELP_URL = 'https://steamcommunity.com/my/edit/settings';

export function isSteamId(value: string | null | undefined): value is string {
  return typeof value === 'string' && STEAMID.test(value);
}

// ── OpenID 2.0 ──────────────────────────────────────────────────────────────

/**
 * The URL that starts a sign-in.
 *
 * `returnTo` is *our* `/steam/return`, not the app: Steam must hand the assertion back to
 * the party that can verify it. The app's own URL rides along in the query string and is
 * validated against the CORS allowlist by the caller before we ever get here.
 */
export function loginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    // The "I don't know who this is yet, tell me" identifiers. Steam only does this mode.
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${OPENID_ENDPOINT}?${params}`;
}

export type VerifyResult = { ok: true; steamId: string } | { ok: false; reason: string };

/**
 * Verify an OpenID assertion **with Steam**, not by reading it.
 *
 * This is the security-critical step of the whole phase. Everything in the redirect is
 * attacker-controlled: anyone can point a browser at our `/steam/return` with a
 * `claimed_id` of their choosing. The parameters are only worth anything once Steam has
 * confirmed it signed them, which is what `check_authentication` asks.
 *
 * Four checks, all of which must pass:
 *   1. `openid.mode` is `id_res` — not `cancel`, not an error response.
 *   2. `openid.op_endpoint` is Steam's. Without this, a response signed by *some other*
 *      OpenID provider could be replayed at us and would verify against that provider.
 *   3. `openid.return_to` is exactly the URL we told Steam to return to, so an assertion
 *      minted for a different relying party cannot be replayed here.
 *   4. Steam answers `is_valid:true` to a verbatim echo of the parameters.
 *
 * Only then is the SteamID read out of `claimed_id`, and only via a strict regex.
 */
export async function verifyAssertion(url: URL, expectedReturnTo: string): Promise<VerifyResult> {
  const params = url.searchParams;

  const mode = params.get('openid.mode');
  if (mode === 'cancel') return { ok: false, reason: 'cancelled' };
  if (mode !== 'id_res') return { ok: false, reason: 'bad-response' };

  if (params.get('openid.op_endpoint') !== OPENID_OP) {
    return { ok: false, reason: 'bad-response' };
  }

  // Steam echoes return_to exactly as we sent it, so this is an exact comparison — the
  // only latitude given is a trailing slash, which URL parsing can add on its own.
  const returnTo = params.get('openid.return_to') ?? '';
  if (returnTo.replace(/\/+$/, '') !== expectedReturnTo.replace(/\/+$/, '')) {
    return { ok: false, reason: 'bad-response' };
  }

  const claimed = params.get('openid.claimed_id') ?? '';
  const match = CLAIMED_ID.exec(claimed);
  if (!match) return { ok: false, reason: 'bad-response' };

  // Echo every openid.* parameter back, changing only the mode. Signed fields must be
  // returned byte-for-byte or the signature check fails — so we copy rather than rebuild.
  const body = new URLSearchParams();
  for (const [key, value] of params) {
    if (key.startsWith('openid.')) body.set(key, value);
  }
  body.set('openid.mode', 'check_authentication');

  let text: string;
  try {
    const response = await fetch(OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) return { ok: false, reason: 'unreachable' };
    text = await response.text();
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  // Key–value form: a sequence of `key:value` lines. Only an exact `is_valid:true` counts.
  const valid = text
    .split('\n')
    .map((line) => line.trim())
    .includes('is_valid:true');
  if (!valid) return { ok: false, reason: 'not-verified' };

  return { ok: true, steamId: match[1] };
}

// ── Web API ─────────────────────────────────────────────────────────────────

/**
 * Steam's answer to "who is this and may I look". A private profile returns HTTP 200 with
 * an empty object rather than an error, which is why callers have to interpret emptiness
 * rather than trust a status code.
 */
async function call<T>(env: Env, path: string, params: Record<string, string>): Promise<T> {
  if (!env.STEAM_API_KEY) {
    throw new UpstreamError(503, 'The bridge has no Steam credentials configured.');
  }

  const query = new URLSearchParams({ ...params, key: env.STEAM_API_KEY, format: 'json' });
  let response: Response;
  try {
    response = await fetch(`${API}/${path}?${query}`, { headers: { accept: 'application/json' } });
  } catch {
    throw new UpstreamError(502, 'Steam could not be reached.');
  }

  if (response.status === 429) {
    throw new UpstreamError(429, 'Steam is rate-limiting us. Try again shortly.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new UpstreamError(403, 'Steam refused that request.');
  }
  if (response.status === 404) {
    // Real and meaningful for GetSchemaForGame: the app has no achievements at all.
    throw new UpstreamError(404, 'Steam has nothing for that game.');
  }
  if (!response.ok) {
    throw new UpstreamError(502, 'Steam returned an error.');
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamError(502, 'Steam returned something unreadable.');
  }
}

interface RawOwnedGame {
  appid?: number;
  name?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
  rtime_last_played?: number;
  img_icon_url?: string;
}

/**
 * Steam's own CDN header image. Built from the appid rather than taken from the response,
 * because `img_icon_url` is a 32px icon and the header is what a cover slot wants.
 */
const headerImage = (appid: number) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;

function normalizeGame(raw: RawOwnedGame): SteamGame | null {
  if (raw.appid == null) return null;
  return {
    appid: String(raw.appid),
    title: raw.name?.trim() || `App ${raw.appid}`,
    // Steam always reports playtime, and `0` here is a true zero — owned, never launched.
    // That is a different fact from "this platform doesn't report playtime" (`null`), and
    // the two must not be conflated. See `formatPlaytime` in the app.
    minutesPlayed: typeof raw.playtime_forever === 'number' ? raw.playtime_forever : null,
    // Steam's timestamps are seconds; Cartridge is milliseconds everywhere. A zero means
    // "never played", not 1970.
    lastPlayedAt: raw.rtime_last_played ? raw.rtime_last_played * 1000 : undefined,
    imageUrl: headerImage(raw.appid),
  };
}

/** Everything the account owns, including free games it has actually played. */
export async function getOwnedGames(env: Env, steamId: string): Promise<SteamGame[]> {
  const data = await call<{ response?: { game_count?: number; games?: RawOwnedGame[] } }>(
    env,
    'IPlayerService/GetOwnedGames/v1/',
    {
      steamid: steamId,
      include_appinfo: '1',
      include_played_free_games: '1',
    },
  );

  const body = data.response;
  // `{"response":{}}` is Steam's way of saying "that profile's game details are private".
  // It is a 200, so nothing but the shape tells us. `game_count: 0` is a real, public,
  // empty library and must not be mistaken for it.
  if (!body || (body.games == null && body.game_count == null)) {
    throw new PrivateProfileError();
  }
  return (body.games ?? []).map(normalizeGame).filter((g): g is SteamGame => g !== null);
}

/** The last two weeks. The cheap call a background refresh makes. */
export async function getRecentGames(env: Env, steamId: string): Promise<SteamGame[]> {
  const data = await call<{ response?: { total_count?: number; games?: RawOwnedGame[] } }>(
    env,
    'IPlayerService/GetRecentlyPlayedGames/v1/',
    { steamid: steamId },
  );

  const body = data.response;
  if (!body || (body.games == null && body.total_count == null)) {
    throw new PrivateProfileError();
  }
  return (body.games ?? []).map(normalizeGame).filter((g): g is SteamGame => g !== null);
}

/** A private profile, as a type rather than a string comparison. */
export class PrivateProfileError extends Error {
  readonly helpUrl = PRIVACY_HELP_URL;
  constructor() {
    super('That Steam profile’s game details are private.');
    this.name = 'PrivateProfileError';
  }
}

// ── Achievements ────────────────────────────────────────────────────────────

/**
 * How many achievements a game has, from its public schema. Cached hard: a shipped game's
 * achievement list is one of the most static things Steam knows, and it is identical for
 * every user, so nothing personal is being stored.
 *
 * `null` is cached too. "This game has no achievements" is a fact worth remembering, and
 * without a negative cache every sync re-asks Steam about hundreds of achievement-less
 * games.
 */
async function getSchemaTotal(env: Env, appid: string): Promise<number | null> {
  const key = schemaKey(appid);
  const cached = await readCache<{ total: number | null }>(env, key);
  if (cached) return cached.total;

  let total: number | null;
  try {
    const data = await call<{
      game?: { availableGameStats?: { achievements?: unknown[] } };
    }>(env, 'ISteamUserStats/GetSchemaForGame/v2/', { appid });
    const list = data.game?.availableGameStats?.achievements;
    total = Array.isArray(list) && list.length > 0 ? list.length : null;
  } catch (error) {
    // A 404 or a 403 here means "no schema", which means no achievements. Anything else
    // upstream is still not worth failing a whole sync over — one game's achievement
    // count is the least important thing a sync produces.
    if (error instanceof UpstreamError && error.status >= 500) throw error;
    total = null;
  }

  await writeCache(env, key, { total }, SCHEMA_TTL_S);
  return total;
}

/**
 * Achievement progress for one game.
 *
 * Returns `achievements: null` — not an error — when the game has none, which is the common
 * case and not a failure. A private profile, on the other hand, is a real error the user can
 * act on, so it propagates.
 */
export async function getAchievements(
  env: Env,
  steamId: string,
  appid: string,
): Promise<SteamAchievements> {
  const total = await getSchemaTotal(env, appid);
  if (total == null) return { appid, achievements: null };

  let earned: number;
  try {
    const data = await call<{
      playerstats?: { success?: boolean; error?: string; achievements?: { achieved?: number }[] };
    }>(env, 'ISteamUserStats/GetPlayerAchievements/v1/', { steamid: steamId, appid });

    const stats = data.playerstats;
    if (stats?.success === false) {
      // Steam puts the reason in a prose string. "Profile is not public" is the one worth
      // distinguishing; everything else ("Requested app has no stats") is just no data.
      if (/private|not public/i.test(stats.error ?? '')) throw new PrivateProfileError();
      return { appid, achievements: null };
    }
    earned = (stats?.achievements ?? []).filter((a) => a.achieved === 1).length;
  } catch (error) {
    if (error instanceof PrivateProfileError) throw error;
    if (error instanceof UpstreamError && error.status === 429) throw error;
    // The user simply may not have launched it. Not a failure.
    return { appid, achievements: null };
  }

  return { appid, achievements: { earned, total } };
}
