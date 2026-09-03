/**
 * Connections and syncing, as the UI sees them.
 *
 * This store is the only place that knows the whole sequence: hold a credential, ask a
 * connector what the platform says, look the appids up in IGDB, build a plan, show it to
 * the user, and — only if they say yes — write it. Components read stores; they never call
 * a connector, a bridge or the database directly.
 *
 * Two things it is careful about:
 *
 * - **Every connector call goes through the registry**, so a platform that fails degrades
 *   that platform and nothing else. Nothing in this file rethrows into a component.
 * - **A large library must not freeze the app.** Work is chunked and yields to the event
 *   loop between batches, and progress is a store so the screen can show it.
 */
import { writable, derived, get } from 'svelte/store';
import type { Achievements, ID, Platform, Status } from '../types';
import * as db from '../storage/db';
import { library, links, refreshLibrary } from './library';
import {
  fetchLibrary as boundedFetchLibrary,
  fetchAchievements,
  getConnector,
} from '../connectors/registry';
import { ConnectorError, type Credentials } from '../connectors/types';
import { ACHIEVEMENT_BATCH, STEAM_PRIVACY_URL } from '../connectors/steam';
import {
  ACHIEVEMENT_BATCH as XBOX_ACHIEVEMENT_BATCH,
  fetchAccount as fetchXboxAccount,
} from '../connectors/xbox';
import { matchSteamAppids, matchTitles, TITLE_BATCH } from '../metadata/igdb';
import type { GameMetadata } from '../metadata/types';
import { applyPlan, type SyncResultRow } from '../connectors/apply';
import { emptyPlan, planSync, type SyncPlan } from '../connectors/sync';

/** How many appids go to the bridge's IGDB lookup at once. Matches its own cap. */
const MATCH_BATCH = 100;
/** Titles written between yields. Big enough to be quick, small enough to stay responsive. */
const APPLY_CHUNK = 25;
/**
 * How many games get an achievement lookup during a sync. Achievements cost one upstream
 * call each, so a full library would be a thousand requests and a rate-limit; the most
 * recently played are the ones anyone actually looks at.
 */
const ACHIEVEMENT_LIMIT = 40;

// ── Connection state ────────────────────────────────────────────────────────

export interface Connection {
  platform: Platform;
  connectedAt: number;
  syncedAt?: number;
  /** A display handle, e.g. the Steam ID. Never a token. */
  account?: string;
}

export const connections = writable<Record<string, Connection>>({});
/** False until the first read resolves, so the UI can tell "not connected" from "loading". */
export const connectionsLoaded = writable(false);

/**
 * Load stored credentials. Reads IndexedDB only — no network, so this is safe to call on
 * boot without breaking the offline guarantee.
 */
export async function refreshConnections(): Promise<void> {
  try {
    const rows = await db.getAllCredentials();
    const next: Record<string, Connection> = {};
    for (const row of rows) {
      next[row.platform] = {
        platform: row.platform,
        connectedAt: row.connectedAt,
        syncedAt: row.syncedAt,
        account:
          typeof row.values.gamertag === 'string'
            ? row.values.gamertag
            : typeof row.values.steamId === 'string'
              ? row.values.steamId
              : undefined,
      };
    }
    connections.set(next);
  } catch {
    connections.set({});
  } finally {
    connectionsLoaded.set(true);
  }
}

export async function connectSteam(steamId: string): Promise<void> {
  await db.setCredentials({
    platform: 'steam',
    values: { steamId },
    connectedAt: Date.now(),
  });
  await refreshConnections();
}

/**
 * Store an OpenXBL key, having first checked it works.
 *
 * The check is the point. A Steam ID is public and inert, so phase 3 could store one on sight;
 * an API key pasted into a text box is neither, and the failure mode of storing an unverified
 * one is a connection that looks fine in Settings and fails at the least convenient moment.
 * So it is exchanged for an XUID and a gamertag first, and only a working key is written.
 *
 * The key itself is stored in the same on-device `credentials` store as everything else —
 * excluded from backups since DB v2, because a long-lived secret has no business in a file
 * people email to themselves.
 */
