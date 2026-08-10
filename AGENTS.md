# AGENTS.md — Cartridge

Product-specific guide for AI agents working in this repo. It **extends** the JRM Studio base
guide in the managed region at the bottom of this file; where the two differ, the rules here win.

## What Cartridge is

A "Goodreads for video games": a local-first PWA that tracks what you're playing, have played
and want to play across Steam, Xbox, PlayStation and Nintendo, with shelves, ratings, reviews
and stats. Sibling to `score-king` — same shape, same discipline.

Companion docs: [PRODUCT.md](PRODUCT.md) · [ARCHITECTURE.md](ARCHITECTURE.md) ·
[DESIGN.md](DESIGN.md) · [bridge/README.md](bridge/README.md).

## Non-negotiables

These are product invariants, not preferences. A change that breaks one is wrong even if it
passes CI.

1. **The app works fully offline with zero connectors attached.** Every network call is
   optional and every failure path lands on a usable screen.
2. **No credential leaves the device except to the bridge, per request.** Platform
   credentials live in IndexedDB and are sent up only for the request that needs them.
3. **The bridge never persists a user's library.** It brokers API keys and CORS; it caches
   only public game metadata.
4. **An unofficial API breaking degrades one tab, never the app.** Every connector sits
   behind its own error boundary.

## Stack & layout

| Path | What |
| --- | --- |
| `src/` | Svelte 5 (runes) + Vite + TypeScript PWA. Local-first, IndexedDB via `idb`. |
| `src/lib/storage/` | `db.ts` (IndexedDB schema + accessors), `backup.ts` (JSON export/restore). |
| `src/lib/stores/` | Svelte stores; the only layer components talk to. |
| `src/lib/library/` | Pure search / filter / sort / rating logic. Unit-tested, no DOM. |
| `src/lib/stats/` | Pure statistics: coverage-carrying measures, the year rule, backlog triage. Unit-tested, no DOM. |
| `src/lib/metadata/` | Bridge client, metadata cache, IGDB matching helpers. |
| `src/lib/connectors/` | The platform-connector interface, registry, connectors, and the pure sync planner. |
| `bridge/` | Cloudflare Worker. **The only component that holds secrets.** |
| `vendor/@jrm/tokens` | Vendored studio design tokens. Never hand-edited — see `vendor/README.md`. |

## Conventions

- **Svelte 5 runes** (`$state`, `$derived`, `$effect`, `$props`) in components; Svelte stores
  (`writable` / `derived`) for shared state, mirroring `score-king`.
- **Stores own persistence.** Components never call `storage/db.ts` directly.
- **Pure logic is separate and tested.** Anything decidable without the DOM lives in a plain
  `.ts` module with a sibling `.test.ts`.
- **Tokens, not literals.** No hard-coded colours, spacing, radii or durations in components —
  use the CSS custom properties defined in `src/app.css`.
- **Degrade, don't throw.** Metadata and connector failures set a status flag and leave the
  local data path working.

## Checks

```bash
npm run check   # svelte-check + tsc
npm test        # vitest
npm run build   # vite build
```

Run all three before pushing. The bridge has its own `npm run typecheck` in `bridge/`.

## Secrets

Only `bridge/.dev.vars.example` (placeholders) is committed. Real values go in
`bridge/.dev.vars` (git-ignored) locally and via `wrangler secret put` in production. If you
are about to commit anything that looks like a key, stop.

## Studio sync boundaries — what must NOT live in this repo

Cartridge is a member of JRM Studio. Some files reach this repo by machinery rather than by
hand, and hand-authoring them is actively harmful — either it creates false drift in the sync
engine's hash tracking, or it forks a file that then silently goes stale.

