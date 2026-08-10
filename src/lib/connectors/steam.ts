/**
 * The Steam connector — the first real one, and the proof that the seam holds.
 *
 * Steam is the only one of Cartridge's four platforms with a documented, official API, so
 * it gets the easiest job and the highest standard: if the connector interface is wrong,
 * it is wrong here first, where there is no reverse-engineering to blame.
 *
 * Everything goes through the bridge. The Steam Web API needs a server-side key and sends
 * no CORS headers, so a browser cannot call it at all — which is also why the credential
 * this connector stores is nothing but a SteamID64. Cartridge never sees a Steam password,
 * and the SteamID travels to the bridge per request and is stored nowhere else.
 *
 * Three Steam-specific facts this file is careful about:
 *
 * 1. **`0` minutes is real.** Steam reports playtime, and an owned-but-never-launched game
 *    genuinely has zero. That is a different statement from `null` ("this platform doesn't
 *    report playtime"), and conflating them would put a fake `0h` in someone's stats.
 * 2. **A game with no achievements is not a failure.** Most games have none; the bridge
 *    answers `achievements: null` and the sync records nothing rather than an error.
 * 3. **A private profile is its own outcome.** Not `auth` — the credential is fine and
 *    reconnecting will not help. It gets `kind: 'private'` and a link to the exact setting.
 */
import {
  ConnectorError,
  type Connector,
  type Credentials,
  type FetchOptions,
  type Page,
} from './types';
import type { ConnectorAchievements, ConnectorGame } from './types';
import type { SteamAchievementsResponse, SteamGame, SteamLibraryResponse } from '../metadata/types';
import { bridgeRequest, bridgeBase, type BridgeFailure } from '../metadata/igdb';

/** A SteamID64 is always seventeen digits. */
const STEAMID = /^\d{17}$/;

/** Where a user makes their game details public, linked from every private-profile error. */
export const STEAM_PRIVACY_URL = 'https://steamcommunity.com/my/edit/settings';

/** The bridge caps an achievements batch at twenty appids; ask for exactly that. */
export const ACHIEVEMENT_BATCH = 20;

export interface SteamCredentials extends Credentials {
  steamId: string;
}

export function isSteamId(value: unknown): value is string {
  return typeof value === 'string' && STEAMID.test(value);
}

/** Pull a usable SteamID out of stored credentials, or explain why there isn't one. */
function steamIdFrom(credentials: Credentials | undefined): string {
  const value = credentials?.steamId;
  if (!isSteamId(value)) {
    throw new ConnectorError('steam', 'auth', 'Connect your Steam account first.');
  }
  return value;
}

/**
 * Map a bridge failure onto the one error type connectors are allowed to throw.
 *
 * The point of doing this here rather than in the UI is that the rest of the app never
 * learns what an HTTP status is, let alone what Steam's idea of one means.
 */
function toConnectorError(failure: BridgeFailure): ConnectorError {
  if (failure.error === 'steam-private' || failure.status === 403) {
    return new ConnectorError(
      'steam',
      'private',
      'Steam is hiding this account’s game details, so Cartridge can’t read your library.',
      { helpUrl: failure.helpUrl ?? STEAM_PRIVACY_URL },
    );
  }
  if (failure.status === 429) {
    return new ConnectorError('steam', 'rate-limit', 'Steam asked us to slow down.', {
      retryAfterMs: failure.retryAfterMs ?? 60_000,
    });
  }
  if (failure.error === 'no-bridge') {
    return new ConnectorError('steam', 'unsupported', failure.message);
  }
  if (failure.status === 0) {
    return new ConnectorError('steam', 'network', failure.message);
  }
  if (failure.status === 400) {
    return new ConnectorError('steam', 'auth', 'That Steam account no longer looks valid.');
  }
  if (failure.status === 503) {
    return new ConnectorError(
      'steam',
      'unsupported',
      'This bridge has no Steam key configured, so Steam is unavailable.',
    );
  }
  return new ConnectorError('steam', 'unknown', failure.message);
}

