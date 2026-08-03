<script lang="ts">
  /**
   * One game in the library, as a grid tile or a list row.
   *
   * Every fact shown here is local: cover, title, status, rating, playtime. A game added
   * by hand with no metadata renders exactly as well as one matched to IGDB — just with
   * less to say.
   */
  import type { LibraryItem } from '../types';
  import { STATUS_LABELS } from '../types';
  import { formatPlaytime } from '../util';
  import { link } from '../router';
  import Stars from './Stars.svelte';
  import CoverArt from './CoverArt.svelte';

  interface Props {
    item: LibraryItem;
    view?: 'grid' | 'list';
  }

  let { item, view = 'grid' }: Props = $props();

  const year = $derived(
    item.game.releasedAt == null ? '' : String(new Date(item.game.releasedAt).getFullYear()),
  );
</script>

<a class="tile {view}" href="/game/{item.game.id}" use:link>
  <CoverArt game={item.game} />

  <div class="meta">
    <span class="title">
      {item.game.title}
      {#if item.entry.favourite}<span class="fav" title="Favourite" aria-label="Favourite">♥</span
        >{/if}
    </span>

    <span class="sub muted">
      {STATUS_LABELS[item.entry.status]}{year ? ` · ${year}` : ''}
    </span>

    {#if item.entry.rating != null}
      <Stars value={item.entry.rating} size="sm" showValue />
    {/if}

    {#if view === 'list'}
      <span class="sub muted">
        {item.game.developer || 'Unknown developer'}
        {#if item.totalMinutes != null}· {formatPlaytime(item.totalMinutes)}{/if}
      </span>
    {/if}
  </div>
</a>

<style>
  .tile {
    display: block;
    color: inherit;
    text-decoration: none;
    border-radius: var(--radius);
    transition: transform var(--dur-fast) var(--ease);
  }
  .tile:hover {
    text-decoration: none;
    transform: translateY(-2px);
  }
  .tile:active {
    transform: translateY(0);
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--spacing-xs) 2px 0;
    min-width: 0;
  }
  .title {
    font-weight: var(--font-weight-semibold);
    line-height: var(--font-line-height-tight);
    /* Two lines, then ellipsis — long titles must not shove the grid around. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .fav {
    color: var(--accent);
  }
  .sub {
    font-size: var(--font-size-overline);
  }

  /* List: cover on the left, everything else beside it. */
  .list {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    gap: var(--spacing-md);
    align-items: center;
    padding: var(--spacing-xs);
  }
  .list:hover {
    transform: none;
    background: var(--surface-2);
  }
  .list .meta {
    padding: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .tile {
      transition: none;
    }
    .tile:hover {
      transform: none;
    }
  }
</style>
