<script lang="ts">
  /**
   * Add a game by hand.
   *
   * This is the primary path, not a fallback: title and a shelf are the only required
   * fields, and nothing on this form needs a network, an account or a metadata match.
   * Phase 2 adds an optional lookup above the form; the form itself stays exactly as it is.
   */
  import { addGame } from '../stores/library';
  import { showToast } from '../stores/toast';
  import { navigate, link } from '../router';
  import { STATUSES, STATUS_LABELS, PLATFORMS, PLATFORM_LABELS } from '../types';
  import type { Platform, Status } from '../types';
  import { cleanText, parseList, parseDateInput } from '../util';
  import { fileToCoverData, ImageError } from '../media';
  import MetadataSearch from '../components/MetadataSearch.svelte';
  import CoverArt from '../components/CoverArt.svelte';
  import type { GameMetadata } from '../metadata/types';

  let title = $state('');
  let status = $state<Status>('backlog');
  let platforms = $state<Platform[]>([]);
  let released = $state('');
  let developer = $state('');
  let publisher = $state('');
  let genresText = $state('');
  let summary = $state('');
  let coverUrl = $state('');
  let coverData = $state('');
  let igdbId = $state<number | undefined>(undefined);

  let saving = $state(false);
  let error = $state('');

  const canSave = $derived(cleanText(title).length > 0 && !saving);

  /** Preview shim so `CoverArt` can render the form's in-progress values. */
  const preview = $derived({
    id: 'preview',
    createdAt: 0,
    updatedAt: 0,
    title: title || 'Untitled',
    sortTitle: '',
    genres: [],
    platforms: [],
    source: 'manual' as const,
    coverUrl,
    coverData,
  });

  function togglePlatform(platform: Platform) {
    platforms = platforms.includes(platform)
      ? platforms.filter((p) => p !== platform)
      : [...platforms, platform];
  }

  /** Fill the form from a bridge result. Everything stays editable — it's a head start. */
  function applyMetadata(meta: GameMetadata) {
    title = meta.title;
    igdbId = meta.igdbId;
    coverUrl = meta.coverUrl ?? '';
    coverData = '';
    genresText = meta.genres.join(', ');
    developer = meta.developer ?? '';
    publisher = meta.publisher ?? '';
    summary = meta.summary ?? '';
    platforms = meta.platforms;
    released = meta.releasedAt ? new Date(meta.releasedAt).toISOString().slice(0, 10) : '';
    showToast(`Filled in details for ${meta.title}`, 'success');
  }

  async function pickCover(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      coverData = await fileToCoverData(file);
      error = '';
    } catch (e) {
      error = e instanceof ImageError ? e.message : 'That image could not be used.';
    } finally {
      input.value = '';
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const clean = cleanText(title);
    if (!clean) {
      error = 'A title is the one thing Cartridge needs.';
      return;
    }

    saving = true;
    error = '';
    const item = await addGame({
      title: clean,
      status,
      platforms,
      genres: parseList(genresText),
      releasedAt: parseDateInput(released),
      developer: cleanText(developer) || undefined,
      publisher: cleanText(publisher) || undefined,
      summary: summary.trim() || undefined,
      coverUrl: coverUrl.trim() || undefined,
      coverData: coverData || undefined,
      igdbId,
      source: igdbId ? 'igdb' : 'manual',
    });
    saving = false;

    if (!item) {
      error = 'That game could not be saved. Check the storage warning above.';
      return;
    }
    showToast(`Added ${item.game.title} to ${STATUS_LABELS[status]}`, 'success');
    navigate(`/game/${item.game.id}`);
  }
</script>

<h1>Add a game</h1>

<MetadataSearch onselect={applyMetadata} />

<form class="card stack" onsubmit={save}>
  <div>
    <label for="title">Title <span aria-hidden="true">*</span></label>
    <input
      id="title"
      type="text"
      bind:value={title}
      required
      autocomplete="off"
      placeholder="Outer Wilds"
    />
  </div>

  <div>
    <span class="fieldlabel" id="shelf-label">Shelf</span>
    <div class="row wrap" role="group" aria-labelledby="shelf-label">
      {#each STATUSES as s (s)}
        <button
          type="button"
          class="pill"
          class:on={status === s}
          aria-pressed={status === s}
          onclick={() => (status = s)}
        >
          {STATUS_LABELS[s]}
        </button>
      {/each}
    </div>
  </div>

  <div>
    <span class="fieldlabel" id="plat-label">Platforms you own it on</span>
    <div class="row wrap" role="group" aria-labelledby="plat-label">
      {#each PLATFORMS as p (p)}
        <button
          type="button"
          class="pill"
          class:on={platforms.includes(p)}
          aria-pressed={platforms.includes(p)}
          onclick={() => togglePlatform(p)}
        >
          {PLATFORM_LABELS[p]}
        </button>
      {/each}
    </div>
  </div>

  <div class="fields">
    <div>
      <label for="released">Released</label>
      <input id="released" type="date" bind:value={released} />
    </div>
    <div>
      <label for="developer">Developer</label>
      <input id="developer" type="text" bind:value={developer} autocomplete="off" />
    </div>
    <div>
      <label for="publisher">Publisher</label>
      <input id="publisher" type="text" bind:value={publisher} autocomplete="off" />
    </div>
    <div>
      <label for="genres">Genres</label>
      <input
        id="genres"
        type="text"
        bind:value={genresText}
        placeholder="Adventure, Puzzle"
        autocomplete="off"
      />
    </div>
  </div>

  <div>
    <label for="summary">Summary</label>
    <textarea id="summary" rows="3" bind:value={summary}></textarea>
  </div>

  <div class="cover-field">
    <div class="grow stack">
      <div>
        <label for="coverUrl">Cover image URL</label>
        <input id="coverUrl" type="url" bind:value={coverUrl} placeholder="https://…" />
      </div>
      <div>
        <label for="coverFile">…or use an image from this device</label>
        <input id="coverFile" type="file" accept="image/*" onchange={pickCover} />
        <p class="hint muted">
          Stored on this device only, resized to keep your backups small.
          {#if coverData}
            <button type="button" class="btn small ghost" onclick={() => (coverData = '')}>
              Remove image
            </button>
          {/if}
        </p>
      </div>
    </div>
    <div class="thumb"><CoverArt game={preview} /></div>
  </div>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <div class="row wrap">
    <button type="submit" class="btn primary" disabled={!canSave}>
      {saving ? 'Saving…' : 'Add to library'}
    </button>
    <a class="btn ghost" href="/" use:link>Cancel</a>
  </div>
</form>

<style>
  form {
    margin-top: var(--spacing-md);
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--spacing-sm);
  }
  .cover-field {
    display: flex;
    gap: var(--spacing-md);
    align-items: flex-start;
  }
  .thumb {
    width: 96px;
    flex: none;
  }
  .hint {
    margin: var(--spacing-xs) 0 0;
    font-size: var(--font-size-overline);
  }
  .error {
    margin: 0;
    color: var(--bad);
  }
</style>
