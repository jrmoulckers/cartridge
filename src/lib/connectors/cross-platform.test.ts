/**
 * The properties that only exist once there are two connectors.
 *
 * Phase 3 could assert that a Steam sync doesn't duplicate a game the user already had.
 * It could not assert the thing that actually matters, because there was only ever one
 * platform in the room: **a game owned on Steam and on Xbox is one game.** That is the
 * whole premise of a platform-agnostic library — one row, one rating, one review, with the
 * platforms hanging off it — and until now it was a design claim rather than a tested fact.
 *
 * The other three blocks are the phase's other promises, in the same order the brief put
 * them: matching refuses rather than guesses, a failing Xbox is Xbox's problem alone, and
 * an unreported playtime is still unreported after a full round trip through the database.
 *
 * And one more, added after review: the duplicate that arrives from *behind*. A game Xbox
 * couldn't identify is a game the next platform might not recognise either — the same
 * failure as the headline case, reached by a route nobody was watching.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

import { planSync } from './sync';
import { applyPlan } from './apply';
import type { ConnectorGame } from './types';
import type { GameMetadata } from '../metadata/types';
import { bestMatch, similarity } from '../metadata/match';
import { library, refreshLibrary, addGame, updateEntry } from '../stores/library';
import { refreshShelves } from '../stores/shelves';
import { steamConnector } from './steam';
import { xboxConnector } from './xbox';
import { registerConnector, fetchLibrary as boundedFetchLibrary } from './registry';
import { setBridgeUrl } from '../stores/settings';
import * as db from '../storage/db';

const BRIDGE = 'https://bridge.test';

const game = (overrides: Partial<ConnectorGame> & { externalId: string }): ConnectorGame => ({
  title: 'Untitled',
  minutesPlayed: null,
  ...overrides,
});

const metadata = (igdbId: number, title: string): GameMetadata => ({
  igdbId,
  title,
  genres: ['Action'],
  platforms: ['pc'],
  coverUrl: `https://images.test/${igdbId}.jpg`,
  coverUrlLarge: `https://images.test/${igdbId}-big.jpg`,
});

beforeEach(async () => {
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

/** Run a whole sync for one platform, exactly as `stores/connectors` does. */
async function sync(
  platform: 'steam' | 'xbox',
  games: ConnectorGame[],
  meta?: Record<string, GameMetadata>,
) {
  const plan = planSync(get(library), games, { platform, metadata: meta });
  const results = await applyPlan(plan, get(library), { status: 'backlog' });
  await refreshLibrary();
  return { plan, results };
}

// ── The headline property of the whole product ──────────────────────────────

