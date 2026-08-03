/**
 * Matching a platform's idea of a game to Cartridge's.
 *
 * This is the hard part of every connector. Steam says "Hades™", Xbox says "Hades (PC)",
 * IGDB says "Hades", and the user typed "hades" three years ago. These helpers exist now,
 * and are tested now, so that when the Steam connector arrives in phase 3 the matching
 * rules are already agreed and provably behaved.
 *
 * The rules, in order:
 *   1. An external id already linked to a game is the truth. Never second-guess it.
 *   2. An exact normalized-title match is `matched`.
 *   3. A strong fuzzy match is `matched` too, but only well above the threshold.
 *   4. Anything else is not a match — an unmatched game is a small annoyance, a wrongly
 *      merged one silently corrupts someone's library.
 */
import type { LibraryItem, MatchConfidence, Platform } from '../types';
import { normalizeTitle, tokenize } from '../util';

/** Noise a storefront adds that says nothing about which game this is. */
const EDITION_NOISE =
  /\b(goty|game of the year|definitive|deluxe|complete|enhanced|remastered|remake|anniversary|ultimate|standard|special|digital|collectors?|gold|premium|redux|directors? cut)\s*(edition|bundle|pack)?\b/g;
const PLATFORM_NOISE = /\b(pc|windows|steam|xbox|playstation|ps[45]|nintendo|switch|edition)\b/g;
const BRACKETED = /[([{][^)\]}]*[)\]}]/g;

/**
 * A comparison key for a game title: Cartridge's normal sort key with storefront noise
 * (trademarks, "Deluxe Edition", parenthetical platform tags) removed as well.
 */
export function matchKey(title: string): string {
  const withoutSymbols = title.replace(/[™®©]/g, ' ').replace(BRACKETED, ' ');
  return normalizeTitle(withoutSymbols)
    .replace(EDITION_NOISE, ' ')
    .replace(PLATFORM_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Similarity in 0–1, by Sørensen–Dice over character bigrams. Chosen over token overlap
 * because it survives the punctuation and word-order differences storefronts introduce
 * ("Zelda: Breath of the Wild" vs "Breath of the Wild") without matching things that
 * merely share a common word.
 */
export function similarity(a: string, b: string): number {
  const left = matchKey(a);
  const right = matchKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;

  const bigrams = (value: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < value.length - 1; i++) {
      const pair = value.slice(i, i + 2);
      out.set(pair, (out.get(pair) ?? 0) + 1);
    }
    return out;
  };

  const first = bigrams(left);
  const second = bigrams(right);
  let shared = 0;
  for (const [pair, count] of first) {
    const other = second.get(pair);
    if (other) shared += Math.min(count, other);
  }
  return (2 * shared) / (left.length - 1 + (right.length - 1));
}

/**
 * How similar two titles must be before we are willing to call them the same game.
 * High on purpose: a false merge is far more damaging than a duplicate row.
 */
export const MATCH_THRESHOLD = 0.86;

export interface MatchCandidate {
  platform: Platform;
  /** The platform's own id — a Steam appid, an Xbox titleId, and so on. */
  externalId: string;
  title: string;
}

export interface MatchResult {
  item: LibraryItem;
  confidence: MatchConfidence;
  score: number;
}

/** Find the game a link already points at. An existing link is authoritative. */
export function findByExternalId(
  items: LibraryItem[],
  platform: Platform,
  externalId: string,
): LibraryItem | undefined {
  return items.find((item) =>
    item.links.some((l) => l.platform === platform && l.externalId === externalId),
  );
}

/**
 * The library game a platform entry refers to, or `null` when nothing is close enough.
 * `null` is a perfectly good answer: the caller adds a new game instead.
 */
export function matchGame(items: LibraryItem[], candidate: MatchCandidate): MatchResult | null {
  const linked = findByExternalId(items, candidate.platform, candidate.externalId);
  if (linked) return { item: linked, confidence: 'exact', score: 1 };

  const key = matchKey(candidate.title);
  if (!key) return null;

  let best: MatchResult | null = null;
  for (const item of items) {
    const score = similarity(item.game.title, candidate.title);
    if (score > (best?.score ?? 0)) best = { item, confidence: 'matched', score };
  }

  if (!best || best.score < MATCH_THRESHOLD) return null;
  return best;
}

/** Tokens a search would use for a title — exported for the connectors' own logging. */
export function matchTokens(title: string): string[] {
  return tokenize(matchKey(title));
}
