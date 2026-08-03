import { describe, it, expect } from 'vitest';
import { matchKey, similarity, matchGame, findByExternalId, MATCH_THRESHOLD } from './match';
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
  });

  it('strips parenthetical platform tags', () => {
    expect(matchKey('Hades (PC)')).toBe('hades');
    expect(matchKey('Ori and the Blind Forest (Windows)')).toBe('ori and the blind forest');
  });

  it('keeps the leading-article rule the rest of the app uses', () => {
    expect(matchKey('The Witcher 3')).toBe('witcher 3');
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
    expect(matchGame(library, { platform: 'steam', externalId: '9', title: 'Final Fantasy XV' }))
      .toBeNull();
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
