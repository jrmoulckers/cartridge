<script lang="ts">
  /**
   * Stats — the everyday view.
   *
   * Everything on this screen is computed in memory from IndexedDB. There is no request to
   * make, which is what lets it work with no accounts and no network, exactly like the
   * library.
   *
   * The rule the whole page is built around: **no number is shown without the share of the
   * library it could see.** `<StatCard>` and `<Coverage>` make that structural rather than a
   * matter of remembering — a measure that saw 38 of 91 games cannot be rendered as though it
   * saw all of them, because the component is handed the measure, not the number.
   */
  import { library, libraryLoaded } from '../stores/library';
  import { computeStats } from '../stats/compute';
  import { triageBacklog, BACKLOG_SORT_LABELS, NO_LENGTH_ESTIMATE } from '../stats/backlog';
  import type { BacklogSort } from '../stats/backlog';
  import { countUndated } from '../stats/year';
  import { formatCount, formatHours, formatPercent, formatRating, pluralize } from '../stats/format';
  import { measure } from '../stats/types';
  import { PLATFORM_LABELS } from '../types';
  import type { Platform } from '../types';
  import { formatDate } from '../util';
  import { link } from '../router';
  import StatCard from '../components/StatCard.svelte';
  import Coverage from '../components/Coverage.svelte';
  import BarChart from '../components/BarChart.svelte';

  /** Which platform the page is scoped to, or every game. */
  let scope = $state<Platform | 'all'>('all');
  let backlogSort = $state<BacklogSort>('added');

  /** Platforms you actually own something on — no empty options in the picker. */
  const ownedPlatforms = $derived.by(() => {
    const seen = new Set<Platform>();
    for (const item of $library) for (const l of item.links) seen.add(l.platform);
    return [...seen].sort((a, b) => PLATFORM_LABELS[a].localeCompare(PLATFORM_LABELS[b]));
  });

  const scoped = $derived(
    scope === 'all' ? $library : $library.filter((i) => i.links.some((l) => l.platform === scope)),
  );

  const stats = $derived(computeStats(scoped));
  const triage = $derived(triageBacklog(scoped, backlogSort));
  const undated = $derived(countUndated(scoped));
  const thisYear = new Date().getFullYear();

  const empty = $derived($libraryLoaded && $library.length === 0);

  /** Counts are exact — every game is on exactly one shelf — so they carry full coverage. */
  const exact = (n: number) => measure(n, stats.total, stats.total);
</script>

<div class="row spread wrap head">
  <h1>Stats</h1>
  <a class="btn small" href="/year/{thisYear}" use:link>Your {thisYear} in review</a>
</div>