describe('a game owned on Steam and on Xbox', () => {
  it('is one entry with two platform links and merged playtime', async () => {
    // Two platforms, two completely unrelated ids, both resolving to IGDB 1145. This is the
    // case the platform-agnostic model exists for, and the case a Steam-shaped design would
    // have quietly got wrong by keying anything on an appid.
    await sync('steam', [game({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })], {
      '1145360': metadata(1145, 'Hades'),
    });
    const { plan } = await sync(
      'xbox',
      [game({ externalId: '1963298018', title: 'Hades (Xbox)', minutesPlayed: 300 })],
      { '1963298018': metadata(1145, 'Hades') },
    );

    // Not an add. The Xbox row found the Steam-imported game by its IGDB id.
    expect(plan.adds).toHaveLength(0);
    expect(plan.updates[0].newLink).toBe(true);

    const items = get(library);
    expect(items).toHaveLength(1);

    const platforms = items[0].links.map((l) => l.platform).sort();
    expect(platforms).toEqual(['steam', 'xbox']);
    expect(items[0].links.map((l) => l.externalId).sort()).toEqual(['1145360', '1963298018']);

    // One stat row per platform, and a total that adds them up. Neither figure overwrites
    // the other — "how long have I played Hades" spans the platforms it was played on.
    expect(items[0].stats).toHaveLength(2);
    expect(items[0].totalMinutes).toBe(1500);
  });

  it('keeps the single rating and review the user wrote, from either direction', async () => {
    const added = await addGame({ title: 'Hades', status: 'played' });
    await updateEntry(added!.entry, {
      rating: 5,
      review: 'Still the best run-based game there is.',
      favourite: true,
    });
    await refreshLibrary();

    await sync('steam', [game({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })]);
    await sync('xbox', [game({ externalId: '1963298018', title: 'Hades', minutesPlayed: 300 })]);

    const items = get(library);
    expect(items).toHaveLength(1);
    expect(items[0].entry.rating).toBe(5);
    expect(items[0].entry.review).toBe('Still the best run-based game there is.');
    expect(items[0].entry.favourite).toBe(true);
    // And the status they chose, not the "backlog" a sync would have used for a new game.
    expect(items[0].entry.status).toBe('played');
  });

  it('links to each platform separately when the games really are different', async () => {
    // The inverse guard. Two genuinely different games must not be collapsed just because
    // they arrived from two connectors in the same session.
    await sync('steam', [game({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })]);
    await sync('xbox', [game({ externalId: '1717113201', title: 'Halo Infinite' })]);

    const items = get(library);
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.links).toHaveLength(1);
  });

  it('stays idempotent across both platforms', async () => {
    const steam = [game({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })];
    const xbox = [game({ externalId: '1963298018', title: 'Hades', minutesPlayed: 300 })];

    await sync('steam', steam);
    await sync('xbox', xbox);

    // Re-running either one changes nothing at all.
    const again = await sync('steam', steam);
    expect(again.plan.adds).toHaveLength(0);
    expect(again.plan.updates).toHaveLength(0);

    const alsoAgain = await sync('xbox', xbox);
    expect(alsoAgain.plan.adds).toHaveLength(0);
    expect(alsoAgain.plan.updates).toHaveLength(0);

    const items = get(library);
    expect(items).toHaveLength(1);
    expect(items[0].links).toHaveLength(2);
    expect(items[0].stats).toHaveLength(2);
    expect(items[0].totalMinutes).toBe(1500);
  });
});

// ── Conservative matching ───────────────────────────────────────────────────

describe('an ambiguous title', () => {
  it('is refused rather than guessed at', () => {
    // Two candidates, both plausible, no way to tell which. Picking either would attach a
    // rating to the wrong game and nothing on screen would ever reveal it.
    const chosen = bestMatch([
      { item: 'Halo 3', score: 0.95 },
      { item: 'Halo 3: ODST', score: 0.94 },
    ]);
    expect(chosen).toBeNull();
  });

  it('is refused when nothing clears the bar, even if something is closest', () => {
    expect(bestMatch([{ item: 'Portal 2', score: 0.909 }])).toBeNull();
  });

  it('resolves when one candidate is exact and the rest are merely similar', () => {
    // "Portal" against "Portal 2" scores in the low 0.8s — close enough that the library
    // matcher would take it, and nowhere near clear enough for a search result. An exact
    // "Portal" at 1.0 is well past the margin. Strictness that refuses *everything* would
    // be useless, so this is the case that proves it still says yes.
    const runnerUp = similarity('Portal', 'Portal 2');
    expect(runnerUp).toBeGreaterThan(0.5);
    expect(runnerUp).toBeLessThan(0.94);
    expect(
      bestMatch([
        { item: 'Portal', score: 1 },
        { item: 'Portal 2', score: runnerUp },
      ]),
    ).toBe('Portal');
  });

  it('lands in the plan as an unidentified add, not a wrong link', async () => {
    // No metadata for the Xbox row, and no library game close enough to its title. The
    // planner adds it under Xbox's own name and marks it — which is what the import screen
    // lists for review.
    await sync('steam', [game({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })]);
    const { plan } = await sync('xbox', [
      game({ externalId: '999', title: 'Some Compilation Nobody Indexes' }),
    ]);

    expect(plan.updates).toHaveLength(0);
    expect(plan.adds).toHaveLength(1);
    expect(plan.adds[0].unmatched).toBe(true);
    expect(plan.adds[0].title).toBe('Some Compilation Nobody Indexes');
  });
});

