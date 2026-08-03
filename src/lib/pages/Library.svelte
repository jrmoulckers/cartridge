<script lang="ts">
  /**
   * The library — the app's home.
   *
   * Everything on this screen is computed from memory: the shelf tabs, the counts, the
   * search results, the facet options. There is no request to make and nothing to wait
   * for, which is what lets the whole screen work with no accounts and no network.
   */
  import { library, libraryLoaded, statusCounts } from '../stores/library';
  import { customShelves } from '../stores/shelves';
  import { settings, setView } from '../stores/settings';
  import { STATUSES, STATUS_LABELS, PLATFORMS, PLATFORM_LABELS } from '../types';
  import type { Platform, Status } from '../types';
  import {
    EMPTY_FILTER,
    searchLibrary,
    collectGenres,
    collectTags,
    collectYears,
    isFiltered,
    SORT_LABELS,
    DEFAULT_DIRECTION,
  } from '../library/search';
  import type { LibraryFilter, SortKey, SortDirection } from '../library/search';
  import { link } from '../router';
  import GameCard from '../components/GameCard.svelte';

  let filter = $state<LibraryFilter>({ ...EMPTY_FILTER });
  let sort = $state<SortKey>('updated');
  let direction = $state<SortDirection>(DEFAULT_DIRECTION.updated);
  let showFilters = $state(false);

  const results = $derived(searchLibrary($library, filter, sort, direction));
  const genres = $derived(collectGenres($library));
  const tags = $derived(collectTags($library));
  const years = $derived(collectYears($library));
  const filtered = $derived(isFiltered(filter));
  const empty = $derived($libraryLoaded && $library.length === 0);

  function selectStatus(status: Status | 'all') {
    filter = { ...filter, status, shelfId: undefined };
  }

  function selectShelf(shelfId: string) {
    filter = { ...filter, status: 'all', shelfId: filter.shelfId === shelfId ? undefined : shelfId };
  }

  function changeSort(next: SortKey) {
    sort = next;
    direction = DEFAULT_DIRECTION[next];
  }

  function clearFilters() {
    filter = { ...EMPTY_FILTER };
  }
</script>

<h1 class="sr-only">Library</h1>

