<script lang="ts">
  /**
   * Year in review — the annual artifact.
   *
   * A more designed surface than the stats page on purpose: a handful of strong statements
   * rather than a wall of numbers. Everything here is prose in the DOM, so a screen-reader
   * user gets exactly the same story, in the same order, as a sighted one — the numbers are
   * inside the sentences rather than floating beside them.
   *
   * The honesty problem is sharper here than anywhere else in the app, because a "year in
   * review" *sounds* complete. Three things are therefore said out loud rather than papered
   * over: the games no year can claim, the fact that a platform only reports the **last**
   * time you played, and that hours-in-a-year is not a number Cartridge can compute at all.
   */
  import { library, libraryLoaded } from '../stores/library';
  import {
    availableYears,
    yearInReview,
    LAST_PLAYED_IS_LAST,
    NO_YEARLY_PLAYTIME,
  } from '../stats/year';
  import { formatCount, formatHours, formatRating, pluralize } from '../stats/format';
  import { link, navigate } from '../router';
  import Coverage from '../components/Coverage.svelte';
  import BarChart from '../components/BarChart.svelte';

  interface Props {
    /** From the route. Absent means "this year". */
    year?: string;
  }

  let { year = undefined }: Props = $props();

  const years = $derived(availableYears($library));
  const selected = $derived(Number(year) || new Date().getFullYear());
  const review = $derived(yearInReview($library, selected));

  const empty = $derived($libraryLoaded && $library.length === 0);

  /** The one sentence the page leads with. Written to be true of a thin year too. */
  const headline = $derived.by(() => {
    if (review.finished > 0) return `You finished ${pluralize(review.finished, 'game')}.`;
    if (review.started > 0) return `You started ${pluralize(review.started, 'game')}.`;
    if (review.games > 0) return `You spent time with ${pluralize(review.games, 'game')}.`;
    return 'Nothing is dated to this year yet.';
  });

  function choose(event: Event) {
    navigate(`/year/${(event.currentTarget as HTMLSelectElement).value}`);
  }
</script>

