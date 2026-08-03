/**
 * Xbox, brokered — through OpenXBL, and warily.
 *
 * Three things make this module different from `steam.ts`, and every one of them shows up in
 * the code rather than only in a comment:
 *
 * 1. **OpenXBL is unofficial.** It is a third-party proxy over Xbox Live, not a documented
 *    Microsoft API, and Microsoft has never promised it anything. So nothing here trusts a
 *    response's shape: every field is checked before it is used, and a title that doesn't
 *    survive the check is dropped rather than passed along half-formed. A garbage response is
 *    an expected outcome, not an exceptional one.
 * 2. **The key belongs to the user, not to the bridge.** There is no `XBOX_API_KEY` in the
 *    worker's environment and there never will be. The user creates their own free key at
 *    xbl.io, it lives in their browser, and it arrives here in the `X-XBL-Key` header for the
 *    one request
 *    that needs it. A header rather than a query parameter on purpose: query strings end up in
 *    access logs, `Referer` headers and browser history, and a long-lived credential has no
 *    business in any of them. It is used inside the request and forgotten — never logged,
 *    never written to KV, never returned to anyone.
 * 3. **The budget is 150 requests an hour.** That is the free tier, and it is the single
 *    biggest constraint on the design. The saving grace is that `player/titleHistory` carries
 *    achievement counts *and* last-played inline, so a whole library — however large — costs
 *    one request. Playtime costs one more, because `player/stats` batches. A full sync is
 *    three requests, not one per game, and that is why it fits.
 *
 * Nothing about a user is cached. There is no KV key in this file at all: a title history is
 * a fact about a person, and the bridge does not keep facts about people.
 */
import type { XboxAccount, XboxAchievements, XboxGame } from './types';
import { UpstreamError } from './igdb';

const API = 'https://xbl.io/api/v2';

/** Where a user signs up and finds their own key. Travels with every auth failure. */
export const OPENXBL_KEY_URL = 'https://xbl.io/';

/** An XUID is a decimal string. Bound it so a path is never built from arbitrary input. */
const XUID = /^\d{1,20}$/;
/** Xbox title ids are decimal too. Anything else never reaches upstream. */
const TITLE_ID = /^\d{1,20}$/;

/**
 * An OpenXBL key as it may appear in a header.
 *
 * Deliberately loose on *format* and strict on *shape*: xbl.io issues UUID-ish keys today, but
 * a third party may change that tomorrow and rejecting a user's perfectly good key because it
 * grew a character would be an own goal. What this does guarantee is that the value cannot
 * smuggle a newline or a control character into an outbound header.
 */
const KEY = /^[A-Za-z0-9._~+/=-]{16,200}$/;

export function isOpenXblKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && KEY.test(value);
}

export function isXuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && XUID.test(value);
}

export function isTitleId(value: string | null | undefined): value is string {
  return typeof value === 'string' && TITLE_ID.test(value);
}

/** The credential was rejected. Its own type so the router can answer with its own code. */
export class XboxAuthError extends Error {
  readonly helpUrl = OPENXBL_KEY_URL;
  constructor(message = 'OpenXBL rejected that API key.') {
    super(message);
    this.name = 'XboxAuthError';
  }
}

/** A throttle, carrying how long to wait. Distinct so the router can set `retry-after`. */
export class RateLimited extends Error {
  readonly retryAfterS: number;
  constructor(retryAfterS: number) {
    super('OpenXBL is rate-limiting this key. Its free tier allows 150 requests an hour.');
    this.name = 'RateLimited';
    this.retryAfterS = retryAfterS;
  }
}

/**
 * One call to OpenXBL.
 *
 * The key is set as a header on the outbound request and appears nowhere else — not in the
 * URL we build, not in an error message, not in anything this function can throw. Every
 * failure below is deliberately generic about *why*, because an upstream body from an
 * unofficial proxy is the last thing that should be reflected back to a browser.
 */
async function call<T>(
  key: string,
  path: string,
  init?: { method: 'POST'; body: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        'x-authorization': key,
        accept: 'application/json',
        ...(init ? { 'content-type': 'application/json' } : {}),
      },
      body: init ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new UpstreamError(502, 'Xbox could not be reached.');
  }

  if (response.status === 401 || response.status === 403) throw new XboxAuthError();
  if (response.status === 429) {
    // OpenXBL's free tier is an hourly quota, so its own retry hint is worth carrying when it
    // sends one — guessing "a minute" would just invite the user to fail again immediately.
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new RateLimited(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 3600);
  }
  if (!response.ok) throw new UpstreamError(502, 'Xbox returned an error.');

  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamError(502, 'Xbox returned something unreadable.');
  }
}

