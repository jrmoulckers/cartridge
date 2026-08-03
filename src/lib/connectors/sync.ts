/**
 * Turning a platform's library into a plan.
 *
 * This module is pure. It takes what the user already has, what the platform says they own,
 * and what IGDB thinks those appids are, and returns a description of what *would* change.
 * Nothing here touches IndexedDB, the DOM or the network — which is exactly why the rules
 * that matter most in phase 3 can be proven rather than asserted:
 *
 * 1. **A game already in the library gains a link. It never becomes a duplicate.** This is
 *    the single most important correctness property of a connector. A duplicate splits
 *    someone's rating and review across two rows and there is no good way back.
 * 2. **Sync is idempotent.** Run it twice on unchanged data and the second plan is empty.
 *    Not "harmless" — empty, so the UI can honestly say nothing changed.
 * 3. **User-authored data is untouchable.** Rating, score, review, notes, status, dates,
 *    shelves, tags and favourite belong to the user. A plan cannot express changing them,
 *    which is a stronger guarantee than remembering not to.
 * 4. **Playtime is copied, never invented.** A real `0` (owned, never launched) survives as
 *    `0`; an absent figure stays `null`.
 *
 * Because the plan is a value, it is also what the import screen shows the user *before*
 * anything is written. Reviewing a change and applying it are the same object.
 */
import type {
  Achievements,
  Game,
  ID,
  LibraryItem,
  MatchConfidence,
  Platform,
  Record_,
} from '../types';
import type { GameMetadata } from '../metadata/types';
import type { ConnectorGame } from './types';
import { findByExternalId, matchGame } from '../metadata/match';

// ── The plan ────────────────────────────────────────────────────────────────

/** A game the platform reports that isn't in the library yet. */
export interface PlannedAdd {
  externalId: string;
  /** What the game will be called: IGDB's title when matched, the platform's otherwise. */
  title: string;
  minutesPlayed: number | null;
  lastPlayedAt?: number;
  /** IGDB metadata, when the appid resolved to a game. */
  metadata?: GameMetadata;
  coverUrl?: string;
  /** True when nothing in IGDB matched — the game is still imported, just without covers. */
  unmatched: boolean;
}

/** A game that is already in the library and only needs its platform-sourced rows refreshed. */
export interface PlannedUpdate {
  externalId: string;
  title: string;
  gameId: ID;
  minutesPlayed: number | null;
  lastPlayedAt?: number;
  /** True when this sync will create the link, i.e. an existing game is gaining a platform. */
  newLink: boolean;
  /** How the game was identified, for the review screen and for the stored link. */
  confidence: MatchConfidence;
  /** Minutes the library currently records, for a "+3h" line in the review. */
  previousMinutes: number | null;
}

/** A plan, and the whole vocabulary the applier understands. */
export interface SyncPlan {
  platform: Platform;
  adds: PlannedAdd[];
  updates: PlannedUpdate[];
  /** Rows that already match the library exactly. Counted, never written. */
  unchanged: number;
  /** Adds that IGDB could not identify — surfaced honestly rather than guessed at. */
  unmatchedCount: number;
}

export interface PlanOptions {
  platform: Platform;
  /** IGDB metadata keyed by the platform's external id, where it resolved. */
  metadata?: Record<string, GameMetadata>;
  /** Achievement progress keyed by external id, when a sync fetched any. */
  achievements?: Record<string, Achievements>;
}

/** Nothing to do — the shape an empty plan takes, so callers never special-case null. */
export function emptyPlan(platform: Platform): SyncPlan {
  return { platform, adds: [], updates: [], unchanged: 0, unmatchedCount: 0 };
}

export function planIsEmpty(plan: SyncPlan): boolean {
  return plan.adds.length === 0 && plan.updates.length === 0;
}

// ── Identification ──────────────────────────────────────────────────────────

/**
 * Which library game a platform entry refers to, in order of how much we trust the answer.
 *
 *   1. **An existing link.** Authoritative — the user or a previous sync already decided.
 *   2. **The IGDB id.** Two rows with the same IGDB id are the same game, full stop. This
 *      is what stops a manually added "Hades" from becoming a second "Hades" on import.
 *   3. **A title match**, via the shared matcher and its deliberately high threshold.
 *
 * `null` is a good answer. An unmatched game becomes a new row, which is a small annoyance;
 * a wrong match silently merges two games and corrupts a library.
 */
