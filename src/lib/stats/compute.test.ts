/**
 * The honesty rules, as tests.
 *
 * Phase 7's brief names one failure mode as the one that matters: **presenting a partial
 * number as if it were complete.** "You played 412 hours" is a lie when half the library
 * reports nothing, and the lie is invisible — it looks exactly like a true number. So the
 * properties that stop it are proven here rather than promised in a comment:
 *
 * - `null` playtime is never summed as zero, and never counted as covered.
 * - A real `0` is a different fact from `null`, and stays one all the way to the top.
 * - A measure that cannot be computed honestly is `null` with a reason, never `0`.
 * - Every partial figure carries the denominator the UI needs to say so.
 */
import { describe, it, expect } from 'vitest';
import { computeStats, GENRE_RATING_MINIMUM } from './compute';
import { isComplete, isPartial, missing } from './types';
import { item, local } from './fixtures';

describe('playtime, and the difference between none and unknown', () => {
  it('never sums an unreported playtime as zero', () => {
    const stats = computeStats([
      item({ id: 'a', platforms: [{ platform: 'steam', minutesPlayed: 600 }] }),
      item({ id: 'b', platforms: [{ platform: 'playstation', minutesPlayed: null }] }),
      item({ id: 'c' }),
    ]);

    expect(stats.playtime.totalMinutes.value).toBe(600);
    expect(stats.playtime.totalMinutes.covered).toBe(1);
    expect(stats.playtime.totalMinutes.total).toBe(3);
    expect(missing(stats.playtime.totalMinutes)).toBe(2);
    expect(isPartial(stats.playtime.totalMinutes)).toBe(true);
  });

  it('counts a real zero as covered, and an unknown as not', () => {
    const stats = computeStats([
      item({ id: 'owned-never-launched', platforms: [{ platform: 'steam', minutesPlayed: 0 }] }),
      item({ id: 'nobody-knows', platforms: [{ platform: 'playstation', minutesPlayed: null }] }),
    ]);

    expect(stats.playtime.neverLaunched).toBe(1);
    expect(stats.playtime.unreported).toBe(1);
    expect(stats.playtime.totalMinutes.value).toBe(0);
    expect(stats.playtime.totalMinutes.covered).toBe(1);
  });

  it('merges playtime across the platforms that report it and ignores the ones that do not', () => {
    const stats = computeStats([
      item({
        id: 'hades',
        platforms: [
          { platform: 'steam', minutesPlayed: 1200 },
          { platform: 'xbox', minutesPlayed: null },
        ],
      }),
    ]);

    expect(stats.playtime.totalMinutes.value).toBe(1200);
    expect(isComplete(stats.playtime.totalMinutes)).toBe(true);
  });

  it('reports no playtime at all as unavailable with a reason, not as zero hours', () => {
    const stats = computeStats([
      item({ id: 'a', platforms: [{ platform: 'playstation', minutesPlayed: null }] }),
    ]);

    expect(stats.playtime.totalMinutes.value).toBeNull();
    expect(stats.playtime.totalMinutes.reason).toBeTruthy();
  });

  it('averages over played games only, so a shelf of never-launched games cannot drag it down', () => {
    const stats = computeStats([
      item({ id: 'a', platforms: [{ platform: 'steam', minutesPlayed: 600 }] }),
      item({ id: 'b', platforms: [{ platform: 'steam', minutesPlayed: 0 }] }),
      item({ id: 'c', platforms: [{ platform: 'steam', minutesPlayed: 0 }] }),
    ]);

    expect(stats.playtime.averageMinutes.value).toBe(600);
    expect(stats.playtime.averageMinutes.covered).toBe(1);
  });

  it('says nothing rather than zero when the library is empty', () => {
    const stats = computeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.playtime.totalMinutes.value).toBeNull();
    expect(stats.ratings.average.value).toBeNull();
    expect(stats.completion.finishRate.value).toBeNull();
    expect(stats.extremes.mostPlayed).toBeNull();
  });
});