/** Steam's own shape → Cartridge's. Defensive: a bridge is still a network boundary. */
function toConnectorGame(game: SteamGame): ConnectorGame | null {
  if (!game || typeof game.appid !== 'string' || !game.appid) return null;
  return {
    externalId: game.appid,
    title:
      typeof game.title === 'string' && game.title.trim() ? game.title.trim() : `App ${game.appid}`,
    // Preserved exactly, including a real `0`. Anything non-numeric becomes `null` rather
    // than a made-up number.
    minutesPlayed: typeof game.minutesPlayed === 'number' ? game.minutesPlayed : null,
    lastPlayedAt:
      typeof game.lastPlayedAt === 'number' && game.lastPlayedAt > 0
        ? game.lastPlayedAt
        : undefined,
    imageUrl: typeof game.imageUrl === 'string' ? game.imageUrl : undefined,
  };
}

async function fetchGames(path: string, options: FetchOptions): Promise<Page<ConnectorGame>> {
  const steamId = steamIdFrom(options.credentials);
  const result = await bridgeRequest<SteamLibraryResponse>(
    `${path}?steamid=${steamId}`,
    options.signal,
  );
  if (!result.ok) throw toConnectorError(result.failure);

  const games = result.value?.games;
  if (!Array.isArray(games)) {
    throw new ConnectorError('steam', 'unsupported', 'Steam sent back something unreadable.');
  }
  // No cursor: Steam returns an entire library in one response, however large. The
  // interface still allows paging, so a future platform that needs it is not blocked.
  return { items: games.map(toConnectorGame).filter((g): g is ConnectorGame => g !== null) };
}

export const steamConnector: Connector = {
  platform: 'steam',
  label: 'Steam',

  // Reported honestly. Steam does all three, and it is the only official API of the four.
  capabilities: {
    playtime: true,
    achievements: true,
    lastPlayed: true,
    official: true,
    requiresBridge: true,
  },

  /**
   * Steam sign-in is a full-page redirect through the bridge, so there is nothing to do
   * here but confirm that what we already hold is usable. The redirect is started by
   * `steam-auth.ts` and lands back on Settings; this method exists so the registry's
   * "re-authenticate on an auth failure" path has something honest to call.
   *
   * Per the interface contract, an ordinary refusal is a returned status, not a throw.
   */
  async authenticate(existing) {
    if (!bridgeBase()) {
      return {
        status: 'error',
        message: 'Add a bridge URL in Settings before connecting Steam.',
      };
    }
    if (isSteamId(existing?.steamId)) {
      return { status: 'connected', credentials: existing };
    }
    return { status: 'disconnected', message: 'Sign in through Steam to connect.' };
  },

  fetchLibrary(options) {
    return fetchGames('/steam/library', options);
  },

  fetchRecent(options) {
    return fetchGames('/steam/recent', options);
  },

  /**
   * Achievements for the games asked about, and only those.
   *
   * Steam is strictly one HTTP call per appid upstream, which is why the interface gained
   * `externalIds` in phase 3 and why "everything" is not on the menu. Given neither id,
   * this returns an empty page rather than quietly fetching a thousand games.
   */
  async fetchAchievements(options): Promise<Page<ConnectorAchievements>> {
    const steamId = steamIdFrom(options.credentials);
    const ids = [
      ...new Set([
        ...(options.externalIds ?? []),
        ...(options.externalId ? [options.externalId] : []),
      ]),
    ]
      .filter((id) => /^\d+$/.test(id))
      .slice(0, ACHIEVEMENT_BATCH);
    if (!ids.length) return { items: [] };

    const result = await bridgeRequest<SteamAchievementsResponse>(
      `/steam/achievements?steamid=${steamId}&appids=${ids.join(',')}`,
      options.signal,
    );
    if (!result.ok) throw toConnectorError(result.failure);

    const rows = result.value?.results;
    if (!Array.isArray(rows)) {
      throw new ConnectorError('steam', 'unsupported', 'Steam sent back something unreadable.');
    }

    const items: ConnectorAchievements[] = [];
    for (const row of rows) {
      // `achievements: null` means the game has none. That is an answer, not an omission,
      // and it is right to drop it rather than record a 0/0 that would render as progress.
      if (!row?.appid || !row.achievements) continue;
      const { earned, total } = row.achievements;
      if (typeof earned !== 'number' || typeof total !== 'number' || total <= 0) continue;
      items.push({ externalId: row.appid, achievements: { earned, total } });
    }
    return { items };
  },

  /**
   * Nothing to revoke. Steam OpenID issues no token: the "credential" is a public account
   * number, and forgetting it locally is the whole of disconnecting. The credential row and
   * the platform links are removed by `stores/connectors.ts`.
   */
  async disconnect() {
    /* no remote state to clean up */
  },
};
