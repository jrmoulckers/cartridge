/**
 * Backlog triage, as tests.
 *
 * The one thing this screen must not do is blur "a platform told us zero" together with
 * "no platform told us anything". The first is evidence; the second is the absence of it,
 * and a triage list that mixes them is no better than the backlog shelf it replaces.
 */
import { describe, it, expect } from 'vitest';
import { triageBacklog, NO_LENGTH_ESTIMATE, BACKLOG_SORT_LABELS } from './backlog';
import { item, local } from './fixtures';

const library = [
  item({ id: 'never', status: 'backlog', platforms: [{ platform: 'steam', minutesPlayed: 0 }] }),
  item({
    id: 'unknown',
    status: 'backlog',
    platforms: [{ platform: 'playstation', minutesPlayed: null }],
  }),
  item({ id: 'no-links', status: 'backlog' }),
  item({ id: 'begun', status: 'backlog', platforms: [{ platform: 'steam', minutesPlayed: 90 }] }),
  item({ id: 'played', status: 'played', platforms: [{ platform: 'steam', minutesPlayed: 0 }] }),
  item({ id: 'wishlist', status: 'wishlist' }),
];

describe('triage', () => {
  const triage = triageBacklog(library);

  it('separates a real zero from nobody knowing', () => {
    expect(triage.neverLaunched.map((i) => i.game.id)).toEqual(['never']);
    expect(triage.unknown.map((i) => i.game.id).sort()).toEqual(['no-links', 'unknown']);
  });

  it('keeps the games you have already begun out of the never-launched pile', () => {
    expect(triage.started.map((i) => i.game.id)).toEqual(['begun']);
  });

  it('only considers the backlog — a wishlist game is not owned, and a played one is done', () => {
    expect(triage.total).toBe(4);
    const ids = [...triage.neverLaunched, ...triage.unknown, ...triage.started].map(
      (i) => i.game.id,
    );
    expect(ids).not.toContain('wishlist');
    expect(ids).not.toContain('played');
  });
});

describe('sorting on real signals only', () => {
  const waiting = [
    item({
      id: 'old',
      status: 'backlog',
      createdAt: local(2019),
      releasedAt: local(2015),
      title: 'Zed',
    }),
    item({
      id: 'new',
      status: 'backlog',
      createdAt: local(2026),
      releasedAt: local(2024),
      title: 'Alpha',
    }),
    item({ id: 'undated', status: 'backlog', createdAt: local(2022), title: 'Middle' }),
  ];

  it('defaults to whichever has waited longest in your library', () => {
    expect(triageBacklog(waiting).unknown.map((i) => i.game.id)).toEqual(['old', 'undated', 'new']);
  });

  it('sorts by release date newest first, with unknown release dates last', () => {
    expect(triageBacklog(waiting, 'released').unknown.map((i) => i.game.id)).toEqual([
      'new',
      'old',
      'undated',
    ]);
  });

  it('sorts by title', () => {
    expect(triageBacklog(waiting, 'title').unknown.map((i) => i.game.title)).toEqual([
      'Alpha',
      'Middle',
      'Zed',
    ]);
  });

  it('offers no length-based sort, and explains the absence', () => {
    expect(Object.keys(BACKLOG_SORT_LABELS)).toEqual(['added', 'released', 'title']);
    expect(NO_LENGTH_ESTIMATE).toMatch(/HowLongToBeat/);
  });
});

describe('an empty backlog', () => {
  it('is empty rather than broken', () => {
    const triage = triageBacklog([]);
    expect(triage.total).toBe(0);
    expect(triage.neverLaunched).toEqual([]);
    expect(triage.unknown).toEqual([]);
    expect(triage.started).toEqual([]);
  });
});