export async function connectXbox(apiKey: string): Promise<void> {
  const account = await fetchXboxAccount(apiKey.trim());
  await db.setCredentials({
    platform: 'xbox',
    values: { apiKey: apiKey.trim(), xuid: account.xuid, gamertag: account.gamertag },
    connectedAt: Date.now(),
  });
  await refreshConnections();
}

export interface DisconnectResult {
  links: number;
  stats: number;
}

/**
 * Platforms the library is linked to but this device has no credential for.
 *
 * Credentials are deliberately left out of backups — a backup is a file people email
 * themselves and drop in cloud storage, and an account belongs in neither. The cost of that
 * choice is this exact situation: restore onto a new phone and you get every game, rating and
 * review back, with Steam quietly unattached. Left alone, the user finds out when a sync they
 * didn't run doesn't happen.
 *
 * So it is derived rather than remembered. Links in the library plus no credential means
 * "reconnect", whether that state arrived by a restore, a cleared browser, a second device or
 * anything else. It resolves itself the moment they reconnect, and it can't go stale.
 */
export const needsReconnect = derived(
  [links, connections, connectionsLoaded],
  ([$links, $connections, $loaded]): Platform[] => {
    if (!$loaded) return [];
    const platforms = new Set<Platform>();
    for (const link of $links) {
      if (!link.deleted && !$connections[link.platform]) platforms.add(link.platform);
    }
    return [...platforms];
  },
);

