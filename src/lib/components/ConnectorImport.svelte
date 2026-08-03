<script lang="ts">
  /**
   * The import review screen, for any connector.
   *
   * The rule this component exists to keep is simple: **nothing is written until the user
   * says so.** A library of eleven hundred games appearing in someone's collection without
   * warning is not an import, it's an accident, so the sync stops at a plan and this screen
   * shows what that plan would do — how many games are new, how many they already own and
   * are about to gain a link, how many the metadata database didn't recognise, and how many
   * are already exactly right.
   *
   * The shelf picker defaults to Backlog because an owned-but-unplayed library *is* a
   * backlog, and putting a thousand games in "Played" would be a lie the user then has to
   * clean up by hand.
   *
   * Phase 4 made it platform-agnostic and gave the unmatched tail a section of its own. That
   * second change matters more than it looks. Steam appids are carried by IGDB, so phase 3's
   * unmatched tail was a handful of demos and soundtracks and a count was plenty. Xbox has no
   * ids in IGDB, so its games are matched on title alone and the matcher is built to refuse
   * when it isn't sure — which produces a real tail of real games. Hidden behind a number,
   * that tail is a silent quality problem. Listed, it is a visible ten-minute chore. The
   * alternative — guessing — attaches somebody's rating to the wrong game, and no number on
   * this screen would ever reveal it.
   */
  import { STATUSES, STATUS_LABELS, PLATFORM_LABELS, type ID, type Status } from '../types';
  import { customShelves } from '../stores/shelves';
  import { syncState, commitSync, resetSync } from '../stores/connectors';
  import { planCounts, planIsEmpty } from '../connectors/sync';
  import { getConnector } from '../connectors/registry';
  import { formatPlaytime } from '../util';

  /** How many per-title rows to render before collapsing the rest into a count. */
  const PREVIEW = 40;

  let status = $state<Status>('backlog');
  let shelfIds = $state<ID[]>([]);
  let showAll = $state(false);

  const plan = $derived($syncState.plan);
  const platform = $derived($syncState.platform);
  const label = $derived(platform ? PLATFORM_LABELS[platform] : 'that platform');
  const capabilities = $derived(platform ? getConnector(platform)?.capabilities : undefined);
  const counts = $derived(plan ? planCounts(plan) : null);
  const empty = $derived(plan ? planIsEmpty(plan) : true);
  const phase = $derived($syncState.phase);
  const percent = $derived(
    $syncState.total > 0 ? Math.round(($syncState.done / $syncState.total) * 100) : 0,
  );

  /** The games that will be added under the platform's own name. Reviewable, not hidden. */
  const unidentified = $derived((plan?.adds ?? []).filter((add) => add.unmatched));

  const failures = $derived(($syncState.results ?? []).filter((r) => r.outcome === 'failed'));

  function toggleShelf(id: ID) {
    shelfIds = shelfIds.includes(id) ? shelfIds.filter((s) => s !== id) : [...shelfIds, id];
  }

  const playtime = (minutes: number | null) => formatPlaytime(minutes);
</script>

