/**
 * The bridge's half of the metadata contract.
 *
 * These types mirror `src/lib/metadata/types.ts` in the app, deliberately and identically.
 * The worker is a separate deployable with its own tsconfig and its own release cadence,
 * so it duplicates the contract rather than importing across that boundary. Keep the two
 * files in step; the contract is small and versioned by the endpoint path.
 */

export interface Env {
  /** Metadata cache. Never holds anything about a user. */
  METADATA: KVNamespace;
  /** Comma-separated exact origins allowed to call this worker. */
  ALLOWED_ORIGINS: string;
  /** Twitch application credentials — IGDB authenticates through Twitch. */
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  /**
   * Steam Web API key. Used per request and never stored alongside anything that
   * identifies a user — see `steam.ts`.
   */
  STEAM_API_KEY: string;
  // There is deliberately no Xbox key here. OpenXBL keys belong to the users who created
  // them: one arrives in the `X-XBL-Key` header per request and is forgotten. See `xbox.ts`.
}

/** Cartridge's platform vocabulary. Must match `Platform` in the app. */
export type Platform = 'steam' | 'xbox' | 'playstation' | 'nintendo' | 'pc' | 'other';

export interface GameMetadata {
  igdbId: number;
  title: string;
  coverUrl?: string;
  coverUrlLarge?: string;
  genres: string[];
  platforms: Platform[];
  releasedAt?: number;
  developer?: string;
  publisher?: string;
  summary?: string;
  externalIds?: { steam?: string };
}

export interface SearchResponse {
  results: GameMetadata[];
}

/** Every failure the bridge returns uses this envelope, whatever went wrong upstream. */
export interface BridgeError {
  error: string;
  message: string;
  /** Where the user can fix it themselves, when that is a real place. */
  helpUrl?: string;
}

// ── Steam ───────────────────────────────────────────────────────────────────

/**
 * One owned game, in Cartridge's vocabulary rather than Steam's. Mirrors
 * `ConnectorGame` in `src/lib/connectors/types.ts`, deliberately and identically.
 */
export interface SteamGame {
  /** The Steam appid, as a string — Cartridge's external ids are always strings. */
  appid: string;
  title: string;
  /**
   * Total minutes played. Steam does report this, so `0` is a true zero (owned, never
   * launched) and is not the same thing as `null` (platform doesn't report playtime).
   */
  minutesPlayed: number | null;
  lastPlayedAt?: number;
  imageUrl?: string;
}

export interface SteamAchievements {
  appid: string;
  /** `null` when the game has no achievements at all — a fact, not a failure. */
  achievements: { earned: number; total: number } | null;
}

export interface SteamLibraryResponse {
  games: SteamGame[];
}

export interface SteamAchievementsResponse {
  results: SteamAchievements[];
}

/** IGDB games resolved from Steam appids, keyed by appid. Unmatched appids are absent. */
export interface SteamMatchResponse {
  matches: Record<string, GameMetadata>;
}

// ── Xbox ────────────────────────────────────────────────────────────────────

/**
 * Who an OpenXBL key belongs to.
 *
 * The gamertag exists so the app can show the user *which* account they just attached — the
 * one thing worth displaying about a connection. The key itself is never echoed back, here or
 * anywhere else.
 */
export interface XboxAccount {
  xuid: string;
  gamertag: string;
  gamerscore?: number;
}

/**
 * One game from an Xbox title history. Mirrors `ConnectorGame` in the app, like `SteamGame`.
 *
 * Two differences from Steam are load-bearing rather than cosmetic:
 *
 * - `minutesPlayed` is almost always `null`, because Xbox reports playtime only for titles
 *   that publish a `MinutesPlayed` statistic. `null` means "not reported" and renders as
 *   exactly that. It is never a `0`.
 * - `achievements` rides along with the library rather than needing a call of its own, which
 *   is what makes a whole Xbox sync affordable on a 150-request hour.
 */
export interface XboxGame {
  /** The Xbox title id, as a string — Cartridge's external ids are always strings. */
  titleId: string;
  title: string;
  minutesPlayed: number | null;
  lastPlayedAt?: number;
  imageUrl?: string;
  /** `null` when the game has no achievements at all — a fact, not an omission. */
  achievements: { earned: number; total: number } | null;
}

export interface XboxAchievements {
  titleId: string;
  /** `null` when the game has no achievements at all. Not a failure. */
  achievements: { earned: number; total: number } | null;
}

export interface XboxLibraryResponse {
  games: XboxGame[];
}

export interface XboxAchievementsResponse {
  results: XboxAchievements[];
}

/** Minutes played keyed by title id. A title with no figure is absent, never `0`. */
export interface XboxPlaytimeResponse {
  minutes: Record<string, number>;
}

// ── Title matching ──────────────────────────────────────────────────────────

/**
 * IGDB games resolved from plain titles, keyed by the title exactly as it was asked for.
 *
 * The fallback for a platform whose ids IGDB does not carry. A title that matched nothing —
 * or matched two things too closely to choose between — is simply absent, which is the
 * caller's cue to leave the game unidentified rather than guess.
 */
export interface TitleMatchResponse {
  matches: Record<string, GameMetadata>;
  /**
   * False when the bridge stopped early — IGDB throttled it, or fell over. Whatever resolved
   * before that point is still here and still correct; the rest is unanswered rather than
   * unmatched.
   */
  complete: boolean;
}
