/**
 * Backlog triage — "what should I play next, out of the 300 things I already own?"
 *
 * The roadmap wanted this sorted by how long a game takes. Cartridge has no HowLongToBeat
 * integration and IGDB does not carry reliable completion times, so **no length estimate is
 * offered**: a made-up "about 12 hours" would be the most quietly damaging number in the app,
 * because it is the one a person would actually plan an evening around. The sorts here are
 * all facts Cartridge holds.
 *
 * The one real signal the data does carry is the difference between a `0` and a `null`, and
 * the triage is built on it: a platform saying "zero minutes" is *evidence* you have never
 * launched a game, while no platform reporting at all is simply an absence of evidence.
 * Blurring the two into one "unplayed" list would throw away the only thing that makes this
 * screen better than scrolling the backlog shelf.
 *
 * Pure: no DOM, no IndexedDB, no network.
 */
import type { LibraryItem } from '../types';

/** Why the obvious sort is missing. Shown on the page, not buried here. */
export const NO_LENGTH_ESTIMATE =
  'Cartridge can’t sort by how long a game takes. It has no HowLongToBeat data, and IGDB doesn’t reliably carry completion times — so rather than guess at an evening you’d plan around, it sorts by things it actually knows.';

export type BacklogSort = 'added' | 'released' | 'title';

export const BACKLOG_SORT_LABELS: Record<BacklogSort, string> = {
  added: 'Longest in your library',
  released: 'Newest release',
  title: 'Title',
};

export interface BacklogTriage {
  /**
   * A platform that reports playtime reports a real `0`. You own it and have never launched
   * it — the only bucket Cartridge can be certain about.
   */
  neverLaunched: LibraryItem[];
  /** No platform reports playtime for these, so nobody knows. Unknown, not zero. */
  unknown: LibraryItem[];
  /** Backlog games with playtime above zero — you have begun these and stopped. */
  started: LibraryItem[];
  /** Games considered: everything on the Backlog shelf. */
  total: number;
}

/**
 * Split the backlog into what Cartridge knows, what it doesn't, and what you've already
 * begun. Wishlist games are out of scope — you don't own them, so "never launched" is not an
 * observation about them.
 */
export function triageBacklog(items: LibraryItem[], sort: BacklogSort = 'added'): BacklogTriage {
  const neverLaunched: LibraryItem[] = [];
  const unknown: LibraryItem[] = [];
  const started: LibraryItem[] = [];

  let total = 0;
  for (const item of items) {
    if (item.entry.status !== 'backlog') continue;
    total++;
    if (item.totalMinutes == null) unknown.push(item);
    else if (item.totalMinutes === 0) neverLaunched.push(item);
    else started.push(item);
  }

  const by = comparator(sort);
  return {
    neverLaunched: neverLaunched.sort(by),
    unknown: unknown.sort(by),
    started: started.sort(by),
    total,
  };
}

/**
 * Items with no value for the active sort go **last**, in the same spirit as
 * `library/search.ts`: unknown is not "smallest".
 */
function comparator(sort: BacklogSort): (a: LibraryItem, b: LibraryItem) => number {
  if (sort === 'title') {
    return (a, b) => (a.game.sortTitle || '').localeCompare(b.game.sortTitle || '');
  }
  if (sort === 'released') {
    return (a, b) => {
      const av = a.game.releasedAt;
      const bv = b.game.releasedAt;
      if (av == null || bv == null) {
        if (av == null && bv == null) return 0;
        return av == null ? 1 : -1;
      }
      return bv - av;
    };
  }
  // 'added' — oldest first, because the point is which one has waited longest.
  return (a, b) => a.entry.createdAt - b.entry.createdAt;
}
