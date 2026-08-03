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
