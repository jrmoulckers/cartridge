/**
 * The connector interface.
 *
 * A connector is one platform's answer to three questions: what does this person own,
 * what have they played lately, and what have they achieved. Steam (phase 3) and Xbox
 * (phase 4) implement it; PlayStation and Nintendo follow. The shape of the seam was a
 * design decision made in phase 2, before any platform could bend it into its own shape.
 *
 * Phase 4 is where that held up or didn't, and it mostly held: three additive changes —
 * {@link Capabilities.playtimeCoverage}, {@link ConnectorGame.achievements} and the plan's
 * `matchingIncomplete` — were all the second platform needed. Each is documented where it
 * sits with the Xbox fact that forced it.
 *
 * Three rules the interface exists to enforce:
 *
 * 1. **A connector is optional.** The app is complete without any. Every method may fail,
 *    and failing is a normal outcome, not an exception path bolted on later.
 * 2. **A connector is isolated.** It reports its own errors and its own status; the
 *    registry ({@link ./registry}) makes sure a throwing connector degrades one platform
 *    and nothing else.
 * 3. **A connector never invents playtime.** {@link ConnectorGame.minutesPlayed} is
 *    `number | null`, and `null` means "this platform does not report it". Writing `0`
 *    there would be a lie that shows up in the user's stats forever.
 */
import type { Achievements, Platform } from '../types';

// ── Capabilities ────────────────────────────────────────────────────────────

/**
 * What a platform can actually tell us. The UI reads these instead of hard-coding
 * per-platform quirks, so "PlayStation has no playtime" is a value, not an `if`.
 */
export interface Capabilities {
  /** Reports total time played per game — at all, for anything. */
  playtime: boolean;
  /**
   * *How much* of the library that figure covers, when `playtime` is true.
   *
   * Phase 4 added this rather than widening `playtime` itself, because they are two different
   * questions and conflating them loses the answer to one of them. Steam reports minutes for
   * every owned game (`complete`). Xbox reports them for whichever titles happen to define a
   * `MinutesPlayed` stat and nothing for the rest (`partial`), so a `null` there is normal
   * rather than a fault — and the UI should say "some games" instead of implying a gap is a
   * failure. Absent means `complete`, which is the behaviour Steam already had.
   */
  playtimeCoverage?: 'complete' | 'partial';
  /** Reports achievements/trophies. */
  achievements: boolean;
  /** Reports a last-played timestamp. */
  lastPlayed: boolean;
  /** Backed by a documented, official API rather than a reverse-engineered endpoint. */
  official: boolean;
  /** Requires the bridge (an OAuth secret or a server-side call). */
  requiresBridge: boolean;
}

// ── Credentials and auth ────────────────────────────────────────────────────

/**
 * Whatever a connector needs to talk to its platform, as it is stored on-device.
 *
 * Opaque on purpose: only the owning connector interprets it. Credentials live in
 * IndexedDB on the user's device and are sent to the bridge per request, never persisted
 * there — see ARCHITECTURE.md.
 */
export interface Credentials {
  [key: string]: string | number | undefined;
  /** When the stored access token stops working, if it expires at all. */
  expiresAt?: number;
}

export type AuthStatus = 'disconnected' | 'connected' | 'expired' | 'error';

export interface AuthResult {
  status: AuthStatus;
  credentials?: Credentials;
  /** A human sentence for the UI when `status` is 'error' or 'expired'. */
  message?: string;
}

// ── Data a connector returns ────────────────────────────────────────────────

/** One game as a platform reports it, before matching against the library. */
export interface ConnectorGame {
  /** The platform's own id — Steam appid, Xbox titleId, PSN npCommunicationId. */
  externalId: string;
  /** The title exactly as the platform spells it, noise and all. */
  title: string;
  /**
   * Total minutes played, or `null` when the platform does not report playtime at all.
   * Never substitute `0`.
   */
  minutesPlayed: number | null;
  lastPlayedAt?: number;
  /** Cover or icon URL the platform provides, if any. */
  imageUrl?: string;
  /**
   * Achievement progress, when the platform reports it *with* the library.
   *
   * Phase 4 added this. Steam is strictly one HTTP call per game for achievements, so the
   * interface assumed a second round-trip was unavoidable; Xbox's title history carries the
   * counts inline, and forcing it to throw them away and re-ask would cost one request per
   * game against a 150-per-hour budget. A connector that has the numbers already says so here;
   * one that doesn't leaves it undefined and the caller falls back to
   * {@link Connector.fetchAchievements}.
   */
  achievements?: Achievements;
}

