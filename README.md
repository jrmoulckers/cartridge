# Cartridge

Track the games you're playing, have played, and want to play - across Steam, Xbox, PlayStation and Nintendo.

A member repo of **JRM Studio**: shared agents, skills, prompts and design tokens arrive via
`chore(sync)` PRs from [`jrmoulckers/.github`](https://github.com/jrmoulckers/.github). See
[`AGENTS.md`](AGENTS.md) for the stack, the platform-API constraints that shape it, and the
rules for working in this repo.

## Getting started

```bash
pnpm install
pnpm dev
```

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `pnpm dev`          | Next.js dev server                    |
| `pnpm build`        | Production build                      |
| `pnpm lint`         | ESLint                                |
| `pnpm format:check` | Prettier check (`pnpm format` to fix) |
| `pnpm typecheck`    | `tsc --noEmit`                        |
| `pnpm test`         | `node --test`                         |

CI runs the same commands through the studio's reusable workflows
(`.github/workflows/ci.yml`).
