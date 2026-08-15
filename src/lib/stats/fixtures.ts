/**
 * Fixtures shared by the stats tests.
 *
 * Test-only: nothing in `src/lib` outside a `.test.ts` imports this. It lives beside the
 * module it exercises rather than in a `__fixtures__` directory because the shape it builds
 * — a fully-formed `LibraryItem`, including the `totalMinutes` join the library store
 * computes — is the thing every stats test needs and the thing most easily got wrong.
 */
import type {
  Entry,
  Game,
  LibraryItem,
  Platform,
  PlatformLink,
  SessionStat,
  Status,
} from '../types';

const T0 = Date.UTC(2020, 0, 1);

export interface ItemSpec {
  id: string;
  title?: string;
  status?: Status;
  rating?: number;
  favourite?: boolean;
  genres?: string[];
  releasedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  replays?: { startedAt?: number; finishedAt?: number }[];
  createdAt?: number;
  /** One entry per platform link, with the playtime that platform reports. */
  platforms?: { platform: Platform; minutesPlayed?: number | null; lastPlayedAt?: number }[];
}

/**
 * Build a `LibraryItem`, deriving `totalMinutes` exactly the way `stores/library.ts` does:
 * platforms reporting `null` contribute nothing, and an item nobody reports for is `null`
 * rather than `0`.
 */
export function item(spec: ItemSpec): LibraryItem {
  const title = spec.title ?? `Game ${spec.id}`;
  const game: Game = {
    id: spec.id,
    title,
    sortTitle: title.toLowerCase(),
    genres: spec.genres ?? [],
    platforms: [],
    releasedAt: spec.releasedAt,
    source: 'manual',
    createdAt: spec.createdAt ?? T0,
    updatedAt: spec.createdAt ?? T0,
  };

  const entry: Entry = {
    id: `e-${spec.id}`,
    gameId: spec.id,
    status: spec.status ?? 'backlog',
    shelfIds: [],
    rating: spec.rating,
    startedAt: spec.startedAt,
    finishedAt: spec.finishedAt,
    replays: spec.replays ?? [],
    tags: [],
    favourite: spec.favourite ?? false,
    createdAt: spec.createdAt ?? T0,
    updatedAt: spec.createdAt ?? T0,
  };

  const specs = spec.platforms ?? [];
  const links: PlatformLink[] = specs.map((p, i) => ({
    id: `l-${spec.id}-${i}`,
    gameId: spec.id,
    platform: p.platform,
    externalId: `${spec.id}-${i}`,
    confidence: 'exact',
    createdAt: T0,
    updatedAt: T0,
  }));
  const stats: SessionStat[] = specs.map((p, i) => ({
    id: `s-${spec.id}-${i}`,
    gameId: spec.id,
    platform: p.platform,
    minutesPlayed: p.minutesPlayed === undefined ? null : p.minutesPlayed,
    lastPlayedAt: p.lastPlayedAt,
    syncedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  }));

  const reported = stats.filter((s) => s.minutesPlayed != null);
  const totalMinutes = reported.length
    ? reported.reduce((sum, s) => sum + (s.minutesPlayed ?? 0), 0)
    : null;

  return { game, entry, links, stats, totalMinutes };
}

/** Local midnight for a date, so year attribution is tested in the zone it runs in. */
export function local(year: number, month = 6, day = 15): number {
  return new Date(year, month - 1, day).getTime();
}
