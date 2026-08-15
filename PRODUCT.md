# Cartridge — product

Cartridge's product definition. It is an instance of the obligations defined in
[jrmoulckers/product](https://github.com/jrmoulckers/product); sections below cite the
obligation IDs they satisfy rather than restating them.

## What it is

**Goodreads for video games.** Cartridge tracks the games you're playing, have played, and
want to play, and lets you rate and review them the way you would a book. It can pull your
library in from Steam, Xbox, PlayStation and Nintendo — but it does not need to.

## Who it's for

Someone with a games library scattered across four storefronts and twenty years, who wants
one place that answers:

- _What am I in the middle of?_
- _What did I think of that game I finished in 2019?_
- _What should I play next, out of the 300 things I already own?_

## The promise

_Satisfies
[`PROD-STRAT-001` (Put durable value and trust first)](https://github.com/jrmoulckers/product/blob/main/principles/strategy.md)
— the target user value and the trust constraints that outrank adoption or novelty,
for the three sections above._

**Your library is yours, it lives on your device, and it works with nothing connected.**

Every feature that matters — adding a game, shelving it, rating it, reviewing it, searching
it, backing it up — works with no accounts, no bridge and no network. Connectors and
metadata lookup are conveniences layered on top of a complete app, never load-bearing.

## Core concepts

| Concept           | What it means                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Game**          | The canonical record for a title: cover, genres, release date, developer. Authored by you or filled in from IGDB.         |
| **Entry**         | _Your_ relationship to a game: shelf, rating, review, notes, dates, tags. One per game, whatever platforms you own it on. |
| **Shelf**         | Where a game sits. Five built-ins — Playing, Backlog, Played, Wishlist, Abandoned — plus any number of your own.          |
| **Platform link** | The id a storefront uses for a game, so a connector knows your "Hades" and Steam's "Hades™" are the same thing.           |
| **Session stat**  | Playtime, last-played and achievements, as reported by a platform. Never authored by hand.                                |

### One entry, many platforms

Owning a game on Steam _and_ Xbox gives you **one** entry with two platform links and
merged stats — not two rows to rate separately. Your opinion of a game is about the game,
not the storefront. As of phase 4 this is a tested property rather than an intention: see
`src/lib/connectors/cross-platform.test.ts`.

### Playtime you don't have is not zero

_Satisfies
[`PROD-MET-003` (Interpret metrics honestly)](https://github.com/jrmoulckers/product/blob/main/principles/metrics.md)
— unknown and none are different facts, and a number may not claim more than the data
supports._

PlayStation does not report playtime. Cartridge stores that as `null` and renders it as
"Not reported". Writing `0h` would be a small lie that quietly poisons every statistic
built on top of it.

Steam is the other half of the same rule: a game you own and have never launched is a real
`0`, and it is shown as `0`. Unknown and none are different facts and Cartridge never
conflates them.

### Connecting a platform is a proposal, not an event

A Steam library can be eleven hundred games. Sync reads it, works out what would change, and
**shows you before writing anything**: what's new, what you already own and will simply gain
a Steam link, what couldn't be identified. You choose the shelf new games land on — Backlog
by default, because an unplayed library is a backlog.

Running it again changes nothing. Playtime, last-played and achievements are refreshed;
ratings, reviews, notes, statuses, dates and shelves are yours and are never written by a
sync. Disconnecting removes the account and the platform's numbers, and leaves everything you
wrote exactly where it was.

## What a connector holds

A connector is the one part of Cartridge that handles something genuinely sensitive, so what
it holds, who it goes to, and what happens when you stop are stated here rather than left to
the architecture.

### One credential, one purpose

_Satisfies
[`PROD-COMP-002` (Bound processing by purpose and necessity)](https://github.com/jrmoulckers/product/blob/main/principles/compliance.md)
and
[`PROD-COMP-004` (Decide residency and transfer bounds before launch)](https://github.com/jrmoulckers/product/blob/main/principles/compliance.md)._

A connector needs exactly one platform credential and Cartridge asks for nothing else: for
Steam a 64-bit account id, which is public information; for Xbox the user's own free OpenXBL
key. PlayStation will need an NPSSO token, which is a real session secret rather than an
account number, and that is why phase 5 is a step up in sensitivity rather than one more
storefront.

The credential lives in IndexedDB on the device. It is sent to the bridge only inside the one
request that cannot be made without it, and only for that request — never to be stored, because
there is nowhere to store it. Cartridge has no account, so nothing on any server ever
associates a credential with a person.

The parties are named rather than implied. Everything goes through Cartridge's own Cloudflare
Worker (`bridge/`), and from there — depending only on which connectors you attach — to Steam's
Web API, to OpenXBL, and to IGDB via Twitch for covers and metadata. There is no analytics
vendor, no error reporter and no fourth party.

### Connecting is per platform, and undoing it is one step

_Satisfies
[`PROD-COMP-008` (Make consent specific and revocable)](https://github.com/jrmoulckers/product/blob/main/principles/compliance.md)._

Attaching Steam says nothing about Xbox. Disconnecting deletes the stored credential rather
than ending a session, takes the platform's numbers with it, and leaves everything you wrote
untouched — one button, no harder than connecting was.

Where the promise stops is stated too: an OpenXBL key is issued by xbl.io and lives in your
account there, so Cartridge forgetting its copy is the whole of what it can do. Killing the key
everywhere means deleting it at the source, and claiming otherwise would be a revocation
Cartridge cannot perform.

### Getting your library out, and getting rid of it

_Satisfies
[`PROD-COMP-003` (Map privacy rights to product behavior)](https://github.com/jrmoulckers/product/blob/main/principles/compliance.md)
and
[`PROD-COMP-005` (Bound retention and terminal disposition)](https://github.com/jrmoulckers/product/blob/main/principles/compliance.md)._

Export is the whole library as one JSON file, on demand, with no server involved and nothing
held back — except credentials, which sit deliberately outside the backup envelope, because a
backup is a file people email themselves and drop in cloud storage.

Deletion is real deletion: clearing the site's data removes the library, because the device is
the only place it ever was. The bridge has nothing to delete, which is the whole reason
Cartridge can promise a deletion outcome without operating a request queue to honour it — it
caches public facts about games, keyed by game, and never a library, a playtime figure or an
account id.

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

_Satisfies
[`PROD-STRAT-001` (Put durable value and trust first)](https://github.com/jrmoulckers/product/blob/main/principles/strategy.md)
— the rejected options and the trust constraints that ruled them out._

Cartridge is deliberately **not**:

- A social network. There is no feed, no follower count, no "5 friends played this".
- An engagement machine. No streaks, no notifications begging you back, no daily quests.
- A storefront. It never sells you a game or shows you an ad.
- A cloud service. There is no Cartridge account, because there is no Cartridge server.
- A completionist scold. An abandoned game is a legitimate outcome, not a failure state.

## Stats, and what a number is allowed to claim

_Satisfies
[`PROD-MET-001` (Give each metric one versioned decision definition)](https://github.com/jrmoulckers/product/blob/main/principles/metrics.md)
(one owned definition per metric, stating its population, window and exclusions) and
[`PROD-MET-003` (Interpret metrics honestly)](https://github.com/jrmoulckers/product/blob/main/principles/metrics.md)
(report coverage, limitations and what the number cannot claim) — for this section and the
two that follow._

Cartridge's data is structurally incomplete by design, so the stats screens are built around
one rule: **every number carries the share of the library it could actually see.** "412 hours"
is false the moment half your library reports nothing; "412 hours across 38 of your 91 games"
is true, and more interesting. A figure that can't be computed honestly says why instead of
showing a zero.

### What counts as "this year"

A game belongs to a year when it carries a dated fact in it, in your own time zone: a finish
date, a start date, a replay date, or the last-played date a platform reports. Everything
that follows from that is stated on the page rather than hidden:

- **A game with no dates belongs to no year.** It is counted and named, never quietly
  dropped — and never back-filled from the day it was imported, which is a fact about an
  import rather than about playing a game.
- **Last-played is _last_, not _every_.** Play something again next year and it moves with
  you, leaving the year before.
- **Hours played _in_ a year cannot be computed, so they are never claimed.** Steam and Xbox
  report how long you have played a game in total, never when. The year page reports the
  lifetime playtime behind the games your year touched, labelled exactly that.
- **"Rated in 2026" is not a thing either.** A rating carries no timestamp of its own, so the
  page talks about your ratings _of_ the year's games and makes no claim about when you gave
  them.

### What Cartridge deliberately won't tell you

- **Whether a game surprised you.** It never asked what you expected, so a "low expectations,
  high rating" statistic would be invented, not measured.
- **How long a game takes.** There is no HowLongToBeat integration and IGDB does not carry
  reliable completion times. Backlog triage sorts on dates and titles — things Cartridge
  actually knows — rather than on an estimate you might plan an evening around.
- **Anything shaped like a streak.** No "you're behind", no daily target, no nagging. See the
  anti-references above.

Backlog triage keeps the `0` / `null` distinction in the foreground: **never launched** is a
platform reporting a real zero, **nobody knows** is no platform reporting at all, and mixing
the two into one "unplayed" pile would throw away the only thing that makes the screen more
useful than the shelf it summarises.

## Scope by phase

_Satisfies
[`PROD-STRAT-003` (Build roadmaps from coherent outcome milestones)](https://github.com/jrmoulckers/product/blob/main/principles/strategy.md)
(milestones are coherent outcomes that stay valuable without any one platform or vendor) and
[`PROD-PLAN-001` (Plan independently shippable outcome slices)](https://github.com/jrmoulckers/product/blob/main/principles/planning-and-delivery.md)
(each phase is an independently shippable slice — phase 7 shipped ahead of 5 and 6 precisely
because it did not depend on them)._

| Phase                 | What lands                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — local core** ✅ | Shelves, manual entry, ratings, Markdown reviews and notes, dates, replays, tags, search and filter, JSON backup/restore, full offline operation.                                                         |
| **2 — the bridge** ✅ | Cloudflare Worker with IGDB search and metadata, KV-cached. Real covers, genres, release dates. The connector interface, with no connectors.                                                              |
| **3 — Steam** ✅      | The first connector: Steam sign-in via OpenID, owned games, playtime, achievements, and a review step before anything is written.                                                                         |
| **4 — Xbox** ✅       | The second connector, via the unofficial OpenXBL. Title history, last-played, achievements, batched playtime. Title-based IGDB matching that refuses to guess, with the unmatched tail listed for review. |
| 5 — PlayStation       | PSN library and trophies (no playtime — see above).                                                                                                                                                       |
| 6 — Nintendo          | Nintendo, within whatever the platform actually permits.                                                                                                                                                  |
| **7 — stats** ✅      | Pulled forward ahead of PlayStation and Nintendo. Stats page, year in review, backlog triage — every figure carrying the share of the library it could see, computed locally with no bridge involvement.  |
| 8 — import/export     | CSV import from other trackers, richer export formats.                                                                                                                                                    |
