/**
 * The Xbox connector — the second one, and the one that tests whether the seam generalises.
 *
 * Steam was the friendly case: an official API, a documented contract, and appids that IGDB
 * already carries. Xbox is the honest one, and it differs in four ways that are visible all
 * over this file:
 *
 * 1. **The API is unofficial.** OpenXBL (xbl.io) is a third-party proxy over Xbox Live, so
 *    `capabilities.official` is `false` and the UI says so out loud. The bridge shape-checks
 *    every response and this file checks again, because a proxy over an undocumented service
 *    can change shape on a Tuesday and no one will announce it.
 * 2. **The credential is a key the user made themselves.** Not OAuth — the user creates a free
 *    OpenXBL key with their own Microsoft login, and Cartridge stores it on-device and sends it
 *    to the bridge per request in a header. That is a deliberate choice over shipping an app
 *    key: an app key would make our quota everybody's bottleneck and our compromise everybody's
 *    problem.
 * 3. **Playtime is patchy, and that is not a bug.** Xbox reports minutes only for titles that
 *    define the stat. Every other game is `null` — "not reported" — and must never be dressed
 *    up as `0`, which on Steam means the true and different thing "owned, never launched".
 * 4. **The budget is 150 requests an hour.** So a whole sync is three calls: the account, the
 *    title history (which carries achievements and last-played inline), and one batched
 *    playtime call. `fetchAchievements` exists for refreshing a single game and is capped hard.
 *
 * One more thing worth stating plainly, because it changes what the numbers mean: Xbox's title
 * history is **what has been played, not what is owned.** A game bought and never launched is
 * simply absent. Cartridge cannot invent it, and pretending otherwise would be the same class
 * of lie as a fabricated `0`.
 */
import { ConnectorError, type Connector, type Credentials, type FetchOptions, type Page } from './types';
import type { ConnectorAchievements, ConnectorGame } from './types';
import type {
  XboxAccount,
  XboxAchievementsResponse,
  XboxGame,
  XboxLibraryResponse,
  XboxPlaytimeResponse,
} from '../metadata/types';
import { bridgeRequest, bridgeBase, type BridgeFailure } from '../metadata/igdb';

/** Where a user creates their own free OpenXBL key. Linked from every auth failure. */
export const OPENXBL_KEY_URL = 'https://xbl.io/';

/** An XUID is a decimal Xbox user id. */
const XUID = /^\d{6,20}$/;

/**
 * OpenXBL issues UUID-shaped keys. Checked loosely — enough to catch a pasted email address
 * or a truncated copy before it costs a round-trip, not so tight that a change to their key
 * format bricks the connector.
 */
const API_KEY = /^[A-Za-z0-9-]{16,80}$/;

/** The bridge caps a playtime batch at 200 title ids. */
export const PLAYTIME_BATCH = 200;

/** The bridge caps an achievements batch at ten, because each one is an upstream call. */
export const ACHIEVEMENT_BATCH = 10;

export interface XboxCredentials extends Credentials {
  /** The user's own OpenXBL key. Never rendered, never logged, never put in a URL. */
  apiKey: string;
  xuid: string;
  /** Kept so Settings can show *who* is connected without ever showing the key. */
  gamertag?: string;
}

export function isOpenXblKey(value: unknown): value is string {
  return typeof value === 'string' && API_KEY.test(value.trim());
}

export function isXuid(value: unknown): value is string {
  return typeof value === 'string' && XUID.test(value);
}

/** Pull usable credentials apart, or explain why they aren't. */
function credentialsFrom(credentials: Credentials | undefined): { apiKey: string; xuid: string } {
  const apiKey = credentials?.apiKey;
  const xuid = credentials?.xuid;
  if (!isOpenXblKey(apiKey) || !isXuid(xuid)) {
    throw new ConnectorError('xbox', 'auth', 'Connect your Xbox account first.');
  }
  return { apiKey: apiKey.trim(), xuid };
}

/** The key goes in a header, so it never lands in a URL, a log line or a history entry. */
function keyHeader(apiKey: string): Record<string, string> {
  return { 'X-XBL-Key': apiKey };
}

/**
 * Map a bridge failure onto the one error type connectors are allowed to throw.
 *
 * Note what is *missing* compared with Steam: there is no `private` case. Xbox privacy shows
 * up as an empty or partial title history rather than a refusal, so there is no honest link to
 * point at. Inventing one would be worse than saying nothing.
 */
