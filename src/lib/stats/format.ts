/**
 * The words a statistic is allowed to be said in.
 *
 * Honesty about coverage is the whole point of this phase, and honesty implemented as fifty
 * hand-written strings scattered through two Svelte pages is honesty that will drift by the
 * third change. So the wording lives here, as pure functions with tests, and the components
 * only decide *where* a sentence goes.
 *
 * The voice follows `DESIGN.md`: plain, warm, never anxious, and never apologising for the
 * user's own library.
 */
import { formatPlaytime } from '../util';
import type { Distribution, Measure } from './types';
import { isComplete, missing } from './types';

/** `12` → "12"; `1234` → "1,234". Counts sit in columns, so they stay tabular in CSS. */
export function formatCount(n: number): string {
  return n.toLocaleString();
}

/** "1 game" / "7 games", so no sentence ever reads "1 games". */
export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : plural}`;
}

/** A 0–1 fraction as a whole percent. `null` is not a percent and is never rendered as 0%. */
export function formatPercent(fraction: number | null): string {
  return fraction == null ? '—' : `${Math.round(fraction * 100)}%`;
}

/** Total playtime for display. Delegates the `null` → "Not reported" contract to `util`. */
export function formatHours(minutes: number | null | undefined): string {
  return formatPlaytime(minutes);
}

/** A star average to one decimal, trailing `.0` kept so a column doesn't wobble. */
export function formatRating(rating: number | null): string {
  return rating == null ? '—' : rating.toFixed(1);
}

/**
 * The denominator sentence for a measure.
 *
 * - Complete → `''`. A number that saw everything needs no apology, and adding "across 91 of
 *   your 91 games" to it is noise that trains people to stop reading the ones that matter.
 * - Partial → "Across 38 of your 91 games." plus the measure's own reason.
 * - Unavailable → the reason alone, because there is no number to qualify.
 */
export function coverageSentence(m: Measure<unknown>, noun = 'game'): string {
  if (m.value === null) return m.reason ?? 'Not enough data to say.';
  if (isComplete(m)) return m.reason ?? '';
  const scope = `Across ${formatCount(m.covered)} of your ${pluralize(m.total, noun)}.`;
  return m.reason ? `${scope} ${m.reason}` : scope;
}

/** The same idea for a chart: what the bars don't include. `''` when they include everything. */
export function distributionSentence(d: Distribution, noun = 'game'): string {
  const absent = Math.max(0, d.total - d.covered);
  if (!absent) return '';
  const scope = `${pluralize(absent, noun)} ${absent === 1 ? 'is' : 'are'} not in this chart.`;
  return d.reason ? `${scope} ${d.reason}` : scope;
}

/**
 * A short label for a measure's completeness, for the badge next to a headline number.
 * Deliberately neutral: "partial" is a property of the data, not a criticism of the user.
 */
export function coverageBadge(m: Measure<unknown>): string | null {
  if (m.value === null) return null;
  return isComplete(m) ? null : `${formatCount(m.covered)} of ${formatCount(m.total)}`;
}

/** "and 53 more we can't see" — for the tail of a list. `''` when nothing is hidden. */
export function remainderSentence(m: Measure<unknown>, noun = 'game'): string {
  const n = missing(m);
  return n ? `${pluralize(n, noun)} not counted.` : '';
}
