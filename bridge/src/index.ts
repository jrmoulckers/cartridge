/**
 * Cartridge bridge — the only component that holds a secret, and the only one the app ever
 * talks to over the network.
 *
 * What it does:
 *   GET /health              — liveness, and the probe Settings uses
 *   GET /igdb/search?q=      — normalized metadata search
 *   GET /igdb/game/:id       — normalized metadata for one game
 *   GET /igdb/by-steam       — Steam appids resolved to IGDB games, in bulk
 *   GET /steam/login         — starts Steam OpenID sign-in
 *   GET /steam/return        — verifies the assertion with Steam, hands back a SteamID
 *   GET /steam/library       — owned games and playtime
 *   GET /steam/recent        — the last two weeks
 *   GET /steam/achievements  — achievement progress for a bounded set of appids
 *
 * What it deliberately does **not** do, now or later:
 *   - store a user's library, shelves, ratings, reviews or notes
 *   - accept a POST of anything belonging to a user
 *   - set a cookie, issue an identifier, or log a request body
 *   - hold a user's platform credentials — a connector passes one per request, the bridge
 *     uses it inside that request and forgets it
 *
 * Everything it caches in KV is public game data plus its own Twitch app token. A SteamID
 * never appears in a cache key.
 */
import { preflight, resolveOrigin, allowedOrigins, corsHeaders } from './cors';
import { searchGames, getGame, matchSteamAppids, UpstreamError } from './igdb';
import {
  loginUrl,
  verifyAssertion,
  getOwnedGames,
  getRecentGames,
  getAchievements,
  isSteamId,
  PrivateProfileError,
  PRIVACY_HELP_URL,
} from './steam';
import type { BridgeError, Env, SteamAchievements } from './types';

/** Longest search term accepted. IGDB won't do anything useful with more. */
const MAX_QUERY = 120;
const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 12;
/** Appids per batch. Bounds both the IGDB query and the achievement fan-out. */
const MAX_APPIDS = 100;
const MAX_ACHIEVEMENT_APPIDS = 20;

/** A crude per-IP throttle: this many requests per window, tracked in KV. */
const RATE_LIMIT = 60;
const RATE_WINDOW_S = 60;

function json(body: unknown, origin: string | null, init: ResponseInit = {}, cacheS = 0): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Echo the cache policy so the browser and any CDN in front of us agree with KV.
      'cache-control': cacheS > 0 ? `public, max-age=${cacheS}` : 'no-store',
      ...corsHeaders(origin),
      ...(init.headers ?? {}),
    },
  });
}

function fail(
  origin: string | null,
  status: number,
  error: string,
  message: string,
  extra?: { headers?: Record<string, string>; helpUrl?: string },
): Response {
  const body: BridgeError = { error, message };
  if (extra?.helpUrl) body.helpUrl = extra.helpUrl;
  return json(body, origin, { status, headers: extra?.headers });
}

/**
 * Best-effort per-IP throttle. KV is eventually consistent, so this is a speed bump rather
 * than a guarantee — enough to stop a stray loop burning the IGDB rate limit for everyone.
 */
async function throttled(env: Env, request: Request): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return false;
  const key = `rate:v1:${ip}:${Math.floor(Date.now() / (RATE_WINDOW_S * 1000))}`;
  try {
    const current = Number((await env.METADATA.get(key)) ?? '0');
    if (current >= RATE_LIMIT) return true;
    await env.METADATA.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_S * 2 });
    return false;
  } catch {
    // If the counter itself is broken, let the request through rather than block everyone.
    return false;
  }
}

/** Split and bound a comma-separated appid list. Non-numeric ids never reach upstream. */
function parseAppids(value: string | null, max: number): string[] {
  const ids = (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{1,10}$/.test(id));
  return [...new Set(ids)].slice(0, max);
}

/**
 * Where the browser is sent back to once Steam has answered.
 *
 * Validated against the **same allowlist CORS uses**, because a redirect endpoint that
 * accepts an arbitrary `return` is an open redirect — and this one carries a freshly
 * verified identity in its fragment. Only the origin is checked against the list; the path
 * is the app's own business.
 */
function safeReturnUrl(raw: string | null, env: Env): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return allowedOrigins(env).includes(url.origin) ? url : null;
}

/** Redirect home with a result in the fragment — fragments are never sent to a server. */
function backToApp(target: URL, params: Record<string, string>): Response {
  target.hash = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), 'cache-control': 'no-store' },
  });
}