describe('shelves and completion', () => {
  const library = [
    item({ id: '1', status: 'played' }),
    item({ id: '2', status: 'played' }),
    item({ id: '3', status: 'abandoned' }),
    item({ id: '4', status: 'playing' }),
    item({ id: '5', status: 'backlog' }),
    item({ id: '6', status: 'wishlist' }),
  ];

  it('counts every shelf exactly', () => {
    const { byStatus } = computeStats(library);
    expect(byStatus).toEqual({ played: 2, abandoned: 1, playing: 1, backlog: 1, wishlist: 1 });
  });

  it('rates completion against games you started, not against the backlog', () => {
    const { completion } = computeStats(library);
    expect(completion.engaged).toBe(4);
    expect(completion.finishRate.value).toBeCloseTo(0.5);
    expect(completion.abandonRate.value).toBeCloseTo(0.25);
    expect(completion.finishRate.covered).toBe(4);
    expect(completion.finishRate.total).toBe(6);
  });

  it('has no finish rate at all before you start anything', () => {
    const { completion } = computeStats([item({ id: '1', status: 'backlog' })]);
    expect(completion.finishRate.value).toBeNull();
    expect(completion.finishRate.reason).toBeTruthy();
  });
});

describe('ratings', () => {
  it('keeps all ten half-star buckets so the chart never changes shape', () => {
    const { ratings } = computeStats([item({ id: '1', rating: 4.5 })]);
    expect(ratings.distribution.buckets).toHaveLength(10);
    expect(ratings.distribution.buckets.find((b) => b.key === '4.5')?.count).toBe(1);
    expect(ratings.distribution.buckets.every((b) => b.label.includes('★'))).toBe(true);
  });

  it('averages over rated entries and reports how many were rated', () => {
    const { ratings } = computeStats([
      item({ id: '1', rating: 5 }),
      item({ id: '2', rating: 4 }),
      item({ id: '3' }),
    ]);
    expect(ratings.average.value).toBeCloseTo(4.5);
    expect(ratings.rated).toBe(2);
    expect(ratings.unrated).toBe(1);
    expect(ratings.average.total).toBe(3);
  });

  it('treats unrated as absent, never as zero stars', () => {
    const { ratings } = computeStats([item({ id: '1', rating: 4 }), item({ id: '2' })]);
    expect(ratings.distribution.buckets.reduce((n, b) => n + b.count, 0)).toBe(1);
    expect(ratings.average.value).toBe(4);
  });

  it('breaks a top-rating tie with the favourite', () => {
    const { extremes } = computeStats([
      item({ id: 'a', title: 'Alpha', rating: 5 }),
      item({ id: 'b', title: 'Beta', rating: 5, favourite: true }),
    ]);
    expect(extremes.bestRated?.title).toBe('Beta');
  });
});

describe('genres', () => {
  it('ranks by count and reports how many games carry no genre', () => {
    const { genres } = computeStats([
      item({ id: '1', genres: ['RPG', 'Action'] }),
      item({ id: '2', genres: ['RPG'] }),
      item({ id: '3' }),
    ]);
    expect(genres.buckets[0]).toMatchObject({ label: 'RPG', count: 2 });
    expect(genres.covered).toBe(2);
    expect(genres.total).toBe(3);
    expect(genres.reason).toBeTruthy();
  });

  it('refuses to call one five-star game a favourite genre', () => {
    const below = Array.from({ length: GENRE_RATING_MINIMUM - 1 }, (_, i) =>
      item({ id: `x${i}`, genres: ['Roguelike'], rating: 5 }),
    );
    expect(computeStats(below).genresByRating).toHaveLength(0);

    const enough = Array.from({ length: GENRE_RATING_MINIMUM }, (_, i) =>
      item({ id: `y${i}`, genres: ['Roguelike'], rating: 5 }),
    );
    expect(computeStats(enough).genresByRating[0]).toMatchObject({ label: 'Roguelike', detail: 5 });
  });
});

