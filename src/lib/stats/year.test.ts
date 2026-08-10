/**
 * The year rule, as tests.
 *
 * A "year in review" over data where many entries have no dates is only defensible if the
 * rule for what counts is written down and enforced. These tests are that enforcement:
 *
 * - Any dated fact in year Y puts a game in Y — finish, start, replay, or a platform's
 *   last-played date.
 * - A game with no dates is in **no** year, and is counted separately rather than dropped or
 *   back-filled from `createdAt`.
 * - `lastPlayedAt` is *last*: a 2027 replay takes the game out of 2026, and the app says so.
 * - Yearly *hours* are never claimed, because nothing in the schema windows playtime.
 */
import { describe, it, expect } from 'vitest';
import {
  availableYears,
  countUndated,
  isUndated,
  signalsIn,
  yearInReview,
  NO_YEARLY_PLAYTIME,
} from './year';
import { item, local } from './fixtures';

describe('what puts a game in a year', () => {
  it('accepts a finish, a start, a replay and a platform last-played date', () => {
    expect(signalsIn(item({ id: '1', finishedAt: local(2026) }), 2026)).toContain('finished');
    expect(signalsIn(item({ id: '2', startedAt: local(2026) }), 2026)).toContain('started');
    expect(signalsIn(item({ id: '3', replays: [{ finishedAt: local(2026) }] }), 2026)).toContain(
      'replayed',
    );
    expect(
      signalsIn(
        item({ id: '4', platforms: [{ platform: 'steam', lastPlayedAt: local(2026) }] }),
        2026,
      ),
    ).toContain('touched');
  });

  it('puts a game in every year it has a fact in', () => {
    const spanning = item({ id: '1', startedAt: local(2025), finishedAt: local(2026) });
    expect(signalsIn(spanning, 2025)).toEqual(new Set(['started']));
    expect(signalsIn(spanning, 2026)).toEqual(new Set(['finished']));
  });

  it('never lets createdAt stand in for a play date', () => {
    const imported = item({ id: '1', createdAt: local(2026) });
    expect(isUndated(imported)).toBe(true);
    expect(signalsIn(imported, 2026).size).toBe(0);
  });

  it('counts the games no year can claim', () => {
    const items = [
      item({ id: '1', finishedAt: local(2026) }),
      item({ id: '2' }),
      item({ id: '3' }),
    ];
    expect(countUndated(items)).toBe(2);
  });
});

describe('available years', () => {
  it('offers the years with data, newest first, and always the current one', () => {
    const now = local(2026, 3, 1);
    const items = [
      item({ id: '1', finishedAt: local(2019) }),
      item({ id: '2', startedAt: local(2023) }),
    ];
    expect(availableYears(items, now)).toEqual([2026, 2023, 2019]);
  });

  it('offers the current year even for an empty library', () => {
    expect(availableYears([], local(2026))).toEqual([2026]);
  });
});

describe('the review', () => {
  const items = [
    item({
      id: 'finished',
      status: 'played',
      rating: 4.5,
      genres: ['RPG'],
      releasedAt: local(1998),
      finishedAt: local(2026, 2, 3),
      platforms: [{ platform: 'steam', minutesPlayed: 1200 }],
    }),
    item({
      id: 'started',
      status: 'playing',
      genres: ['RPG', 'Action'],
      releasedAt: local(2024),
      startedAt: local(2026, 11, 1),
      platforms: [{ platform: 'xbox', minutesPlayed: null }],
    }),
    item({
      id: 'touched',
      status: 'backlog',
      platforms: [{ platform: 'steam', minutesPlayed: 60, lastPlayedAt: local(2026, 5, 5) }],
    }),
    item({ id: 'last-year', status: 'played', finishedAt: local(2025) }),
    item({ id: 'undated', status: 'backlog' }),
  ];

  const review = yearInReview(items, 2026);

  it('claims only the games the year has a fact for', () => {
    expect(review.games).toBe(3);
    expect(review.finished).toBe(1);
    expect(review.started).toBe(1);
    expect(review.touchedOnly).toBe(1);
  });

  it('keeps the undated games visible rather than silently dropping them', () => {
    expect(review.undated).toBe(1);
    expect(review.libraryTotal).toBe(5);
  });

  it('rates only the year’s games, and says how many of them are rated', () => {
    expect(review.rated).toBe(1);
    expect(review.averageRating.value).toBeCloseTo(4.5);
    expect(review.averageRating.covered).toBe(1);
    expect(review.averageRating.total).toBe(3);
    expect(review.bestRated?.id).toBe('finished');
  });

  it('reports lifetime playtime, labelled as lifetime, never as hours played this year', () => {
    expect(review.lifetimeMinutes.value).toBe(1260);
    expect(review.lifetimeMinutes.covered).toBe(2);
    expect(review.lifetimeMinutes.total).toBe(3);
    expect(review.lifetimeMinutes.reason).toBe(NO_YEARLY_PLAYTIME);
  });

  it('finds the year’s genres and platforms, and its oldest release', () => {
    expect(review.genres.buckets[0]!).toMatchObject({ label: 'RPG', count: 2 });
    expect(review.genres.covered).toBe(2);
    expect(review.platforms.map((p) => p.key)).toContain('steam');
    expect(review.oldestRelease?.amount).toBe(1998);
  });
});

describe('last-played is last, not every', () => {
  it('drops a game out of the earlier year once a platform reports a newer session', () => {
    const replayed = item({
      id: '1',
      platforms: [{ platform: 'steam', minutesPlayed: 600, lastPlayedAt: local(2027) }],
    });
    expect(yearInReview([replayed], 2026).games).toBe(0);
    expect(yearInReview([replayed], 2027).games).toBe(1);
  });

  it('keeps a game in the earlier year when the user dated it themselves', () => {
    const dated = item({
      id: '1',
      finishedAt: local(2026),
      platforms: [{ platform: 'steam', minutesPlayed: 600, lastPlayedAt: local(2027) }],
    });
    expect(yearInReview([dated], 2026).finished).toBe(1);
    expect(yearInReview([dated], 2027).games).toBe(1);
  });
});

describe('an empty year', () => {
  it('is a designed state, not an error, and still knows the library it sits in', () => {
    const review = yearInReview([item({ id: '1' }), item({ id: '2' })], 2026);
    expect(review.empty).toBe(true);
    expect(review.games).toBe(0);
    expect(review.undated).toBe(2);
    expect(review.libraryTotal).toBe(2);
    expect(review.averageRating.value).toBeNull();
    expect(review.lifetimeMinutes.value).toBeNull();
    expect(review.bestRated).toBeNull();
  });
});
