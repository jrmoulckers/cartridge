/**
 * Library search, filtering and sorting.
 *
 * Pure functions over an in-memory `LibraryItem[]`: no DOM, no IndexedDB, no network.
 * A personal game library is small (thousands of rows at the very most), so filtering the
 * whole array on every keystroke is both fast enough and simpler than maintaining an
 * index — and it keeps search working with no connectors and no bridge.
 */
import type { ID, LibraryItem, Platform, Status } from '../types';
import { normalizeTitle, tokenize } from '../util';

export interface LibraryFilter {
  /** Free-text query, matched against title, developer, tags and genres. */
  query: string;
  /** A single status, or 'all' / undefined for every shelf. */
  status?: Status | 'all';
  /** A custom shelf id. */
  shelfId?: ID;
  platform?: Platform;
  genre?: string;
  tag?: string;
  /** Minimum star rating, inclusive. */
  minRating?: number;
  favouritesOnly?: boolean;
  /** Only entries with no star rating — the "you never rated these" pile. */
  unratedOnly?: boolean;
  /** Release year. */
  year?: number;
}

export const EMPTY_FILTER: LibraryFilter = { query: '', status: 'all' };

export type SortKey = 'updated' | 'title' | 'rating' | 'released' | 'finished' | 'playtime';
export type SortDirection = 'asc' | 'desc';

export const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Recently updated',
  title: 'Title',
  rating: 'Your rating',
  released: 'Release date',
  finished: 'Date finished',
  playtime: 'Playtime',
};

/** Everything about an item that free text can match. */
function haystack(item: LibraryItem): string {
  return [
    item.game.title,
    item.game.developer ?? '',
    item.game.publisher ?? '',
    ...item.game.genres,
    ...item.entry.tags,
    ...item.links.map((l) => l.externalTitle ?? ''),
  ].join(' ');
}

/**
 * Relevance for a query, or `null` when the item doesn't match at all.
 * Higher is better: exact title beats prefix beats all-tokens-somewhere.
 */
export function matchScore(item: LibraryItem, query: string): number | null {
  const q = normalizeTitle(query);
  if (!q) return 0;

  const title = item.game.sortTitle || normalizeTitle(item.game.title);
  if (title === q) return 100;
  if (title.startsWith(q)) return 80;
  if (title.includes(q)) return 60;

  const hay = normalizeTitle(haystack(item));
  if (hay.includes(q)) return 40;

  // Every token present somewhere — "zelda breath" finds "Breath of the Wild".
  const tokens = tokenize(query);
  if (tokens.length > 1 && tokens.every((t) => hay.includes(t))) return 20;

  return null;
}

const hasLower = (values: string[], needle: string) =>
  values.some((v) => v.toLowerCase() === needle.toLowerCase());

/** Whether an item passes every non-text facet of the filter. */
export function matchesFacets(item: LibraryItem, filter: LibraryFilter): boolean {
  const { entry, game, links } = item;

  if (filter.status && filter.status !== 'all' && entry.status !== filter.status) return false;
  if (filter.shelfId && !entry.shelfIds.includes(filter.shelfId)) return false;
  if (filter.favouritesOnly && !entry.favourite) return false;
  if (filter.unratedOnly && entry.rating != null) return false;
  if (filter.minRating != null && (entry.rating ?? 0) < filter.minRating) return false;
  if (filter.genre && !hasLower(game.genres, filter.genre)) return false;
  if (filter.tag && !hasLower(entry.tags, filter.tag)) return false;
  if (filter.year != null) {
    if (game.releasedAt == null) return false;
    if (new Date(game.releasedAt).getFullYear() !== filter.year) return false;
  }
  if (filter.platform) {
    const owned = links.some((l) => l.platform === filter.platform);
    if (!owned && !game.platforms.includes(filter.platform)) return false;
  }
  return true;
}

/**
 * The direction each sort opens in — "A to Z" for a title, "newest / highest first"
 * for everything else. Reversing is the user's call, not a default.
 */
export const DEFAULT_DIRECTION: Record<SortKey, SortDirection> = {
  updated: 'desc',
  title: 'asc',
  rating: 'desc',
  released: 'desc',
  finished: 'desc',
  playtime: 'desc',
};

/** The numeric value a sort key ranks on, or `null` when the item has no value for it. */
function sortValue(key: SortKey, item: LibraryItem): number | null {
  switch (key) {
    case 'rating':
      return item.entry.rating ?? null;
    case 'released':
      return item.game.releasedAt ?? null;
    case 'finished':
      return item.entry.finishedAt ?? null;
    case 'playtime':
      return item.totalMinutes;
    case 'updated':
    default:
      return item.entry.updatedAt;
  }
}

/**
 * Filter, then sort. With a query present, relevance wins and `sort` only breaks ties —
 * typing a title should surface that title, whatever the sort dropdown says.
 *
 * Items with no value for the active sort (unrated, never finished, playtime the platform
 * doesn't report) always sort **last**, in either direction: "unknown" is not "smallest".
 */
export function searchLibrary(
  items: LibraryItem[],
  filter: LibraryFilter = EMPTY_FILTER,
  sort: SortKey = 'updated',
  direction: SortDirection = DEFAULT_DIRECTION[sort],
): LibraryItem[] {
  const scored: { item: LibraryItem; score: number }[] = [];
  for (const item of items) {
    if (!matchesFacets(item, filter)) continue;
    const score = matchScore(item, filter.query);
    if (score === null) continue;
    scored.push({ item, score });
  }

  const flip = direction === 'desc' ? -1 : 1;

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    if (sort === 'title') {
      return (a.item.game.sortTitle || '').localeCompare(b.item.game.sortTitle || '') * flip;
    }

    const av = sortValue(sort, a.item);
    const bv = sortValue(sort, b.item);
    if (av == null || bv == null) {
      if (av == null && bv == null) return 0;
      return av == null ? 1 : -1;
    }
    return (av - bv) * flip;
  });

  return scored.map((s) => s.item);
}

/** Distinct genres across the library, most common first. */
export function collectGenres(items: LibraryItem[]): string[] {
  return countDistinct(items.flatMap((i) => i.game.genres));
}

/** Distinct tags across the library, most common first. */
export function collectTags(items: LibraryItem[]): string[] {
  return countDistinct(items.flatMap((i) => i.entry.tags));
}

/** Distinct release years present in the library, newest first. */
export function collectYears(items: LibraryItem[]): number[] {
  const years = new Set<number>();
  for (const item of items) {
    if (item.game.releasedAt != null) years.add(new Date(item.game.releasedAt).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

function countDistinct(values: string[]): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const value of values) {
    const key = value.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.n++;
    else counts.set(key, { label: value, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .map((c) => c.label);
}

/** True when the filter would narrow anything — drives the "clear filters" affordance. */
export function isFiltered(filter: LibraryFilter): boolean {
  return Boolean(
    filter.query.trim() ||
      (filter.status && filter.status !== 'all') ||
      filter.shelfId ||
      filter.platform ||
      filter.genre ||
      filter.tag ||
      filter.minRating != null ||
      filter.favouritesOnly ||
      filter.unratedOnly ||
      filter.year != null,
  );
}