export interface ConnectorAchievements {
  externalId: string;
  achievements: Achievements;
}

/** A page of results. Connectors paginate; the caller loops until `cursor` is undefined. */
export interface Page<T> {
  items: T[];
  cursor?: string;
}

export interface FetchOptions {
  credentials: Credentials;
  signal?: AbortSignal;
  cursor?: string;
  /** For `fetchRecent`: only games touched since this timestamp. */
  since?: number;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type ConnectorErrorKind =
  /** Credentials are missing, rejected or expired — the user must reconnect. */
  | 'auth'
  /**
   * The credential is fine, but the account's privacy settings hide what we asked for.
   * Distinct from `auth` on purpose: reconnecting will not help, and telling someone to
   * sign in again when the real fix is a privacy toggle sends them in a circle. Steam's
   * private profile is the common case; carry a {@link ConnectorError.helpUrl} with it.
   */
  | 'private'
  /** The platform said "slow down". Retry after `retryAfterMs`. */
  | 'rate-limit'
  /** The bridge or the platform was unreachable. Usually transient. */
  | 'network'
  /** The platform answered, but not with anything we recognise. */
  | 'unsupported'
  /** Anything else. */
  | 'unknown';

/**
 * The only error type a connector should throw. Carries enough for the UI to say
 * something true and specific about *one* platform without knowing what a connector is.
 */
export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly platform: Platform;
  readonly retryAfterMs?: number;
  /**
   * Where the user can fix this themselves — the exact settings page, not a homepage.
   * The UI renders it as a link without knowing which platform produced it.
   */
  readonly helpUrl?: string;

  constructor(
    platform: Platform,
    kind: ConnectorErrorKind,
    message: string,
    options?: { retryAfterMs?: number; cause?: unknown; helpUrl?: string },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ConnectorError';
    this.platform = platform;
    this.kind = kind;
    this.retryAfterMs = options?.retryAfterMs;
    this.helpUrl = options?.helpUrl;
  }
}

// ── The interface itself ────────────────────────────────────────────────────

export interface Connector {
  readonly platform: Platform;
  /** Display name, e.g. "Steam". */
  readonly label: string;
  readonly capabilities: Capabilities;

  /**
   * Establish or refresh access. Called on connect, and again whenever a fetch reports
   * `kind: 'auth'`. Implementations must not throw for an ordinary refusal — return
   * `{ status: 'error', message }` instead, and reserve {@link ConnectorError} for faults.
   */
  authenticate(existing?: Credentials): Promise<AuthResult>;

  /** Everything the user owns on this platform, one page at a time. */
  fetchLibrary(options: FetchOptions): Promise<Page<ConnectorGame>>;

  /**
   * Just what has moved recently — the cheap call a background refresh makes.
   * A platform with no "recent" concept may return the same data as `fetchLibrary`.
   */
  fetchRecent(options: FetchOptions): Promise<Page<ConnectorGame>>;

  /**
   * Achievements for a bounded set of games.
   *
   * Phase 3 amended this: it originally said "or for everything when `externalId` is
   * omitted", which no real platform can honour. Steam is strictly one HTTP call per
   * appid, so "everything" is a thousand requests, not a query. Callers therefore ask for
   * the games they care about — one via `externalId`, several via `externalIds` — and a
   * connector given neither returns an empty page rather than fetching the world.
   *
   * Connectors whose `capabilities.achievements` is false always return an empty page.
   */
  fetchAchievements(
    options: FetchOptions & { externalId?: string; externalIds?: string[] },
  ): Promise<Page<ConnectorAchievements>>;

  /** Optional: revoke tokens and forget device state. */
  disconnect?(credentials: Credentials): Promise<void>;
}