// ── Account ─────────────────────────────────────────────────────────────────

interface RawSetting {
  id?: string;
  value?: string;
}

interface RawProfile {
  id?: string;
  settings?: RawSetting[];
}

/**
 * Who this key belongs to.
 *
 * Xbox Live returns a profile as a bag of `{ id, value }` settings rather than named fields,
 * so this reads the two that matter by name and shrugs at the rest. The XUID is what every
 * other endpoint is keyed by; the gamertag is the only thing the app ever displays, and it is
 * shown precisely so the user can confirm the key is the account they meant.
 */
export async function getAccount(key: string): Promise<XboxAccount> {
  const data = await call<{ profileUsers?: RawProfile[] }>(key, '/account');

  const profile = Array.isArray(data?.profileUsers) ? data.profileUsers[0] : undefined;
  if (!profile || !isXuid(profile.id)) {
    throw new UpstreamError(502, 'Xbox did not say whose account that key belongs to.');
  }

  const settings = new Map(
    (Array.isArray(profile.settings) ? profile.settings : [])
      .filter((s): s is Required<RawSetting> => typeof s?.id === 'string' && typeof s.value === 'string')
      .map((s) => [s.id, s.value] as const),
  );

  const gamerscore = Number(settings.get('Gamerscore'));
  return {
    xuid: profile.id,
    gamertag: settings.get('Gamertag')?.trim() || 'Xbox account',
    gamerscore: Number.isFinite(gamerscore) && gamerscore >= 0 ? gamerscore : undefined,
  };
}

// ── Title history — the library ─────────────────────────────────────────────

interface RawTitle {
  titleId?: string | number;
  name?: string;
  displayImage?: string;
  achievement?: {
    currentAchievements?: number;
    totalAchievements?: number;
  };
  titleHistory?: {
    lastTimePlayed?: string;
  };
}

/** An ISO timestamp from an unofficial proxy, turned into a number or nothing at all. */
function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const ms = Date.parse(value);
  // A zero or a negative is Xbox's "never", not 1970 — and neither is worth storing.
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/**
 * Achievement counts as the title history reports them.
 *
 * `null` for "this game has no achievements", which is a fact about the game and not a
 * failure. A 0-of-0 would render as an empty progress bar forever, which says something false.
 * Anything incoherent — a negative, more earned than exist, a non-integer — is dropped rather
 * than stored, because an unofficial proxy is exactly where an incoherent number comes from.
 */
function parseAchievements(raw: RawTitle['achievement']): { earned: number; total: number } | null {
  const earned = raw?.currentAchievements;
  const total = raw?.totalAchievements;
  if (typeof earned !== 'number' || typeof total !== 'number') return null;
  if (!Number.isInteger(earned) || !Number.isInteger(total)) return null;
  if (total <= 0 || earned < 0 || earned > total) return null;
  return { earned, total };
}

function normalizeTitle(raw: RawTitle): XboxGame | null {
  const titleId =
    typeof raw?.titleId === 'number' ? String(raw.titleId) : raw?.titleId;
  if (!isTitleId(titleId)) return null;

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const image = typeof raw.displayImage === 'string' ? raw.displayImage : undefined;

  return {
    titleId,
    title: name || `Title ${titleId}`,
    // Always `null` here, and that is the honest answer rather than a placeholder: the title
    // history carries no playtime at all. Whatever minutes exist come from `getPlaytime`, and
    // for most games there are none — which is `null`, never a fabricated `0`.
    minutesPlayed: null,
    lastPlayedAt: parseTimestamp(raw.titleHistory?.lastTimePlayed),
    imageUrl: image && /^https:\/\//.test(image) ? image : undefined,
    achievements: parseAchievements(raw.achievement),
  };
}

/**
 * Everything Xbox Live remembers this account playing.
 *
 * One request for the whole library, achievements and last-played included. That is the reason
 * an Xbox sync fits inside a 150-per-hour budget at all, and it is why the connector does not
 * fan out one achievement call per game the way Steam has to.
 *
 * Note what this is *not*: an ownership list. Xbox's title history is what has been played,
 * which is a different set from what has been bought — a never-launched purchase is simply
 * absent. That is a limitation of the platform rather than of this code, and the app says so
 * rather than implying the import is a complete library.
 */