// ── The duplicate arriving from behind ──────────────────────────────────────

describe('a game imported before anything could identify it', () => {
  it('is claimed by the next platform that can, not duplicated by it', async () => {
    // The exact sequence that makes this a real risk rather than a theoretical one: Xbox
    // matches by title, so its awkward tail lands unidentified. Steam then resolves the same
    // game cleanly by appid — and if the unidentified row can't be recognised, the user ends
    // up with two Hades, one rating on each.
    await sync('xbox', [game({ externalId: '1963298018', title: 'Hades', minutesPlayed: 300 })]);

    let items = get(library);
    expect(items).toHaveLength(1);
    expect(items[0].game.igdbId).toBeUndefined();
    expect(items[0].game.source).toBe('manual');

    const { plan } = await sync(
      'steam',
      [game({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })],
      { '1145360': metadata(1145, 'Hades') },
    );

    expect(plan.adds).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);

    items = get(library);
    expect(items).toHaveLength(1);
    expect(items[0].links.map((l) => l.platform).sort()).toEqual(['steam', 'xbox']);
    expect(items[0].totalMinutes).toBe(1500);

    // And the door is now shut for good: the row has an identity, so the *third* platform
    // gets a lookup rather than another go at the fuzzy matcher that nearly failed here.
    expect(items[0].game.igdbId).toBe(1145);
    expect(items[0].game.source).toBe('igdb');
    expect(items[0].game.coverUrl).toBe('https://images.test/1145-big.jpg');
    expect(items[0].game.genres).toEqual(['Action']);
  });

  it('reports the upgrade instead of pretending it was a routine link', async () => {
    await sync('xbox', [game({ externalId: '1963298018', title: 'Hades' })]);
    const { results } = await sync(
      'steam',
      [game({ externalId: '1145360', title: 'Hades' })],
      { '1145360': metadata(1145, 'Hades') },
    );

    expect(results[0].outcome).toBe('linked');
    expect(results[0].detail).toContain('identified');
  });

  it('fills blanks and replaces nothing', async () => {
    // A game the user typed themselves, with their own title and their own cover. A later
    // sync learns what it is — and that is a reason to fill in the summary, not a licence to
    // rewrite the two fields they chose.
    const added = await addGame({ title: 'Hades', status: 'playing' });
    await db.putGame({ ...added!.game, coverUrl: 'https://mine.test/hades.jpg' });
    await refreshLibrary();

    await sync('steam', [game({ externalId: '1145360', title: 'Hades' })], {
      '1145360': { ...metadata(1145, 'HADES: Definitive Edition'), summary: 'A rogue-lite.' },
    });

    const [item] = get(library);
    expect(item.game.title).toBe('Hades');
    expect(item.game.coverUrl).toBe('https://mine.test/hades.jpg');
    // The blanks, though, are worth having.
    expect(item.game.igdbId).toBe(1145);
    expect(item.game.summary).toBe('A rogue-lite.');
  });

  it('leaves a game alone entirely when IGDB disagrees about what it is', async () => {
    // The title matcher found a row that already claims to be a different game. That is a
    // disagreement about identity, and the only safe response to a disagreement is to write
    // nothing — not to pick the newer answer because it arrived last.
    const added = await addGame({ title: 'Hades', status: 'playing' });
    await db.putGame({ ...added!.game, igdbId: 999, source: 'igdb' });
    await refreshLibrary();

    await sync('xbox', [game({ externalId: '1963298018', title: 'Hades' })], {
      '1963298018': metadata(1145, 'Hades'),
    });

    const [item] = get(library);
    expect(item.game.igdbId).toBe(999);
    expect(item.game.genres).toEqual([]);
  });

  it('enriches once, then goes quiet', async () => {
    await sync('xbox', [game({ externalId: '1963298018', title: 'Hades' })]);
    const steam = [game({ externalId: '1145360', title: 'Hades' })];
    const meta = { '1145360': metadata(1145, 'Hades') };

    await sync('steam', steam, meta);
    // Idempotency has to survive the new write too: once the gaps are filled there is
    // nothing left to fill, so the next sync is empty rather than perpetually "updating".
    const { plan } = await sync('steam', steam, meta);
    expect(plan.adds).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });
});