| Kind | Where it comes from | Rule |
| --- | --- | --- |
| `.github/agents/`, `.github/skills/`, `.github/prompts/`, `.github/instructions/`, `agency.toml` | `chore(sync)` PR from `jrmoulckers/.github` | Never hand-edit. Fix upstream, then re-sync. |
| `vendor/@jrm/tokens/` | `chore(sync)` PR, sourced from `jrmoulckers/studio` `packages/tokens/dist/` | Never hand-edit or hand-copy. |
| `AGENTS.md` between `studio:base:start` / `studio:base:end` | Merged in by the sync engine | Edit only *outside* the markers. Everything above this line is product-authored and safe to change. |
| `.studio-sync.lock.json` | The sync engine | Never create by hand. |
| `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/DISCUSSION_TEMPLATE/` | **GitHub inherits these automatically** from `jrmoulckers/.github` | Do not add them here. A local copy overrides the inherited one and stops tracking upstream. |
| `.github/workflows/reusable-*.yml` | Referenced by ref, never copied | Call them as `jrmoulckers/.github/.github/workflows/<name>.yml@<40-char-sha>` with a trailing `# main` comment, per `GH-ACT-003`. A vendored copy is a stale fork. |

`.github/workflows/ci.yml` is the exception: it is product-owned forever. The sync engine
reports reusable workflows as "native" but never writes them, so wiring and inputs are ours.

## Product authority

