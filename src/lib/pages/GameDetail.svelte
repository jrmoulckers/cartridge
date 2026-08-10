<script lang="ts">
  /**
   * One game, and everything the user knows about it.
   *
   * Edits save as you make them — a review is a long thing to type and losing it to a
   * forgotten "Save" button would be unforgivable. Quick controls (shelf, rating,
   * favourite) write immediately; typed fields write on a short debounce and report when
   * they land.
   */
  import { onDestroy } from 'svelte';
  import {
    findItem,
    library,
    updateEntry,
    setStatus,
    toggleFavourite,
    removeGame,
    addLink,
    removeLink,
  } from '../stores/library';
  import { customShelves, toggleShelf } from '../stores/shelves';
  import { showToast } from '../stores/toast';
  import { navigate, link } from '../router';
  import {
    STATUSES,
    STATUS_LABELS,
    PLATFORMS,
    PLATFORM_LABELS,
    type Platform,
    type Replay,
  } from '../types';
  import {
    formatDate,
    formatPlaytime,
    toDateInput,
    parseDateInput,
    parseList,
    clampScore,
  } from '../util';
  import { renderMarkdown } from '../markdown';
  import Stars from '../components/Stars.svelte';
  import StarRating from '../components/StarRating.svelte';
  import MarkdownEditor from '../components/MarkdownEditor.svelte';
  import CoverArt from '../components/CoverArt.svelte';

  interface Props {
    id: string;
    /** Reported back to the shell so the document title can name the game. */
    title?: string;
  }

  let { id, title = $bindable(undefined) }: Props = $props();

  // Re-derived from the store so an edit anywhere refreshes this page.
  const item = $derived($library.find((i) => i.game.id === id) ?? findItem(id));

  $effect(() => {
    title = item?.game.title;
  });

  let confirmDelete = $state(false);
  let savedAt = $state(0);
  let newLinkPlatform = $state<Platform>('steam');
  let newLinkId = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => clearTimeout(timer));

  /** Write a patch after a short pause, so typing doesn't hit IndexedDB per keystroke. */
  function saveSoon(patch: Parameters<typeof updateEntry>[1]) {
    if (!item) return;
    const entry = item.entry;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await updateEntry(entry, patch);
      savedAt = Date.now();
    }, 600);
  }

  async function saveNow(patch: Parameters<typeof updateEntry>[1]) {
    if (!item) return;
    await updateEntry(item.entry, patch);
    savedAt = Date.now();
  }

  async function addReplay() {
    if (!item) return;
    await saveNow({ replays: [...item.entry.replays, {} as Replay] });
  }

  async function updateReplay(index: number, patch: Partial<Replay>) {
    if (!item) return;
    const replays = item.entry.replays.map((r, i) => (i === index ? { ...r, ...patch } : r));
    await saveNow({ replays });
  }

  async function deleteReplay(index: number) {
    if (!item) return;
    await saveNow({ replays: item.entry.replays.filter((_, i) => i !== index) });
  }

  async function saveLink() {
    if (!item || !newLinkId.trim()) return;
    await addLink(item.game.id, newLinkPlatform, newLinkId.trim());
    newLinkId = '';
  }

  async function destroy() {
    if (!item) return;
    const name = item.game.title;
    await removeGame(item.game.id);
    showToast(`Removed ${name}`, 'info');
    navigate('/');
  }

  const year = $derived(
    item?.game.releasedAt == null ? '' : String(new Date(item.game.releasedAt).getFullYear()),
  );
</script>

