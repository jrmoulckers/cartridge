/**
 * Attributing games to a year, and the year-in-review figures.
 *
 * ## What counts as "this year"
 *
 * A game is **in year Y** when it carries at least one dated fact that falls in Y, read in
 * the user's local time zone:
 *
 * | Fact | Signal |
 * | --- | --- |
 * | `entry.finishedAt` | finished |
 * | `entry.startedAt` | started |
 * | any `replay.startedAt` / `replay.finishedAt` | replayed |
 * | `sessionStat.lastPlayedAt` | touched |
 *
 * Three consequences, each of which the UI states rather than hides:
 *
 * 1. **A game with no dates is in no year.** It is counted by {@link countUndated} and shown
 *    as its own figure. It is never back-filled from `createdAt`: the day a row landed in
 *    IndexedDB is a fact about an import, not about playing a game.
 * 2. **`lastPlayedAt` is *last*, not *every*.** A game played in 2026 and again in 2027
 *    reports only 2027, and silently leaves 2026 the moment it is touched again. That is a
 *    limit of what platforms tell us, and the year page says so out loud.
 * 3. **Hours played *in* a year cannot be computed.** Steam and Xbox report *lifetime*
 *    minutes; nothing in the schema windows playtime to a period. So a year in review never
 *    claims "you played 412 hours this year". It can honestly report the *lifetime* playtime
 *    of the games you touched — labelled exactly that — and nothing more.
 *
 * A fourth, quieter one: **ratings carry no timestamp.** `entry.updatedAt` moves whenever
 * anything on the entry changes, so "rated in 2026" is not a sentence Cartridge can say
 * truthfully. "Games of your 2026 that you have rated" is, and is what gets shown.
 */
import type { LibraryItem } from '../types';
import { PLATFORM_LABELS } from '../types';
import type { Bucket, Distribution, GameRef, Measure } from './types';
import { measure, unavailable } from './types';

export type YearSignal = 'finished' | 'started' | 'replayed' | 'touched';

/** Said once on the year page, so nobody reads a lifetime total as a yearly one. */
export const NO_YEARLY_PLAYTIME =
  'Steam and Xbox report how long you have played a game in total, never when you played it. So Cartridge can’t tell you how many hours this year took — only how much time sits behind the games the year touched.';

/** Said once on the year page, because it is the sharpest edge in the year rule. */
export const LAST_PLAYED_IS_LAST =
  'Platforms report only the *last* time you played a game. Play something again next year and it moves with you, leaving this one.';

/** The year a timestamp falls in, locally. */
const yearOf = (ms: number): number => new Date(ms).getFullYear();

/** Every dated fact on an item, as `[year, signal]` pairs. */
export function datedFacts(item: LibraryItem): [number, YearSignal][] {
  const facts: [number, YearSignal][] = [];
  const { entry, stats } = item;

  if (entry.finishedAt != null) facts.push([yearOf(entry.finishedAt), 'finished']);
  if (entry.startedAt != null) facts.push([yearOf(entry.startedAt), 'started']);
  for (const replay of entry.replays ?? []) {
    if (replay.finishedAt != null) facts.push([yearOf(replay.finishedAt), 'replayed']);
    if (replay.startedAt != null) facts.push([yearOf(replay.startedAt), 'replayed']);
  }
  for (const stat of stats) {
    if (stat.lastPlayedAt != null) facts.push([yearOf(stat.lastPlayedAt), 'touched']);
  }
  return facts;
}

/** The signals an item shows in a year. Empty when the year has no claim on it. */
export function signalsIn(item: LibraryItem, year: number): Set<YearSignal> {
  const signals = new Set<YearSignal>();
  for (const [y, signal] of datedFacts(item)) if (y === year) signals.add(signal);
  return signals;
}

/** True when nothing on this item is dated, so no year can claim it. */
export function isUndated(item: LibraryItem): boolean {
  return datedFacts(item).length === 0;
}

/** How many games carry no dates at all. The honest footnote under every year. */
export function countUndated(items: LibraryItem[]): number {
  let n = 0;
  for (const item of items) if (isUndated(item)) n++;
  return n;
}

/**
 * Years with something in them, newest first. The current year is always offered even when
 * empty — a year in progress that says "nothing yet" is more use than a missing option.
 */
export function availableYears(items: LibraryItem[], now = Date.now()): number[] {
  const years = new Set<number>([yearOf(now)]);
  for (const item of items) for (const [year] of datedFacts(item)) years.add(year);
  return [...years].sort((a, b) => b - a);
}

// ── The review ──────────────────────────────────────────────────────────────

