import { describe, it, expect } from 'vitest';
import { parseRoute, titleForRoute } from './router';

describe('parseRoute', () => {
  it('maps the root to the library', () => {
    expect(parseRoute('/')).toEqual({ name: 'library', params: {} });
    expect(parseRoute('')).toEqual({ name: 'library', params: {} });
  });

  it('maps the top-level pages', () => {
    expect(parseRoute('/add').name).toBe('add');
    expect(parseRoute('/shelves').name).toBe('shelves');
    expect(parseRoute('/stats').name).toBe('stats');
    expect(parseRoute('/settings').name).toBe('settings');
  });

  it('maps a year in review, with or without the year', () => {
    expect(parseRoute('/year')).toEqual({ name: 'year', params: {} });
    expect(parseRoute('/year/2026')).toEqual({ name: 'year', params: { year: '2026' } });
    expect(parseRoute('/year/2026/')).toEqual({ name: 'year', params: { year: '2026' } });
  });

  it('refuses a year that is not one', () => {
    expect(parseRoute('/year/last').name).toBe('notfound');
    expect(parseRoute('/year/20').name).toBe('notfound');
  });

  it('maps a game deep link, trailing slash or not', () => {
    expect(parseRoute('/game/abc')).toEqual({ name: 'game', params: { id: 'abc' } });
    expect(parseRoute('/game/abc/')).toEqual({ name: 'game', params: { id: 'abc' } });
  });

  it('falls back to not-found', () => {
    expect(parseRoute('/nope').name).toBe('notfound');
    expect(parseRoute('/game').name).toBe('notfound');
  });
});

describe('titleForRoute', () => {
  it('uses the bare app name on the library', () => {
    expect(titleForRoute({ name: 'library', params: {} })).toBe('Cartridge');
  });

  it('prefixes other pages', () => {
    expect(titleForRoute({ name: 'settings', params: {} })).toBe('Settings · Cartridge');
  });

  it('prefers a subject when the page knows one', () => {
    expect(titleForRoute({ name: 'game', params: {} }, 'Hades')).toBe('Hades · Cartridge');
  });
});
