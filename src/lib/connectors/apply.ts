/**
 * Writing a plan to disk.
 *
 * Deliberately thin. Every decision was made in `sync.ts`, where it could be tested without
 * a database; this file's only job is to write what was decided, and to write **nothing
 * else**. Two rules it exists to keep:
 *
 * - It writes `Game`, `PlatformLink` and `SessionStat`, appends a `PlaytimeObservation`, and
 *   creates an `Entry` for a genuinely new game. It never *modifies* an existing `Entry`.
 *   Status, rating, score, review, notes, dates, replays, tags, shelves and favourite are the
 *   user's own work, and nothing a platform says can overwrite them. It does fill *blank*
 *   metadata fields on an existing `Game` — see `GameEnrichment` — but only ones the planner
 *   proved were empty.
 * - It is safe to run twice. Links and stats are matched before being written, so a repeat
 *   apply updates the same rows instead of growing new ones.
 */
import type { Achievements, ID, LibraryItem, Platform, SessionStat, Status } from '../types';
import { PLATFORM_LABELS } from '../types';
import * as db from '../storage/db';
import { uid } from '../util';
import { gameFieldsFor, type PlannedAdd, type PlannedUpdate, type SyncPlan } from './sync';

/** What one title's import actually did — the per-title result the UI lists. */
export interface SyncResultRow {
  externalId: string;
  title: string;
  outcome: 'added' | 'linked' | 'updated' | 'failed';
  /** A short explanation, shown next to the title. */
  detail?: string;
}

export interface ApplyOptions {
  /** Shelf status for newly added games. The UI defaults this to Backlog. */
  status: Status;
  /** Achievement progress keyed by external id, where a sync fetched any. */
  achievements?: Record<string, Achievements>;
  /** Custom shelves to also place new games on. Existing games are never re-shelved. */
  shelfIds?: ID[];
  /** Progress callback, fired per title so a large library shows movement. */
  onProgress?: (done: number, total: number, title: string) => void;
  /** Yield point between titles, so the main thread stays responsive. */
  onYield?: () => Promise<void>;
}

/**
 * Apply a plan.
 *
 * Never rejects for one bad title: a game that fails to write is recorded as `failed` and
 * the rest of the import continues. A connector import that abandons nine hundred games
 * because of one is worse than useless.
 */
export async function applyPlan(
  plan: SyncPlan,
  items: LibraryItem[],
  options: ApplyOptions,
): Promise<SyncResultRow[]> {
  const rows: SyncResultRow[] = [];
  const total = plan.adds.length + plan.updates.length;
  let done = 0;

  const byGameId = new Map<ID, LibraryItem>(items.map((i) => [i.game.id, i] as const));

  for (const add of plan.adds) {
    rows.push(await applyAdd(add, plan.platform, options));
    options.onProgress?.(++done, total, add.title);
    if (options.onYield) await options.onYield();
  }

  for (const update of plan.updates) {
    rows.push(await applyUpdate(update, plan.platform, byGameId.get(update.gameId), options));
    options.onProgress?.(++done, total, update.title);
    if (options.onYield) await options.onYield();
  }

  return rows;
}

async function applyAdd(
  add: PlannedAdd,
  platform: Platform,
  options: ApplyOptions,
): Promise<SyncResultRow> {
  try {
    const game = await db.createGame(gameFieldsFor(add, platform));

    const entry = await db.createEntry(game.id, options.status);
    if (options.shelfIds?.length) {
      await db.putEntry({ ...entry, shelfIds: [...options.shelfIds] });
    }

    await db.createLink({
      gameId: game.id,
      platform,
      externalId: add.externalId,
      externalTitle: add.title,
      // A brand-new row keyed by the platform's own id is as exact as matching gets.
      confidence: 'exact',
    });

    await writeStat(game.id, platform, null, {
      externalId: add.externalId,
      minutesPlayed: add.minutesPlayed,
      lastPlayedAt: add.lastPlayedAt,
      achievements: options.achievements?.[add.externalId],
    });

    return {
      externalId: add.externalId,
      title: add.title,
      outcome: 'added',
      detail: add.unmatched ? 'Added without cover art — no metadata match' : undefined,
    };
  } catch {
    return {
      externalId: add.externalId,
      title: add.title,
      outcome: 'failed',
      detail: 'Couldn’t be saved',
    };
  }
}