{#if !item}
  <section class="card center stack">
    <h1>That game isn’t in your library</h1>
    <p class="muted">It may have been removed, or the link may be from another device.</p>
    <div><a class="btn" href="/" use:link>Back to the library</a></div>
  </section>
{:else}
  <article class="stack">
    <header class="hero card">
      <CoverArt game={item.game} size="hero" />
      <div class="grow stack">
        <div>
          <h1>{item.game.title}</h1>
          <p class="muted sub">
            {[item.game.developer, year].filter(Boolean).join(' · ') || 'No release details yet'}
          </p>
        </div>

        <div class="row wrap">
          {#each item.game.genres as genre (genre)}<span class="pill">{genre}</span>{/each}
          {#each item.links as l (l.id)}
            <span class="pill">{PLATFORM_LABELS[l.platform]}</span>
          {/each}
        </div>

        <div class="row wrap">
          <button
            type="button"
            class="btn small"
            aria-pressed={item.entry.favourite}
            onclick={() => toggleFavourite(item.entry)}
          >
            {item.entry.favourite ? '♥ Favourite' : '♡ Mark favourite'}
          </button>
          <Stars value={item.entry.rating} showValue />
        </div>
      </div>
    </header>

    <section class="card stack" aria-labelledby="shelf-h">
      <h2 id="shelf-h">Shelf</h2>
      <div class="row wrap" role="group" aria-label="Status">
        {#each STATUSES as s (s)}
          <button
            type="button"
            class="pill"
            class:on={item.entry.status === s}
            aria-pressed={item.entry.status === s}
            onclick={() => setStatus(item.entry, s)}
          >
            {STATUS_LABELS[s]}
          </button>
        {/each}
      </div>

      {#if $customShelves.length}
        <div class="row wrap" role="group" aria-label="Custom shelves">
          {#each $customShelves as shelf (shelf.id)}
            <button
              type="button"
              class="pill"
              class:on={item.entry.shelfIds.includes(shelf.id)}
              aria-pressed={item.entry.shelfIds.includes(shelf.id)}
              onclick={() => toggleShelf(item.entry, shelf.id)}
            >
              {shelf.name}
            </button>
          {/each}
        </div>
      {:else}
        <p class="muted hint">
          Custom shelves let you group games any way you like — <a href="/shelves" use:link
            >make one</a
          >.
        </p>
      {/if}
    </section>

    <section class="card stack" aria-labelledby="rating-h">
      <h2 id="rating-h">Your rating</h2>
      <StarRating value={item.entry.rating} onchange={(rating) => saveNow({ rating })} />

      <div class="fields">
        <div>
          <label for="score">Score out of 100 <span class="muted">(optional)</span></label>
          <input
            id="score"
            type="number"
            min="1"
            max="100"
            step="1"
            value={item.entry.score ?? ''}
            oninput={(e) =>
              saveSoon({
                score: e.currentTarget.value
                  ? clampScore(Number(e.currentTarget.value))
                  : undefined,
              })}
          />
        </div>
        <div>
          <label for="started">Started</label>
          <input
            id="started"
            type="date"
            value={toDateInput(item.entry.startedAt)}
            onchange={(e) => saveNow({ startedAt: parseDateInput(e.currentTarget.value) })}
          />
        </div>
        <div>
          <label for="finished">Finished</label>
          <input
            id="finished"
            type="date"
            value={toDateInput(item.entry.finishedAt)}
            onchange={(e) => saveNow({ finishedAt: parseDateInput(e.currentTarget.value) })}
          />
        </div>
        <div>
          <label for="tags">Tags</label>
          <input
            id="tags"
            type="text"
            value={item.entry.tags.join(', ')}
            placeholder="co-op, comfort, 2026"
            oninput={(e) => saveSoon({ tags: parseList(e.currentTarget.value) })}
          />
        </div>
      </div>
    </section>

    <section class="card stack" aria-labelledby="review-h">
      <h2 id="review-h">Review</h2>
      <MarkdownEditor
        id="review"
        label="What did you think?"
        placeholder="No spoilers in the first paragraph…"
        value={item.entry.review ?? ''}
        onchange={(review) => saveSoon({ review })}
      />
    </section>

    <section class="card stack" aria-labelledby="notes-h">
      <h2 id="notes-h">Notes</h2>
      <MarkdownEditor
        id="notes"
        label="Private notes"
        hint="Only ever stored on this device. Never included in a review."
        rows={5}
        value={item.entry.notes ?? ''}
        onchange={(notes) => saveSoon({ notes })}
      />
    </section>

    <section class="card stack" aria-labelledby="replays-h">
      <h2 id="replays-h">Playthroughs</h2>
      {#if item.entry.replays.length === 0}
        <p class="muted hint">
          Your first playthrough is the started and finished dates above. Add a row here when you
          come back to a game.
        </p>
      {/if}
      {#each item.entry.replays as replay, i (i)}
        <div class="replay row wrap">
          <div>
            <label for="r-start-{i}">Started</label>
            <input
              id="r-start-{i}"
              type="date"
              value={toDateInput(replay.startedAt)}
              onchange={(e) =>
                updateReplay(i, { startedAt: parseDateInput(e.currentTarget.value) })}
            />
          </div>
          <div>
            <label for="r-end-{i}">Finished</label>
            <input
              id="r-end-{i}"
              type="date"
              value={toDateInput(replay.finishedAt)}
              onchange={(e) =>
                updateReplay(i, { finishedAt: parseDateInput(e.currentTarget.value) })}
            />
          </div>
          <div class="grow">
            <label for="r-note-{i}">Note</label>
            <input
              id="r-note-{i}"
              type="text"
              value={replay.note ?? ''}
              onchange={(e) => updateReplay(i, { note: e.currentTarget.value })}
            />
          </div>
          <button type="button" class="btn small ghost" onclick={() => deleteReplay(i)}>
            Remove
          </button>
        </div>
      {/each}
      <div>
        <button type="button" class="btn small" onclick={addReplay}>Add a playthrough</button>
      </div>
    </section>

    <section class="card stack" aria-labelledby="platforms-h">
      <h2 id="platforms-h">Platforms</h2>
      <p class="muted hint">
        Link this game to the id a platform uses for it. Connectors will fill these in automatically
        later; until then you can set them by hand.
      </p>

      {#each item.links as l (l.id)}
        <div class="row spread">
          <span>{PLATFORM_LABELS[l.platform]} · <code>{l.externalId}</code></span>
          <button type="button" class="btn small ghost" onclick={() => removeLink(l.id)}>
            Unlink
          </button>
        </div>
      {/each}

      <div class="row wrap">
        <div>
          <label for="link-platform">Platform</label>
          <select id="link-platform" bind:value={newLinkPlatform}>
            {#each PLATFORMS as p (p)}<option value={p}>{PLATFORM_LABELS[p]}</option>{/each}
          </select>
        </div>
        <div class="grow">
          <label for="link-id">Platform id</label>
          <input id="link-id" type="text" bind:value={newLinkId} placeholder="e.g. 753640" />
        </div>
        <button type="button" class="btn small" onclick={saveLink} disabled={!newLinkId.trim()}>
          Link
        </button>
      </div>

      {#if item.stats.length}
        <ul class="stats">
          {#each item.stats as stat (stat.id)}
            <li>
              {PLATFORM_LABELS[stat.platform]} · {formatPlaytime(stat.minutesPlayed)}
              {#if stat.lastPlayedAt}· last played {formatDate(stat.lastPlayedAt)}{/if}
              {#if stat.achievements}
                · {stat.achievements.earned}/{stat.achievements.total} achievements
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if item.game.summary}
      <section class="card" aria-labelledby="about-h">
        <h2 id="about-h">About</h2>
        <!-- renderMarkdown() escapes its input before emitting any tag and produces only
             the tags it generates itself; markdown.test.ts proves it against XSS payloads. -->
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="md">{@html renderMarkdown(item.game.summary)}</div>
      </section>
    {/if}

    <section class="card stack" aria-labelledby="danger-h">
      <h2 id="danger-h">Remove</h2>
      {#if confirmDelete}
        <p class="muted">
          Remove <strong>{item.game.title}</strong> and its rating, review and notes from this device?
          A restored backup can bring it back.
        </p>
        <div class="row wrap">
          <button type="button" class="btn danger" onclick={destroy}>Yes, remove it</button>
          <button type="button" class="btn ghost" onclick={() => (confirmDelete = false)}>
            Keep it
          </button>
        </div>
      {:else}
        <div>
          <button type="button" class="btn ghost" onclick={() => (confirmDelete = true)}>
            Remove from library
          </button>
        </div>
      {/if}
    </section>

    <p class="muted saved" aria-live="polite">
      {savedAt ? 'Saved' : 'Changes save as you make them'}
    </p>
  </article>
{/if}

<style>
  .hero {
    display: flex;
    gap: var(--spacing-lg);
    align-items: flex-start;
  }
  .hero h1 {
    margin-bottom: 0.1em;
  }
  .sub {
    margin: 0;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--spacing-sm);
  }
  .hint {
    margin: 0;
    font-size: var(--font-size-overline);
  }
  .replay {
    align-items: flex-end;
  }
  .stats {
    margin: 0;
    padding-left: 1.2em;
    color: var(--muted);
    font-size: var(--font-size-overline);
  }
  .saved {
    text-align: right;
    font-size: var(--font-size-overline);
    margin: 0;
  }

  @media (max-width: 560px) {
    .hero {
      flex-direction: column;
    }
  }
</style>
