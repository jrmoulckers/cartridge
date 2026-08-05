/**
 * The correctness properties of a sync, as tests.
 *
 * Phase 3's brief names one thing as the most important: **a game already in the library
 * gains a Steam link rather than becoming a duplicate**. That, idempotency, and the
 * inviolability of anything the user wrote are the three things a connector can get wrong
 * in a way the user cannot recover from — so they are proven here rather than promised in a
 * comment.
 *
 * The planner is pure, so most of this needs no database at all. The last block runs the
 * real applier against `fake-indexeddb` end to end, because "the plan is right" and "the
 * write is right" are two different claims.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';

import { planSync, planCounts, planIsEmpty, gameFieldsFor, emptyPlan } from './sync';
import { applyPlan } from './apply';
import type { ConnectorGame } from './types';
import type { Entry, Game, LibraryItem, PlatformLink, SessionStat } from '../types';
import type { GameMetadata } from '../metadata/types';
import { library, refreshLibrary, addGame, updateEntry } from '../stores/library';
import { refreshShelves } from '../stores/shelves';
import * as db from '../storage/db';

// ── Fixtures ────────────────────────────────────────────────────────────────

const now = 1_700_000_000_000;

function item(overrides: {
  id: string;
  title: string;
  igdbId?: number;
  links?: Partial<PlatformLink>[];
  stats?: Partial<SessionStat>[];
  entry?: Partial<Entry>;
}): LibraryItem {
  const game: Game = {
    id: overrides.id,
    title: overrides.title,
    sortTitle: overrides.title.toLowerCase(),
    igdbId: overrides.igdbId,
    genres: [],
    platforms: [],
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  };
  const entry: Entry = {
    id: `e-${overrides.id}`,
    gameId: overrides.id,
    status: 'played',
    shelfIds: [],
    replays: [],
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
    ...overrides.entry,
  };
  const links = (overrides.links ?? []).map((l, i) => ({
    id: `l-${overrides.id}-${i}`,
    gameId: overrides.id,
    platform: 'steam' as const,
    externalId: '0',
    confidence: 'exact' as const,
    createdAt: now,
    updatedAt: now,
    ...l,
  }));
  const stats = (overrides.stats ?? []).map((s, i) => ({
    id: `s-${overrides.id}-${i}`,
    gameId: overrides.id,
    platform: 'steam' as const,
    minutesPlayed: null,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
    ...s,
  }));
  return { game, entry, links, stats, totalMinutes: null };
}

const steamGame = (overrides: Partial<ConnectorGame> & { externalId: string }): ConnectorGame => ({
  title: 'Untitled',
  minutesPlayed: null,
  ...overrides,
});

const metadata = (igdbId: number, title: string): GameMetadata => ({
  igdbId,
  title,
  genres: ['Action'],
  platforms: ['pc'],
  coverUrl: `https://images.test/${igdbId}-small.jpg`,
  coverUrlLarge: `https://images.test/${igdbId}-big.jpg`,
});

// ── The property that matters most ──────────────────────────────────────────

describe('a game already in the library', () => {
  it('gains a Steam link instead of becoming a duplicate — matched by IGDB id', () => {
    const items = [item({ id: 'g1', title: 'Hades', igdbId: 1145 })];
    const plan = planSync(items, [steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })], {
      platform: 'steam',
      metadata: { '1145360': metadata(1145, 'Hades') },
    });

    expect(plan.adds).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].gameId).toBe('g1');
    expect(plan.updates[0].newLink).toBe(true);
  });

  it('gains a link when only the title matches, and records that it was a title match', () => {
    const items = [item({ id: 'g1', title: 'Hades' })];
    const plan = planSync(items, [steamGame({ externalId: '1145360', title: 'Hades™', minutesPlayed: 60 })], {
      platform: 'steam',
    });

    expect(plan.adds).toHaveLength(0);
    expect(plan.updates[0].gameId).toBe('g1');
    expect(plan.updates[0].confidence).toBe('matched');
  });

  it('trusts an existing link above everything else', () => {
    // The stored link says appid 1 is "Some Other Name". A title comparison would disagree;
    // the link wins, because a previous sync or the user already decided.
    const items = [
      item({ id: 'g1', title: 'Some Other Name', links: [{ externalId: '1' }] }),
      item({ id: 'g2', title: 'Hades' }),
    ];
    const plan = planSync(items, [steamGame({ externalId: '1', title: 'Hades' })], {
      platform: 'steam',
    });

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].gameId).toBe('g1');
    expect(plan.updates[0].confidence).toBe('exact');
  });

  it('does not merge two different games that merely share a word', () => {
    const items = [item({ id: 'g1', title: 'Portal 2' })];
    const plan = planSync(items, [steamGame({ externalId: '400', title: 'Portal' })], {
      platform: 'steam',
    });

    expect(plan.updates).toHaveLength(0);
    expect(plan.adds).toHaveLength(1);
  });
});

// ── Idempotency ─────────────────────────────────────────────────────────────

describe('re-running a sync', () => {
  const games = [steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200, lastPlayedAt: 1699 })];

  it('produces an empty plan when nothing changed', () => {
    const synced = [
      item({
        id: 'g1',
        title: 'Hades',
        links: [{ externalId: '1145360' }],
        stats: [{ minutesPlayed: 1200, lastPlayedAt: 1699 }],
      }),
    ];

    const plan = planSync(synced, games, { platform: 'steam' });
    expect(planIsEmpty(plan)).toBe(true);
    expect(plan.unchanged).toBe(1);
  });

  it('notices a changed playtime and nothing else', () => {
    const synced = [
      item({
        id: 'g1',
        title: 'Hades',
        links: [{ externalId: '1145360' }],
        stats: [{ minutesPlayed: 900, lastPlayedAt: 1699 }],
      }),
    ];

    const plan = planSync(synced, games, { platform: 'steam' });
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].previousMinutes).toBe(900);
    expect(plan.updates[0].minutesPlayed).toBe(1200);
    expect(plan.updates[0].newLink).toBe(false);
  });

  it('notices new achievement progress', () => {
    const synced = [
      item({
        id: 'g1',
        title: 'Hades',
        links: [{ externalId: '1145360' }],
        stats: [{ minutesPlayed: 1200, lastPlayedAt: 1699, achievements: { earned: 10, total: 49 } }],
      }),
    ];

    const same = planSync(synced, games, {
      platform: 'steam',
      achievements: { '1145360': { earned: 10, total: 49 } },
    });
    expect(planIsEmpty(same)).toBe(true);

    const moved = planSync(synced, games, {
      platform: 'steam',
      achievements: { '1145360': { earned: 30, total: 49 } },
    });
    expect(moved.updates).toHaveLength(1);
  });

  it('collapses a platform reporting the same appid twice', () => {
    const plan = planSync([], [games[0], { ...games[0] }], { platform: 'steam' });
    expect(plan.adds).toHaveLength(1);
  });
});

// ── Playtime honesty ────────────────────────────────────────────────────────

describe('playtime', () => {
  it('keeps a real zero as zero — owned but never launched is not "not reported"', () => {
    const plan = planSync([], [steamGame({ externalId: '1', title: 'Untouched', minutesPlayed: 0 })], {
      platform: 'steam',
    });
    expect(plan.adds[0].minutesPlayed).toBe(0);
    expect(plan.adds[0].minutesPlayed).not.toBeNull();
  });

  it('keeps an unreported figure as null rather than inventing a zero', () => {
    const plan = planSync([], [steamGame({ externalId: '1', title: 'Unknown', minutesPlayed: null })], {
      platform: 'steam',
    });
    expect(plan.adds[0].minutesPlayed).toBeNull();
  });

  it('treats 0 and null as different states of the same game', () => {
    const zeroed = [
      item({ id: 'g1', title: 'Untouched', links: [{ externalId: '1' }], stats: [{ minutesPlayed: 0 }] }),
    ];
    const plan = planSync(zeroed, [steamGame({ externalId: '1', title: 'Untouched', minutesPlayed: null })], {
      platform: 'steam',
    });
    expect(plan.updates).toHaveLength(1);
  });
});

// ── The unmatched tail ──────────────────────────────────────────────────────

describe('games IGDB does not know', () => {
  it('imports them with the platform’s own title and art, flagged rather than guessed at', () => {
    const plan = planSync(
      [],
      [
        steamGame({
          externalId: '9999',
          title: 'Some Delisted Demo',
          minutesPlayed: 5,
          imageUrl: 'https://cdn.test/9999/header.jpg',
        }),
      ],
      { platform: 'steam' },
    );

    expect(plan.adds[0].unmatched).toBe(true);
    expect(plan.adds[0].title).toBe('Some Delisted Demo');
    expect(plan.adds[0].coverUrl).toBe('https://cdn.test/9999/header.jpg');
    expect(planCounts(plan).unmatched).toBe(1);
  });

  it('records an unmatched import as manual, so a metadata refresh never trusts it', () => {
    const plan = planSync([], [steamGame({ externalId: '9999', title: 'Some Delisted Demo' })], {
      platform: 'steam',
    });
    expect(gameFieldsFor(plan.adds[0], 'steam').source).toBe('manual');
    expect(gameFieldsFor(plan.adds[0], 'steam').platforms).toEqual(['steam']);
  });

  it('prefers IGDB’s title and metadata when there is a match', () => {
    const plan = planSync([], [steamGame({ externalId: '1145360', title: 'Hades™ Deluxe Edition' })], {
      platform: 'steam',
      metadata: { '1145360': metadata(1145, 'Hades') },
    });
    const fields = gameFieldsFor(plan.adds[0], 'steam');
    expect(fields.title).toBe('Hades');
    expect(fields.igdbId).toBe(1145);
    expect(fields.source).toBe('igdb');
    expect(fields.coverUrl).toBe('https://images.test/1145-big.jpg');
  });
});

describe('an empty plan', () => {
  it('is a value, not a null', () => {
    expect(planIsEmpty(emptyPlan('steam'))).toBe(true);
    expect(planCounts(emptyPlan('steam'))).toEqual({
      adds: 0,
      updates: 0,
      newLinks: 0,
      unchanged: 0,
      unmatched: 0,
    });
  });
});

// ── End to end, against a real database ─────────────────────────────────────

describe('applying a plan', () => {
  beforeEach(async () => {
    // A clean database per test: the sync path is stateful in a way the planner is not.
    await db.replaceAll({
      games: [],
      entries: [],
      platformLinks: [],
      shelves: [],
      sessionStats: [],
      playtimeObservations: [],
      meta: [],
    });
    await refreshShelves();
    await refreshLibrary();
  });

  async function sync(games: ConnectorGame[], meta?: Record<string, GameMetadata>) {
    const plan = planSync(get(library), games, { platform: 'steam', metadata: meta });
    const results = await applyPlan(plan, get(library), { status: 'backlog' });
    await refreshLibrary();
    return { plan, results };
  }

  it('adds new games onto the chosen shelf with their platform rows', async () => {
    const { results } = await sync([
      steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200, lastPlayedAt: 1699 }),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ outcome: 'added', externalId: '1145360' }),
    ]);

    const items = get(library);
    expect(items).toHaveLength(1);
    expect(items[0].entry.status).toBe('backlog');
    expect(items[0].links[0]).toMatchObject({ platform: 'steam', externalId: '1145360' });
    expect(items[0].stats[0].minutesPlayed).toBe(1200);
    expect(items[0].totalMinutes).toBe(1200);
  });

  it('never touches a rating, review or shelf that the user wrote', async () => {
    // The user's own row: played, five stars, reviewed, with a start date.
    const added = await addGame({ title: 'Hades', status: 'played' });
    await updateEntry(added!.entry, {
      rating: 5,
      score: 98,
      review: 'The best roguelike.',
      notes: 'Aspect of Arthur.',
      startedAt: 111,
      finishedAt: 222,
      favourite: true,
      tags: ['comfort'],
    });
    await refreshLibrary();

    await sync([steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 3000 })]);

    const items = get(library);
    expect(items).toHaveLength(1);

    const entry = items[0].entry;
    expect(entry.status).toBe('played');
    expect(entry.rating).toBe(5);
    expect(entry.score).toBe(98);
    expect(entry.review).toBe('The best roguelike.');
    expect(entry.notes).toBe('Aspect of Arthur.');
    expect(entry.startedAt).toBe(111);
    expect(entry.finishedAt).toBe(222);
    expect(entry.favourite).toBe(true);
    expect(entry.tags).toEqual(['comfort']);

    // And the game did gain its Steam link and playtime.
    expect(items[0].links).toHaveLength(1);
    expect(items[0].stats[0].minutesPlayed).toBe(3000);
  });

  it('is idempotent: a second run over unchanged data writes nothing', async () => {
    const games = [steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200, lastPlayedAt: 1699 })];

    await sync(games);
    const first = get(library)[0];

    const { plan, results } = await sync(games);
    expect(planIsEmpty(plan)).toBe(true);
    expect(results).toEqual([]);

    const second = get(library)[0];
    expect(get(library)).toHaveLength(1);
    expect(second.links).toHaveLength(1);
    expect(second.stats).toHaveLength(1);
    expect(second.game.updatedAt).toBe(first.game.updatedAt);
    expect(second.entry.updatedAt).toBe(first.entry.updatedAt);
  });

  it('updates only the platform-sourced fields on a later run', async () => {
    await sync([steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })]);
    const before = get(library)[0];

    const { results } = await sync([
      steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 1500, lastPlayedAt: 42 }),
    ]);

    expect(results[0].outcome).toBe('updated');
    const after = get(library)[0];
    expect(after.stats).toHaveLength(1);
    expect(after.stats[0].id).toBe(before.stats[0].id);
    expect(after.stats[0].minutesPlayed).toBe(1500);
    expect(after.stats[0].lastPlayedAt).toBe(42);
    expect(after.entry.updatedAt).toBe(before.entry.updatedAt);
  });

  it('reports a linked game distinctly from an added one', async () => {
    await addGame({ title: 'Outer Wilds', status: 'playing' });
    await refreshLibrary();

    const { results } = await sync([
      steamGame({ externalId: '753640', title: 'Outer Wilds', minutesPlayed: 500 }),
      steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 10 }),
    ]);

    const byId = new Map(results.map((r) => [r.externalId, r]));
    expect(byId.get('753640')?.outcome).toBe('linked');
    expect(byId.get('1145360')?.outcome).toBe('added');
    expect(get(library)).toHaveLength(2);
    // The pre-existing game kept the shelf the user put it on.
    expect(get(library).find((i) => i.game.title === 'Outer Wilds')!.entry.status).toBe('playing');
  });

  it('does not resurrect a stat as a second row after a disconnect', async () => {
    const games = [steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })];
    await sync(games);

    await db.clearPlatformData('steam');
    await refreshLibrary();
    expect(get(library)[0].links).toHaveLength(0);
    expect(get(library)[0].stats).toHaveLength(0);

    await sync(games);
    const item = get(library)[0];
    // One live link and one live stat — not two of each.
    expect(item.links).toHaveLength(1);
    expect(item.stats).toHaveLength(1);
    expect((await db.getAllStats()).filter((s) => s.gameId === item.game.id)).toHaveLength(1);
  });

  it('records achievements without inventing a zero-of-zero', async () => {
    const games = [steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })];
    const plan = planSync(get(library), games, { platform: 'steam' });
    await applyPlan(plan, get(library), {
      status: 'backlog',
      achievements: { '1145360': { earned: 30, total: 49 } },
    });
    await refreshLibrary();

    expect(get(library)[0].stats[0].achievements).toEqual({ earned: 30, total: 49 });
  });

  it('keeps existing achievements when a sync did not fetch any', async () => {
    const games = [steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })];
    await applyPlan(planSync(get(library), games, { platform: 'steam' }), get(library), {
      status: 'backlog',
      achievements: { '1145360': { earned: 30, total: 49 } },
    });
    await refreshLibrary();

    const moved = [steamGame({ externalId: '1145360', title: 'Hades', minutesPlayed: 1300 })];
    await applyPlan(planSync(get(library), moved, { platform: 'steam' }), get(library), {
      status: 'backlog',
    });
    await refreshLibrary();

    expect(get(library)[0].stats[0].achievements).toEqual({ earned: 30, total: 49 });
    expect(get(library)[0].stats[0].minutesPlayed).toBe(1300);
  });

  it('imports a large library without losing anything', async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      steamGame({ externalId: String(i + 1), title: `Game ${i + 1}`, minutesPlayed: i }),
    );
    const { results } = await sync(many);

    expect(results.filter((r) => r.outcome === 'added')).toHaveLength(250);
    expect(get(library)).toHaveLength(250);
  });
});

// ── Credentials never travel in a backup ────────────────────────────────────

describe('credentials', () => {
  it('are excluded from a backup snapshot', async () => {
    await db.setCredentials({
      platform: 'steam',
      values: { steamId: '76561197960287930' },
      connectedAt: now,
    });

    const snapshot = await db.getAllForBackup();
    expect(Object.keys(snapshot)).not.toContain('credentials');
    expect(JSON.stringify(snapshot)).not.toContain('76561197960287930');

    // And they survive a restore rather than being wiped by it.
    await db.replaceAll(snapshot);
    expect(await db.getCredentials('steam')).toBeDefined();

    await db.clearCredentials('steam');
    expect(await db.getCredentials('steam')).toBeUndefined();
  });
});
