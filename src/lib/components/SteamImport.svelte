<script lang="ts">
  /**
   * The Steam import screen.
   *
   * The rule this component exists to keep is simple: **nothing is written until the user
   * says so.** A library of eleven hundred games appearing in someone's collection without
   * warning is not an import, it's an accident, so the sync stops at a plan and this screen
   * shows what that plan would do — how many games are new, how many they already own and
   * are about to gain a Steam link, how many Steam knows about that IGDB doesn't, and how
   * many are already exactly right.
   *
   * The shelf picker defaults to Backlog because an owned-but-unplayed Steam library *is* a
   * backlog, and putting a thousand games in "Played" would be a lie the user then has to
   * clean up by hand.
   */
  import { STATUSES, STATUS_LABELS, type ID, type Status } from '../types';
  import { customShelves } from '../stores/shelves';
  import { syncState, commitSync, resetSync } from '../stores/connectors';
  import { planCounts, planIsEmpty } from '../connectors/sync';
  import { formatPlaytime } from '../util';

  /** How many per-title rows to render before collapsing the rest into a count. */
  const PREVIEW = 40;

  let status = $state<Status>('backlog');
  let shelfIds = $state<ID[]>([]);
  let showAll = $state(false);

  const plan = $derived($syncState.plan);
  const counts = $derived(plan ? planCounts(plan) : null);
  const empty = $derived(plan ? planIsEmpty(plan) : true);
  const phase = $derived($syncState.phase);
  const percent = $derived(
    $syncState.total > 0 ? Math.round(($syncState.done / $syncState.total) * 100) : 0,
  );

  const failures = $derived(($syncState.results ?? []).filter((r) => r.outcome === 'failed'));

  function toggleShelf(id: ID) {
    shelfIds = shelfIds.includes(id) ? shelfIds.filter((s) => s !== id) : [...shelfIds, id];
  }

  const playtime = (minutes: number | null) => formatPlaytime(minutes);
</script>

<section class="card stack" aria-labelledby="import-h">
  <h2 id="import-h">
    {#if phase === 'done'}Import finished{:else}Review your Steam library{/if}
  </h2>

  {#if phase === 'reviewing' && counts && plan}
    {#if empty}
      <p class="muted">
        Nothing to do — all {counts.unchanged} games Steam reports are already in your library
        with the same playtime.
      </p>
      <div class="row wrap">
        <button type="button" class="btn" onclick={resetSync}>Close</button>
      </div>
    {:else}
      <ul class="summary">
        <li><strong>{counts.adds}</strong> new games will be added</li>
        <li>
          <strong>{counts.newLinks}</strong> games you already have will gain a Steam link
          <span class="muted">— your ratings, reviews and shelves are not touched</span>
        </li>
        <li><strong>{counts.updates - counts.newLinks}</strong> will have their playtime refreshed</li>
        <li><strong>{counts.unchanged}</strong> are already up to date</li>
        {#if counts.unmatched}
          <li>
            <strong>{counts.unmatched}</strong> couldn’t be identified in the metadata database.
            <span class="muted">
              They’ll be added with Steam’s own title and art rather than guessed at — you can
              fix any of them later.
            </span>
          </li>
        {/if}
      </ul>

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
</style>
