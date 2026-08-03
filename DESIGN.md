---
name: Cartridge
description: A local-first PWA that tracks the games you're playing, have played, and want to play — Goodreads for video games.
colors:
  primary: "#7c5cff"
  primary-strong: "#6b46f0"
  accent: "#ffd166"
  accent-ink-light: "#806600"
  good: "#34d399"
  bad: "#f87171"
  warn: "#fbbf24"
  info: "#38bdf8"
  dark-bg: "#0f1020"
  dark-surface: "#1a1b2e"
  dark-surface-2: "#24263f"
  dark-surface-3: "#2c2e4d"
  dark-border: "#313357"
  dark-text: "#e9e9f4"
  dark-muted: "#a3a6cb"
  light-bg: "#f4f4fb"
  light-surface: "#ffffff"
  light-surface-2: "#f1f1f9"
  light-surface-3: "#e7e7f4"
  light-border: "#dcdcea"
  light-text: "#1c1d2e"
  light-muted: "#5b5e7e"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.4
  overline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  sm: "9px"
  md: "14px"
  chip: "10px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "16px"
  xl: "20px"
motion:
  press: "50ms"
  tile: "120ms"
  state: "150ms"
  easing: "ease"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "12px 18px"
    height: "46px"
  button-primary-hover:
    backgroundColor: "{colors.primary-strong}"
  button-default:
    backgroundColor: "{colors.dark-surface-2}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.sm}"
    padding: "12px 18px"
    height: "46px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.dark-text}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.bad}"
  card:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.sm}"
    padding: "11px 12px"
    height: "46px"
  pill:
    backgroundColor: "{colors.dark-surface-2}"
    textColor: "{colors.dark-muted}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  cover:
    backgroundColor: "{colors.dark-surface-2}"
    rounded: "{rounded.sm}"
    aspectRatio: "3 / 4"
  star-filled:
    textColor: "{colors.accent}"
  star-empty:
    textColor: "{colors.dark-border}"
  iconbtn:
    backgroundColor: "{colors.dark-surface-2}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.chip}"
    size: "42px"
---

# Design System: Cartridge

## 1. Overview

**Creative North Star: "The Shelf"**

Cartridge is a bookshelf for games. A shelf is quiet, personal and slightly proud: the
spines face out, the order means something to the person who arranged it, and nothing on it
is trying to sell you anything. The app is the same. Covers do the talking; the chrome gets
out of the way; the only decoration is the one gold star you awarded yourself.

Every value in this system comes from **`@jrm/tokens`**, the shared JRM Studio design token
distribution vendored at `vendor/@jrm/tokens`. Cartridge invents no colour, no spacing step,
no radius and no duration. `src/app.css` imports the token CSS and defines only short local
aliases (`--bg`, `--surface`, `--primary`, …) so that a token rename is a one-file change.

**Key characteristics**

- **Cover-forward.** The library grid is art on a shelf, not a table of rows.
- **Dark-first**, OLED-friendly, with a faithful light theme and a high-contrast theme — all
  four are token themes keyed off `[data-theme]` on `<html>`.
- **Royal Violet for the one action that matters; Crown Gold only for stars and favourites.**
  Scarcity is what makes an accent mean something.
- **≥46px touch targets**, thumb-zone-first: app bar and bottom tab bar on phones, a solid
  left rail from 900px.
- **Empty states that reassure**, never nag. "Your library starts empty — and that's all it
  needs."

## 2. Colours

The palette is the studio palette: saturated Royal Violet and Crown Gold against deep
indigo neutrals, with a tight semantic set for good/bad/caution/info.

| Role | Token | Dark | Light |
| --- | --- | --- | --- |
| App background | `--semantic-background-primary` | `#0f1020` | `#f4f4fb` |
| Card / input surface | `--semantic-background-elevated` | `#1a1b2e` | `#ffffff` |
| Secondary chrome | `--semantic-background-secondary` | `#24263f` | `#f1f1f9` |
| Deepest chrome | `--semantic-background-raised` | `#2c2e4d` | `#e7e7f4` |
| Border | `--semantic-border-default` | `#313357` | `#dcdcea` |
| Primary text | `--semantic-text-primary` | `#e9e9f4` | `#1c1d2e` |
| Muted text | `--semantic-text-secondary` | `#a3a6cb` | `#5b5e7e` |
| Action | `--semantic-interactive-default` | Royal Violet | `#7c5cff` |
| Stars / favourite | `--semantic-accent-default` | Crown Gold `#ffd166` | `#ffd166` |
| Gold *text* on light | `--semantic-accent-ink` | `#ffd166` | `#806600` |

