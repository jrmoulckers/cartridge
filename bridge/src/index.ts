/**
 * Cartridge bridge — the only component that holds a secret, and the only one the app ever
 * talks to over the network.
 *
 * What it does:
 *   GET /health           — liveness, and the probe Settings uses
 *   GET /igdb/search?q=   — normalized metadata search
 *   GET /igdb/game/:id    — normalized metadata for one game
 *
 * What it deliberately does **not** do, now or later:
 *   - store a user's library, shelves, ratings, reviews or notes
 *   - accept a POST of anything belonging to a user
 *   - set a cookie, issue an identifier, or log a request body
 *   - hold a user's platform credentials (a future connector passes them per request,
 *     uses them, and forgets them within that request)
 *
 * Everything it caches in KV is public IGDB data plus its own Twitch app token.
 */
import { preflight, resolveOrigin, corsHeaders } from './cors';
import { searchGames, getGame, UpstreamError } from './igdb';
import type { BridgeError, Env } from './types';

/** Longest search term accepted. IGDB won't do anything useful with more. */
const MAX_QUERY = 120;
const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 12;

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
  extra?: Record<string, string>,
): Response {
  const body: BridgeError = { error, message };
  return json(body, origin, { status, headers: extra });
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return preflight(request, env);

    const origin = resolveOrigin(request, env);
    const url = new URL(request.url);

    // /health answers anyone, so a misconfigured ALLOWED_ORIGINS is diagnosable.
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'cartridge-bridge' }, origin);
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
        'retry-after': String(RATE_WINDOW_S),
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

      const match = /^\/igdb\/game\/(\d+)$/.exec(url.pathname);
      if (match) {
        const game = await getGame(env, Number(match[1]));
        if (!game) return fail(origin, 404, 'not-found', 'No game with that id.');
        return json(game, origin, {}, 24 * 60 * 60);
      }

      return fail(origin, 404, 'not-found', 'No such endpoint.');
    } catch (error) {
      if (error instanceof UpstreamError) {
        return fail(origin, error.status, 'upstream', error.message);
      }
      // Never leak an upstream stack trace to a browser.
      return fail(origin, 500, 'internal', 'The bridge could not answer that right now.');
    }
  },
} satisfies ExportedHandler<Env>;
