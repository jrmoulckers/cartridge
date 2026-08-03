<script lang="ts">
  /**
   * Shelves.
   *
   * The five built-ins are the status a game is in and can't be renamed or removed —
   * everything else is the user's own vocabulary. Removing a custom shelf never removes
   * the games on it.
   */
  import {
    shelves,
    builtinShelves,
    customShelves,
    createShelf,
    renameShelf,
    removeShelf,
    shelfNameExists,
  } from '../stores/shelves';
  import { library } from '../stores/library';
  import { showToast } from '../stores/toast';
  import { STATUS_LABELS, type Shelf } from '../types';
  import { cleanText } from '../util';

  let newName = $state('');
  let editing = $state<string | null>(null);
  let editName = $state('');
  let error = $state('');

  const taken = $derived(shelfNameExists(newName));

  const countFor = (shelf: Shelf) =>
    shelf.builtinStatus
      ? $library.filter((i) => i.entry.status === shelf.builtinStatus).length
      : $library.filter((i) => i.entry.shelfIds.includes(shelf.id)).length;

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const clean = cleanText(newName, 60);
    if (!clean) return;
    if (shelfNameExists(clean)) {
      error = 'You already have a shelf with that name.';
      return;
    }
    const shelf = await createShelf(clean);
    if (!shelf) {
      error = 'That shelf could not be created.';
      return;
    }
    newName = '';
    error = '';
    showToast(`Created ${shelf.name}`, 'success');
  }

  function startEdit(shelf: Shelf) {
    editing = shelf.id;
    editName = shelf.name;
  }

  async function commitEdit(shelf: Shelf) {
    await renameShelf(shelf, editName);
    editing = null;
  }

  async function destroy(shelf: Shelf) {
    await removeShelf(shelf);
    showToast(`Removed the ${shelf.name} shelf — its games are still in your library`, 'info');
  }
</script>

<h1>Shelves</h1>

<section class="card stack" aria-labelledby="builtin-h">
  <h2 id="builtin-h">Built in</h2>
  <p class="muted hint">
    Every game sits on exactly one of these. They can't be renamed or removed.
  </p>
  <ul>
    {#each $builtinShelves as shelf (shelf.id)}
      <li class="row spread">
        <span>{STATUS_LABELS[shelf.builtinStatus!]}</span>
        <span class="muted count">{countFor(shelf)}</span>
      </li>
    {/each}
  </ul>
</section>

<section class="card stack" aria-labelledby="custom-h">
  <h2 id="custom-h">Your shelves</h2>

  {#if $customShelves.length === 0}
    <p class="muted hint">
      Nothing yet. Shelves are free-form — “Comfort games”, “Finish in 2026”, “Couch co-op”.
    </p>
  {:else}
    <ul>
      {#each $customShelves as shelf (shelf.id)}
        <li class="row spread">
          {#if editing === shelf.id}
            <div class="grow">
              <label class="sr-only" for="rename-{shelf.id}">Shelf name</label>
              <input
                id="rename-{shelf.id}"
                type="text"
                bind:value={editName}
                onkeydown={(e) => e.key === 'Enter' && commitEdit(shelf)}
              />
            </div>
            <button type="button" class="btn small primary" onclick={() => commitEdit(shelf)}>
              Save
            </button>
            <button type="button" class="btn small ghost" onclick={() => (editing = null)}>
              Cancel
            </button>
          {:else}
            <span class="grow">{shelf.name}</span>
            <span class="muted count">{countFor(shelf)}</span>
            <button type="button" class="btn small ghost" onclick={() => startEdit(shelf)}>
              Rename
            </button>
            <button type="button" class="btn small ghost" onclick={() => destroy(shelf)}>
              Remove
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <form class="row wrap" onsubmit={add}>
    <div class="grow">
      <label for="new-shelf">New shelf</label>
      <input
        id="new-shelf"
        type="text"
        bind:value={newName}
        placeholder="Comfort games"
        autocomplete="off"
        aria-describedby={taken ? 'shelf-taken' : undefined}
      />
    </div>
    <button type="submit" class="btn" disabled={!cleanText(newName) || taken}>Create</button>
  </form>

  {#if taken}
    <p class="error" id="shelf-taken" role="alert">You already have a shelf with that name.</p>
  {:else if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</section>

<p class="muted hint total">
  {$shelves.length} shelves · {$library.length} games
</p>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    padding: var(--spacing-xs) 0;
  }
  li + li {
    border-top: 1px solid var(--border);
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-size: var(--font-size-overline);
  }
  .hint {
    margin: 0;
    font-size: var(--font-size-overline);
  }
  .total {
    text-align: right;
  }
  .error {
    margin: 0;
    color: var(--bad);
  }
  form {
    align-items: flex-end;
  }
</style>