/** Turn whatever Steam threw into the shared error envelope. */
function steamFailure(origin: string, error: unknown): Response {
  if (error instanceof PrivateProfileError) {
    return fail(origin, 403, 'steam-private', error.message, { helpUrl: error.helpUrl });
  }
  if (error instanceof UpstreamError) {
    const headers = error.status === 429 ? { 'retry-after': '60' } : undefined;
    return fail(origin, error.status, 'upstream', error.message, { headers });
  }
  return fail(origin, 500, 'internal', 'The bridge could not answer that right now.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return preflight(request, env);

    const origin = resolveOrigin(request, env);
    const url = new URL(request.url);

    // /health answers anyone, so a misconfigured ALLOWED_ORIGINS is diagnosable.
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'cartridge-bridge' }, origin);
    }

    // ── Steam OpenID ────────────────────────────────────────────────────────
    // These two are browser *navigations*, not fetches: they arrive with no Origin header
    // and must answer anyway. The allowlist still applies — it is enforced on the return
    // URL instead, which is the only thing here that could be abused.

    if (url.pathname === '/steam/login' || url.pathname === '/steam/return') {
      if (request.method !== 'GET') {
        return fail(null, 405, 'method-not-allowed', 'Only GET is supported.');
      }
      const param = url.pathname === '/steam/login' ? 'return' : 'app';
      const target = safeReturnUrl(url.searchParams.get(param), env);
      if (!target) {
        return fail(null, 403, 'forbidden', 'That return address is not allowed by this bridge.');
      }

      // Steam hands the assertion back to us, not to the app — the app cannot verify it.
      // The app's own address rides along so /steam/return knows where to finish.
      const returnTo = new URL('/steam/return', url.origin);
      returnTo.searchParams.set('app', target.toString());

      if (url.pathname === '/steam/login') {
        return new Response(null, {
          status: 302,
          headers: {
            location: loginUrl(returnTo.toString(), url.origin),
            'cache-control': 'no-store',
          },
        });
      }

      const result = await verifyAssertion(url, returnTo.toString());
      return backToApp(
        target,
        result.ok ? { steam_id: result.steamId } : { steam_error: result.reason },
      );
    }

    // Every other route requires an allow-listed browser origin.
    if (!origin) {
      return fail(null, 403, 'forbidden', 'This origin is not allowed to use this bridge.');
    }
    if (request.method !== 'GET') {
      return fail(origin, 405, 'method-not-allowed', 'Only GET is supported.');
    }
    if (await throttled(env, request)) {
      return fail(origin, 429, 'rate-limited', 'Too many requests. Try again in a minute.', {
        headers: { 'retry-after': String(RATE_WINDOW_S) },
      });
    }

    try {
      if (url.pathname === '/igdb/search') {
        const q = (url.searchParams.get('q') ?? '').trim();
        if (q.length < 2) {
          return fail(origin, 400, 'bad-request', 'Search for at least two characters.');
        }
        if (q.length > MAX_QUERY) {
          return fail(origin, 400, 'bad-request', 'That search is too long.');
        }

        const requested = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
        const limit = Number.isFinite(requested)
          ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(requested)))
          : DEFAULT_LIMIT;

        const results = await searchGames(env, q, limit);
        return json({ results }, origin, {}, 60 * 60);
      }

      if (url.pathname === '/igdb/by-steam') {
        const appids = parseAppids(url.searchParams.get('appids'), MAX_APPIDS);
        if (!appids.length) {
          return fail(origin, 400, 'bad-request', 'Give at least one Steam appid.');
        }
        const matches = await matchSteamAppids(env, appids);
        return json({ matches }, origin, {}, 24 * 60 * 60);
      }

      const match = /^\/igdb\/game\/(\d+)$/.exec(url.pathname);
      if (match) {
        const game = await getGame(env, Number(match[1]));
        if (!game) return fail(origin, 404, 'not-found', 'No game with that id.');
        return json(game, origin, {}, 24 * 60 * 60);
      }

      // ── Steam Web API ─────────────────────────────────────────────────────
      // Every response here is `no-store`. A user's library is not ours to cache — not in
      // KV, not in a browser cache, not in anything downstream.

      if (url.pathname.startsWith('/steam/')) {
        const steamId = url.searchParams.get('steamid');
        if (!isSteamId(steamId)) {
          return fail(origin, 400, 'bad-request', 'That is not a Steam ID.');
        }

        try {
          if (url.pathname === '/steam/library') {
            return json({ games: await getOwnedGames(env, steamId) }, origin);
          }
          if (url.pathname === '/steam/recent') {
            return json({ games: await getRecentGames(env, steamId) }, origin);
          }
          if (url.pathname === '/steam/achievements') {
            const appids = parseAppids(
              url.searchParams.get('appids') ?? url.searchParams.get('appid'),
              MAX_ACHIEVEMENT_APPIDS,
            );
            if (!appids.length) {
              return fail(origin, 400, 'bad-request', 'Give at least one Steam appid.');
            }
            // Sequential on purpose: one user's sync must not be able to fan twenty
            // simultaneous calls at Steam and get the whole bridge rate-limited.
            const results: SteamAchievements[] = [];
            for (const appid of appids) {
              results.push(await getAchievements(env, steamId, appid));
            }
            return json({ results }, origin);
          }
        } catch (error) {
          return steamFailure(origin, error);
        }
      }

      return fail(origin, 404, 'not-found', 'No such endpoint.');
    } catch (error) {
      if (error instanceof PrivateProfileError) {
        return fail(origin, 403, 'steam-private', error.message, { helpUrl: PRIVACY_HELP_URL });
      }
      if (error instanceof UpstreamError) {
        return fail(origin, error.status, 'upstream', error.message);
      }
      // Never leak an upstream stack trace to a browser.
      return fail(origin, 500, 'internal', 'The bridge could not answer that right now.');
    }
  },
} satisfies ExportedHandler<Env>;
