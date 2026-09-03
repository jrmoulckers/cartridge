import { describe, it, expect } from 'vitest';
import {
  bestMatch,
  isUnadornedTitle,
  matchKey,
  similarity,
  matchGame,
  findByExternalId,
  MATCH_THRESHOLD,
} from './match';
import type { Entry, Game, LibraryItem, PlatformLink } from '../types';
import { normalizeTitle } from '../util';

function item(title: string, links: Partial<PlatformLink>[] = []): LibraryItem {
  const game = {
    id: title,
    createdAt: 0,
    updatedAt: 0,
    title,
    sortTitle: normalizeTitle(title),
    genres: [],
    platforms: [],
    source: 'manual',
  } as Game;
  const entry = {
    id: `e-${title}`,
    createdAt: 0,
    updatedAt: 0,
    gameId: title,
    status: 'played',
    shelfIds: [],
    replays: [],
    tags: [],
    favourite: false,
  } as Entry;
  return {
    game,
    entry,
    links: links.map((l, i) => ({
      id: `l${i}`,
      createdAt: 0,
      updatedAt: 0,
      gameId: title,
      confidence: 'exact',
      ...l,
    })) as PlatformLink[],
    stats: [],
    totalMinutes: null,
  };
}

describe('matchKey', () => {
  it('strips trademark symbols', () => {
    expect(matchKey('Hades™')).toBe('hades');
  });

  it('strips edition noise', () => {
    expect(matchKey('Skyrim Special Edition')).toBe(matchKey('Skyrim'));
    expect(matchKey('Dishonored - Definitive Edition')).toBe('dishonored');
    expect(matchKey('Fallout: New Vegas GOTY Edition')).toBe('fallout new vegas');
    expect(matchKey("Ori and the Will of the Wisps: Collector's Edition")).toBe(
      'ori and the will of the wisps',
    );
    expect(matchKey("Stardew Valley: Collector's Edition")).toBe('stardew valley');
  });

  it('strips parenthetical platform tags', () => {
    expect(matchKey('Hades (PC)')).toBe('hades');
    expect(matchKey('Ori and the Blind Forest (Windows)')).toBe('ori and the blind forest');
  });

  it('keeps the leading-article rule the rest of the app uses', () => {
    expect(matchKey('The Witcher 3')).toBe('witcher 3');
  });
});

describe('bestMatch', () => {
  interface Candidate {
    id: number;
    title: string;
  }

  function choose(query: string, candidates: Candidate[]): Candidate | null {
    const key = matchKey(query);
    return bestMatch(
      candidates.map((candidate) => ({
        item: candidate,
        score: similarity(query, candidate.title),
        identityKey: matchKey(candidate.title),
        preferred: isUnadornedTitle(candidate.title, key),
        tieBreaker: candidate.id,
      })),
    );
  }

  it.each([
    [
      'Gears 5',
      [
        { id: 200, title: 'Gears 5: Ultimate Edition' },
        { id: 300, title: 'Gears 5' },
      ],
    ],
    [
      'Sea of Thieves',
      [
        { id: 103, title: 'Sea of Thieves: Anniversary Edition' },
        { id: 101, title: 'Sea of Thieves: Deluxe Edition' },
        { id: 105, title: 'Sea of Thieves' },
      ],
    ],
    [
      'Ori and the Will of the Wisps',
      [
        { id: 202, title: "Ori and the Will of the Wisps: Collector's Edition" },
        { id: 201, title: 'Ori and the Will of the Wisps' },
      ],
    ],
    [
      'Stardew Valley',
      [
        { id: 302, title: "Stardew Valley: Collector's Edition" },
        { id: 301, title: 'Stardew Valley' },
      ],
    ],
  ])('collapses the real %s edition pool and chooses the bare title', (query, candidates) => {
    expect(choose(query, candidates)?.title).toBe(query);
  });

  it('uses the lowest IGDB id as a deterministic fallback when no bare title is returned', () => {
    const chosen = choose('Sea of Thieves', [
      { id: 900, title: 'Sea of Thieves: Deluxe Edition' },
      { id: 700, title: 'Sea of Thieves: Anniversary Edition' },
    ]);
    expect(chosen?.id).toBe(700);
  });

  it('recognizes a normalized base title before falling back to IGDB id order', () => {
    const chosen = choose('Witcher 3', [
      { id: 100, title: 'The Witcher 3: Complete Edition' },
      { id: 200, title: 'The Witcher 3™' },
    ]);
    expect(chosen?.id).toBe(200);
  });

  it('preserves ambiguity protection across genuinely different normalized keys', () => {
    const chosen = bestMatch([
      {
        item: { id: 1, title: 'Halo 3' },
        score: 0.98,
        identityKey: matchKey('Halo 3'),
        tieBreaker: 1,
      },
      {
        item: { id: 2, title: 'Halo 3: ODST' },
        score: 0.95,
        identityKey: matchKey('Halo 3: ODST'),
        tieBreaker: 2,
      },
    ]);
    expect(chosen).toBeNull();
  });
});

describe('similarity', () => {
  it('is 1 for the same game written differently', () => {
    expect(similarity('Hades™', 'Hades (PC)')).toBe(1);
  });

  it('is high for a subtitle difference', () => {
    expect(similarity('Portal 2', 'Portal 2 ')).toBe(1);
  });

  it('is low for different games that share a word', () => {
    expect(similarity('Final Fantasy VII', 'Final Fantasy XV')).toBeLessThan(MATCH_THRESHOLD);
    expect(similarity('Doom', 'Doom Eternal')).toBeLessThan(MATCH_THRESHOLD);
  });

  it('never matches unrelated titles', () => {
    expect(similarity('Hades', 'Celeste')).toBeLessThan(0.3);
  });

  it('handles empty input without dividing by zero', () => {
    expect(similarity('', 'Hades')).toBe(0);
    expect(similarity('', '')).toBe(0);
  });
});

describe('matchGame', () => {
  const library = [
    item('Hades', [{ platform: 'steam', externalId: '1145360' }]),
    item('Celeste'),
    item('Final Fantasy VII'),
  ];

  it('trusts an existing link above everything else', () => {
    // A wildly different title on a linked appid still resolves to the linked game.
    const result = matchGame(library, {
      platform: 'steam',
      externalId: '1145360',
      title: 'Something Else Entirely',
    });
    expect(result?.item.game.title).toBe('Hades');
    expect(result?.confidence).toBe('exact');
  });

  it('matches a noisy storefront title to the library title', () => {
    const result = matchGame(library, {
      platform: 'xbox',
      externalId: 'x1',
      title: 'Celeste (Windows)',
    });
    expect(result?.item.game.title).toBe('Celeste');
    expect(result?.confidence).toBe('matched');
  });

  it('returns null rather than guessing between sequels', () => {
    expect(
      matchGame(library, { platform: 'steam', externalId: '9', title: 'Final Fantasy XV' }),
    ).toBeNull();
  });

  it('returns null for an empty title', () => {
    expect(matchGame(library, { platform: 'steam', externalId: '9', title: '   ' })).toBeNull();
  });

  it('returns null against an empty library', () => {
    expect(matchGame([], { platform: 'steam', externalId: '9', title: 'Hades' })).toBeNull();
  });
});

describe('findByExternalId', () => {
  const library = [item('Hades', [{ platform: 'steam', externalId: '1145360' }])];

  it('is platform-scoped — the same id on another platform is a different game', () => {
    expect(findByExternalId(library, 'steam', '1145360')?.game.title).toBe('Hades');
    expect(findByExternalId(library, 'xbox', '1145360')).toBeUndefined();
  });
});
