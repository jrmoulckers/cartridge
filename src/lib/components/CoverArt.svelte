<script lang="ts">
  /**
   * Cover art, with a graceful fallback.
   *
   * A cover may be a data URL cached on-device, a remote URL, or absent entirely — the
   * common case for a manually added game with no bridge. The fallback is not an error
   * state: it is a legitimate way for a game to look, so it renders as a designed tile
   * with the game's initials rather than a broken-image icon.
   */
  import type { Game } from '../types';

  interface Props {
    game: Game;
    size?: 'tile' | 'hero';
  }

  let { game, size = 'tile' }: Props = $props();

  let failed = $state(false);
  const src = $derived(game.coverData || game.coverUrl || '');

  /** Up to two initials from the title — "Outer Wilds" → "OW". */
  const initials = $derived(
    game.title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join(''),
  );
</script>

<div class="cover {size}" class:placeholder={!src || failed}>
  {#if src && !failed}
    <img {src} alt="" loading="lazy" decoding="async" onerror={() => (failed = true)} />
  {:else}
    <span class="initials" aria-hidden="true">{initials || '?'}</span>
  {/if}
</div>

<style>
  .cover {
    position: relative;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .placeholder {
    display: grid;
    place-items: center;
  }
  .initials {
    font-size: 1.6rem;
    font-weight: var(--font-weight-bold);
    color: var(--muted);
    letter-spacing: 0.05em;
  }
  .hero {
    width: 140px;
    flex: none;
  }
  .hero .initials {
    font-size: 2.2rem;
  }
</style>