export interface YearInReview {
  year: number;
  /** Games the year has any claim on. */
  games: number;
  finished: number;
  started: number;
  replayed: number;
  /** Games whose only claim is a platform's last-played date. */
  touchedOnly: number;
  /** The library as a whole, so the year's numbers have something to sit against. */
  libraryTotal: number;
  /** Games no year can claim, because they carry no dates. */
  undated: number;
  rated: number;
  averageRating: Measure<number>;
  /** The year's highest-rated game. */
  bestRated: GameRef | null;
  genres: Distribution;
  /** Platforms the year's games are owned on, most first. */
  platforms: Bucket[];
  /** The oldest game, by release date, the year touched. */
  oldestRelease: GameRef | null;
  /**
   * Lifetime playtime behind the year's games. **Not** hours played during the year — see
   * {@link NO_YEARLY_PLAYTIME}.
   */
  lifetimeMinutes: Measure<number>;
  /** True when the year has no games at all — the page has a designed state for this. */
  empty: boolean;
}

/** Everything the year-in-review page shows, in one pass over the library. */
export function yearInReview(items: LibraryItem[], year: number): YearInReview {
  const libraryTotal = items.length;
  let undated = 0;

  const inYear: { item: LibraryItem; signals: Set<YearSignal> }[] = [];
  for (const item of items) {
    const facts = datedFacts(item);
    if (!facts.length) {
      undated++;
      continue;
    }
    const signals = new Set<YearSignal>();
    for (const [y, signal] of facts) if (y === year) signals.add(signal);
    if (signals.size) inYear.push({ item, signals });
  }

  let finished = 0;
  let started = 0;
  let replayed = 0;
  let touchedOnly = 0;

  let rated = 0;
  let ratingSum = 0;
  let bestRated: GameRef | null = null;
  let bestRatedFavourite = false;

  let minutes = 0;
  let minutesCovered = 0;

  let oldestRelease: GameRef | null = null;

  const genreCounts = new Map<string, { label: string; count: number }>();
  let withGenres = 0;
  const platformCounts = new Map<string, { label: string; count: number }>();

  for (const { item, signals } of inYear) {
    const { entry, game, links } = item;

    if (signals.has('finished')) finished++;
    if (signals.has('started')) started++;
    if (signals.has('replayed')) replayed++;
    if (signals.size === 1 && signals.has('touched')) touchedOnly++;

    if (entry.rating != null) {
      rated++;
      ratingSum += entry.rating;
      if (
        !bestRated ||
        entry.rating > bestRated.amount ||
        (entry.rating === bestRated.amount && entry.favourite && !bestRatedFavourite)
      ) {
        bestRated = { id: game.id, title: game.title, amount: entry.rating };
        bestRatedFavourite = entry.favourite;
      }
    }

    if (item.totalMinutes != null) {
      minutes += item.totalMinutes;
      minutesCovered++;
    }

    if (game.releasedAt != null) {
      const released = yearOf(game.releasedAt);
      if (!oldestRelease || released < oldestRelease.amount) {
        oldestRelease = { id: game.id, title: game.title, amount: released };
      }
    }

    if (game.genres.length) withGenres++;
    for (const genre of game.genres) {
      const key = genre.toLowerCase();
      const seen = genreCounts.get(key);
      if (seen) seen.count++;
      else genreCounts.set(key, { label: genre, count: 1 });
    }

    const seenPlatforms = new Set<string>();
    for (const link of links) {
      if (seenPlatforms.has(link.platform)) continue;
      seenPlatforms.add(link.platform);
      const seen = platformCounts.get(link.platform);
      if (seen) seen.count++;
      else platformCounts.set(link.platform, { label: PLATFORM_LABELS[link.platform], count: 1 });
    }
  }

  const games = inYear.length;

  return {
    year,
    games,
    finished,
    started,
    replayed,
    touchedOnly,
    libraryTotal,
    undated,
    rated,
    averageRating: rated
      ? measure(ratingSum / rated, rated, games)
      : unavailable(games, 'None of this year’s games are rated.'),
    bestRated,
    genres: {
      buckets: [...genreCounts.entries()]
        .map(([key, g]) => ({ key, label: g.label, count: g.count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      covered: withGenres,
      total: games,
      reason: games - withGenres ? 'These games carry no genre.' : undefined,
    },
    platforms: [...platformCounts.entries()]
      .map(([key, p]) => ({ key, label: p.label, count: p.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    oldestRelease,
    lifetimeMinutes: minutesCovered
      ? measure(minutes, minutesCovered, games, NO_YEARLY_PLAYTIME)
      : unavailable(games, 'No platform reports playtime for this year’s games.'),
    empty: games === 0,
  };
}