async function applyUpdate(
  update: PlannedUpdate,
  platform: Platform,
  item: LibraryItem | undefined,
  options: ApplyOptions,
): Promise<SyncResultRow> {
  try {
    const existingLink = item?.links.find(
      (l) => l.platform === platform && l.externalId === update.externalId,
    );

    if (!existingLink) {
      // The heart of it: an existing game *gains* a link to this platform. Its entry —
      // rating, review, shelf, everything the user wrote — is not read here, let alone
      // written. Phase 4 made this concrete rather than theoretical: a game owned on Steam
      // *and* Xbox arrives here the second time as an update, not an add, and ends up as one
      // row with two links and two stats.
      await db.createLink({
        gameId: update.gameId,
        platform,
        externalId: update.externalId,
        externalTitle: update.title,
        confidence: update.confidence,
      });
    }

    // Filling the blanks on a game that arrived unidentified. Spread order matters and is the
    // whole safety property: the enrichment is a sparse object of gaps the planner already
    // proved were empty, so nothing the user or an earlier sync wrote can be underneath it.
    if (update.enrich && item) {
      await db.putGame({ ...item.game, ...update.enrich });
    }

    const stat = item?.stats.find((s) => s.platform === platform) ?? null;
    await writeStat(update.gameId, platform, stat, {
      externalId: update.externalId,
      minutesPlayed: update.minutesPlayed,
      lastPlayedAt: update.lastPlayedAt,
      achievements: options.achievements?.[update.externalId],
    });

    return {
      externalId: update.externalId,
      title: update.title,
      outcome: update.newLink ? 'linked' : 'updated',
      detail: describeUpdate(update, platform),
    };
  } catch {
    return {
      externalId: update.externalId,
      title: update.title,
      outcome: 'failed',
      detail: 'Couldn’t be saved',
    };
  }
}

/** The one-line explanation next to a title on the results screen. */
function describeUpdate(update: PlannedUpdate, platform: Platform): string | undefined {
  const identified = update.enrich?.igdbId != null;
  if (update.newLink) {
    const linked = `Already in your library — linked to ${PLATFORM_LABELS[platform]}`;
    return identified ? `${linked}, and identified at last` : linked;
  }
  return identified ? 'Identified at last — cover art and details filled in' : undefined;
}

/**
 * Create or refresh the one stat row for this game and platform, and append the reading that
 * produced it to the playtime history.
 *
 * `minutesPlayed` is copied verbatim — a real `0` stays `0`, `null` stays `null`. Existing
 * achievements are kept when a sync didn't fetch any, because "we didn't ask this time" is
 * not the same as "there are none".
 *
 * The observation is appended here, at the single point where playtime enters the database,
 * so there is no path that refreshes a total without also writing down when it was seen.
 * `SessionStat` keeps only the latest reading — it is a snapshot of now, and overwriting it
 * is what loses the history the log exists to keep.
 */
async function writeStat(
  gameId: ID,
  platform: Platform,
  existing: SessionStat | null,
  next: {
    externalId: string;
    minutesPlayed: number | null;
    lastPlayedAt?: number;
    achievements?: Achievements;
  },
): Promise<void> {
  const now = Date.now();
  const base: SessionStat = existing ?? {
    id: uid(),
    gameId,
    platform,
    minutesPlayed: null,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await db.putStat({
    ...base,
    minutesPlayed: next.minutesPlayed,
    lastPlayedAt: next.lastPlayedAt ?? base.lastPlayedAt,
    achievements: next.achievements ?? base.achievements,
    syncedAt: now,
    // A stat tombstoned by a previous disconnect comes back to life rather than
    // accumulating a second row for the same game and platform.
    deleted: undefined,
  });

  // A `null` reading appends nothing — `recordObservation` enforces that, so the rule lives
  // in one place rather than at every call site.
  await db.recordObservation({
    platform,
    externalId: next.externalId,
    minutesPlayed: next.minutesPlayed,
    observedAt: now,
  });
}