function toConnectorError(failure: BridgeFailure): ConnectorError {
  if (failure.error === 'xbox-auth' || failure.status === 401) {
    return new ConnectorError(
      'xbox',
      'auth',
      'OpenXBL rejected that API key. Create a new one and paste it in again.',
      { helpUrl: failure.helpUrl ?? OPENXBL_KEY_URL },
    );
  }
  if (failure.status === 429) {
    return new ConnectorError(
      'xbox',
      'rate-limit',
      'OpenXBL’s free tier is out of requests for now. Everything already synced is kept.',
      { retryAfterMs: failure.retryAfterMs ?? 15 * 60_000 },
    );
  }
  if (failure.error === 'no-bridge') {
    return new ConnectorError('xbox', 'unsupported', failure.message);
  }
  if (failure.status === 0) {
    return new ConnectorError('xbox', 'network', failure.message);
  }
  if (failure.status === 400) {
    return new ConnectorError('xbox', 'auth', 'That Xbox connection no longer looks valid.', {
      helpUrl: OPENXBL_KEY_URL,
    });
  }
  if (failure.status === 502 || failure.status === 503) {
    return new ConnectorError(
      'xbox',
      'unsupported',
      'Xbox Live isn’t answering through OpenXBL right now. Everything else still works.',
    );
  }
  return new ConnectorError('xbox', 'unknown', failure.message);
}

/**
 * OpenXBL's shape → Cartridge's. Defensive twice over, on purpose.
 *
 * The bridge has already checked this, and this checks it again, because the cost of being
 * wrong is asymmetric: a dropped row is one missing game the user can add by hand, and a
 * trusted bad row is a `NaN` in someone's stats or a title of `undefined` in their library.
 */
function toConnectorGame(game: XboxGame): ConnectorGame | null {
  if (!game || typeof game.titleId !== 'string' || !/^\d+$/.test(game.titleId)) return null;

  const title =
    typeof game.title === 'string' && game.title.trim() ? game.title.trim() : `Title ${game.titleId}`;

  const converted: ConnectorGame = {
    externalId: game.titleId,
    title,
    // `null` unless Xbox actually reported a number. Never a stand-in zero — on Xbox an
    // absent figure means "this title doesn't report minutes", which is not the same fact as
    // "you have never played it".
    minutesPlayed: typeof game.minutesPlayed === 'number' && Number.isFinite(game.minutesPlayed)
      ? game.minutesPlayed
      : null,
  };

  if (typeof game.lastPlayedAt === 'number' && game.lastPlayedAt > 0) {
    converted.lastPlayedAt = game.lastPlayedAt;
  }
  if (typeof game.imageUrl === 'string' && game.imageUrl) {
    converted.imageUrl = game.imageUrl;
  }

  // Achievements ride along with the library. A game with none reports `null`, which is an
  // answer rather than an omission, and a 0/0 is dropped so it can't render as progress.
  const earned = game.achievements?.earned;
  const total = game.achievements?.total;
  if (typeof earned === 'number' && typeof total === 'number' && total > 0) {
    converted.achievements = { earned, total };
  }

  return converted;
}

/**
 * Who a key belongs to.
 *
 * This is the connect step. It is separate from {@link Connector.authenticate} because
 * authenticate cannot ask for a key — the user types it into Settings, and this turns it into
 * the XUID and gamertag everything else needs.
 */
export async function fetchAccount(apiKey: string, signal?: AbortSignal): Promise<XboxAccount> {
  if (!isOpenXblKey(apiKey)) {
    throw new ConnectorError('xbox', 'auth', 'That doesn’t look like an OpenXBL API key.', {
      helpUrl: OPENXBL_KEY_URL,
    });
  }
  const result = await bridgeRequest<XboxAccount>(
    '/xbox/account',
    signal,
    keyHeader(apiKey.trim()),
  );
  if (!result.ok) throw toConnectorError(result.failure);

  const account = result.value;
  if (!account || !isXuid(account.xuid)) {
    throw new ConnectorError('xbox', 'unsupported', 'OpenXBL sent back something unreadable.');
  }
  return {
    xuid: account.xuid,
    gamertag: typeof account.gamertag === 'string' && account.gamertag ? account.gamertag : 'Xbox',
    gamerscore: typeof account.gamerscore === 'number' ? account.gamerscore : null,
    avatarUrl: typeof account.avatarUrl === 'string' ? account.avatarUrl : undefined,
  };
}

/**
 * Fill in minutes played for the titles that report any.
 *
 * Best-effort by design. This is a second upstream call on a tight budget, and a library with
 * last-played dates and achievements but no minutes is still a good library — so a failure
 * here leaves every `minutesPlayed` at `null` and the sync carries on. Losing a whole import
 * over an optional statistic would be the wrong trade.
 */
async function withPlaytime(
  games: ConnectorGame[],
  apiKey: string,
  xuid: string,
  signal?: AbortSignal,
): Promise<ConnectorGame[]> {
  const ids = games.map((g) => g.externalId).slice(0, PLAYTIME_BATCH);
  if (!ids.length) return games;

  const result = await bridgeRequest<XboxPlaytimeResponse>(
    `/xbox/playtime?xuid=${xuid}&titleids=${ids.join(',')}`,
    signal,
    keyHeader(apiKey),
  );
  if (!result.ok) return games;

  const minutes = result.value?.minutes;
  if (!minutes || typeof minutes !== 'object') return games;

  return games.map((game) => {
    const value = minutes[game.externalId];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? { ...game, minutesPlayed: value }
      : game;
  });
}

