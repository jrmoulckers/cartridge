/**
 * The four platforms cartridge tracks, and how a library is obtained from each.
 *
 * `ingestion` records the honest status of each platform's API today; it drives what the
 * UI may promise and where credentials have to live. Every non-`manual` path needs a
 * server-held secret, so ingestion is server-side only (see AGENTS.md).
 */
export type Ingestion = 'official-api' | 'unofficial-api' | 'manual';

export interface Platform {
  readonly id: 'steam' | 'xbox' | 'playstation' | 'nintendo';
  readonly label: string;
  readonly ingestion: Ingestion;
}

export const PLATFORMS: readonly Platform[] = [
  { id: 'steam', label: 'Steam', ingestion: 'official-api' },
  { id: 'xbox', label: 'Xbox', ingestion: 'unofficial-api' },
  { id: 'playstation', label: 'PlayStation', ingestion: 'unofficial-api' },
  { id: 'nintendo', label: 'Nintendo', ingestion: 'manual' },
];

/** Platforms whose ingestion depends on a credential that must never reach the browser. */
export function platformsNeedingServerCredentials(): readonly Platform[] {
  return PLATFORMS.filter((platform) => platform.ingestion !== 'manual');
}