Product obligations and outcomes are defined in
[jrmoulckers/product](https://github.com/jrmoulckers/product) and consumed **by reference,
never by copy** — nothing is synced or vendored. Cite obligations by stable ID (for example
`PROD-REL-001`), and pin to a commit SHA when the exact wording matters. Roadmaps, metrics,
experiments and compliance evidence stay in this repository and cite the obligation they
satisfy; [PRODUCT.md](PRODUCT.md) is Cartridge's instance of that authority, not a copy of it.

Engineering mechanisms live in
[jrmoulckers/engineering](https://github.com/jrmoulckers/engineering) (`ENG-*`), design and
interface in [jrmoulckers/studio](https://github.com/jrmoulckers/studio) (`STUDIO-*`), and
automation plus shared agent assets in
[jrmoulckers/.github](https://github.com/jrmoulckers/.github) (`GH-*`). The legacy
`principles/<realm>.md` files are gone — if you find a citation to one, remap it via
`principles/migration-ledger.json` in `jrmoulckers/studio`.

## Deviations from the shared principles

- **No shared lint/format presets.** `@jrm/eslint-config`, `@jrm/prettier-config`,
  `@jrm/tsconfig` and `@jrm/tailwind-preset` have no transport to member repos — the sync
  engine vendors `packages/tokens/dist` only, and nothing is published to a registry (see
  studio's README transport table). Cartridge therefore carries no ESLint/Prettier yet, so
  `ci.yml` calls `reusable-ci-lint` with `lint-command` and `format-check-command` set to
  empty strings — its lint job self-skips and only the semantic-PR-title check runs. Give
  those two inputs real commands once the repo has lint/format scripts.
- **Credential boundary is a Worker, not a Next.js server.**
  [`ENG-API-003`](https://github.com/jrmoulckers/engineering/blob/main/principles/platforms/api-backend.md)
  ("source secrets outside code and enforce authentication and authorization server-side with
  default-deny decisions") and
  [`ENG-SEC-001`](https://github.com/jrmoulckers/engineering/blob/main/principles/assurance/security-and-privacy.md)
  / [`ENG-SEC-004`](https://github.com/jrmoulckers/engineering/blob/main/principles/assurance/security-and-privacy.md)
  require third-party credentials to sit behind a first-party server. Of the four
  platforms, only Steam has an official public API (server-side key); Xbox is partner-gated,
  PlayStation is a reverse-engineered NPSSO flow and Nintendo has no API at all — so every
  path is either a server-held key or a long-lived per-user secret. Cartridge satisfies that
  with a local-first Svelte PWA plus the `bridge/` Cloudflare Worker as the sole secret
  holder, rather than the Next.js server tier used by `jrm-recipes`.
  [`ENG-WEB-001`](https://github.com/jrmoulckers/engineering/blob/main/principles/platforms/browser-frontend.md)
  ("treat browser code, rendered input, and client-visible configuration as an untrusted
  seam") still binds: no secret ever reaches `src/`.

  These four citations previously pointed at `principles/backend.md` #4,
  `principles/security.md` #1/#4 and `principles/frontend.md` #7 in `jrmoulckers/studio`.
  Those legacy files were deleted in the principle migration; the successors above are the
  ones declared in that repo's `principles/migration-ledger.json`
  (`studio-legacy:backend:4` → `ENG-API-003`, `studio-legacy:security:1` → `ENG-SEC-001`,
  `studio-legacy:security:4` → `ENG-SEC-004`, `studio-legacy:frontend:7` → `ENG-WEB-001`;
  all four `disposition: reference`, `status: verified`).

<!-- studio:base:start -->
<!-- synced from jrmoulckers/.github — canonical source; do not edit here -->

# AGENTS.md — JRM Studio base operating guide

This file tells an AI agent (GitHub Copilot, Codex, Claude, and others) how to work safely and
effectively across **JRM Studio** repositories. It is the shared floor. **Each product repo
extends it** with its own root `AGENTS.md` that adds product-specific stack, paths, and rules —
product rules layer on top of, and may override, the defaults here.

> This file lives in the canonical `jrmoulckers/.github` backbone repo. It is distributed to
> product repos by the studio sync tool; edit the canonical copy here, not the copies.

## What JRM Studio is

A family of independent product repositories (`jrm-recipes`, `score-king`, `finance`, and more)
that share DNA — work practice, AI agents/skills, community-health files, and reusable CI —
through this backbone repo and `@jrm` npm packages. Products stay independent; the shared layer
keeps them consistent.

## Golden rules

1. **Never commit secrets.** Real values live only in git-ignored files. In tracked files use
   `${VARS}` or placeholders (`YOUR_API_KEY_HERE`) and ship a `.env.example`. If you find a
   secret that would be committed, stop and flag it.
2. **Issue-first, PR-always.** Every change references an issue and lands as a PR. A task that
   ends at a local commit is **incomplete**. Read-only research does not need an issue when it makes
   no repository change; the issue requirement begins before the first change.
3. **Stay in scope.** Make surgical, intentional edits. Don't reformat or "clean up" unrelated
   code. Don't work outside the repository root.
4. **Document decisions.** Non-trivial structural or design choices get an ADR in
   `docs/architecture/` (or the product's ADR location).
5. **When unsure, ask.** Prefer a short clarifying question over a guess that touches
   security, data, or infrastructure.

## Core principles

1. **Privacy first** — treat user data as confidential by default; never log or transmit it in
   plain text.
2. **Accessibility** — UI meets WCAG 2.2 AA minimum: semantic elements, screen-reader support,
   reduced-motion and high-contrast preferences.
3. **Security** — follow OWASP guidance; validate and sanitize inputs; never hardcode secrets.
4. **Transparency** — capture significant trade-offs in commit messages and PR descriptions.
5. **Conventional commits** — `type(scope): description (#N)` (`feat`, `fix`, `docs`, `style`,
   `refactor`, `test`, `chore`, `ci`, `perf`).

## Definition of Done — not complete until ALL gates pass

| Gate | Verification |
| --- | --- |
| **Lint & format** | The repo's lint/format check passes with no errors. |
| **Type-check** | Static type-check passes (where the stack has one). |
| **Tests** | Affected unit/integration tests pass. |
| **Build** | The affected app/package builds. |
| **PR open & green** | A PR is open against the default branch with CI green. |
| **No conflicts** | The PR is `MERGEABLE` (not `DIRTY`/`BEHIND`). |
| **Merged** | The PR is merged once the quality gate passes (unless a documented blocker prevents it). |

Run the repo's own pre-push checks before every push (each product repo documents the exact
commands). Merge conflicts carry the same weight as red CI — resolve them before merging.

## Issue-First Development

1. Every change references a GitHub issue — create one first if none exists.
2. Work on a feature branch (or worktree); never commit directly to the default branch.
3. Commit messages include the issue reference: `type(scope): description (#N)`.
4. Push your feature branch, then open a PR against the default branch with `Closes #N`.
5. Verify the PR exists, then monitor CI until it is green **and** the PR is `MERGEABLE`.
6. Land the work: self-merge your own PR once the quality gate passes. A change left only on a
   side branch is not done. If a real blocker prevents merge, leave one green, `MERGEABLE` PR
   with a `## Needs Human Action` note.

## Coding standards

- Write clear, self-documenting code; comment only when intent isn't obvious.
- Prefer small, focused functions, modules, and PRs.
- Write tests alongside new code (unit tests for logic; integration tests for I/O and APIs).
- Use each language's conventional naming; document public APIs.

## What NOT to do

- Do NOT commit secrets, API keys, tokens, or credentials.
- Do NOT add dependencies without documenting why.
- Do NOT bypass linters, formatters, or CI checks.
- Do NOT ship placeholder implementations without a clearly marked `// TODO:`.
- Do NOT make changes outside the scope of the assigned task.

## Tooling (MCP)

Pinned MCP servers are declared in `agency.toml`. Intrinsically bounded Context7 documentation and
sequential-thinking tools are enabled by default; Playwright browser automation and persistent
memory are documented, pinned opt-ins until the consuming host's tool-filter enforcement is
verified. Product repos may define a narrower local runtime policy.

## Human-Gated Operations (MANDATORY)

These apply to **all** AI tools in every studio repo. Pushing feature branches and creating PRs
is **required and auto-approved** — stopping at a local commit to ask permission is a workflow
violation. The operations below, however, require explicit human approval.

**1 — Git remote.** Auto-approved: push/rebase your **own** feature branch, `fetch`,
`force-with-lease` on your own branch to resolve a rebase/conflict, read-only git.
Gated/forbidden: pushing to `main`/release branches, plain `git push --force`, force-with-lease
on shared branches, remote/merge reconfiguration.

**2 — Pull requests.** Auto-approved on **your own** PRs: create, review, request changes,
merge once the quality gate passes (CI green AND `MERGEABLE`). Gated: merging, approving,
closing, or dismissing reviews on a PR you did **not** author; merging while CI is red or the PR
conflicts.

**3 — Remote platform.** Auto-approved: routine triage labels. Gated: closing/reopening/deleting
issues, changing gating labels (`blocked`, `security`, `breaking-change`), and any repo-settings,
branch-protection, secrets, deployment, or `gh api` write.

**4 — Outside project boundary.** Never read, write, or execute outside the repository root, and
never modify system configuration or install global tools.

**5 — Destructive file ops.** No recursive/bulk/wildcard deletion; name each file to remove and
explain why. Never overwrite a file without reading it first.

**6 — Publishing & distribution.** No `npm publish`, image pushes, store submission, or deploy
scripts. Prepare the release and hand the final publish to a human.

**7 — Secrets & credentials.** Never create/read real secret files, access OS keychains, generate
real keys, or echo secret-bearing env vars. Use `.env.example` placeholders.

**8 — Destructive database ops.** No `DROP`/`TRUNCATE`/unqualified `DELETE`/destructive `ALTER`,
no restores, no pointing connection strings at production. Write reversible migrations for a human
to review and run.

If a task needs a gated operation: **stop, state what and why, and wait for approval.** Never work
around these restrictions. If no human is available, complete everything that is auto-approved,
then leave a clear `## Needs Human Action` note.

## Nested guides

Scope-specific rules live alongside the code — read the relevant one before working in that area:

- Each product repo's root `AGENTS.md` — stack, paths, and product-specific rules.
- `agents/*.agent.md` in this backbone, materialized as `.github/agents/*.agent.md` in consumers —
  role definitions and boundaries. Consumer copies are generated; product-specific stack/path/risk
  overlays belong in the product's root `AGENTS.md` or scoped instructions.
- `skills/<name>/SKILL.md` in this backbone is canonical; opted-in consumers read the generated,
  upstream-owned `.github/skills/<name>/SKILL.md` materialization.
- `instructions/*.instructions.md` in this backbone is canonical; opted-in consumers read generated,
  upstream-owned `.github/instructions/*.instructions.md` copies. Root/local `AGENTS.md` and
  more-specific scoped instructions override shared defaults without relaxing mandatory human
  gates.
<!-- studio:base:end -->