<section class="card stack" aria-labelledby="import-h">
  <h2 id="import-h">
    {#if phase === 'done'}Import finished{:else}Review your {label} library{/if}
  </h2>

  {#if phase === 'reviewing' && counts && plan}
    {#if empty}
      <p class="muted">
        Nothing to do — all {counts.unchanged} games {label} reports are already in your library
        with the same playtime.
      </p>
      <div class="row wrap">
        <button type="button" class="btn" onclick={resetSync}>Close</button>
      </div>
    {:else}
      <ul class="summary">
        <li><strong>{counts.adds}</strong> new games will be added</li>
        <li>
          <strong>{counts.newLinks}</strong> games you already have will gain a {label} link
          <span class="muted">— your ratings, reviews and shelves are not touched</span>
        </li>
        <li><strong>{counts.updates - counts.newLinks}</strong> will have their playtime refreshed</li>
        <li><strong>{counts.unchanged}</strong> are already up to date</li>
      </ul>

      {#if capabilities?.playtimeCoverage === 'partial'}
        <p class="muted hint">
          {label} only reports time played for some games. The rest will say “Not reported” rather
          than showing a made-up zero.
        </p>
      {/if}

      {#if counts.unmatched}
        <!--
          Deliberately its own section rather than a line in the summary above. These are the
          games the matcher declined to guess at, and they are the one part of an import that
          benefits from a human glance.
        -->
        <div class="notice stack-sm">
          <h3 class="notice-h">
            {counts.unmatched}
            {counts.unmatched === 1 ? 'game wasn’t' : 'games weren’t'} identified
          </h3>
          <p class="muted">
            They’ll still be imported, using {label}’s own title and art. Cartridge would rather
            leave a game unidentified than attach your rating to the wrong one — open any of them
            later and search for the right match in a couple of seconds.
          </p>
          {#if plan.matchingIncomplete}
            <p class="muted">
              Some of these were never checked, because the metadata lookup didn’t finish. Syncing
              again will pick up where it stopped.
            </p>
          {/if}
          <details>
            <summary>Which ones ({unidentified.length})</summary>
            <ul class="titles">
              {#each unidentified.slice(0, showAll ? unidentified.length : PREVIEW) as add (add.externalId)}
                <li class="row spread">
                  <span class="grow">{add.title}</span>
                  <span class="muted tag">{playtime(add.minutesPlayed)}</span>
                </li>
              {/each}
            </ul>
            {#if !showAll && unidentified.length > PREVIEW}
              <button type="button" class="btn ghost" onclick={() => (showAll = true)}>
                Show the rest
              </button>
            {/if}
          </details>
        </div>
      {/if}

      {#if counts.adds > 0}
        <fieldset>
          <legend class="fieldlabel">Put new games on</legend>
          <div class="row wrap" role="group" aria-label="Shelf for new games">
            {#each STATUSES as value (value)}
              <button
                type="button"
                class="pill"
                class:on={status === value}
                aria-pressed={status === value}
                onclick={() => (status = value)}
              >
                {STATUS_LABELS[value]}
              </button>
            {/each}
          </div>
          <p class="muted hint">
            Only the {counts.adds} new games go here. Games already in your library keep the shelf
            you put them on.
          </p>
        </fieldset>

        {#if $customShelves.length}
          <fieldset>
            <legend class="fieldlabel">Also add them to</legend>
            <div class="row wrap" role="group" aria-label="Custom shelves for new games">
              {#each $customShelves as shelf (shelf.id)}
                <button
                  type="button"
                  class="pill"
                  class:on={shelfIds.includes(shelf.id)}
                  aria-pressed={shelfIds.includes(shelf.id)}
                  onclick={() => toggleShelf(shelf.id)}
                >
                  {shelf.name}
                </button>
              {/each}
            </div>
          </fieldset>
        {/if}
      {/if}

      <details>
        <summary>See every game ({counts.adds + counts.updates})</summary>
        <ul class="titles">
          {#each plan.adds.slice(0, showAll ? plan.adds.length : PREVIEW) as add (add.externalId)}
            <li class="row spread">
              <span class="grow">{add.title}</span>
              <span class="muted tag">
                {add.unmatched ? 'New · no match' : 'New'} · {playtime(add.minutesPlayed)}
              </span>
            </li>
          {/each}
          {#each plan.updates.slice(0, showAll ? plan.updates.length : PREVIEW) as update (update.externalId)}
            <li class="row spread">
              <span class="grow">{update.title}</span>
              <span class="muted tag">
                {update.newLink ? 'Linking' : 'Playtime'} · {playtime(update.minutesPlayed)}
              </span>
            </li>
          {/each}
        </ul>
        {#if !showAll && (plan.adds.length > PREVIEW || plan.updates.length > PREVIEW)}
          <button type="button" class="btn ghost" onclick={() => (showAll = true)}>
            Show the rest
          </button>
        {/if}
      </details>

      <div class="row wrap">
        <button
          type="button"
          class="btn primary"
          onclick={() => commitSync({ status, shelfIds })}
        >
          Import {counts.adds + counts.updates} games
        </button>
        <button type="button" class="btn ghost" onclick={resetSync}>Cancel</button>
      </div>
    {/if}
  {/if}

  {#if phase === 'applying'}
    <p aria-live="polite">
      Importing… {$syncState.done} of {$syncState.total}
      {#if $syncState.current}<span class="muted">— {$syncState.current}</span>{/if}
    </p>
    <div
      class="bar"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="Import progress"
    >
      <span style:transform="scaleX({percent / 100})"></span>
    </div>
  {/if}

  {#if phase === 'done'}
    {@const results = $syncState.results ?? []}
    <p>
      {results.filter((r) => r.outcome === 'added').length} added,
      {results.filter((r) => r.outcome === 'linked').length} linked to games you already had,
      {results.filter((r) => r.outcome === 'updated').length} refreshed.
    </p>
    {#if failures.length}
      <p class="error" role="alert">
        {failures.length}
        {failures.length === 1 ? 'game' : 'games'} couldn’t be saved. Everything else was imported.
      </p>
    {/if}

    <details>
      <summary>What happened to each game ({results.length})</summary>
      <ul class="titles">
        {#each results.slice(0, showAll ? results.length : PREVIEW) as row (row.externalId)}
          <li class="row spread">
            <span class="grow">{row.title}</span>
            <span class="muted tag" class:bad={row.outcome === 'failed'}>
              {row.detail ?? row.outcome}
            </span>
          </li>
        {/each}
      </ul>
      {#if !showAll && results.length > PREVIEW}
        <button type="button" class="btn ghost" onclick={() => (showAll = true)}>
          Show the rest
        </button>
      {/if}
    </details>

    <div class="row wrap">
      <button type="button" class="btn" onclick={resetSync}>Done</button>
    </div>
  {/if}
</section>

<style>
  .summary {
    margin: 0;
    padding-left: var(--spacing-md);
  }
  .summary li + li {
    margin-top: var(--spacing-xs);
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
  }
  .hint {
    margin: var(--spacing-xs) 0 0;
    font-size: var(--font-size-overline);
  }
  details summary {
    cursor: pointer;
  }
  .titles {
    list-style: none;
    margin: var(--spacing-sm) 0 0;
    padding: 0;
    max-height: 20rem;
    overflow-y: auto;
  }
  .titles li {
    padding: var(--spacing-xs) 0;
    border-bottom: 1px solid var(--border);
  }
  .tag {
    font-size: var(--font-size-overline);
    white-space: nowrap;
  }
  .tag.bad {
    color: var(--bad);
  }
  .bar {
    height: 0.5rem;
    border-radius: var(--radius-chip);
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transform-origin: left center;
    transition: transform var(--dur-fast) ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
  }
  .error {
    margin: 0;
    color: var(--bad);
  }
  /*
    The unmatched tail. Given a surface of its own rather than a bullet, because on a
    title-matched platform this is the part of an import a person should actually look at.
    Toned down rather than alarming: nothing has gone wrong, there is just a small chore.
  */
  .notice {
    padding: var(--spacing-sm);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .stack-sm {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }
  .notice-h {
    margin: 0;
    font-size: var(--font-size-body);
  }
  .notice p {
    margin: 0;
  }
</style>
