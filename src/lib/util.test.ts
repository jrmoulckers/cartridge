import { describe, expect, it } from 'vitest';
import {
  cleanList,
  cleanText,
  clampRating,
  clampScore,
  formatDate,
  formatPlaytime,
  normalizeTitle,
  parseDateInput,
  parseList,
  toDateInput,
  tokenize,
} from './util';

describe('formatPlaytime — the unreported rule', () => {
  // PlayStation does not report playtime at all. `null` is "we were never told",
  // which is a different fact from "you played it for no time". Rendering it as
  // "0h" would be Cartridge inventing data about the user's own life.
  it('renders null as "Not reported", never as a number', () => {
    expect(formatPlaytime(null)).toBe('Not reported');
    expect(formatPlaytime(null)).not.toContain('0');
  });

  it('renders undefined the same way', () => {
    expect(formatPlaytime(undefined)).toBe('Not reported');
  });

  it('renders a genuine zero as zero, distinctly from unreported', () => {
    expect(formatPlaytime(0)).toBe('0m');
    expect(formatPlaytime(0)).not.toBe(formatPlaytime(null));
  });

  it('uses minutes below an hour', () => {
    expect(formatPlaytime(1)).toBe('1m');
    expect(formatPlaytime(59)).toBe('59m');
  });

  it('uses one decimal hour up to ten hours, then whole hours', () => {
    expect(formatPlaytime(60)).toBe('1.0h');
    expect(formatPlaytime(90)).toBe('1.5h');
    expect(formatPlaytime(599)).toBe('10.0h');
    expect(formatPlaytime(600)).toBe('10h');
    expect(formatPlaytime(1250)).toBe('21h');
  });
});

describe('clampRating', () => {
  it('snaps to half steps', () => {
    expect(clampRating(3.3)).toBe(3.5);
    expect(clampRating(3.2)).toBe(3);
    expect(clampRating(4.75)).toBe(5);
  });

  it('clears on zero, negative, undefined or NaN', () => {
    expect(clampRating(0)).toBeUndefined();
    expect(clampRating(-2)).toBeUndefined();
    expect(clampRating(undefined)).toBeUndefined();
    expect(clampRating(Number.NaN)).toBeUndefined();
  });

  it('never exceeds the scale', () => {
    expect(clampRating(9)).toBe(5);
    expect(clampRating(0.1)).toBe(0.5);
  });
});

describe('clampScore', () => {
  it('rounds into 1–100', () => {
    expect(clampScore(92.4)).toBe(92);
    expect(clampScore(140)).toBe(100);
  });

  it('clears on zero, NaN or undefined', () => {
    expect(clampScore(0)).toBeUndefined();
    expect(clampScore(Number.NaN)).toBeUndefined();
    expect(clampScore(undefined)).toBeUndefined();
  });
});

describe('normalizeTitle and tokenize', () => {
  it('drops leading articles, diacritics and punctuation', () => {
    expect(normalizeTitle('The Legend of Zelda: Breath of the Wild')).toBe(
      'legend of zelda breath of the wild',
    );
    expect(normalizeTitle('Ōkami HD')).toBe('okami hd');
    expect(normalizeTitle('A Short Hike')).toBe('short hike');
  });

  it('tokenizes to searchable words and handles the empty case', () => {
    expect(tokenize('Hollow  Knight')).toEqual(['hollow', 'knight']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('text and list helpers', () => {
  it('collapses whitespace and caps length', () => {
    expect(cleanText('  Hades   II  ')).toBe('Hades II');
    expect(cleanText('x'.repeat(300)).length).toBe(200);
  });

  it('de-duplicates case-insensitively and drops empties', () => {
    expect(cleanList(['RPG', ' rpg ', '', 'Indie'])).toEqual(['RPG', 'Indie']);
    expect(parseList('Action, , action ,Roguelike')).toEqual(['Action', 'Roguelike']);
  });
});

describe('date helpers', () => {
  it('round-trips a date input through midnight-local ms', () => {
    const ms = parseDateInput('2025-03-12');
    expect(ms).toBeTypeOf('number');
    expect(toDateInput(ms)).toBe('2025-03-12');
  });

  it('treats empty and malformed input as unset', () => {
    expect(parseDateInput('')).toBeUndefined();
    expect(parseDateInput('not-a-date')).toBeUndefined();
    expect(toDateInput(undefined)).toBe('');
    expect(formatDate(undefined)).toBe('');
  });
});