function identify(
  items: LibraryItem[],
  platform: Platform,
  game: ConnectorGame,
  metadata: GameMetadata | undefined,
): { item: LibraryItem; confidence: MatchConfidence } | null {
  const linked = findByExternalId(items, platform, game.externalId);
  if (linked) return { item: linked, confidence: 'exact' };

  if (metadata) {
    const byIgdb = items.find((i) => i.game.igdbId != null && i.game.igdbId === metadata.igdbId);
    if (byIgdb) return { item: byIgdb, confidence: 'exact' };
  }

  // Match against the IGDB title when we have one — it is the cleaner of the two, and the
  // user's own row was most likely typed to look like it.
  const title = metadata?.title ?? game.title;
  const matched = matchGame(items, { platform, externalId: game.externalId, title });
  return matched ? { item: matched.item, confidence: matched.confidence } : null;
}

// ── Planning ────────────────────────────────────────────────────────────────

/**
 * Compare a platform's library against the user's and describe the difference.
 *
 * Pure, deterministic and total: every reported game lands in exactly one of `adds`,
 * `updates` or `unchanged`.
 */
export function planSync(
  items: LibraryItem[],
  games: ConnectorGame[],
  options: PlanOptions,
): SyncPlan {
  const { platform, metadata = {}, achievements = {} } = options;
  const plan = emptyPlan(platform);

  // A platform can report the same appid twice (Steam occasionally does across free and
  // owned lists). Collapse first, so the plan can never contain two rows for one id.
  const seen = new Set<string>();

  for (const game of games) {
    if (!game.externalId || seen.has(game.externalId)) continue;
    seen.add(game.externalId);

    const meta = metadata[game.externalId];
    const found = identify(items, platform, game, meta);

    if (!found) {
      plan.adds.push({
        externalId: game.externalId,
        title: meta?.title ?? game.title,
        minutesPlayed: game.minutesPlayed,
        lastPlayedAt: game.lastPlayedAt,
        metadata: meta,
        // Prefer IGDB's cover; fall back to the platform's own art rather than nothing.
        coverUrl: meta?.coverUrl ?? game.imageUrl,
        unmatched: !meta,
      });
      if (!meta) plan.unmatchedCount++;
      continue;
    }

    const { item, confidence } = found;
    const link = item.links.find(
      (l) => l.platform === platform && l.externalId === game.externalId,
    );
    const stat = item.stats.find((s) => s.platform === platform);

    const nothingChanged =
      link != null &&
      stat != null &&
      stat.minutesPlayed === game.minutesPlayed &&
      (stat.lastPlayedAt ?? undefined) === (game.lastPlayedAt ?? undefined) &&
      sameAchievements(stat.achievements, achievements[game.externalId]);

    // This is the idempotency guarantee, and it is a comparison rather than a promise: a
    // second sync over unchanged data produces a plan with nothing in it.
    if (nothingChanged) {
      plan.unchanged++;
      continue;
    }

    plan.updates.push({
      externalId: game.externalId,
      title: item.game.title,
      gameId: item.game.id,
      minutesPlayed: game.minutesPlayed,
      lastPlayedAt: game.lastPlayedAt,
      newLink: link == null,
      confidence,
      previousMinutes: stat?.minutesPlayed ?? null,
    });
  }

  return plan;
}

function sameAchievements(a: Achievements | undefined, b: Achievements | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.earned === b.earned && a.total === b.total;
}

// ── Deriving records ────────────────────────────────────────────────────────

/**
 * The `Game` fields a planned add becomes. Split out so the applier stays a thin writer and
 * this stays testable.
 *
 * `source` is `igdb` only when IGDB actually identified the game. An unmatched import is
 * `manual`, which is honest and also means a later metadata refresh will not treat the
 * platform's noisy title as authoritative.
 */
export function gameFieldsFor(
  add: PlannedAdd,
  platform: Platform,
): Omit<Game, keyof Record_ | 'sortTitle'> {
  const meta = add.metadata;
  return {
    igdbId: meta?.igdbId,
    title: add.title,
    coverUrl: meta?.coverUrlLarge ?? add.coverUrl,
    genres: meta?.genres ?? [],
    // A game the user owns on this platform certainly released on it; IGDB's fuller list
    // wins when we have it.
    platforms: meta?.platforms?.length ? meta.platforms : [platform],
    releasedAt: meta?.releasedAt,
    developer: meta?.developer,
    publisher: meta?.publisher,
    summary: meta?.summary,
    source: meta ? 'igdb' : 'manual',
    fetchedAt: meta ? Date.now() : undefined,
  };
}

/** How many games this plan will actually write, for the review screen's headline. */
export function planCounts(plan: SyncPlan): {
  adds: number;
  updates: number;
  newLinks: number;
  unchanged: number;
  unmatched: number;
} {
  return {
    adds: plan.adds.length,
    updates: plan.updates.length,
    newLinks: plan.updates.filter((u) => u.newLink).length,
    unchanged: plan.unchanged,
    unmatched: plan.unmatchedCount,
  };
}