async function fetchGames(options: FetchOptions): Promise<Page<ConnectorGame>> {
  const { apiKey, xuid } = credentialsFrom(options.credentials);

  const result = await bridgeRequest<XboxLibraryResponse>(
    `/xbox/library?xuid=${xuid}`,
    options.signal,
    keyHeader(apiKey),
  );
  if (!result.ok) throw toConnectorError(result.failure);

  const games = result.value?.games;
  if (!Array.isArray(games)) {
    throw new ConnectorError('xbox', 'unsupported', 'OpenXBL sent back something unreadable.');
  }

  const items = games.map(toConnectorGame).filter((g): g is ConnectorGame => g !== null);
  // No cursor: title history arrives whole, like Steam's library.
  return { items: await withPlaytime(items, apiKey, xuid, options.signal) };
}

export const xboxConnector: Connector = {
  platform: 'xbox',
  label: 'Xbox',

  /**
   * Reported honestly, including the parts that aren't flattering. `official: false` is the
   * important one — a user deciding whether to paste a third-party API key deserves to know
   * that this path is not blessed by Microsoft and can break without warning.
   */
  capabilities: {
    playtime: true,
    playtimeCoverage: 'partial',
    achievements: true,
    lastPlayed: true,
    official: false,
    requiresBridge: true,
  },

  /**
   * There is no redirect to start and no token to refresh: the credential is a key the user
   * pasted, and it either still works or it doesn't. So this validates what we hold and, if
   * the shape is right, asks OpenXBL whether it is still accepted.
   *
   * Per the interface contract, an ordinary refusal is a returned status, not a throw. A key
   * that has been revoked is an ordinary refusal.
   */
  async authenticate(existing) {
    if (!bridgeBase()) {
      return { status: 'error', message: 'Add a bridge URL in Settings before connecting Xbox.' };
    }
    if (!isOpenXblKey(existing?.apiKey)) {
      return { status: 'disconnected', message: 'Paste an OpenXBL API key to connect Xbox.' };
    }

    try {
      const account = await fetchAccount(existing.apiKey as string);
      return {
        status: 'connected',
        credentials: { ...existing, xuid: account.xuid, gamertag: account.gamertag },
      };
    } catch (error) {
      if (error instanceof ConnectorError && error.kind === 'auth') {
        return { status: 'expired', message: error.message };
      }
      // A network blip or an OpenXBL outage is not a reason to tell someone their key is bad
      // and send them off to make another one.
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Xbox could not be reached.',
      };
    }
  },

  fetchLibrary(options) {
    return fetchGames(options);
  },

  /**
   * Xbox has no cheaper "recent" endpoint — title history is the only list there is, and it
   * already carries `lastTimePlayed`. Returning the same data is the interface's documented
   * answer for a platform with no recent concept, and it costs no extra requests.
   */
  fetchRecent(options) {
    return fetchGames(options);
  },

  /**
   * Achievements for a bounded set of titles.
   *
   * Rarely needed: `fetchLibrary` already returns counts inline, which is the whole reason
   * {@link ConnectorGame.achievements} exists. This is for refreshing one game on its own
   * page, and it is capped at {@link ACHIEVEMENT_BATCH} because every id is one call against
   * the user's hourly quota.
   */
  async fetchAchievements(options): Promise<Page<ConnectorAchievements>> {
    const { apiKey, xuid } = credentialsFrom(options.credentials);
    const ids = [
      ...new Set([...(options.externalIds ?? []), ...(options.externalId ? [options.externalId] : [])]),
    ]
      .filter((id) => /^\d+$/.test(id))
      .slice(0, ACHIEVEMENT_BATCH);
    if (!ids.length) return { items: [] };

    const result = await bridgeRequest<XboxAchievementsResponse>(
      `/xbox/achievements?xuid=${xuid}&titleids=${ids.join(',')}`,
      options.signal,
      keyHeader(apiKey),
    );
    if (!result.ok) throw toConnectorError(result.failure);

    const rows = result.value?.results;
    if (!Array.isArray(rows)) {
      throw new ConnectorError('xbox', 'unsupported', 'OpenXBL sent back something unreadable.');
    }

    const items: ConnectorAchievements[] = [];
    for (const row of rows) {
      if (!row?.titleId || !row.achievements) continue;
      const { earned, total } = row.achievements;
      if (typeof earned !== 'number' || typeof total !== 'number' || total <= 0) continue;
      items.push({ externalId: row.titleId, achievements: { earned, total } });
    }
    return { items };
  },

  /**
   * Nothing to revoke from here. The key is the user's own and lives in their xbl.io account;
   * Cartridge forgetting its copy is the whole of disconnecting, and anyone who wants it dead
   * everywhere can delete it at the source. Saying so is better than pretending to revoke.
   */
  async disconnect() {
    /* no remote state to clean up */
  },
};
