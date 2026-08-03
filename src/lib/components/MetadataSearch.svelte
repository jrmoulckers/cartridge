<script lang="ts">
  /**
   * Optional metadata lookup.
   *
   * This block is a convenience wrapped around the manual form below it, and it is written
   * to disappear quietly: with no bridge configured it renders a single line of
   * explanation and nothing else; with a bridge that fails it says so and gets out of the
   * way. Nothing here is ever required to add a game.
   */
  import { onDestroy } from 'svelte';
  import { searchGames, bridgeConfigured, bridgeAvailable } from '../metadata/igdb';
  import type { GameMetadata } from '../metadata/types';
  import { link } from '../router';

  interface Props {
    onselect: (meta: GameMetadata) => void;
  }

  let { onselect }: Props = $props();

  let query = $state('');
  let results = $state<GameMetadata[]>([]);
  let searching = $state(false);
  let searched = $state(false);
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => {
    clearTimeout(timer);
    controller?.abort();
  });

  function oninput(event: Event) {
    query = (event.currentTarget as HTMLInputElement).value;
    clearTimeout(timer);
    controller?.abort();
    if (query.trim().length < 2) {
      results = [];
      searched = false;
      searching = false;
      return;
    }
    timer = setTimeout(run, 350);
  }

  async function run() {
    controller = new AbortController();
    searching = true;
    results = await searchGames(query, controller.signal);
    searching = false;
    searched = true;
  }

  function choose(meta: GameMetadata) {
    onselect(meta);
    query = '';
    results = [];
    searched = false;
  }

  const year = (meta: GameMetadata) =>
    meta.releasedAt == null ? '' : String(new Date(meta.releasedAt).getFullYear());
</script>

<section class="card lookup stack" aria-labelledby="lookup-h">
  <div class="row spread">
    <h2 id="lookup-h">Look it up <span class="pill">Optional</span></h2>
  </div>

  {#if !$bridgeConfigured}
    <p class="muted hint">
      No metadata bridge is configured, so covers and release details are typed in by hand.
      That's a perfectly good way to use Cartridge — or
      <a href="/settings" use:link>connect a bridge</a> to have them filled in for you.
    </p>
  {:else}
    <div>
      <label for="lookup">Search for a game</label>
      <input
        id="lookup"
        type="search"
        value={query}
        {oninput}
        placeholder="Outer Wilds"
        autocomplete="off"
        aria-describedby="lookup-status"
      />
    </div>

    <p class="muted hint" id="lookup-status" aria-live="polite">
      {#if searching}
        Searching…
      {:else if searched && results.length === 0 && $bridgeAvailable === false}
        The bridge isn’t reachable right now — fill the form in below instead.
      {:else if searched && results.length === 0}
        Nothing found. Add it by hand below.
      {:else}
        Picking a result fills in the form below. You can change anything afterwards.
      {/if}
    </p>

    {#if results.length}
      <ul aria-label="Search results">
        {#each results as meta (meta.igdbId)}
          <li>
            <button type="button" class="result row" onclick={() => choose(meta)}>
              {#if meta.coverUrl}
                <img src={meta.coverUrl} alt="" width="40" height="53" loading="lazy" />
              {:else}
                <span class="nocover" aria-hidden="true"></span>
              {/if}
              <span class="grow">
                <span class="title">{meta.title}</span>
                <span class="sub muted">
                  {[year(meta), meta.developer, meta.genres.slice(0, 2).join(', ')]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .lookup {
    margin-top: var(--spacing-md);
  }
  .lookup h2 {
    margin: 0;
  }
  .hint {
    margin: 0;
    font-size: var(--font-size-overline);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li {
    border-top: 1px solid var(--border);
  }
  .result {
    width: 100%;
    padding: var(--spacing-xs);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .result:hover {
    background: var(--surface-2);
  }
  .result img,
  .nocover {
    width: 40px;
    height: 53px;
    flex: none;
    object-fit: cover;
    border-radius: var(--radius-chip);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .title {
    display: block;
    font-weight: var(--font-weight-semibold);
  }
  .sub {
    display: block;
    font-size: var(--font-size-overline);
  }
</style>