Two rules:

- **The Crown Gold rule.** Gold appears on exactly two things: a star you filled in, and a
  favourite. It never becomes a general highlight colour.
- **Gold text darkens on light surfaces.** Pure `#ffd166` fails WCAG on white, so
  `accent-ink` is `#806600` in the light theme while fills stay gold. Use `--accent` for
  fills and `--accent-ink` for text.

## 3. Typography

One native sans for everything (the studio Quiet-Type Rule) — no webfont to download, no
layout shift, and it looks native on every platform.

| Style | Size | Weight | Used for |
| --- | --- | --- | --- |
| Display | 1.6rem | 700 | Page titles |
| Title | 1.25rem | 700 | Section headings, game titles on the detail page |
| Body | 1rem | 400 | Everything else |
| Label | 0.9rem | 400 | Form labels |
| Overline | 0.8rem | 600, +0.08em, uppercase | Counts, metadata lines, hints |

Numbers that sit in columns — ratings, counts, playtime — use
`font-variant-numeric: tabular-nums` so they don't shuffle as they change.

## 4. Layout and shape

- **Radii**: `9px` controls, `14px` containers, `10px` chips, `999px` pills.
- **Spacing**: `6 / 10 / 14 / 16 / 20px`. Nothing between.
- **Shell**: sticky app bar + fixed bottom tab bar under 900px; both collapse into a 232px
  left rail above it. `env(safe-area-inset-*)` everywhere so notches and home indicators
  never clip a control.
- **Covers are 3:4**, always. A missing cover is not a broken image — it is a designed tile
  with the game's initials, because a hand-added game is a first-class citizen.
- **Grid**: `repeat(auto-fill, minmax(132px, 1fr))`. Titles clamp to two lines so one long
  name can't shove the grid around.

## 5. Motion

Fast and functional; nothing you wait for.

| Token | Duration | Used for |
| --- | --- | --- |
| `--duration-press` | 50ms | `:active` press-down |
| `--duration-tile` | 120ms | Tile hover lift, star fill |
| `--duration-state` | 150ms | Hover and state colour changes |

The star fill animates `clip-path`, not `width` — composited, and it doesn't distort the
glyph. Every transition is disabled under `prefers-reduced-motion: reduce`.

## 6. Accessibility

Non-negotiable, not a pass at the end.

- **One focus vocabulary**: a 2px `--semantic-border-focus` ring with 2px offset, on every
  focusable thing (WCAG 2.4.7).
- **The rating control is a radio group** of ten half-steps with a roving tabindex: one tab
  stop, arrows adjust, Home/End jump to the ends, Delete/Backspace clears. Screen readers
  announce "3.5 out of 5".
- **Touch targets ≥46px**; `touch-action: manipulation` kills the 300ms tap delay.
- **Live regions** for result counts, save confirmations and toasts; errors use `role="alert"`
  and assertive politeness, everything else is polite.
- **Page titles change per route** (WCAG 2.4.2), and `document.title` names the game on a
  game page.
- **A high-contrast theme** and honouring of `prefers-contrast`, `prefers-color-scheme` and
  `prefers-reduced-motion` come from the token distribution, not from bespoke CSS.
- **Colour is never the only signal**: shelf pills carry text, degraded connectors carry a
  sentence, favourites carry a glyph.

## 7. Voice

Plain, warm, and never anxious. The app's job is to be a shelf, not a coach.

- "Your library starts empty — and that's all it needs."
- "Not reported" — never "0h" for a platform that doesn't tell us.
- "The bridge isn't reachable right now — fill the form in below instead."
- "Removed the Comfort games shelf — its games are still in your library."

No exclamation marks in error messages. No blame. No "Oops!".
