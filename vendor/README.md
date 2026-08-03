# vendor/

Third-party and studio-shared code that is **copied in, not authored here**.

## `@jrm/tokens`

The `@jrm/tokens` design-token distribution from the private `jrmoulckers/studio` repo.

Per `jrmoulckers/.github` → `studio.config.json` → `tokens`, the studio sync engine is
registry-free ("Option A"): it copies studio's committed `packages/tokens/dist` tree
**verbatim** into each opted-in member at `vendor/@jrm/tokens`. Cartridge consumes it
through the `@jrm/tokens` alias declared in `vite.config.ts`, `vitest.config.ts` and
`tsconfig.app.json`, so switching to a published npm package later is a one-line change.

**Do not hand-edit anything under `@jrm/tokens/`.** Token changes are made in
`jrmoulckers/studio` (`packages/tokens/tokens/**`), regenerated with Style Dictionary, and
re-synced here.

- `css/default/index.css` — the entry point `src/app.css` imports. Pulls in the light
  (`:root`), `[data-theme="dark"]`, `[data-theme="dark-oled"]` and
  `[data-theme="high-contrast"]` palettes, plus `prefers-color-scheme`,
  `prefers-contrast` and `prefers-reduced-motion` handling.
- `js/` — the same tokens as typed JS objects, for code that needs a raw value.
- `tailwind/default.cjs` — a Tailwind preset. Unused: Cartridge is plain CSS, like
  `score-king`.

### Pending

`jrmoulckers/cartridge` still needs a `members[]` entry in `jrmoulckers/.github`'s
`studio.config.json` (`framework: "svelte"`, `tokens.enabled: true`,
`targetPath: "vendor/@jrm/tokens"`) so future token releases sync automatically. That lives
in a different repo and must be raised as its own PR.
