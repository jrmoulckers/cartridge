import { describe, it, expect } from 'vitest';
import type { Entry, Game, LibraryItem, Platform, Status } from '../types';
import {
  searchLibrary,
  matchScore,
  matchesFacets,
  collectGenres,
  collectTags,
  collectYears,
  isFiltered,
  EMPTY_FILTER,
} from './search';
import { normalizeTitle } from '../util';

let clock = 1_000;

function item(
  title: string,
  overrides: {
    status?: Status;
    rating?: number;
    genres?: string[];
    tags?: string[];
    developer?: string;
    releasedAt?: number;
    finishedAt?: number;
    favourite?: boolean;
    platforms?: Platform[];
    ownedOn?: Platform[];
    minutes?: number | null;
  } = {},
): LibraryItem {
  const now = clock++;
  const game: Game = {
    id: `g-${title}`,
    title,
    sortTitle: normalizeTitle(title),
    genres: overrides.genres ?? [],
    platforms: overrides.platforms ?? [],
    developer: overrides.developer,
    releasedAt: overrides.releasedAt,
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  };
  const entry: Entry = {
    id: `e-${title}`,
    gameId: game.id,
    status: overrides.status ?? 'backlog',
    shelfIds: [],
    rating: overrides.rating,
    tags: overrides.tags ?? [],
    favourite: overrides.favourite ?? false,
    finishedAt: overrides.finishedAt,
    replays: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    game,
    entry,
    links: (overrides.ownedOn ?? []).map((platform, i) => ({
      id: `l-${title}-${i}`,
      gameId: game.id,
      platform,
      externalId: String(i),
      confidence: 'manual' as const,
      createdAt: now,
      updatedAt: now,
    })),
    stats: [],
    totalMinutes: overrides.minutes ?? null,
  };
}

const zelda = item('The Legend of Zelda: Breath of the Wild', {
  status: 'played',
  rating: 5,
  genres: ['Adventure'],
  releasedAt: new Date(2017, 2, 3).getTime(),
  finishedAt: new Date(2018, 0, 1).getTime(),
  ownedOn: ['nintendo'],
  minutes: 6000,
});
const hades = item('Hades', {
  status: 'playing',
  rating: 4.5,
  genres: ['Roguelike', 'Adventure'],
  tags: ['indie'],
  developer: 'Supergiant Games',
  releasedAt: new Date(2020, 8, 17).getTime(),
  ownedOn: ['steam'],
  minutes: 1200,
  favourite: true,
});
const outer = item('Outer Wilds', {
  status: 'backlog',
  genres: ['Adventure'],
  tags: ['indie', 'short'],
  releasedAt: new Date(2019, 4, 28).getTime(),
  ownedOn: ['xbox'],
});
const library = [zelda, hades, outer];

describe('matchScore', () => {
  it('scores an exact normalized title highest', () => {
    expect(matchScore(hades, 'hades')).toBe(100);
  });

  it('ignores a leading article, so Zelda files under Legend', () => {
    expect(matchScore(zelda, 'legend of zelda')).toBe(80);
  });

  it('matches a substring of the title', () => {
    expect(matchScore(zelda, 'breath of the wild')).toBe(60);
  });

  it('matches developer and tags below title', () => {
    expect(matchScore(hades, 'supergiant')).toBe(40);
  });

  it('matches scattered tokens', () => {
    expect(matchScore(zelda, 'zelda wild')).toBe(20);
  });

  it('returns null when nothing matches', () => {
    expect(matchScore(hades, 'football')).toBeNull();
  });

  it('treats an empty query as a neutral match', () => {
    expect(matchScore(hades, '   ')).toBe(0);
  });
});

describe('matchesFacets', () => {
  it('filters by status', () => {
    expect(matchesFacets(hades, { query: '', status: 'playing' })).toBe(true);
    expect(matchesFacets(hades, { query: '', status: 'backlog' })).toBe(false);
  });

  it('filters by owned platform', () => {
    expect(matchesFacets(outer, { query: '', platform: 'xbox' })).toBe(true);
    expect(matchesFacets(outer, { query: '', platform: 'steam' })).toBe(false);
  });

  it('filters by genre and tag case-insensitively', () => {
    expect(matchesFacets(hades, { query: '', genre: 'roguelike' })).toBe(true);
    expect(matchesFacets(hades, { query: '', tag: 'INDIE' })).toBe(true);
  });

  it('filters by minimum rating, treating unrated as below any minimum', () => {
    expect(matchesFacets(hades, { query: '', minRating: 4.5 })).toBe(true);
    expect(matchesFacets(hades, { query: '', minRating: 5 })).toBe(false);
    expect(matchesFacets(outer, { query: '', minRating: 0.5 })).toBe(false);
  });

  it('filters to favourites and to unrated', () => {
    expect(matchesFacets(hades, { query: '', favouritesOnly: true })).toBe(true);
    expect(matchesFacets(outer, { query: '', favouritesOnly: true })).toBe(false);
    expect(matchesFacets(outer, { query: '', unratedOnly: true })).toBe(true);
    expect(matchesFacets(hades, { query: '', unratedOnly: true })).toBe(false);
  });

  it('filters by release year and excludes games with no release date', () => {
    expect(matchesFacets(hades, { query: '', year: 2020 })).toBe(true);
    expect(matchesFacets(hades, { query: '', year: 2019 })).toBe(false);
    expect(matchesFacets(item('Unknown'), { query: '', year: 2020 })).toBe(false);
  });
});

describe('searchLibrary', () => {
  it('returns everything for an empty filter', () => {
    expect(searchLibrary(library, EMPTY_FILTER)).toHaveLength(3);
  });

  it('puts the best title match first regardless of sort', () => {
    const found = searchLibrary(library, { query: 'hades' }, 'title');
    expect(found[0].game.title).toBe('Hades');
  });

  it('sorts by title A to Z by default', () => {
    const titles = searchLibrary(library, EMPTY_FILTER, 'title').map((i) => i.game.title);
    expect(titles).toEqual(['Hades', 'The Legend of Zelda: Breath of the Wild', 'Outer Wilds']);
  });

  it('sorts by rating with unrated last', () => {
    const rated = searchLibrary(library, EMPTY_FILTER, 'rating');
    expect(rated.map((i) => i.entry.rating)).toEqual([5, 4.5, undefined]);
  });

  it('keeps unknown values last when the direction flips', () => {
    const rated = searchLibrary(library, EMPTY_FILTER, 'rating', 'asc');
    expect(rated[rated.length - 1].entry.rating).toBeUndefined();
  });

  it('sorts by playtime with "not reported" last', () => {
    const played = searchLibrary(library, EMPTY_FILTER, 'playtime');
    expect(played.map((i) => i.totalMinutes)).toEqual([6000, 1200, null]);
  });

  it('combines a query with facets', () => {
    const found = searchLibrary(library, { query: 'indie', status: 'backlog' });
    expect(found.map((i) => i.game.title)).toEqual(['Outer Wilds']);
  });
});

describe('facet collection', () => {
  it('lists genres most common first', () => {
    expect(collectGenres(library)[0]).toBe('Adventure');
  });

  it('lists tags most common first', () => {
    expect(collectTags(library)).toEqual(['indie', 'short']);
  });

  it('lists release years newest first', () => {
    expect(collectYears(library)).toEqual([2020, 2019, 2017]);
  });
});

describe('isFiltered', () => {
  it('is false for the empty filter and true once anything narrows', () => {
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
    expect(isFiltered({ query: 'x', status: 'all' })).toBe(true);
    expect(isFiltered({ query: '', status: 'playing' })).toBe(true);
  });
});