{#if empty}
  <section class="card stack">
    <h2>Nothing to count yet</h2>
    <p class="muted">
      Stats are built entirely from your own library, on your own device. Add a game and this
      page starts filling in — no account, no sync, nothing to switch on.
    </p>
    <div class="row wrap">
      <a class="btn primary" href="/add" use:link>Add a game</a>
    </div>
  </section>
{:else}
  {#if ownedPlatforms.length > 1}
    <section class="card" aria-label="Scope">
      <div class="row wrap">
        <div class="grow">
          <label for="scope">Show stats for</label>
          <select id="scope" bind:value={scope}>
            <option value="all">Every game ({formatCount($library.length)})</option>
            {#each ownedPlatforms as platform (platform)}
              <option value={platform}>{PLATFORM_LABELS[platform]}</option>
            {/each}
          </select>
        </div>
      </div>
      {#if scope !== 'all'}
        <p class="muted note" role="status">
          Showing {pluralize(stats.total, 'game')} you own on {PLATFORM_LABELS[scope]}. Playtime
          here still includes every platform a game is on, because your time with a game isn’t
          divided by where you bought it.
        </p>
      {/if}
    </section>
  {/if}

  <section class="card stack" aria-labelledby="totals-h">
    <h2 id="totals-h">Where things stand</h2>
    <div class="grid">
      <StatCard label="Games" measure={exact(stats.total)} display={formatCount(stats.total)} />
      <StatCard
        label="Playing"
        measure={exact(stats.byStatus.playing)}
        display={formatCount(stats.byStatus.playing)}
      />
      <StatCard
        label="Played"
        measure={exact(stats.byStatus.played)}
        display={formatCount(stats.byStatus.played)}
      />
      <StatCard
        label="Backlog"
        measure={exact(stats.byStatus.backlog)}
        display={formatCount(stats.byStatus.backlog)}
      />
      <StatCard
        label="Wishlist"
        measure={exact(stats.byStatus.wishlist)}
        display={formatCount(stats.byStatus.wishlist)}
      />
      <StatCard
        label="Abandoned"
        measure={exact(stats.byStatus.abandoned)}
        display={formatCount(stats.byStatus.abandoned)}
      />
    </div>
    <p class="muted note">
      An abandoned game is a legitimate outcome, not a failure state — it sits here as plainly
      as a finished one.
    </p>
  </section>

  <section class="card stack" aria-labelledby="time-h">
    <h2 id="time-h">Time</h2>
    <div class="grid">
      <StatCard
        label="Playtime"
        measure={stats.playtime.totalMinutes}
        display={formatHours(stats.playtime.totalMinutes.value)}
      />
      <StatCard
        label="Average per game played"
        measure={stats.playtime.averageMinutes}
        display={formatHours(stats.playtime.averageMinutes.value)}
      />
      <StatCard
        label="Owned, never launched"
        measure={measure(
          stats.playtime.neverLaunched,
          stats.total - stats.playtime.unreported,
          stats.total,
          'Counted only where a platform actually reports playtime — elsewhere nobody knows.',
        )}
        display={formatCount(stats.playtime.neverLaunched)}
      />
    </div>
    <p class="muted note">
      Playtime you don’t have isn’t zero. {pluralize(stats.playtime.unreported, 'game')} here
      {stats.playtime.unreported === 1 ? 'reports' : 'report'} no playtime at all — PlayStation
      reports none by design, and Xbox only reports it for some titles — so
      {stats.playtime.unreported === 1 ? 'it is' : 'they are'} left out of these totals rather than
      counted as nothing.
    </p>
  </section>

  <section class="card stack" aria-labelledby="ratings-h">
    <h2 id="ratings-h">Ratings</h2>
    <div class="grid">
      <StatCard
        label="Average rating"
        measure={stats.ratings.average}
        display={formatRating(stats.ratings.average.value)}
        noun="rated game"
      />
      <StatCard
        label="Rated"
        measure={exact(stats.ratings.rated)}
        display={formatCount(stats.ratings.rated)}
        detail="{formatCount(stats.ratings.unrated)} still unrated"
      />
      <StatCard
        label="Favourites"
        measure={exact(stats.ratings.favourites)}
        display={formatCount(stats.ratings.favourites)}
      />
    </div>
    <BarChart title="How you rate" distribution={stats.ratings.distribution} />
  </section>

  <section class="card stack" aria-labelledby="completion-h">
    <h2 id="completion-h">Finishing</h2>
    <div class="grid">
      <StatCard
        label="Finish rate"
        measure={stats.completion.finishRate}
        display={formatPercent(stats.completion.finishRate.value)}
      />
      <StatCard
        label="Abandon rate"
        measure={stats.completion.abandonRate}
        display={formatPercent(stats.completion.abandonRate.value)}
      />
    </div>
  </section>

  <section class="card stack" aria-labelledby="taste-h">
    <h2 id="taste-h">Taste</h2>
    <BarChart title="Genres you own" distribution={stats.genres} />

    {#if stats.genresByRating.length}
      <BarChart
        title="Genres by your average rating"
        distribution={{
          buckets: stats.genresByRating,
          covered: stats.ratings.rated,
          total: stats.total,
          reason: 'Only genres with three or more rated games — one five-star game isn’t a taste.',
        }}
        noun="rated game"
        formatDetail={(v) => `${formatRating(v)} ★`}
      />
    {:else}
      <p class="muted note">
        Rate three or more games in the same genre and Cartridge will start telling you what you
        actually like. Until then it would only be repeating a single opinion back at you.
      </p>
    {/if}

    <BarChart
      title="Release years"
      distribution={stats.releaseYears}
      limit={30}
      emptyText="No release dates recorded yet."
    />
  </section>

  <section class="card stack" aria-labelledby="platforms-h">
    <h2 id="platforms-h">Platforms</h2>
    {#if stats.platforms.length}
      <table>
        <thead>
          <tr>
            <th scope="col">Platform</th>
            <th scope="col" class="num">Games</th>
            <th scope="col" class="num">Playtime</th>
          </tr>
        </thead>
        <tbody>
          {#each stats.platforms as p (p.platform)}
            <tr>
              <th scope="row">{p.label}</th>
              <td class="num">{formatCount(p.games)}</td>
              <td class="num">
                {formatHours(p.minutes.value)}
                {#if p.minutes.value !== null && p.minutes.covered < p.minutes.total}
                  <span class="muted small">({p.minutes.covered} of {p.minutes.total})</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="muted note">
        One game can sit on more than one platform, so these add up to more than your library.
        {#if stats.unlinked}
          {pluralize(stats.unlinked, 'game')}
          {stats.unlinked === 1 ? 'is' : 'are'} in no row at all — added by hand, owned nowhere in
          particular.
        {/if}
      </p>
    {:else}
      <p class="muted note">
        Nothing here is linked to a platform yet. Connect Steam or Xbox in Settings, or keep
        adding games by hand — the rest of this page works either way.
      </p>
    {/if}
  </section>

  <section class="card stack" aria-labelledby="extremes-h">
    <h2 id="extremes-h">Standouts</h2>
    <ul class="standouts">
      {#if stats.extremes.mostPlayed}
        <li>
          <span class="overline">Most played</span>
          <a href="/game/{stats.extremes.mostPlayed.id}" use:link>{stats.extremes.mostPlayed.title}</a
          >
          <span class="muted">{formatHours(stats.extremes.mostPlayed.amount)}</span>
        </li>
      {/if}
      {#if stats.extremes.bestRated}
        <li>
          <span class="overline">Highest rated</span>
          <a href="/game/{stats.extremes.bestRated.id}" use:link>{stats.extremes.bestRated.title}</a>
          <span class="muted">{formatRating(stats.extremes.bestRated.amount)} ★</span>
        </li>
      {/if}
      {#if stats.extremes.leastPlayedFinish}
        <li>
          <span class="overline">Least time on the clock, and still finished</span>
          <a href="/game/{stats.extremes.leastPlayedFinish.id}" use:link
            >{stats.extremes.leastPlayedFinish.title}</a
          >
          <span class="muted">{formatHours(stats.extremes.leastPlayedFinish.amount)}</span>
          <span class="muted note">
            Recorded playtime, not how long the game takes — a replay would push it up.
          </span>
        </li>
      {/if}
      {#if stats.extremes.oldestPlayed}
        <li>
          <span class="overline">Oldest game you’ve played</span>
          <a href="/game/{stats.extremes.oldestPlayed.id}" use:link
            >{stats.extremes.oldestPlayed.title}</a
          >
          <span class="muted">{stats.extremes.oldestPlayed.amount}</span>
        </li>
      {/if}
      {#if stats.extremes.longestInBacklog}
        <li>
          <span class="overline">Waiting the longest</span>
          <a href="/game/{stats.extremes.longestInBacklog.id}" use:link
            >{stats.extremes.longestInBacklog.title}</a
          >
          <span class="muted">in your library since {formatDate(stats.extremes.longestInBacklog.amount)}</span
          >
        </li>
      {/if}
    </ul>
  </section>

  <section class="card stack" aria-labelledby="backlog-h">
    <h2 id="backlog-h">Backlog</h2>
    <p class="muted note">{NO_LENGTH_ESTIMATE}</p>

    {#if triage.total === 0}
      <p class="muted note">Your backlog is empty. That’s allowed.</p>
    {:else}
      <div class="row wrap">
        <div class="grow">
          <label for="backlog-sort">Order by</label>
          <select id="backlog-sort" bind:value={backlogSort}>
            {#each Object.entries(BACKLOG_SORT_LABELS) as [key, label] (key)}
              <option value={key}>{label}</option>
            {/each}
          </select>
        </div>
      </div>

      {#each [{ title: 'Never launched', items: triage.neverLaunched, note: 'A platform reports a real zero for these, so this is the one thing Cartridge is certain of.' }, { title: 'Nobody knows', items: triage.unknown, note: 'No platform reports playtime for these. Unknown, which is not the same as unplayed.' }, { title: 'Already begun', items: triage.started, note: 'You have put time into these and stopped.' }] as group (group.title)}
        {#if group.items.length}
          <div class="group">
            <h3>{group.title} <span class="muted">· {formatCount(group.items.length)}</span></h3>
            <p class="muted note">{group.note}</p>
            <ul class="games">
              {#each group.items.slice(0, 12) as candidate (candidate.game.id)}
                <li>
                  <a href="/game/{candidate.game.id}" use:link>{candidate.game.title}</a>
                  <span class="muted small">
                    {#if backlogSort === 'released'}
                      {candidate.game.releasedAt
                        ? formatDate(candidate.game.releasedAt)
                        : 'No release date'}
                    {:else}
                      in your library since {formatDate(candidate.entry.createdAt)}
                    {/if}
                  </span>
                </li>
              {/each}
            </ul>
            {#if group.items.length > 12}
              <p class="muted note">and {formatCount(group.items.length - 12)} more.</p>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </section>

  <section class="card stack" aria-labelledby="honesty-h">
    <h2 id="honesty-h">What this page can’t tell you</h2>
    <ul class="plain">
      <li>
        <strong>When you played.</strong> Platforms report total playtime and a last-played date,
        never a history. So Cartridge can say how long you’ve spent with a game, but never how much
        of that was this year.
      </li>
      <li>
        <strong>How long a game takes.</strong> There’s no HowLongToBeat data here and IGDB doesn’t
        carry reliable completion times, so nothing is estimated.
      </li>
      <li>
        <strong>Whether a game surprised you.</strong> Cartridge never asked what you expected, so
        it isn’t going to invent an answer.
      </li>
      {#if undated}
        <li>
          <strong>Which year {undated === 1 ? 'one game belongs' : `${formatCount(undated)} games belong`} to.</strong>
          {undated === 1 ? 'It carries' : 'They carry'} no start, finish or last-played date. Adding
          dates on a game page fixes that.
        </li>
      {/if}
    </ul>
    <Coverage measure={exact(stats.total)} />
  </section>
{/if}

<style>
  .head {
    align-items: baseline;
  }
  h1 {
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--spacing-sm);
  }
  .note {
    margin: 0;
    font-size: var(--text-overline-size);
    line-height: var(--font-line-height-normal);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: var(--spacing-xs) 0;
    border-bottom: 1px solid var(--border);
    font-weight: var(--font-weight-regular);
  }
  thead th {
    font-size: var(--text-overline-size);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: var(--text-overline-letter-spacing);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .small {
    font-size: var(--text-overline-size);
  }
  ul.standouts,
  ul.games,
  ul.plain {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }
  ul.plain li {
    line-height: var(--font-line-height-normal);
  }
  ul.standouts li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  ul.games li {
    display: flex;
    justify-content: space-between;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    padding-top: var(--spacing-sm);
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: 0;
  }
</style>
