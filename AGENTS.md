# cartridge — agent guide

Product-authored guide for `jrmoulckers/cartridge`, a member repo of **JRM Studio**.
Everything in this file is product-local. The studio sync engine injects the shared
canonical guide into a marked `<!-- studio:base:start -->` … `<!-- studio:base:end -->`
block; **do not edit inside that block** — edit canon in `jrmoulckers/.github` instead.
Everything outside it belongs to this repo.

## What cartridge is

Cartridge tracks the games you're **playing**, **have played**, and **want to play**, across
Steam, Xbox, PlayStation and Nintendo — one library instead of four walled gardens.

## Platform reality (this shapes the whole architecture)

| Platform    | Library API                                                       | Credential                                                              |
| ----------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Steam       | Official, public — Steam Web API (`IPlayerService/GetOwnedGames`) | Server-side **Web API key**; requires a public profile                  |
| Xbox        | No open API — XSAPI is partner-gated                              | Partner approval, or an unofficial gateway (e.g. OpenXBL) API key       |
| PlayStation | No third-party API                                                | Reverse-engineered flow: user-supplied **NPSSO** → refresh/access token |
| Nintendo    | None                                                              | Manual entry / import only                                              |

Three of the four are unofficial or absent and **will break without notice**. Ingestion is
therefore expected to fail routinely and must degrade per-platform, never as a whole.

## Stack

- **Framework:** Next.js (App Router, TypeScript) — chosen for its first-party server tier.
- **Package manager:** pnpm (`packageManager` field + Corepack; `--frozen-lockfile` in CI).
- **Node:** 24 (CI pins `node-version: '24'`; tests run on `node --test` with native TS
  type stripping, so test files import with explicit `.ts` extensions).
- **Design tokens:** `@jrm/tokens`, vendored from `jrmoulckers/studio` by the sync engine.
- **Layout:** single app at the repo root (`app/`, `lib/`, `tests/`) — no monorepo.

### Why Next.js and not Svelte

Every platform integration needs either a server-held API key (Steam, Xbox) or a
long-lived per-user secret (PlayStation NPSSO). `principles/backend.md` #4 requires
authentication and authorization to be enforced **server-side, default deny**, because
"clients cannot be trusted to gate access"; `principles/security.md` #1/#4 forbid secrets
in the tree and demand least privilege; `principles/frontend.md` #7 treats the browser as
untrusted. Cartridge must own a server. Next.js route handlers/server actions provide one
in the same repo and match the `jrm-recipes` precedent (nextjs/pnpm). The studio's Svelte
precedent (`score-king`) is a client-only Vite PWA with no server tier, so it would either
force a brand-new SvelteKit/adapter-node stack or push credentials clientward.

## Binding rules for agents working here

1. **No third-party credential ever reaches the browser.** Steam keys, OpenXBL keys, NPSSO
   values and derived tokens live in server-side environment variables or encrypted
   per-user storage. No credential in `localStorage`, cookies readable by JS, client
   bundles, logs, or error bodies.
2. **All platform calls originate server-side**, through a per-platform adapter with an
   explicit timeout, bounded retries with backoff, and a rate limit (`backend.md` #6).
3. **Ingestion is idempotent** — re-importing a library must not duplicate entries; dedupe
   on `(user, platform, platform_game_id)` (`backend.md` #5).
4. **A platform outage is not an app outage.** Unofficial integrations fail soft and surface
   a per-platform state; manual entry always remains available.
5. **No design values hardcoded** — consume `@jrm/tokens` variables only (`frontend.md` #1).
   Until the first sync PR lands, styling stays deliberately minimal rather than inventing
   literals.
6. **No secrets committed, ever** (`security.md` #1). `.env*` is gitignored.

## Design tokens — import path

Tokens arrive as committed files from the sync engine at the **repo-root default**:
`vendor/@jrm/tokens/` (manifest `tokens.targetPath` default — cartridge needs **no**
per-member override, because the Next app is at the repo root).

Once the first `chore(sync)` PR lands, `app/globals.css` enables exactly this line (it is
present, commented, today):

```css
@import '../vendor/@jrm/tokens/css/default/index.css';
```

That barrel pulls in `tokens.css`, `tokens-dark.css`, `tokens-dark-oled.css` and
`tokens-high-contrast.css`. Theme switching is `data-theme` on `<html>` only — no rebuild,
no separate bundle (`frontend.md` #3).

**Never hand-write, copy, or edit anything under `vendor/@jrm/tokens/`.** Those bytes are
generated in `jrmoulckers/studio` and carried here by the engine; editing them registers as
drift and blocks future syncs. `vendor/` is deliberately **not** gitignored.

## Deviations from the shared principles

- **Local ESLint / Prettier / TypeScript configs instead of the `@jrm` presets.** The studio
  is registry-free and the sync engine vendors **only** `packages/tokens/dist`, so
  `@jrm/eslint-config`, `@jrm/tsconfig`, `@jrm/prettier-config` and `@jrm/tailwind-preset`
  cannot be resolved here. Local configs mirror their intent and should be replaced the day
  those presets become consumable.
- **No Tailwind yet.** Plain CSS custom properties from `@jrm/tokens` are enough for now;
  the Tailwind preset can be adopted later without changing the token contract.
- **`sharp` install script disabled** (`pnpm-workspace.yaml` → `allowBuilds.sharp: false`),
  per `security.md` #2.1. Revisit only if Next image optimization is actually needed.
- **Performance budget measures `.next/static`, not `.next`.** `.next` includes the build
  cache, which would make the budget meaningless. Same directory is used for the preview
  artifact.

## CI

`.github/workflows/ci.yml` is **product-owned and never written by the sync engine**
(reusable workflows are "native": the engine reports them and stops). It calls
`jrmoulckers/.github` reusable workflows at `@main`:

| Job       | Reusable workflow             | Notes                                                         |
| --------- | ----------------------------- | ------------------------------------------------------------- |
| `lint`    | `reusable-ci-lint.yml`        | `pnpm lint` + `pnpm format:check`; semantic PR titles on      |
| `web`     | `reusable-ci-web.yml`         | `pnpm typecheck` / `pnpm test` / `pnpm build`                 |
| `preview` | `reusable-deploy-preview.yml` | PRs only, `provider: artifact` — no host chosen yet           |
| `perf`    | `reusable-perf-budget.yml`    | 2048 KB budget on `.next/static`; Lighthouse skipped (no URL) |

Community-health files (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and
PR templates) are **inherited automatically** from `jrmoulckers/.github` and must not be
added here.

## Local commands

```bash
pnpm install          # --frozen-lockfile in CI
pnpm dev              # Next dev server
pnpm lint             # eslint .
pnpm format:check     # prettier --check .
pnpm typecheck        # tsc --noEmit
pnpm test             # node --test tests/
pnpm build            # next build
```

## Not yet built

The repo is onboarding scaffolding only. Still needed: the unified library data model,
per-user encrypted credential storage, Steam ingestion, manual/import entry (required for
Nintendo), and auth. Agents should not assume any of this exists.
