/**
 * The wording of honesty, as tests.
 *
 * A complete number must not be padded with a pointless denominator — "across 91 of your 91
 * games" is noise that teaches people to stop reading the sentence, which is exactly the
 * sentence that matters on the partial ones.
 */
import { describe, it, expect } from 'vitest';
import {
  coverageBadge,
  coverageSentence,
  distributionSentence,
  formatCount,
  formatHours,
  formatPercent,
  formatRating,
  pluralize,
  remainderSentence,
} from './format';
import { measure, unavailable } from './types';

describe('coverageSentence', () => {
  it('says nothing when a number saw everything', () => {
    expect(coverageSentence(measure(412, 91, 91))).toBe('');
  });

  it('names the denominator when a number saw only some of it', () => {
    const sentence = coverageSentence(measure(412, 38, 91));
    expect(sentence).toContain('38');
    expect(sentence).toContain('91 games');
  });

  it('appends the measure’s own reason to the denominator', () => {
    const sentence = coverageSentence(measure(412, 38, 91, 'The rest don’t report playtime.'));
    expect(sentence).toContain('38');
    expect(sentence).toContain('don’t report playtime');
  });

  it('gives the reason alone when there is no number to qualify', () => {
    expect(coverageSentence(unavailable(91, 'No platform reports playtime.'))).toBe(
      'No platform reports playtime.',
    );
  });
});

describe('the badge and the remainder', () => {
  it('badges only partial measures', () => {
    expect(coverageBadge(measure(1, 91, 91))).toBeNull();
    expect(coverageBadge(measure(1, 38, 91))).toBe('38 of 91');
    expect(coverageBadge(unavailable(91, 'nope'))).toBeNull();
  });

  it('counts what was left out', () => {
    expect(remainderSentence(measure(1, 38, 91))).toBe('53 games not counted.');
    expect(remainderSentence(measure(1, 91, 91))).toBe('');
  });
});

describe('distributionSentence', () => {
  it('says nothing when every game is in the chart', () => {
    expect(distributionSentence({ buckets: [], covered: 5, total: 5 })).toBe('');
  });

  it('names what is missing, singular and plural', () => {
    expect(distributionSentence({ buckets: [], covered: 4, total: 5 })).toContain('1 game is');
    expect(distributionSentence({ buckets: [], covered: 3, total: 5 })).toContain('2 games are');
  });
});

describe('number formatting', () => {
  it('never renders an absent value as zero', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatRating(null)).toBe('—');
    expect(formatHours(null)).toBe('Not reported');
  });

  it('renders a real zero as zero', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatHours(0)).toBe('0m');
    expect(formatCount(0)).toBe('0');
  });

  it('pluralizes', () => {
    expect(pluralize(1, 'game')).toBe('1 game');
    expect(pluralize(2, 'game')).toBe('2 games');
  });

  it('keeps a rating to one decimal', () => {
    expect(formatRating(4)).toBe('4.0');
    expect(formatRating(3.75)).toBe('3.8');
  });
});
