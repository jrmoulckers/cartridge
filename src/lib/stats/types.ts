/**
 * The shapes every statistic in Cartridge is expressed in.
 *
 * There is exactly one interesting idea here, and the whole module exists to enforce it:
 * **a number without its denominator is a lie.** Cartridge's data is structurally
 * incomplete — Steam reports playtime, Xbox reports it for some titles, PlayStation reports
 * none at all, and a game can be finished with no finish date or rated with no review. So
 * "you played 412 hours" is false the moment half the library reports nothing, and
 * "412 hours across 38 of your 91 games" is both true and more interesting.
 *
 * Every measure therefore travels with the count of items it could actually see. The UI
 * never gets the opportunity to render a partial number as a complete one, because it never
 * receives a bare number.
 */

/**
 * A value that knows how much of the library it could see.
 *
 * - `value === null` means the measure could not be computed **honestly at all**. The UI
 *   renders {@link Measure.reason}, never a zero — "no platform reports playtime for these
 *   games" is information; "0h" is a fabrication.
 * - `covered < total` means the value is real but partial, and the UI must show the
 *   denominator alongside it.
 * - `covered === total` is a complete number and needs no apology.
 *
 * A zero `value` is never the same thing as a `null` one. A library where every game reports
 * a real `0` minutes has `value: 0, covered: n` — the user has genuinely played nothing, and
 * that is a fact worth stating.
 */
export interface Measure<T> {
  value: T | null;
  /** Items that contributed a real value. */
  covered: number;
  /** Items that were in scope, whether or not they contributed. */
  total: number;
  /** Why `value` is `null`, or what the uncovered items are. Rendered verbatim. */
  reason?: string;
}

/** Build a measure from a value that exists. */
export function measure<T>(value: T, covered: number, total: number, reason?: string): Measure<T> {
  return reason == null ? { value, covered, total } : { value, covered, total, reason };
}

/** Build a measure for something that cannot be computed honestly, and say why. */
export function unavailable<T>(total: number, reason: string): Measure<T> {
  return { value: null, covered: 0, total, reason };
}

/** True when a measure saw everything it was asked about. */
export function isComplete(m: Measure<unknown>): boolean {
  return m.value !== null && m.covered === m.total;
}

/** True when a measure saw something, but not everything. */
export function isPartial(m: Measure<unknown>): boolean {
  return m.value !== null && m.covered < m.total;
}

/** Items a measure could not see. Never negative. */
export function missing(m: Measure<unknown>): number {
  return Math.max(0, m.total - m.covered);
}

/**
 * One bar of a distribution. `label` is the text equivalent — charts in Cartridge are text
 * first and SVG second, so a bar always carries the words a screen reader needs.
 */
export interface Bucket {
  /** The value being counted, used as a key and for stable sorting. */
  key: string;
  /** Human label, shown as text next to the bar. */
  label: string;
  count: number;
  /** Optional secondary figure, e.g. the user's average rating for a genre. */
  detail?: number;
}

/**
 * A set of buckets plus the coverage of the distribution as a whole — how many items carried
 * the dimension at all. A genre chart over a library where 60 of 91 games have no genres is
 * a chart about 31 games, and it says so.
 */
export interface Distribution {
  buckets: Bucket[];
  covered: number;
  total: number;
  /** What the uncovered items are missing. */
  reason?: string;
}

/** The largest count in a distribution, for scaling bars. `0` when empty. */
export function peak(d: Distribution): number {
  return d.buckets.reduce((max, b) => Math.max(max, b.count), 0);
}

/** A named game, for the "extremes" measures. Kept minimal so stats stay DOM-free. */
export interface GameRef {
  id: string;
  title: string;
  /** The figure that won it the spot — minutes, a rating, a year. */
  amount: number;
}
