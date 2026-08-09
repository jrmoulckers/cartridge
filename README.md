# Cartridge

Track the games you're playing, have played, and want to play — across Steam, Xbox,
PlayStation and Nintendo. Rate them, review them, shelve them. Goodreads for video games.

**It works completely offline with no accounts connected.** That's the point, not a
fallback: shelves, ratings, Markdown reviews, notes, dates, search and backups all run on
your device with nothing plugged in. Platform connectors and metadata lookup are
conveniences on top of an app that is already complete without them.

## Status

| Phase | State |
| --- | --- |
| 1 — local-first core | ✅ done |
| 2 — metadata bridge + connector interface | ✅ done |
| 3 — Steam connector | ✅ done |
| 4 — Xbox connector | ✅ done |
| 5–6 — PlayStation, Nintendo connectors | not started |
| 7–8 — stats, import/export | not started |

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

That's it. No configuration, no keys, no account. Add a game and start using it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` (PWA included) |
| `npm run preview` | Serve the production build |
| `npm run check` | `svelte-check` + `tsc` |
| `npm test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |

## Optional: metadata

To get cover art, genres and release dates filled in for you, deploy the bridge — a small
Cloudflare Worker that talks to IGDB — and paste its URL into **Settings → Metadata
bridge**. See [`bridge/README.md`](bridge/README.md) for the two secrets you need and how
to get them.

Without it, you type the details in yourself and everything else is identical.

## Documentation

| Document | What's in it |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | What Cartridge is, who it's for, and what it refuses to be. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The four non-negotiables, the data model, the layers, the failure modes. |
| [DESIGN.md](DESIGN.md) | The design system, sourced entirely from `@jrm/tokens`. |
| [AGENTS.md](AGENTS.md) | Conventions for anyone — human or agent — working in this repo. |
| [bridge/README.md](bridge/README.md) | The worker: secrets, deploy, hardening, and what it deliberately is not. |
| [vendor/README.md](vendor/README.md) | The vendored design tokens and where they come from. |

## Product authority

Product obligations and outcomes are defined in
[jrmoulckers/product](https://github.com/jrmoulckers/product) and consumed by reference —
cite obligations by stable ID (for example `PROD-REL-001`), pinning to a commit SHA when the
exact wording matters. Roadmaps, metrics, experiments and compliance evidence stay here and
cite the obligation they satisfy; [PRODUCT.md](PRODUCT.md) is Cartridge's instance.

Engineering mechanisms are defined in
[jrmoulckers/engineering](https://github.com/jrmoulckers/engineering), design and interface in
[jrmoulckers/studio](https://github.com/jrmoulckers/studio), and automation and shared agent
assets in [jrmoulckers/.github](https://github.com/jrmoulckers/.github).

## Your data

Your library lives in IndexedDB in your browser. There is no Cartridge account and no
Cartridge server — nothing to sign up for and nothing to leak.

**Take a backup.** *Settings → Your data → Save a backup* writes one JSON file, covers
included, that you own. Restoring it replaces the library on that device (and downloads a
copy of what was there first, just in case).

## Built with

Svelte 5 · Vite · TypeScript · `idb` · `vite-plugin-pwa` · Vitest · Cloudflare Workers +
KV. Design tokens from [`@jrm/tokens`](vendor/README.md). A sibling to
[score-king](https://github.com/jrmoulckers/score-king).
