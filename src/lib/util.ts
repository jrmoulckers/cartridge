/** Small shared helpers. Pure and DOM-free so they can be unit-tested directly. */

/** Stable unique id. `crypto.randomUUID` where available, with a safe fallback. */
export function uid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Collapse whitespace and trim — what we store for any user-typed short string. */
export function cleanText(value: string, max = 200): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

const LEADING_ARTICLE = /^(the|a|an)\s+/i;

/**
 * Sort/search key for a title: lower-cased, leading article dropped, punctuation and
 * diacritics flattened. "The Legend of Zelda: Breath of the Wild" → "legend of zelda
 * breath of the wild", so it files under L and matches a query typed without the colon.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(LEADING_ARTICLE, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Split a normalized string into search tokens. */
export function tokenize(value: string): string[] {
  const normalized = normalizeTitle(value);
  return normalized ? normalized.split(' ') : [];
}

/** Midnight-local ms epoch for a `yyyy-mm-dd` input value, or undefined when empty. */
export function parseDateInput(value: string): number | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d).getTime();
}

/** `yyyy-mm-dd` for a date input, or '' when unset. */
export function toDateInput(ms: number | undefined): string {
  if (ms == null) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Human date, e.g. "12 Mar 2025". Empty string when unset. */
export function formatDate(ms: number | undefined): string {
  if (ms == null) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Playtime for display. `null` means the platform does not report playtime at all —
 * that is not "0h" and must not be rendered as one.
 */
export function formatPlaytime(minutes: number | null | undefined): string {
  if (minutes == null) return 'Not reported';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours)}h`;
}

/** Clamp a star rating to the 0.5–5 half-step scale, or undefined to clear it. */
export function clampRating(value: number | undefined): number | undefined {
  if (value == null || Number.isNaN(value) || value <= 0) return undefined;
  return Math.min(5, Math.max(0.5, Math.round(value * 2) / 2));
}

/** Clamp the optional precision score to a whole 1–100, or undefined to clear it. */
export function clampScore(value: number | undefined): number | undefined {
  if (value == null || Number.isNaN(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1) return undefined;
  return Math.min(100, rounded);
}

/** De-duplicate, trim and drop empties from a user-entered list (tags, genres). */
export function cleanList(values: string[], max = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = cleanText(value, 60);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

/** Parse a comma-separated field into a clean list. */
export function parseList(value: string): string[] {
  return cleanList(value.split(','));
}
