/**
 * The metadata contract between the app and the bridge.
 *
 * The app never parses a raw IGDB response. The bridge normalizes everything into the
 * shapes below, which means an upstream field rename is a bridge deploy rather than an app
 * release, and the app has no idea what IGDB's field names even are.
 *
 * These types are duplicated (deliberately, and identically) in `bridge/src/types.ts` —
 * the worker is a separate deployable with its own tsconfig, so a shared import would mean
 * coupling their builds. The contract is small and versioned by the endpoint path.
 */
import type { Platform } from '../types';

/** A game as the metadata backbone describes it. */
export interface GameMetadata {
  igdbId: number;
  title: string;
  /** Small cover, for search results and tiles. */
  coverUrl?: string;
  /** Larger cover, for the game page. */
  coverUrlLarge?: string;
  genres: string[];
  /** Platforms the game released on, mapped to Cartridge's vocabulary. */
  platforms: Platform[];
  /** First release date, ms epoch. */
  releasedAt?: number;
  developer?: string;
  publisher?: string;
  summary?: string;
  /** Ids on other services — `steam` is the appid the Steam connector will match on. */
  externalIds?: { steam?: string };
}

export interface SearchResponse {
  results: GameMetadata[];
}

/** The stable error envelope every bridge failure uses. */
export interface BridgeError {
  error: string;
  message: string;
  /** Where the user can fix it themselves, when that is a real place. */
  helpUrl?: string;
}

// ── Steam ───────────────────────────────────────────────────────────────────

/**
 * One owned game as the bridge reports it. Identical in shape to `ConnectorGame` except
 * for the id's name, because the bridge speaks Steam's vocabulary and the connector speaks
 * Cartridge's.
 */
export interface SteamGame {
  appid: string;
  title: string;
  /**
   * Total minutes played. Steam reports this, so `0` is a true zero — owned, never
   * launched — and is a different fact from `null`.
   */
  minutesPlayed: number | null;
  lastPlayedAt?: number;
  imageUrl?: string;
}

export interface SteamAchievements {
  appid: string;
  /** `null` when the game has no achievements at all. Not a failure. */
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

/** IGDB games resolved from plain titles, keyed by the title asked about. */
export interface TitleMatchResponse {
  matches: Record<string, GameMetadata>;
  /** False when the bridge ran out of IGDB budget partway. Absent on older bridges. */
  complete?: boolean;
}

// ── Xbox ────────────────────────────────────────────────────────────────────
// Mirrors of `bridge/src/types.ts`. The bridge has already shape-checked everything here
// against a third-party proxy over Xbox Live, so by the time it reaches the app it is at
// least the right *shape* — but see `connectors/xbox.ts` for why the connector still
// doesn't take that on faith.

/** Who an OpenXBL key belongs to. The key itself is never echoed back. */
export interface XboxAccount {
  xuid: string;
  gamertag: string;
  gamerscore: number | null;
  avatarUrl?: string;
}

/** One title out of Xbox's title history — what has been *played*, not what is owned. */
export interface XboxGame {
  titleId: string;
  title: string;
  /**
   * Always `null` from this endpoint. Xbox reports minutes separately and only for titles
   * that define the stat, so the library call cannot know — and `null` means "not reported",
   * never "zero". Filled in later, for the titles that have one.
   */
  minutesPlayed: number | null;
  lastPlayedAt?: number;
  imageUrl?: string;
  /** Rides along with the library, so achievements cost no extra request. */
  achievements?: { earned: number; total: number } | null;
}

export interface XboxAchievements {
  titleId: string;
  achievements: { earned: number; total: number } | null;
}

export interface XboxLibraryResponse {
  games: XboxGame[];
}

export interface XboxAchievementsResponse {
  results: XboxAchievements[];
}

/** Minutes played, keyed by title id. A title with no figure is simply absent. */
export interface XboxPlaytimeResponse {
  minutes: Record<string, number>;
}
