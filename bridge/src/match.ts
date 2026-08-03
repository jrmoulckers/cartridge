/**
 * Title matching, bridge-side.
 *
 * A deliberate duplicate of the strict-matching half of `src/lib/metadata/match.ts` in the app,
 * for the same reason `types.ts` duplicates the metadata contract: the worker is a separate
 * deployable with its own tsconfig, and a shared import would couple two builds that have no
 * business being coupled. The two must agree, so keep them in step — the app's copy is the one
 * with the tests.
 *
 * This exists because of Xbox. Steam appids are carried by IGDB as external ids, so phase 3
 * matched by lookup and never had to make a judgement. Xbox title ids are not, so phase 4 has
 * to compare strings — and comparing strings is how libraries get silently corrupted. The
 * whole design here bends one way: **when in doubt, match nothing.**
 */

/** Noise a storefront adds that says nothing about which game this is. */
const EDITION_NOISE =
  /\b(goty|game of the year|definitive|deluxe|complete|enhanced|remastered|remake|anniversary|ultimate|standard|special|digital|collectors?|gold|premium|redux|directors? cut)\s*(edition|bundle|pack)?\b/g;
const PLATFORM_NOISE = /\b(pc|windows|steam|xbox|playstation|ps[45]|nintendo|switch|edition)\b/g;
const BRACKETED = /[([{][^)\]}]*[)\]}]/g;
const ARTICLES = /^(the|a|an)\s+/;

/**
 * A comparison key for a title — lower-cased, de-articled, stripped of punctuation, trademark
 * symbols, parenthetical tags and edition noise.
 *
 * Xbox is why the noise stripping earns its keep: Xbox Live spells things like
 * "Halo: The Master Chief Collection (PC)" and "Forza Horizon 5 Premium Edition", neither of
 * which IGDB would recognise verbatim.
 */
export function matchKey(title: string): string {
  return title
    .replace(/[™®©]/g, ' ')
    .replace(BRACKETED, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(ARTICLES, '')
    .replace(EDITION_NOISE, ' ')
    .replace(PLATFORM_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Similarity in 0–1, by Sørensen–Dice over character bigrams. */
export function similarity(a: string, b: string): number {
  const left = matchKey(a);
  const right = matchKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;

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
 * How similar a candidate must be before we will call it the same game.
 *
 * **Higher than the app's own 0.86, and that is the point.** The app's threshold compares a
 * platform title against games the user has already put in their library by hand — a small,
 * curated set where a near-match is usually right. This compares against whatever IGDB's search
 * returned for a title, which is a much larger and much less friendly pool: "Halo 3" and
 * "Halo 3: ODST" are different games that score high against each other, and so are "Portal"
 * and "Portal 2". At 0.86 those merge. At 0.94 they don't.
 */
export const TITLE_MATCH_THRESHOLD = 0.94;

/**
 * How far clear of the runner-up the winner must be.
 *
 * The threshold alone is not enough. If two candidates both score 0.95 then one of them is
 * wrong and we have no way to tell which, so *both* are refused. This is the check that turns
 * "we found something" into "we found the only thing it could be", and it is what stops a
 * sequel, a remaster or a regional re-release being confidently attached to the wrong entry.
 */
export const TITLE_MATCH_MARGIN = 0.06;

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * The one candidate a title unambiguously refers to, or `null`.
 *
 * `null` is a good answer and by far the most common one for the awkward tail of any library.
 * The game still gets imported — with the platform's own title and art, flagged as
 * unidentified — and the user can fix it in a few seconds on its own page. A wrong match, by
 * contrast, merges two games into one row and takes a rating and a review with it.
 */
export function bestMatch<T>(candidates: Scored<T>[]): T | null {
  if (!candidates.length) return null;

  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const [winner, runnerUp] = ranked;

  if (winner.score < TITLE_MATCH_THRESHOLD) return null;
  if (runnerUp && winner.score - runnerUp.score < TITLE_MATCH_MARGIN) return null;
  return winner.item;
}
