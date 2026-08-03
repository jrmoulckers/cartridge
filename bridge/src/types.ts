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
}
