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
}