/** How many games are linked to a platform, for an honest number in the prompt. */
export const linkedGameCounts = derived(links, ($links): Record<string, number> => {
  const counts: Record<string, number> = {};
  const seen = new Set<string>();
  for (const link of $links) {
    if (link.deleted) continue;
    const key = `${link.platform}:${link.gameId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[link.platform] = (counts[link.platform] ?? 0) + 1;
  }
  return counts;
});

/**
 * Disconnect a platform.
 *
 * Removes the credential and tombstones that platform's links and stats. **Games, entries,
 * ratings, reviews, notes, shelves and dates are untouched** — the user wrote those, and
 * they have nothing to do with whether an account is attached. The UI's warning says
 * exactly this, and it is true because of `clearPlatformData`'s narrowness, not because the
 * copy is careful.
 */
export async function disconnect(platform: Platform): Promise<DisconnectResult> {
  const credentials = await db.getCredentials(platform);
  const connector = getConnector(platform);
  if (connector?.disconnect && credentials) {
    try {
      await connector.disconnect(credentials.values as Credentials);
    } catch {
      // Nothing remote to clean up is the normal case; a failure here must not stop the
      // local removal, which is the part the user actually asked for.
    }
  }

  await db.clearCredentials(platform);
  const counts = await db.clearPlatformData(platform);
  await refreshConnections();
  await refreshLibrary();
  return counts;
}

// ── Sync ────────────────────────────────────────────────────────────────────

export type SyncPhase = 'idle' | 'fetching' | 'matching' | 'reviewing' | 'applying' | 'done';

export interface SyncState {
  platform: Platform | null;
  phase: SyncPhase;
  done: number;
  total: number;
  /** What is being worked on right now, for a live progress line. */
  current?: string;
  plan?: SyncPlan;
  results?: SyncResultRow[];
  /** A sentence about a failure, scoped to this platform. */
  error?: string;
  /** Where the user can fix it — a private profile's privacy page, for instance. */
  helpUrl?: string;
}

const IDLE: SyncState = { platform: null, phase: 'idle', done: 0, total: 0 };

export const syncState = writable<SyncState>({ ...IDLE });

export function resetSync(): void {
  syncState.set({ ...IDLE });
  pendingAchievements = {};
}

/** Achievement progress collected during the most recent `prepareSync`. */
let pendingAchievements: Record<string, Achievements> = {};

/** Hand the event loop back so a long import never blocks paint or input. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function patch(next: Partial<SyncState>): void {
  syncState.update((state) => ({ ...state, ...next }));
}

/**
 * Fetch a platform's library and work out what would change — **without writing anything**.
 *
 * Stops at `reviewing` on purpose. Hundreds of games appearing unannounced is exactly the
 * behaviour this phase is meant to avoid, so the plan is a value the user is shown and has
 * to accept.
 */
export async function prepareSync(platform: Platform, signal?: AbortSignal): Promise<void> {
  syncState.set({ ...IDLE, platform, phase: 'fetching' });

  const stored = await db.getCredentials(platform);
  if (!stored) {
    patch({ phase: 'idle', error: 'That platform isn’t connected.' });
    return;
  }
  const credentials = stored.values as Credentials;

  // Boundaried: a throwing connector is returned as a value, never as a rejection.
  const outcome = await boundedFetchLibrary(platform, { credentials, signal });
  if (!outcome.ok) {
    patch({ phase: 'idle', ...describe(outcome.error) });
    return;
  }

  const games = outcome.value.items;
  if (!games.length) {
    patch({ phase: 'reviewing', plan: emptyPlan(platform), total: 0, done: 0 });
    return;
  }

  // Resolve the platform's games to IGDB in batches. This degrades quietly: with no bridge
  // or a failed lookup the import still runs, just with the platform's own titles and art.
  patch({ phase: 'matching', total: games.length, done: 0 });

  const resolved = await resolveMetadata(platform, games, signal, (done) =>
    patch({ done: Math.min(done, games.length) }),
  );

  const achievements = await collectAchievements(platform, credentials, games, signal);

  const plan = planSync(get(library), games, {
    platform,
    metadata: resolved.matches,
    achievements,
    matchingIncomplete: !resolved.complete,
  });

  // Stash the achievements alongside the plan so `commitSync` writes the same data the
  // review described, rather than re-fetching and possibly showing different numbers.
  pendingAchievements = achievements;
  patch({ phase: 'reviewing', plan, done: games.length, current: undefined });
}

/**
 * Resolve a platform's games to IGDB, by whatever route that platform allows.
 *
 * This is the fork phase 4 existed to find. Steam appids are carried by IGDB as external ids,
 * so phase 3 could *look them up* and never had to make a judgement. Xbox title ids are not
 * carried by anything, so the only handle left is the title — and comparing titles is a guess.
 * Both paths end in the same shape, keyed by the platform's own id, so `planSync` never learns
 * the difference.
 *
 * The `complete` flag is the other half. A title the bridge declined to match and a title we
 * never got to ask about look identical in the result and mean opposite things, so the caller
 * is told which happened and the review screen says so.
 */
async function resolveMetadata(
  platform: Platform,
  games: { externalId: string; title: string }[],
  signal: AbortSignal | undefined,
  onProgress: (done: number) => void,
): Promise<{ matches: Record<string, GameMetadata>; complete: boolean }> {
  const matches: Record<string, GameMetadata> = {};
  let complete = true;

  if (platform === 'steam') {
    for (let i = 0; i < games.length; i += MATCH_BATCH) {
      if (signal?.aborted) return { matches, complete: false };
      const batch = games.slice(i, i + MATCH_BATCH).map((g) => g.externalId);
      Object.assign(matches, await matchSteamAppids(batch, signal));
      onProgress(i + MATCH_BATCH);
      await yieldToUi();
    }
    return { matches, complete };
  }

  // Title matching, for every platform IGDB has no ids for. Deliberately strict at the bridge:
  // an ambiguous title comes back unmatched rather than guessed, and the unmatched tail is
  // shown to the user instead of being quietly resolved to the wrong game.
  for (let i = 0; i < games.length; i += TITLE_BATCH) {
    if (signal?.aborted) return { matches, complete: false };
    const batch = games.slice(i, i + TITLE_BATCH);
    const result = await matchTitles(
      batch.map((g) => g.title),
      signal,
    );
    if (!result.complete) complete = false;
    // Re-key from title to the platform's own id, which is what the planner works in.
    for (const game of batch) {
      const match = result.matches[game.title.trim()];
      if (match) matches[game.externalId] = match;
    }
    onProgress(i + TITLE_BATCH);
    await yieldToUi();
  }

  return { matches, complete };
}

/**
 * Achievements for the games most likely to be looked at.
 *
 * Bounded hard. One upstream call per game means a full library is a rate-limit waiting to
 * happen, and a number next to a game nobody has opened in four years is worth very little.
 * A failure here is swallowed: achievements are the least important thing a sync produces
 * and must never be the reason one fails.
 *
 * Phase 4 added the first branch. Xbox's title history carries achievement counts inline, so
 * asking again would cost one request per game out of a hundred-and-fifty-per-hour budget for
 * numbers already in hand. A connector that supplies them is believed; the fan-out is only for
 * the games it left out.
 */
async function collectAchievements(
  platform: Platform,
  credentials: Credentials,
  games: {
    externalId: string;
    minutesPlayed: number | null;
    lastPlayedAt?: number;
    achievements?: Achievements;
  }[],
  signal?: AbortSignal,
): Promise<Record<string, Achievements>> {
  const connector = getConnector(platform);
  if (!connector?.capabilities.achievements) return {};

  const out: Record<string, Achievements> = {};
  for (const game of games) {
    if (game.achievements && game.achievements.total > 0) out[game.externalId] = game.achievements;
  }

  const candidates = games
    .filter((g) => !out[g.externalId])
    .filter((g) => (g.minutesPlayed ?? 0) > 0)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .slice(0, ACHIEVEMENT_LIMIT)
    .map((g) => g.externalId);
  if (!candidates.length) return out;

  const batchSize = connector.platform === 'steam' ? ACHIEVEMENT_BATCH : XBOX_ACHIEVEMENT_BATCH;
  for (let i = 0; i < candidates.length; i += batchSize) {
    if (signal?.aborted) break;
    const batch = candidates.slice(i, i + batchSize);
    const result = await fetchAchievements(platform, { credentials, externalIds: batch, signal });
    // A rate-limit here would otherwise cost the whole sync. Stop asking; keep what we have.
    if (!result.ok) break;
    for (const row of result.value.items) out[row.externalId] = row.achievements;
    await yieldToUi();
  }
  return out;
}

export interface CommitOptions {
  /** Where new games land. Defaults to Backlog at the call site. */
  status: Status;
  shelfIds?: ID[];
}

/**
 * Write the reviewed plan.
 *
 * Applies in chunks with a yield between them, so importing a two-thousand-game library
 * shows a moving progress bar instead of a frozen tab.
 */
export async function commitSync(options: CommitOptions): Promise<void> {
  const state = get(syncState);
  const plan = state.plan;
  if (!plan || !state.platform) return;

  const total = plan.adds.length + plan.updates.length;
  patch({ phase: 'applying', done: 0, total, results: undefined, error: undefined });

  let sinceYield = 0;
  const results = await applyPlan(plan, get(library), {
    status: options.status,
    shelfIds: options.shelfIds,
    achievements: pendingAchievements,
    onProgress: (done, count, title) => patch({ done, total: count, current: title }),
    onYield: async () => {
      if (++sinceYield >= APPLY_CHUNK) {
        sinceYield = 0;
        await yieldToUi();
      }
    },
  });

  await refreshLibrary();

  const stored = await db.getCredentials(plan.platform);
  if (stored) await db.setCredentials({ ...stored, syncedAt: Date.now() });
  await refreshConnections();

  patch({ phase: 'done', results, current: undefined, done: total, total });
}

/** A connector error, translated into what the UI needs to show. */
function describe(error: ConnectorError): { error: string; helpUrl?: string } {
  if (error.helpUrl) return { error: error.message, helpUrl: error.helpUrl };
  if (error.kind === 'private' && error.platform === 'steam') {
    return { error: error.message, helpUrl: STEAM_PRIVACY_URL };
  }
  return { error: error.message };
}
