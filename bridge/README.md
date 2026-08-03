# Cartridge — metadata and platform bridge

A **small, stateless Cloudflare Worker** that looks up game metadata (cover art, genres,
release dates, summaries) from [IGDB](https://www.igdb.com/), brokers the
[Steam Web API](https://steamcommunity.com/dev), and caches public game data in Cloudflare KV.

It exists for exactly one reason: IGDB and Steam both require a key, and a key cannot live in
a static PWA. The bridge is the only component in Cartridge that holds one.

**The bridge is optional.** With no bridge configured, Cartridge is fully functional — you
type in the titles and everything else works exactly the same. See `../ARCHITECTURE.md`.

## What it does

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness. Answers any origin, so a bad `ALLOWED_ORIGINS` is diagnosable. |
| `GET /igdb/search?q=<term>&limit=<1-25>` | Normalized metadata search. |
| `GET /igdb/game/<igdbId>` | Normalized metadata for one game. |
| `GET /igdb/by-steam?appids=<a,b,c>` | Steam appids resolved to IGDB games, up to 100 at a time. |
| `GET /steam/login?return=<app URL>` | Starts Steam OpenID sign-in. |
| `GET /steam/return?openid.*` | Verifies Steam's assertion, then redirects to the app with `#steam_id=…`. |
| `GET /steam/library?steamid=<id>` | Owned games with total playtime and last-played. |
| `GET /steam/recent?steamid=<id>` | The last two weeks. |
| `GET /steam/achievements?steamid=<id>&appids=<a,b>` | Achievement progress, up to 20 appids at a time. |

Responses use Cartridge's own shapes (`src/types.ts`), not IGDB's or Steam's. The app never
parses an upstream response, so an upstream schema change is a bridge deploy rather than an
app release.

## What it deliberately is not

- **Not a database.** It never stores a library, a shelf, a rating, a review or a note.
- **Not an inbox.** It accepts no `POST`. There is no endpoint that takes user data.
- **Not an identity.** No cookies, no accounts, no user identifiers, no request-body logs.
- **Not a credential store.** A credential travels from the device to the bridge *per
  request*, is used, and is forgotten inside that request. The bridge never persists one.
- **Not required.** Turn it off and the app keeps working.

Everything in KV is public game data — IGDB responses, Steam achievement schemas, the
appid → IGDB mapping — plus the bridge's own Twitch app token. **No cache key anywhere in
this worker contains a Steam ID**, and no owned-games list, playtime figure or achievement
count for a *person* is ever written. Those responses are `no-store` end to end.

## Secrets you need

Three. Two come from a single **Twitch application** — IGDB's API is authenticated through
Twitch — and one from Steam.

| Secret | What it is |
| --- | --- |
| `TWITCH_CLIENT_ID` | Your Twitch application's client id. |
| `TWITCH_CLIENT_SECRET` | Your Twitch application's client secret. |
| `STEAM_API_KEY` | Your Steam Web API key. Only needed if you want the Steam connector. |

### How to obtain the Twitch pair

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

### How to obtain `STEAM_API_KEY`

1. Sign in at <https://steamcommunity.com/dev/apikey> with a Steam account that has spent at
   least $5 (Valve's own requirement for issuing a key).
2. Enter a **domain name** — the host your bridge will run on, e.g.
   `cartridge-bridge.your-subdomain.workers.dev`. It is a label, not an enforced origin
   check.
3. Agree to the [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms) and
   press **Register**. Copy the key.
4. The key identifies *you*, not your users. It is used server-side only and is never sent
   to a browser.

Skip this one if you do not want the Steam connector — every other route works without it,
and the Steam data routes answer `503` rather than failing in some interesting way.

**Never commit any of these values.** `.dev.vars` is git-ignored; only `.dev.vars.example`,
which contains placeholders, is in the repository.

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
npx wrangler secret put STEAM_API_KEY     # optional — only for the Steam connector

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

> `ALLOWED_ORIGINS` is doing double duty for Steam: it is also the allowlist that decides
> where a completed sign-in may be redirected back to. If your app's origin is missing,
> **Connect Steam** will refuse rather than silently redirect somewhere else.

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
cp .dev.vars.example .dev.vars     # then fill in your own values
npx wrangler dev                   # serves on http://localhost:8787
```

Then set **Settings → Metadata bridge** to `http://localhost:8787`. `ALLOWED_ORIGINS` in
`.dev.vars` already includes Vite's `http://localhost:5173`.

## How Steam sign-in works

Steam speaks OpenID 2.0, which needs a server to verify an assertion — a browser cannot do
it. So the bridge mediates, and Cartridge never sees a Steam password.

```
app  ──"connect"──▶  /steam/login  ──302──▶  steamcommunity.com
                                                    │
                                              user signs in
                                                    │
app  ◀──302 #steam_id──  /steam/return  ◀──302──────┘
                              │
                              └── POST back to Steam: openid.mode=check_authentication
```

The last step is the point of the whole thing. Everything in that redirect is
attacker-controlled — anyone can call `/steam/return` with a Steam ID of their choosing — so
the parameters are worth nothing until Steam confirms it signed them. Four checks must all
pass before a Steam ID is handed back:

1. `openid.mode` is `id_res`.
2. `openid.op_endpoint` is Steam's, so a response signed by some *other* OpenID provider
   cannot be replayed here.
3. `openid.return_to` is exactly the URL we asked Steam to return to, so an assertion minted
   for a different relying party cannot be reused.
4. Steam answers `is_valid:true` to a verbatim echo of the parameters.

The resulting Steam ID is returned in the URL **fragment**, which browsers never send to a
server, and the app clears it from the address bar as soon as it has been stored.

## Hardening in place

- **CORS is an exact allowlist.** No wildcard, no pattern matching. An unlisted origin gets
  no CORS headers and no data.
- **No open redirect.** `/steam/login` and `/steam/return` are browser navigations and carry
  no `Origin` header, so the allowlist is enforced on the return URL's origin instead. An
  unlisted origin gets a `403`, not a redirect.
- **`GET` only.** Anything else is a `405`.
- **Input is bounded.** Search terms are 2–120 characters; `limit` is clamped to 1–25; a game
  id must match `/^\d+$/`; a Steam ID must be exactly 17 digits; appid batches are capped at
  100 (IGDB) and 20 (achievements) and every id is digits-only before it reaches upstream.
- **Per-IP throttle.** 60 requests per minute per IP, counted in KV. KV is eventually
  consistent, so this is a speed bump that protects the shared upstream rate limits, not a
  security control.
- **One error envelope.** Every failure is `{ "error": "...", "message": "..." }`, optionally
  with a `helpUrl` when the user can fix it themselves. Upstream stack traces are never
  returned.
- **Cache policy is echoed.** Search responses are cacheable for an hour by the browser and a
  day in KV; a single game is a day and a week. Everything under `/steam/` that involves a
  Steam ID is `no-store` and is never written to KV at all.
- **A private profile is a distinct answer.** `403 steam-private` with a `helpUrl` pointing
  at the exact Steam setting, rather than a generic failure.

## Residual risk — read this before you paste in a key

**The origin allowlist is not authentication.** `Origin` is a request header, and a header is
whatever the sender says it is. A browser sets it honestly because the browser enforces the
same-origin policy; `curl` does not:

```bash
curl -H "Origin: https://you.github.io" \
  "https://your-worker.workers.dev/steam/library?steamid=76561197960287930"
```

That request succeeds. So in practice:

- **Anyone who learns your worker URL and one allowed origin can use this bridge as a free
  Steam and IGDB proxy**, spending your Steam Web API quota and your Twitch app's rate limit.
- They can read the **public** library of any SteamID they already know. The bridge adds no
  reach here — a public Steam profile is public, and the bridge stores nothing and can be
  asked about nothing it wasn't just told.
- Cost is capped by Cloudflare's free tier rather than by anything the bridge does, so the
  realistic damage is exhausted quota and a bridge that stops answering for a while.

What actually mitigates this today is the per-IP throttle (a speed bump — see above) and the
worker URL not being interesting enough to find. That is a reasonable trade for a personal
deployment and a poor one for a public service.

**Closing it properly needs real authentication** — a shared secret the app holds and the
worker checks, or signed short-lived tokens. A static PWA cannot keep a secret from its own
user, so this is not a small change: it means an account system, which Cartridge deliberately
does not have. If you are deploying this beyond yourself and a few friends, use a Steam key
issued for that purpose, keep an eye on the Cloudflare request graph, and rotate the key with
`wrangler secret put STEAM_API_KEY` if it starts being spent by someone else.

## Costs

Cloudflare's free tier covers 100,000 Worker requests and 100,000 KV reads a day. A
personal Cartridge install will not come close — most lookups are served from the app's own
in-memory cache before they ever reach the bridge, and a Steam sync is a handful of requests
however large the library.
