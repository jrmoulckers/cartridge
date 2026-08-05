/**
 * Library-wide statistics.
 *
 * Pure functions over an in-memory `LibraryItem[]`: no DOM, no IndexedDB, no network — the
 * same contract `library/search.ts` follows, and the reason these rules can be proven in a
 * unit test rather than promised in a comment.
 *
 * Two invariants run through everything here:
 *
 * 1. **`null` playtime is not zero.** A platform that does not report playtime contributes
 *    nothing to a total and is counted as uncovered. A real `0` — owned, never launched — is
 *    a genuine data point and is counted as covered.
 * 2. **Every figure carries its denominator.** See `stats/types.ts`.
 *
 * One pass, O(n). A 2,000-game library is well under a millisecond, which is why the stats
 * store can be a plain `derived` without any scheduling cleverness.
 */
import type { ID, LibraryItem, Platform, Status } from '../types';
import { PLATFORM_LABELS, STATUSES } from '../types';
import type { Bucket, Distribution, GameRef, Measure } from './types';
import { measure, unavailable } from './types';

// ── Sub-shapes ──────────────────────────────────────────────────────────────

export interface PlaytimeStats {
  /** Minutes summed across the games some platform reports playtime for. */
  totalMinutes: Measure<number>;
  /** Games a reporting platform says are at a real `0` — owned, never launched. */
  neverLaunched: number;
  /** Games no platform reports playtime for. Unknown, not zero. */
  unreported: number;
  /** Mean minutes across games with reported playtime above zero. */
  averageMinutes: Measure<number>;
}

export interface RatingStats {
  /** Ten half-star buckets, always present so the chart shape never jumps. */
  distribution: Distribution;
  /** Mean star rating across rated entries. */
  average: Measure<number>;
  rated: number;
  unrated: number;
  favourites: number;
}

export interface CompletionStats {
  /**
   * Games you actually engaged with: played, abandoned or playing. Backlog and wishlist are
   * deliberately outside the denominator — an unplayed game is not a failed one.
   */
  engaged: number;
  /** Played ÷ engaged. */
  finishRate: Measure<number>;
  /** Abandoned ÷ engaged. */
  abandonRate: Measure<number>;
}

export interface PlatformStats {
  platform: Platform;
  label: string;
  /** Games you own on this platform (one game can appear under several). */
  games: number;
  /** Minutes on this platform, covered by the games it reports playtime for. */
  minutes: Measure<number>;
}

export interface Extremes {
  /** Most total playtime. */
  mostPlayed: GameRef | null;
  /** Highest star rating; favourites break the tie, then title. */
  bestRated: GameRef | null;
  /**
   * The finished game with the least recorded playtime. Deliberately *not* called "shortest
   * game": lifetime playtime is not time-to-finish, and a replay inflates it.
   */
  leastPlayedFinish: GameRef | null;
  /** The game that has sat in the backlog longest, by the date it entered your library. */
  longestInBacklog: GameRef | null;
  /** The oldest game, by release date, that you have played. */
  oldestPlayed: GameRef | null;
}

export interface LibraryStats {
  /** Games in the library — every entry, on every shelf. */
  total: number;
  byStatus: Record<Status, number>;
  playtime: PlaytimeStats;
  ratings: RatingStats;
  completion: CompletionStats;
  genres: Distribution;
  /** Genres ranked by *your* average rating. Suppressed below `GENRE_RATING_MINIMUM`. */
  genresByRating: Bucket[];
  platforms: PlatformStats[];
  /** Games with no platform link at all — added by hand, owned nowhere in particular. */
  unlinked: number;
  releaseYears: Distribution;
  extremes: Extremes;
}

/**
 * How many rated games a genre needs before Cartridge will claim you like it. Below this a
 * single five-star game makes "Roguelike" your favourite genre, which is noise wearing a
 * finding's clothes.
 */
export const GENRE_RATING_MINIMUM = 3;

// ── The pass ────────────────────────────────────────────────────────────────