{#if empty}
  <!-- First run. The point of this screen is to say, plainly, that nothing is required. -->
  <section class="card welcome stack">
    <div>
      <h2>Your library starts empty — and that’s all it needs</h2>
      <p class="muted">
        Cartridge works completely offline with no accounts connected. Add a game by hand and
        you can shelve it, rate it, review it and search it straight away. Connecting Steam,
        Xbox, PlayStation or Nintendo later only fills in the details you didn’t feel like
        typing.
      </p>
    </div>
    <div class="row wrap">
      <a class="btn primary" href="/add" use:link>Add your first game</a>
      <a class="btn ghost" href="/settings" use:link>Restore a backup</a>
    </div>
  </section>
{:else}
  <section class="controls stack" aria-label="Search and filter">
    <div class="row">
      <div class="grow">
        <label class="sr-only" for="q">Search your library</label>
        <input
          id="q"
          type="search"
          placeholder="Search titles, developers, tags…"
          value={filter.query}
          oninput={(e) => (filter = { ...filter, query: e.currentTarget.value })}
        />
      </div>
      <button
        type="button"
        class="btn small"
        aria-expanded={showFilters}
        onclick={() => (showFilters = !showFilters)}
      >
        Filters{filtered ? ' ·' : ''}
      </button>
    </div>

    <div class="tabs row wrap" role="group" aria-label="Shelves">
      <button
        type="button"
        class="pill"
        class:on={filter.status === 'all' && !filter.shelfId}
        aria-pressed={filter.status === 'all' && !filter.shelfId}
        onclick={() => selectStatus('all')}
      >
        All <span class="count">{$library.length}</span>
      </button>
      {#each STATUSES as status (status)}
        <button
          type="button"
          class="pill"
          class:on={filter.status === status}
          aria-pressed={filter.status === status}
          onclick={() => selectStatus(status)}
        >
          {STATUS_LABELS[status]} <span class="count">{$statusCounts.get(status) ?? 0}</span>
        </button>
      {/each}
      {#each $customShelves as shelf (shelf.id)}
        <button
          type="button"
          class="pill"
          class:on={filter.shelfId === shelf.id}
          aria-pressed={filter.shelfId === shelf.id}
          onclick={() => selectShelf(shelf.id)}
        >
          {shelf.name}
        </button>
      {/each}
    </div>

    {#if showFilters}
      <div class="card filters">
        <div class="fields">
          <div>
            <label for="f-platform">Platform</label>
            <select
              id="f-platform"
              value={filter.platform ?? ''}
              onchange={(e) =>
                (filter = {
                  ...filter,
                  platform: (e.currentTarget.value || undefined) as Platform | undefined,
                })}
            >
              <option value="">Any</option>
              {#each PLATFORMS as p (p)}<option value={p}>{PLATFORM_LABELS[p]}</option>{/each}
            </select>
          </div>

          <div>
            <label for="f-genre">Genre</label>
            <select
              id="f-genre"
              value={filter.genre ?? ''}
              onchange={(e) => (filter = { ...filter, genre: e.currentTarget.value || undefined })}
            >
              <option value="">Any</option>
              {#each genres as g (g)}<option value={g}>{g}</option>{/each}
            </select>
          </div>

          <div>
            <label for="f-tag">Tag</label>
            <select
              id="f-tag"
              value={filter.tag ?? ''}
              onchange={(e) => (filter = { ...filter, tag: e.currentTarget.value || undefined })}
            >
              <option value="">Any</option>
              {#each tags as t (t)}<option value={t}>{t}</option>{/each}
            </select>
          </div>

          <div>
            <label for="f-year">Released</label>
            <select
              id="f-year"
              value={filter.year != null ? String(filter.year) : ''}
              onchange={(e) =>
                (filter = {
                  ...filter,
                  year: e.currentTarget.value ? Number(e.currentTarget.value) : undefined,
                })}
            >
              <option value="">Any year</option>
              {#each years as y (y)}<option value={y}>{y}</option>{/each}
            </select>
          </div>

          <div>
            <label for="f-rating">Minimum rating</label>
            <select
              id="f-rating"
              value={filter.minRating != null ? String(filter.minRating) : ''}
              onchange={(e) =>
                (filter = {
                  ...filter,
                  minRating: e.currentTarget.value ? Number(e.currentTarget.value) : undefined,
                })}
            >
              <option value="">Any rating</option>
              {#each [5, 4.5, 4, 3.5, 3, 2] as r (r)}<option value={r}>{r} and up</option>{/each}
            </select>
          </div>

          <div>
            <label for="f-sort">Sort by</label>
            <select
              id="f-sort"
              value={sort}
              onchange={(e) => changeSort(e.currentTarget.value as SortKey)}
            >
              {#each Object.entries(SORT_LABELS) as [key, label] (key)}
                <option value={key}>{label}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="row wrap">
          <button
            type="button"
            class="pill"
            class:on={filter.favouritesOnly}
            aria-pressed={!!filter.favouritesOnly}
            onclick={() => (filter = { ...filter, favouritesOnly: !filter.favouritesOnly })}
          >
            ♥ Favourites
          </button>
          <button
            type="button"
            class="pill"
            class:on={filter.unratedOnly}
            aria-pressed={!!filter.unratedOnly}
            onclick={() => (filter = { ...filter, unratedOnly: !filter.unratedOnly })}
          >
            Unrated only
          </button>
          <button
            type="button"
            class="pill"
            onclick={() => (direction = direction === 'asc' ? 'desc' : 'asc')}
          >
            {direction === 'asc' ? '↑ Ascending' : '↓ Descending'}
          </button>
          <span class="grow"></span>
          {#if filtered}
            <button type="button" class="btn small ghost" onclick={clearFilters}>
              Clear filters
            </button>
          {/if}
        </div>
      </div>
    {/if}

    <div class="row spread">
      <p class="muted count-line" aria-live="polite">
        {results.length}
        {results.length === 1 ? 'game' : 'games'}
      </p>
      <div class="row" role="group" aria-label="View">
        <button
          type="button"
          class="pill"
          class:on={$settings.view === 'grid'}
          aria-pressed={$settings.view === 'grid'}
          onclick={() => setView('grid')}>Grid</button
        >
        <button
          type="button"
          class="pill"
          class:on={$settings.view === 'list'}
          aria-pressed={$settings.view === 'list'}
          onclick={() => setView('list')}>List</button
        >
      </div>
    </div>
  </section>

  {#if results.length === 0}
    <section class="card center stack">
      <p class="muted">No games match what you’re looking for.</p>
      {#if filtered}
        <div><button type="button" class="btn" onclick={clearFilters}>Clear filters</button></div>
      {/if}
    </section>
  {:else if $settings.view === 'grid'}
    <ul class="grid" aria-label="Games">
      {#each results as item (item.game.id)}
        <li><GameCard {item} view="grid" /></li>
      {/each}
    </ul>
  {:else}
    <ul class="rows" aria-label="Games">
      {#each results as item (item.game.id)}
        <li><GameCard {item} view="list" /></li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .welcome {
    margin-top: var(--spacing-lg);
  }
  .welcome p {
    margin-bottom: 0;
  }

  .controls {
    gap: var(--spacing-sm);
    padding: var(--spacing-md) 0;
  }
  .tabs {
    gap: var(--spacing-xs);
  }
  .tabs .pill {
    cursor: pointer;
    min-height: 34px;
  }
  .count {
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }
  .count-line {
    margin: 0;
    font-size: var(--font-size-overline);
  }

  .filters {
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--spacing-sm);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--cover-min), 1fr));
    gap: var(--spacing-md);
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .rows li + li {
    border-top: 1px solid var(--border);
  }
</style>