// ── Isolation ───────────────────────────────────────────────────────────────

describe('Xbox failing', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setBridgeUrl(BRIDGE);
    registerConnector(steamConnector);
    registerConnector(xboxConnector);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setBridgeUrl('');
  });

  const xboxCredentials = { apiKey: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', xuid: '2533274800000000' };
  const steamCredentials = { steamId: '76561197960287930' };

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it.each([
    ['throttled', () => json({ error: 'rate-limited', message: 'slow down' }, 429)],
    ['unauthorised', () => json({ error: 'xbox-auth', message: 'bad key' }, 401)],
    ['returning garbage', () => json({ nonsense: true })],
    ['unreachable', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('leaves Steam working when Xbox is %s', async (_name, response) => {
    await sync('steam', [game({ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 })]);

    fetchMock.mockImplementationOnce(() => response());
    const xbox = await boundedFetchLibrary('xbox', { credentials: xboxCredentials });
    expect(xbox.ok).toBe(false);

    // Steam, immediately afterwards, on the same bridge: unaffected.
    fetchMock.mockResolvedValueOnce(
      json({ games: [{ appid: '1145360', title: 'Hades', minutesPlayed: 1260 }] }),
    );
    const steam = await boundedFetchLibrary('steam', { credentials: steamCredentials });
    expect(steam.ok).toBe(true);

    // And the library the user already has is untouched by any of it.
    const items = get(library);
    expect(items).toHaveLength(1);
    expect(items[0].totalMinutes).toBe(1200);
  });

  it('is returned as a value, never as a rejection into the UI', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'xbox-auth', message: 'bad key' }, 401));
    // The registry's whole job. A component awaiting this must never see a throw, or one
    // broken connector takes the page down with it.
    const outcome = await boundedFetchLibrary('xbox', { credentials: xboxCredentials });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.platform).toBe('xbox');
  });
});

// ── Unreported playtime ─────────────────────────────────────────────────────

describe('an unreported playtime', () => {
  it('survives a sync as null rather than becoming a zero', async () => {
    await sync('xbox', [game({ externalId: '1', title: 'Forza Horizon 5', minutesPlayed: null })]);

    const items = get(library);
    expect(items[0].stats[0].minutesPlayed).toBeNull();
    // `null` totals render as "Not reported". A `0` would render as "0h" — a claim the user
    // has never played a game they may well have finished.
    expect(items[0].totalMinutes).toBeNull();
  });

  it('is a different fact from a real zero on another platform', async () => {
    // Owned on Steam and never launched (a true `0`), played on Xbox for an unknown length
    // of time. The total is the one real number, not a sum that pretends the unknown is nil.
    await sync('steam', [game({ externalId: '1145360', title: 'Hades', minutesPlayed: 0 })]);
    await sync('xbox', [game({ externalId: '1963298018', title: 'Hades', minutesPlayed: null })]);

    const items = get(library);
    expect(items).toHaveLength(1);
    const byPlatform = Object.fromEntries(items[0].stats.map((s) => [s.platform, s.minutesPlayed]));
    expect(byPlatform).toEqual({ steam: 0, xbox: null });
    expect(items[0].totalMinutes).toBe(0);
  });

  it('does not overwrite a known figure with an unknown one on the next sync', async () => {
    await sync('xbox', [game({ externalId: '1', title: 'Gears 5', minutesPlayed: 640 })]);
    expect(get(library)[0].totalMinutes).toBe(640);

    // OpenXBL's stats call is best-effort, so the same library can come back without minutes.
    // Losing a real number to a transient omission would be a silent data loss.
    await sync('xbox', [game({ externalId: '1', title: 'Gears 5', minutesPlayed: null })]);
    expect(get(library)[0].totalMinutes).toBe(640);
  });
});