describe('platforms', () => {
  it('counts a cross-platform game under both, and says so by summing past the library size', () => {
    const stats = computeStats([
      item({
        id: 'hades',
        platforms: [
          { platform: 'steam', minutesPlayed: 1200 },
          { platform: 'xbox', minutesPlayed: 300 },
        ],
      }),
    ]);
    const total = stats.platforms.reduce((n, p) => n + p.games, 0);
    expect(total).toBe(2);
    expect(stats.total).toBe(1);
  });

  it('keeps per-platform playtime coverage separate', () => {
    const stats = computeStats([
      item({
        id: 'a',
        platforms: [
          { platform: 'steam', minutesPlayed: 600 },
          { platform: 'playstation', minutesPlayed: null },
        ],
      }),
    ]);
    const steam = stats.platforms.find((p) => p.platform === 'steam')!;
    const psn = stats.platforms.find((p) => p.platform === 'playstation')!;
    expect(steam.minutes.value).toBe(600);
    expect(psn.minutes.value).toBeNull();
    expect(psn.minutes.reason).toBeTruthy();
  });

  it('counts hand-added games with no platform link', () => {
    expect(computeStats([item({ id: 'a' })]).unlinked).toBe(1);
  });
});

describe('release years and extremes', () => {
  it('orders release years oldest first and reports metadata coverage', () => {
    const { releaseYears } = computeStats([
      item({ id: '1', releasedAt: local(2015) }),
      item({ id: '2', releasedAt: local(1998) }),
      item({ id: '3' }),
    ]);
    expect(releaseYears.buckets.map((b) => b.label)).toEqual(['1998', '2015']);
    expect(releaseYears.covered).toBe(2);
    expect(releaseYears.total).toBe(3);
  });

  it('picks the least-played finish only from games you finished', () => {
    const { extremes } = computeStats([
      item({ id: 'short', status: 'played', platforms: [{ platform: 'steam', minutesPlayed: 200 }] }),
      item({ id: 'long', status: 'played', platforms: [{ platform: 'steam', minutesPlayed: 4000 }] }),
      item({ id: 'tiny', status: 'backlog', platforms: [{ platform: 'steam', minutesPlayed: 5 }] }),
    ]);
    expect(extremes.leastPlayedFinish?.id).toBe('short');
    expect(extremes.mostPlayed?.id).toBe('long');
  });

  it('finds the game that has waited longest in the backlog', () => {
    const { extremes } = computeStats([
      item({ id: 'old', status: 'backlog', createdAt: local(2019) }),
      item({ id: 'new', status: 'backlog', createdAt: local(2026) }),
      item({ id: 'played', status: 'played', createdAt: local(2001) }),
    ]);
    expect(extremes.longestInBacklog?.id).toBe('old');
  });

  it('finds the oldest game you actually played, not merely own', () => {
    const { extremes } = computeStats([
      item({ id: 'ancient', status: 'backlog', releasedAt: local(1991) }),
      item({ id: 'old', status: 'played', releasedAt: local(1998) }),
      item({ id: 'recent', status: 'playing', releasedAt: local(2024) }),
    ]);
    expect(extremes.oldestPlayed?.id).toBe('old');
  });
});

describe('performance', () => {
  it('handles a 2,000-game library in one pass', () => {
    const big = Array.from({ length: 2000 }, (_, i) =>
      item({
        id: `g${i}`,
        status: i % 3 === 0 ? 'played' : 'backlog',
        rating: i % 4 === 0 ? 4 : undefined,
        genres: i % 2 ? ['RPG'] : ['Action', 'Indie'],
        releasedAt: local(2000 + (i % 25)),
        platforms: [{ platform: 'steam', minutesPlayed: i % 5 === 0 ? null : i }],
      }),
    );
    const started = performance.now();
    const stats = computeStats(big);
    expect(performance.now() - started).toBeLessThan(250);
    expect(stats.total).toBe(2000);
    expect(stats.playtime.totalMinutes.covered).toBe(1600);
  });
});
