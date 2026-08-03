# Cartridge — product

## What it is

**Goodreads for video games.** Cartridge tracks the games you're playing, have played, and
want to play, and lets you rate and review them the way you would a book. It can pull your
library in from Steam, Xbox, PlayStation and Nintendo — but it does not need to.

## Who it's for

Someone with a games library scattered across four storefronts and twenty years, who wants
one place that answers:

- *What am I in the middle of?*
- *What did I think of that game I finished in 2019?*
- *What should I play next, out of the 300 things I already own?*

## The promise

**Your library is yours, it lives on your device, and it works with nothing connected.**

Every feature that matters — adding a game, shelving it, rating it, reviewing it, searching
it, backing it up — works with no accounts, no bridge and no network. Connectors and
metadata lookup are conveniences layered on top of a complete app, never load-bearing.

## Core concepts

| Concept | What it means |
| --- | --- |
| **Game** | The canonical record for a title: cover, genres, release date, developer. Authored by you or filled in from IGDB. |
| **Entry** | *Your* relationship to a game: shelf, rating, review, notes, dates, tags. One per game, whatever platforms you own it on. |
| **Shelf** | Where a game sits. Five built-ins — Playing, Backlog, Played, Wishlist, Abandoned — plus any number of your own. |
| **Platform link** | The id a storefront uses for a game, so a connector knows your "Hades" and Steam's "Hades™" are the same thing. |
| **Session stat** | Playtime, last-played and achievements, as reported by a platform. Never authored by hand. |

### One entry, many platforms

Owning a game on Steam *and* Xbox gives you **one** entry with two platform links and
merged stats — not two rows to rate separately. Your opinion of a game is about the game,
not the storefront.

### Playtime you don't have is not zero

PlayStation does not report playtime. Cartridge stores that as `null` and renders it as
"Not reported". Writing `0h` would be a small lie that quietly poisons every statistic
built on top of it.

## Ratings

- **Five stars, half steps.** The familiar Goodreads scale, and the one most people can use
  consistently.
- **An optional score out of 100** for people who want more resolution, stored separately
  so the two never fight.
- **Unrated is a real state.** Not zero stars, not one — no rating at all, and easy to get
  back to.

## Reviews and notes

Both are Markdown, and both are yours:

- A **review** is what you thought of the game.
- **Notes** are private working notes — where you left off, what to try next.

Markdown is rendered by a small in-repo renderer that escapes everything first and only
emits markup it generates itself. No HTML passthrough, no third-party sanitizer to keep
patched.

## Anti-references

Cartridge is deliberately **not**:

- A social network. There is no feed, no follower count, no "5 friends played this".
- An engagement machine. No streaks, no notifications begging you back, no daily quests.
- A storefront. It never sells you a game or shows you an ad.
- A cloud service. There is no Cartridge account, because there is no Cartridge server.
- A completionist scold. An abandoned game is a legitimate outcome, not a failure state.

## Scope by phase

| Phase | What lands |
| --- | --- |
| **1 — local core** ✅ | Shelves, manual entry, ratings, Markdown reviews and notes, dates, replays, tags, search and filter, JSON backup/restore, full offline operation. |
| **2 — the bridge** ✅ | Cloudflare Worker with IGDB search and metadata, KV-cached. Real covers, genres, release dates. The connector interface, with no connectors. |
| 3 — Steam | The first connector: owned games, playtime, achievements. |
| 4 — Xbox | Xbox library and achievements. |
| 5 — PlayStation | PSN library and trophies (no playtime — see above). |
| 6 — Nintendo | Nintendo, within whatever the platform actually permits. |
| 7 — stats | Year in review, playtime and rating distributions, backlog burn-down. |
| 8 — import/export | CSV import from other trackers, richer export formats. |
