/**
 * Cartridge domain types.
 *
 * Every persisted record carries `id`, `createdAt`, `updatedAt` and an optional
 * `deleted` tombstone — the per-entity last-writer-wins shape `score-king` uses. Nothing
 * in phases 1–2 merges yet, but backups already round-trip tombstones so a future sync
 * layer drops in without a migration.
 */

export type ID = string;

/** Base fields shared by every store record. */
export interface Record_ {
  id: ID;
  createdAt: number;
  updatedAt: number;
  /** Soft-delete timestamp. Live getters hide these; backups keep them. */
  deleted?: number;
}

// ── Platforms ───────────────────────────────────────────────────────────────

export const PLATFORMS = ['steam', 'xbox', 'playstation', 'nintendo', 'pc', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  steam: 'Steam',
  xbox: 'Xbox',
  playstation: 'PlayStation',
  nintendo: 'Nintendo',
  pc: 'PC (other)',
  other: 'Other',
};

// ── Game — canonical metadata ───────────────────────────────────────────────

/** Where a game record's metadata came from. Manual records are never overwritten
 *  by a metadata refresh without the user asking. */
export type MetadataSource = 'manual' | 'igdb';

export interface Game extends Record_ {
  /** IGDB id when this game has been matched to the metadata backbone. */
  igdbId?: number;
  title: string;
  /** Lower-cased, article-stripped title used for sorting and search. */
  sortTitle: string;
  /** Remote cover URL (IGDB or user-supplied). */
  coverUrl?: string;
  /** Cover bytes cached on-device as a data URL, so covers survive going offline. */
  coverData?: string;
  genres: string[];
  /** Platforms this game released on (metadata, not ownership). */
  platforms: Platform[];
  /** First release date, ms epoch. */
  releasedAt?: number;
  developer?: string;
  publisher?: string;
  summary?: string;
  source: MetadataSource;
  /** When metadata was last fetched from the bridge. */
  fetchedAt?: number;
}

// ── Platform link — the matching problem ────────────────────────────────────

/** How confident we are that a platform id refers to this game. */
export type MatchConfidence = 'exact' | 'matched' | 'manual';

export interface PlatformLink extends Record_ {
  gameId: ID;
  platform: Platform;
  /** Steam appid / Xbox titleId / PSN npCommunicationId / Nintendo title id. */
  externalId: string;
  /** Title as the platform reports it — kept for re-matching and for display when
   *  no IGDB metadata exists. */
  externalTitle?: string;
  confidence: MatchConfidence;
}

// ── Entry — the user's relationship to a game ───────────────────────────────

export const STATUSES = ['playing', 'backlog', 'played', 'wishlist', 'abandoned'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  playing: 'Playing',
  backlog: 'Backlog',
  played: 'Played',
  wishlist: 'Wishlist',
  abandoned: 'Abandoned',
};

/** One playthrough. The first is implied by the entry's own dates; extra rows are replays. */
export interface Replay {
  startedAt?: number;
  finishedAt?: number;
  note?: string;
}

export interface Entry extends Record_ {
  gameId: ID;
  status: Status;
  /** Custom shelves this entry also sits on. The five statuses above are not shelves. */
  shelfIds: ID[];
  /** 0.5–5 in half steps. Undefined means unrated — never zero. */
  rating?: number;
  /** Optional 1–100 precision score, independent of the star rating. */
  score?: number;
  /** Markdown, shown publicly in an export. */
  review?: string;
  /** Markdown, private working notes. */
  notes?: string;
  startedAt?: number;
  finishedAt?: number;
  replays: Replay[];
  tags: string[];
  favourite: boolean;
}

// ── Shelf ───────────────────────────────────────────────────────────────────

export interface Shelf extends Record_ {
  name: string;
  order: number;
  /** Built-in shelves map 1:1 to a status and cannot be renamed or removed. */
  builtinStatus?: Status;
}

// ── Session stats — synced, never user-authored ─────────────────────────────

export interface Achievements {
  earned: number;
  total: number;
}

export interface SessionStat extends Record_ {
  gameId: ID;
  platform: Platform;
  /**
   * Total minutes played on this platform, or `null` when the platform does not
   * report playtime at all (PlayStation). `null` and `0` mean different things and the
   * UI must not conflate them.
   */
  minutesPlayed: number | null;
  lastPlayedAt?: number;
  achievements?: Achievements;
  /** When a connector last refreshed this row. */
  syncedAt: number;
}

// ── Playtime observations — append-only history ─────────────────────────────

/**
 * One reading of what a platform said about playtime, at a moment in time.
 *
 * Steam and Xbox report a **lifetime** total, never a window, which is why phase 7's year in
 * review refuses to claim hours-played-in-a-year. The difference between two readings *is*
 * that number — so this store exists purely to make sure the readings are there to subtract
 * later. Nothing reads it yet, and that is deliberate: the value is a function of how early
 * it starts, not of how soon it is displayed.
 *
 * Two shape decisions worth keeping:
 *
 * - It does **not** extend `Record_`. There is no `updatedAt` and no tombstone because a
 *   row is never updated or deleted — an observation is a fact about the past, and editing
 *   it would be rewriting history rather than correcting it.
 * - It is keyed by `platform` + `externalId`, not by `gameId`. It records what the *platform*
 *   said, so it survives a game being merged, deleted, re-linked or re-matched. The library
 *   model can be rearranged freely without invalidating the history underneath it.
 */
export interface PlaytimeObservation {
  id: ID;
  platform: Platform;
  /** The platform's own id — Steam appid, Xbox titleId, and so on. */
  externalId: string;
  /**
   * Lifetime minutes as reported at `observedAt`. Never `null`: a reading with no number in
   * it can never take part in a subtraction, so it is not written at all. A real `0` is,
   * because "owned, launched never" is a genuine reading.
   */
  minutesPlayed: number;
  /** When the sync that produced this reading ran. */
  observedAt: number;
}

// ── Joined view ─────────────────────────────────────────────────────────────

/** A game plus everything the user knows about it — what the library UI renders. */
export interface LibraryItem {
  game: Game;
  entry: Entry;
  links: PlatformLink[];
  stats: SessionStat[];
  /** Summed playtime across platforms that report it, or `null` when none do. */
  totalMinutes: number | null;
}
