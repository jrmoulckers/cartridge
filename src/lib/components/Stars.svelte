<script lang="ts">
  /**
   * Read-only star display. Pure presentation — the interactive control is
   * `StarRating.svelte`. Renders half stars by clipping a filled layer over an empty one,
   * so there is no separate half-star glyph to hunt for in a font.
   */
  interface Props {
    value?: number;
    /** Also show the number, e.g. "4.5". */
    showValue?: boolean;
    size?: 'sm' | 'md';
  }

  let { value = undefined, showValue = false, size = 'md' }: Props = $props();

  const label = $derived(value == null ? 'Not rated' : `Rated ${value} out of 5`);
</script>

<span class="stars {size}" title={label}>
  <span class="sr-only">{label}</span>
  <span class="glyphs" aria-hidden="true">
    {#each [1, 2, 3, 4, 5] as i (i)}
      <span class="star">
        <span class="empty">★</span>
        <span
          class="fill"
          style="--fill: {value == null
            ? 0
            : Math.min(1, Math.max(0, value - (i - 1))) * 100}%">★</span
        >
      </span>
    {/each}
  </span>
  {#if showValue && value != null}
    <span class="value">{value}</span>
  {/if}
</span>

<style>
  .stars {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
  }
  .glyphs {
    display: inline-flex;
    gap: 1px;
  }
  .star {
    position: relative;
    display: inline-block;
    line-height: 1;
    font-size: 1.05rem;
  }
  .sm .star {
    font-size: 0.85rem;
  }
  .empty {
    color: var(--border);
  }
  .fill {
    position: absolute;
    inset: 0;
    color: var(--accent);
    white-space: nowrap;
    clip-path: inset(0 calc(100% - var(--fill, 0%)) 0 0);
  }
  .value {
    font-size: var(--font-size-overline);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