{#if empty}
  <h1>Year in review</h1>
  <section class="card stack">
    <h2>There’s no year to look back on yet</h2>
    <p class="muted">
      This page is built from the dates on your own games. Add one, note when you started or
      finished it, and a year assembles itself — with no account and nothing to sync.
    </p>
    <a class="btn primary" href="/add" use:link>Add a game</a>
  </section>
{:else}
  <div class="row spread wrap head">
    <h1>Your {selected}</h1>
    <div>
      <label class="sr-only" for="year-select">Year</label>
      <select id="year-select" value={String(selected)} onchange={choose}>
        {#each years as y (y)}
          <option value={String(y)}>{y}</option>
        {/each}
      </select>
    </div>
  </div>

  <section class="hero card" aria-labelledby="headline">
    <p class="overline">{selected} in review</p>
    <p class="headline" id="headline">{headline}</p>
    <p class="sub" role="status">
      {#if review.games}
        {selected} has a claim on {pluralize(review.games, 'game')} of your {formatCount(
          review.libraryTotal,
        )}.
      {:else}
        Out of {pluralize(review.libraryTotal, 'game')} in your library, none carry a date in
        {selected}.
      {/if}
    </p>
  </section>

  {#if review.games === 0}
    <section class="card stack">
      <h2>A quiet year, or a quiet record</h2>
      <p>
        Cartridge places a game in a year only when something on it is dated — when you started it,
        when you finished it, or when a platform last saw you play it. That’s a deliberately strict
        rule: guessing from the day a game was imported would fill this page with confident
        nonsense.
      </p>
      {#if review.undated}
        <p>
          {pluralize(review.undated, 'game')} in your library
          {review.undated === 1 ? 'carries' : 'carry'} no dates at all. Adding a start or finish date
          on a game page is all it takes to bring
          {review.undated === 1 ? 'it' : 'them'} into a year.
        </p>
      {/if}
      <div class="row wrap">
        <a class="btn" href="/" use:link>Go to your library</a>
        <a class="btn ghost" href="/stats" use:link>See the stats that don’t need dates</a>
      </div>
    </section>
  {:else}
    <section class="card stack" aria-labelledby="shape-h">
      <h2 id="shape-h">The shape of the year</h2>
      <ul class="statements">
        <li>
          <strong>{formatCount(review.finished)}</strong>
          {review.finished === 1 ? 'game' : 'games'} finished.
        </li>
        <li>
          <strong>{formatCount(review.started)}</strong>
          {review.started === 1 ? 'game' : 'games'} started.
        </li>
        {#if review.replayed}
          <li>
            <strong>{formatCount(review.replayed)}</strong> went round again.
          </li>
        {/if}
        {#if review.touchedOnly}
          <li>
            <strong>{formatCount(review.touchedOnly)}</strong>
            {review.touchedOnly === 1 ? 'game is' : 'games are'} here only because a platform last saw
            you play {review.touchedOnly === 1 ? 'it' : 'them'} in {selected} — no start or finish date
            of your own.
          </li>
        {/if}
      </ul>
    </section>

    {#if review.bestRated || review.rated}
      <section class="card stack" aria-labelledby="loved-h">
        <h2 id="loved-h">What you thought</h2>
        {#if review.bestRated}
          <p class="statement">
            Your highest-rated game of {selected} was
            <a href="/game/{review.bestRated.id}" use:link>{review.bestRated.title}</a>, at
            {formatRating(review.bestRated.amount)} ★.
          </p>
        {/if}
        {#if review.averageRating.value !== null}
          <p class="statement">
            Across the {pluralize(review.rated, 'game')} you rated, you averaged
            {formatRating(review.averageRating.value)} ★.
          </p>
        {/if}
        <Coverage measure={review.averageRating} />
        <p class="muted note">
          Ratings carry no date of their own, so this is your rating of {selected}’s games — not a
          claim about when you gave it.
        </p>
      </section>
    {/if}

    {#if review.genres.buckets.length || review.platforms.length}
      <section class="card stack" aria-labelledby="lean-h">
        <h2 id="lean-h">Where the year leaned</h2>
        {#if review.genres.buckets[0]}
          <p class="statement">
            Mostly <strong>{review.genres.buckets[0].label}</strong>{#if review.genres.buckets[1]},
              then
              {review.genres.buckets[1].label}{/if}.
          </p>
          <BarChart title="Genres of {selected}" distribution={review.genres} limit={8} />
        {/if}
        {#if review.platforms.length}
          <BarChart
            title="Platforms"
            distribution={{
              buckets: review.platforms,
              covered: review.games,
              total: review.games,
            }}
          />
        {/if}
      </section>
    {/if}

    <section class="card stack" aria-labelledby="time-h">
      <h2 id="time-h">Time</h2>
      {#if review.lifetimeMinutes.value !== null}
        <p class="statement">
          The games {selected} touched have
          <strong>{formatHours(review.lifetimeMinutes.value)}</strong> on the clock — across their whole
          lives, not just this year.
        </p>
      {:else}
        <p class="statement muted">No platform reports playtime for this year’s games.</p>
      {/if}
      <p class="muted note">{NO_YEARLY_PLAYTIME}</p>
    </section>

    {#if review.oldestRelease}
      <section class="card stack" aria-labelledby="old-h">
        <h2 id="old-h">The long way back</h2>
        <p class="statement">
          The oldest game your year touched was
          <a href="/game/{review.oldestRelease.id}" use:link>{review.oldestRelease.title}</a>, from
          {review.oldestRelease.amount}.
        </p>
      </section>
    {/if}
  {/if}

  <section class="card stack" aria-labelledby="fine-h">
    <h2 id="fine-h">The honest small print</h2>
    <ul class="plain">
      <li>{LAST_PLAYED_IS_LAST}</li>
      {#if review.empty}
        <li>{NO_YEARLY_PLAYTIME}</li>
      {/if}
      {#if review.undated}
        <li>
          {pluralize(review.undated, 'game')} in your library
          {review.undated === 1 ? 'has' : 'have'} no dates, so no year can claim
          {review.undated === 1 ? 'it' : 'them'}. That’s a gap in the record, not in your year.
        </li>
      {/if}
    </ul>
  </section>
{/if}

<style>
  .head {
    align-items: center;
  }
  .head h1 {
    margin: 0;
  }
  .head select {
    width: auto;
  }

  /* The one place in the app with a tinted surface: this page is meant to feel like an
     artifact rather than a screen. The tint is mixed from the primary token, never a new
     colour, and every value it uses is a token. */
  .hero {
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--primary) 22%, var(--surface)),
      var(--surface) 70%
    );
    border-color: color-mix(in srgb, var(--primary) 35%, var(--border));
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }
  .headline {
    margin: 0;
    font-size: calc(var(--font-size-display) * 1.35);
    font-weight: var(--font-weight-bold);
    line-height: var(--font-line-height-tight);
    text-wrap: balance;
  }
  .hero .overline,
  .hero .sub {
    margin: 0;
  }
  .sub {
    color: var(--muted);
    font-size: var(--font-size-label);
  }

  .statement {
    margin: 0;
    font-size: var(--font-size-title);
    line-height: var(--font-line-height-snug);
    text-wrap: pretty;
  }
  ul.statements,
  ul.plain {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }
  ul.statements li {
    font-size: var(--font-size-title);
    line-height: var(--font-line-height-snug);
  }
  ul.statements strong {
    font-size: var(--font-size-display);
    font-variant-numeric: tabular-nums;
    margin-right: var(--spacing-xs);
  }
  ul.plain li {
    color: var(--muted);
    font-size: var(--text-overline-size);
    line-height: var(--font-line-height-normal);
  }
  .note {
    margin: 0;
    font-size: var(--text-overline-size);
    line-height: var(--font-line-height-normal);
  }
</style>