/** Every library-wide statistic, in one pass. */
export function computeStats(items: LibraryItem[]): LibraryStats {
  const total = items.length;

  const byStatus = emptyStatusCounts();

  let playtimeMinutes = 0;
  let playtimeCovered = 0;
  let neverLaunched = 0;
  let playedAboveZero = 0;
  let playedAboveZeroMinutes = 0;

  let ratingSum = 0;
  let rated = 0;
  let favourites = 0;
  const ratingBuckets = new Map<string, number>(HALF_STARS.map((r) => [starKey(r), 0]));

  const genreCounts = new Map<string, { label: string; count: number }>();
  const genreRatings = new Map<string, { label: string; sum: number; n: number }>();
  let withGenres = 0;

  const yearCounts = new Map<number, number>();
  let withReleaseYear = 0;

  const platformGames = new Map<Platform, number>();
  const platformMinutes = new Map<Platform, { minutes: number; covered: number }>();
  let unlinked = 0;

  let mostPlayed: GameRef | null = null;
  let bestRated: GameRef | null = null;
  let bestRatedFavourite = false;
  let leastPlayedFinish: GameRef | null = null;
  let longestInBacklog: GameRef | null = null;
  let oldestPlayed: GameRef | null = null;

  for (const item of items) {
    const { entry, game, links, stats } = item;

    byStatus[entry.status]++;

    // ── Playtime. `null` contributes nothing and is not covered; a real 0 is covered.
    const minutes = item.totalMinutes;
    if (minutes != null) {
      playtimeCovered++;
      playtimeMinutes += minutes;
      if (minutes === 0) neverLaunched++;
      else {
        playedAboveZero++;
        playedAboveZeroMinutes += minutes;
        if (!mostPlayed || minutes > mostPlayed.amount) mostPlayed = ref(game.id, game.title, minutes);
      }
      if (entry.status === 'played' && (!leastPlayedFinish || minutes < leastPlayedFinish.amount)) {
        leastPlayedFinish = ref(game.id, game.title, minutes);
      }
    }

    // ── Ratings.
    if (entry.rating != null) {
      rated++;
      ratingSum += entry.rating;
      const key = starKey(entry.rating);
      ratingBuckets.set(key, (ratingBuckets.get(key) ?? 0) + 1);
      if (
        !bestRated ||
        entry.rating > bestRated.amount ||
        (entry.rating === bestRated.amount && entry.favourite && !bestRatedFavourite)
      ) {
        bestRated = ref(game.id, game.title, entry.rating);
        bestRatedFavourite = entry.favourite;
      }
    }
    if (entry.favourite) favourites++;

    // ── Genres, and what you thought of them.
    if (game.genres.length) withGenres++;
    for (const genre of game.genres) {
      const key = genre.toLowerCase();
      const existing = genreCounts.get(key);
      if (existing) existing.count++;
      else genreCounts.set(key, { label: genre, count: 1 });

      if (entry.rating != null) {
        const seen = genreRatings.get(key);
        if (seen) {
          seen.sum += entry.rating;
          seen.n++;
        } else {
          genreRatings.set(key, { label: genre, sum: entry.rating, n: 1 });
        }
      }
    }

    // ── Release years.
    if (game.releasedAt != null) {
      withReleaseYear++;
      const year = new Date(game.releasedAt).getFullYear();
      yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
      if (
        (entry.status === 'played' || entry.status === 'playing') &&
        (!oldestPlayed || year < oldestPlayed.amount)
      ) {
        oldestPlayed = ref(game.id, game.title, year);
      }
    }

    // ── Platforms. Ownership is the link, not the metadata: `game.platforms` says where a
    //    game released, which is a fact about the game rather than about you.
    if (!links.length) unlinked++;
    const seenPlatforms = new Set<Platform>();
    for (const link of links) {
      if (seenPlatforms.has(link.platform)) continue;
      seenPlatforms.add(link.platform);
      platformGames.set(link.platform, (platformGames.get(link.platform) ?? 0) + 1);
    }
    for (const stat of stats) {
      const bucket = platformMinutes.get(stat.platform) ?? { minutes: 0, covered: 0 };
      if (stat.minutesPlayed != null) {
        bucket.minutes += stat.minutesPlayed;
        bucket.covered++;
      }
      platformMinutes.set(stat.platform, bucket);
    }

    // ── Backlog residency, by the day it entered the library. `createdAt` is a fact about
    //    the import, which is exactly what "how long has this been sitting here" asks.
    if (entry.status === 'backlog' && (!longestInBacklog || entry.createdAt < longestInBacklog.amount)) {
      longestInBacklog = ref(game.id, game.title, entry.createdAt);
    }
  }

  const unreported = total - playtimeCovered;

  return {
    total,
    byStatus,
    playtime: {
      totalMinutes: playtimeCovered
        ? measure(playtimeMinutes, playtimeCovered, total, playtimeReason(unreported))
        : unavailable(
            total,
            total
              ? 'No platform reports playtime for any of your games yet.'
              : 'Your library is empty.',
          ),
      neverLaunched,
      unreported,
      averageMinutes: playedAboveZero
        ? measure(
            playedAboveZeroMinutes / playedAboveZero,
            playedAboveZero,
            total,
            'Averaged over the games with playtime above zero — never-launched games would drag it toward a number about your buying, not your playing.',
          )
        : unavailable(total, 'No game reports playtime above zero.'),
    },
    ratings: {
      distribution: {
        buckets: HALF_STARS.map((stars) => ({
          key: starKey(stars),
          label: starLabel(stars),
          count: ratingBuckets.get(starKey(stars)) ?? 0,
        })),
        covered: rated,
        total,
        reason: total - rated ? 'Unrated is a real state, and these games are in it.' : undefined,
      },
      average: rated
        ? measure(ratingSum / rated, rated, total)
        : unavailable(total, 'You haven’t rated anything yet.'),
      rated,
      unrated: total - rated,
      favourites,
    },
    completion: completion(byStatus, total),
    genres: {
      buckets: rank([...genreCounts.entries()].map(([key, g]) => ({ key, label: g.label, count: g.count }))),
      covered: withGenres,
      total,
      reason: total - withGenres ? 'These games carry no genre — add one, or match them to IGDB.' : undefined,
    },
    genresByRating: [...genreRatings.entries()]
      .filter(([, g]) => g.n >= GENRE_RATING_MINIMUM)
      .map(([key, g]) => ({ key, label: g.label, count: g.n, detail: g.sum / g.n }))
      .sort((a, b) => (b.detail ?? 0) - (a.detail ?? 0) || a.label.localeCompare(b.label)),
    platforms: platformStats(platformGames, platformMinutes),
    unlinked,
    releaseYears: {
      buckets: [...yearCounts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([year, count]) => ({ key: String(year), label: String(year), count })),
      covered: withReleaseYear,
      total,
      reason: total - withReleaseYear ? 'These games have no release date recorded.' : undefined,
    },
    extremes: { mostPlayed, bestRated, leastPlayedFinish, longestInBacklog, oldestPlayed },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const HALF_STARS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

const starKey = (stars: number) => stars.toFixed(1);
const starLabel = (stars: number) => `${stars} ★`;

function ref(id: ID, title: string, amount: number): GameRef {
  return { id, title, amount };
}

function emptyStatusCounts(): Record<Status, number> {
  return Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
}

function playtimeReason(unreported: number): string | undefined {
  if (!unreported) return undefined;
  return unreported === 1
    ? 'One game reports no playtime at all, so it is not in this total.'
    : `${unreported} games report no playtime at all, so they are not in this total.`;
}

function completion(byStatus: Record<Status, number>, total: number): CompletionStats {
  const engaged = byStatus.played + byStatus.abandoned + byStatus.playing;
  const reason =
    'Out of the games you actually started — backlog and wishlist games aren’t counted, because an unplayed game isn’t a failed one.';
  if (!engaged) {
    return {
      engaged,
      finishRate: unavailable(total, 'You haven’t started anything yet.'),
      abandonRate: unavailable(total, 'You haven’t started anything yet.'),
    };
  }
  return {
    engaged,
    finishRate: measure(byStatus.played / engaged, engaged, total, reason),
    abandonRate: measure(byStatus.abandoned / engaged, engaged, total, reason),
  };
}

function platformStats(
  games: Map<Platform, number>,
  minutes: Map<Platform, { minutes: number; covered: number }>,
): PlatformStats[] {
  const platforms = new Set<Platform>([...games.keys(), ...minutes.keys()]);
  return [...platforms]
    .map((platform) => {
      const count = games.get(platform) ?? 0;
      const m = minutes.get(platform);
      return {
        platform,
        label: PLATFORM_LABELS[platform],
        games: count,
        minutes:
          m && m.covered
            ? measure(m.minutes, m.covered, count)
            : unavailable<number>(count, `${PLATFORM_LABELS[platform]} reports no playtime for these.`),
      };
    })
    .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label));
}

/** Most common first, ties alphabetical — the order `library/search.ts` already uses. */
function rank(buckets: Bucket[]): Bucket[] {
  return buckets.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
