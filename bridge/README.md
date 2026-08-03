# Cartridge — metadata bridge

A **small, stateless Cloudflare Worker** that looks up game metadata (cover art, genres,
release dates, summaries) from [IGDB](https://www.igdb.com/) and caches it in Cloudflare KV.

It exists for exactly one reason: IGDB requires a client id and a client secret, and a
secret cannot live in a static PWA. The bridge is the only component in Cartridge that
holds one.

**The bridge is optional.** With no bridge configured, Cartridge is fully functional — you
type in the titles and everything else works exactly the same. See `../ARCHITECTURE.md`.

## What it does

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness. Answers any origin, so a bad `ALLOWED_ORIGINS` is diagnosable. |
| `GET /igdb/search?q=<term>&limit=<1-25>` | Normalized metadata search. |
| `GET /igdb/game/<igdbId>` | Normalized metadata for one game. |

Responses use Cartridge's own `GameMetadata` shape (`src/types.ts`), not IGDB's. The app
never parses an upstream response, so an IGDB schema change is a bridge deploy rather than
an app release.

## What it deliberately is not

- **Not a database.** It never stores a library, a shelf, a rating, a review or a note.
- **Not an inbox.** It accepts no `POST`. There is no endpoint that takes user data.
- **Not an identity.** No cookies, no accounts, no user identifiers, no request-body logs.
- **Not a credential store.** When platform connectors arrive (phases 3–6), a credential
  travels from the device to the bridge *per request*, is used, and is forgotten inside
  that request. The bridge never persists one.
- **Not required.** Turn it off and the app keeps working.

Everything in KV is public IGDB data plus the bridge's own Twitch app token.

## Secrets you need

Two, and both come from a single **Twitch application** — IGDB's API is authenticated
through Twitch:

| Secret | What it is |
| --- | --- |
| `TWITCH_CLIENT_ID` | Your Twitch application's client id. |
| `TWITCH_CLIENT_SECRET` | Your Twitch application's client secret. |

### How to obtain them

1. Sign in at <https://dev.twitch.tv/> (a normal Twitch account; two-factor authentication
   must be enabled before you can register an app).
2. Go to **Your Console → Applications → Register Your Application**.
3. Fill in:
   - **Name** — anything unique, e.g. `cartridge-metadata`.
   - **OAuth Redirect URLs** — `http://localhost` is fine. The bridge uses the
     client-credentials grant, so no redirect is ever performed.
   - **Category** — *Application Integration*.
4. **Create**, then **Manage** the app. Copy the **Client ID**, then press **New Secret**
   and copy the **Client Secret** — Twitch shows it once.
5. Read and follow the [IGDB API terms](https://api-docs.igdb.com/). The free tier allows
   four requests per second, which is why the bridge caches aggressively.

**Never commit either value.** `.dev.vars` is git-ignored; only `.dev.vars.example`, which
contains placeholders, is in the repository.

## Deploy (about five minutes)

Prereqs: a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and Node 18+.

```bash
cd bridge
npm install
npx wrangler login                      # opens a browser to authorize Wrangler

# 1. Create the metadata cache and put its id in wrangler.toml
npx wrangler kv namespace create METADATA

# 2. Store the secrets (prompts for each value; nothing is written to disk)
npx wrangler secret put TWITCH_CLIENT_ID
npx wrangler secret put TWITCH_CLIENT_SECRET

# 3. Allow your app's origin — exact match, comma-separated, no wildcards
#    Edit ALLOWED_ORIGINS in wrangler.toml, e.g.
#    ALLOWED_ORIGINS = "https://you.github.io,http://localhost:5173"

npx wrangler deploy
```

Wrangler prints the bridge URL, e.g.
`https://cartridge-bridge.<your-subdomain>.workers.dev`.

Check it:

```bash
curl https://cartridge-bridge.<your-subdomain>.workers.dev/health
# {"ok":true,"service":"cartridge-bridge"}
```

## Point the app at it

- **Per device (no rebuild):** app → **Settings → Metadata bridge**, paste the URL, press
  **Save and test**.
- **Baked into a build (everyone gets it):**

  ```bash
  VITE_BRIDGE_URL="https://cartridge-bridge.<your-subdomain>.workers.dev" npm run build
  ```

The per-device setting always wins over the build-time default.

## Local development

```bash
cp .dev.vars.example .dev.vars     # then fill in your own Twitch values
npx wrangler dev                   # serves on http://localhost:8787
```

Then set **Settings → Metadata bridge** to `http://localhost:8787`. `ALLOWED_ORIGINS` in
`.dev.vars` already includes Vite's `http://localhost:5173`.

## Hardening in place

- **CORS is an exact allowlist.** No wildcard, no pattern matching. An unlisted origin gets
  no CORS headers and no data.
- **`GET` only.** Anything else is a `405`.
- **Input is bounded.** Search terms are 2–120 characters; `limit` is clamped to 1–25; a
  game id must match `/^\d+$/`.
- **Per-IP throttle.** 60 requests per minute per IP, counted in KV. KV is eventually
  consistent, so this is a speed bump that protects the shared IGDB rate limit, not a
  security control.
- **One error envelope.** Every failure is `{ "error": "...", "message": "..." }`. Upstream
  stack traces are never returned.
- **Cache policy is echoed.** Search responses are cacheable for an hour by the browser and
  a day in KV; a single game is a day and a week respectively.

## Costs

Cloudflare's free tier covers 100,000 Worker requests and 100,000 KV reads a day. A
personal Cartridge install will not come close — most lookups are served from the app's own
in-memory cache before they ever reach the bridge.
