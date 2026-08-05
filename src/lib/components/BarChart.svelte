<script lang="ts">
  /**
   * A distribution, as text with a bar beside it.
   *
   * Hand-rolled rather than a charting dependency: the app is around 116 kB and a chart
   * library would be a large fraction of that again for something a flex row and a width
   * can do.
   *
   * The accessibility model is deliberate. The **numbers are the chart** — every row states
   * its label and its count as real text, so a screen-reader user reads the same distribution
   * a sighted user sees, in the same order. The coloured bar is `aria-hidden` decoration that
   * makes the shape scannable, and it carries no information the text lacks. Nothing here
   * encodes meaning in colour: there is one bar colour, and length is the variable.
   */
  import type { Distribution } from '../stats/types';
  import { peak } from '../stats/types';
  import { distributionSentence, formatCount } from '../stats/format';

  interface Props {
    title: string;
    distribution: Distribution;
    /** Singular noun for the coverage sentence. */
    noun?: string;
    /** Show at most this many bars, largest first as the distribution is already ordered. */
    limit?: number;
    /** Formats the optional secondary figure, e.g. an average rating. */
    formatDetail?: (value: number) => string;
    /** Text when there is nothing to draw. */
    emptyText?: string;
  }

  let {
    title,
    distribution,
    noun = 'game',
    limit = 12,
    formatDetail = undefined,
    emptyText = 'Nothing to show yet.',
  }: Props = $props();

  const rows = $derived(distribution.buckets.slice(0, limit));
  const max = $derived(peak(distribution));
  const hidden = $derived(Math.max(0, distribution.buckets.length - rows.length));
  const note = $derived(distributionSentence(distribution, noun));
  const id = $props.id();

  /**
   * Bars scale rather than resize: `transform` is composited, where animating `width` makes
   * the browser lay the row out again on every frame. A non-zero count keeps a sliver of bar
   * so a count of 1 beside a count of 400 is still visibly present.
   */
  function scale(count: number, max: number): number {
    if (!max || count <= 0) return 0;
    return Math.max(0.012, count / max);
  }
</script>

<figure class="chart" aria-labelledby="{id}-title">
  <figcaption id="{id}-title" class="overline">{title}</figcaption>

  {#if rows.length === 0}
    <p class="muted empty">{emptyText}</p>
  {:else}
    <ul>
      {#each rows as bucket (bucket.key)}
        <li>
          <span class="key">{bucket.label}</span>
          <span class="track" aria-hidden="true">
            <span class="bar" style="--w: {scale(bucket.count, max)}"></span>
          </span>
          <span class="count">
            {formatCount(bucket.count)}{#if formatDetail && bucket.detail != null}<span class="detail"
                >{formatDetail(bucket.detail)}</span
              >{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if hidden}
    <p class="muted note">{formatCount(hidden)} more not shown.</p>
  {/if}
  {#if note}
    <p class="muted note">{note}</p>
  {/if}
</figure>

<style>
  .chart {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }
  figcaption {
    margin: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }
  li {
    display: grid;
    grid-template-columns: minmax(4.5rem, 8rem) 1fr auto;
    align-items: center;
    gap: var(--spacing-sm);
  }
  .key {
    font-size: var(--font-size-label);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    height: 10px;
    border-radius: var(--radius-pill);
    background: var(--surface-3);
    overflow: hidden;
  }
  .bar {
    display: block;
    height: 100%;
    width: 100%;
    border-radius: var(--radius-pill);
    background: var(--primary);
    transform: scaleX(var(--w, 0));
    transform-origin: left center;
    transition: transform var(--dur-base) var(--ease);
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-size: var(--font-size-label);
    text-align: right;
  }
  .detail {
    color: var(--muted);
    margin-left: var(--spacing-xs);
  }
  .empty,
  .note {
    margin: 0;
    font-size: var(--text-overline-size);
  }

  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
    }
  }
</style>
