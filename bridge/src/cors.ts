/**
 * CORS, deliberately strict.
 *
 * There is no wildcard and no pattern matching: an origin is either in `ALLOWED_ORIGINS`
 * character for character or it gets no CORS headers at all. The bridge holds the only
 * secrets in the product, and a permissive `*` would make it a free IGDB proxy for anyone
 * who found the URL.
 */
import type { Env } from './types';

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** The origin to echo back, or null when this request may not be answered. */
export function resolveOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return allowedOrigins(env).includes(origin.replace(/\/+$/, '')) ? origin : null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    // `X-XBL-Key` carries a user's own OpenXBL key. It is a header rather than a query
    // parameter precisely so it stays out of URLs, access logs and browser history — which
    // means the preflight has to permit it or the browser will never send it.
    'Access-Control-Allow-Headers': 'Accept, Content-Type, X-XBL-Key',
    'Access-Control-Max-Age': '86400',
    // The response body varies by origin, so caches must not share it across origins.
    Vary: 'Origin',
  };
}

export function preflight(request: Request, env: Env): Response {
  const origin = resolveOrigin(request, env);
  return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
}