export async function getTitleHistory(key: string, xuid: string): Promise<XboxGame[]> {
  if (!isXuid(xuid)) throw new UpstreamError(400, 'That is not an Xbox user id.');

  const data = await call<{ titles?: RawTitle[] }>(key, `/player/titleHistory/${xuid}`);
  const titles = data?.titles;
  if (!Array.isArray(titles)) {
    throw new UpstreamError(502, 'Xbox returned something that was not a title history.');
  }

  const seen = new Set<string>();
  const games: XboxGame[] = [];
  for (const raw of titles) {
    const game = normalizeTitle(raw);
    if (!game || seen.has(game.titleId)) continue;
    seen.add(game.titleId);
    games.push(game);
  }
  return games;
}

// ── Playtime ────────────────────────────────────────────────────────────────

interface RawStat {
  titleid?: string | number;
  name?: string;
  value?: string | number;
}

/**
 * Minutes played, for the titles that report any.
 *
 * `MinutesPlayed` is a per-title *statistic* a game chooses to publish, not something Xbox
 * tracks centrally, so most titles simply have none. The batch endpoint takes many title ids
 * in one call, which is the only reason asking is affordable at all — and a title that comes
 * back without a figure is left out of the result entirely rather than being given a `0`. The
 * caller turns absence into `null`, which renders as "Not reported".
 */
export async function getPlaytime(
  key: string,
  xuid: string,
  titleIds: string[],
): Promise<Record<string, number>> {
  if (!isXuid(xuid)) throw new UpstreamError(400, 'That is not an Xbox user id.');
  const ids = titleIds.filter(isTitleId);
  if (!ids.length) return {};

  const data = await call<{
    statlistscollection?: { stats?: RawStat[] }[];
  }>(key, '/player/stats', {
    method: 'POST',
    body: {
      xuids: [xuid],
      stats: ids.map((titleId) => ({ name: 'MinutesPlayed', titleId })),
    },
  });

  const out: Record<string, number> = {};
  for (const list of Array.isArray(data?.statlistscollection) ? data.statlistscollection : []) {
    for (const stat of Array.isArray(list?.stats) ? list.stats : []) {
      if (stat?.name !== 'MinutesPlayed') continue;
      const titleId = typeof stat.titleid === 'number' ? String(stat.titleid) : stat.titleid;
      if (!isTitleId(titleId)) continue;
      // Xbox sends statistic values as strings often enough that a number is the exception.
      const minutes = Number(stat.value);
      if (!Number.isFinite(minutes) || minutes < 0) continue;
      out[titleId] = Math.round(minutes);
    }
  }
  return out;
}

// ── Per-title achievements ──────────────────────────────────────────────────

interface RawAchievement {
  progressState?: string;
  progression?: { timeUnlocked?: string };
}

/**
 * One title's achievements, counted.
 *
 * The title history already carries these numbers, so this exists for the case the history
 * cannot serve: a single game the user has opened and wants refreshed on its own. It costs one
 * request per title, which is why nothing calls it in a loop over a library.
 */
export async function getTitleAchievements(
  key: string,
  xuid: string,
  titleId: string,
): Promise<XboxAchievements> {
  if (!isXuid(xuid)) throw new UpstreamError(400, 'That is not an Xbox user id.');
  if (!isTitleId(titleId)) throw new UpstreamError(400, 'That is not an Xbox title id.');

  let rows: RawAchievement[] = [];
  try {
    const data = await call<{ achievements?: RawAchievement[] }>(
      key,
      `/achievements/player/${xuid}/${titleId}`,
    );
    rows = Array.isArray(data?.achievements) ? data.achievements : [];
  } catch (error) {
    // A throttle and a rejected key are real and must reach the user. Anything else here just
    // means this one game has nothing to say, which is the common case and not a failure.
    if (error instanceof RateLimited || error instanceof XboxAuthError) throw error;
    return { titleId, achievements: null };
  }

  if (!rows.length) return { titleId, achievements: null };
  const earned = rows.filter(
    (row) => row?.progressState === 'Achieved' || Boolean(row?.progression?.timeUnlocked),
  ).length;
  return { titleId, achievements: { earned, total: rows.length } };
}
