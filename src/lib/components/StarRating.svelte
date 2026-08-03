<script lang="ts">
  /**
   * The half-star rating control.
   *
   * Exposed as a radio group of ten half-steps so screen readers announce it as the choice
   * it is ("3.5 out of 5, 7 of 10"). Roving tabindex: one tab stop, arrows adjust,
   * Home/End jump to the ends, and Delete/Backspace clears the rating — un-rating a game
   * has to be as easy as rating it.
   */
  import { clampRating } from '../util';

  interface Props {
    value?: number;
    onchange: (value: number | undefined) => void;
    label?: string;
  }

  let { value = undefined, onchange, label = 'Your rating' }: Props = $props();

  const STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

  let hovered = $state<number | undefined>(undefined);
  /** What the stars draw: the hovered value while pointing, otherwise the real one. */
  const shown = $derived(hovered ?? value);
  /** The single tab stop — the current value, or the first step when unrated. */
  const focusStep = $derived(value ?? 0.5);

  let root = $state<HTMLDivElement>();

  function set(next: number | undefined) {
    onchange(clampRating(next));
  }

  function move(delta: number) {
    const index = STEPS.indexOf(value ?? 0);
    const nextIndex = Math.min(STEPS.length - 1, Math.max(0, (index < 0 ? -1 : index) + delta));
    const next = STEPS[nextIndex];
    set(next);
    queueMicrotask(() => {
      root?.querySelector<HTMLElement>(`[data-step="${next}"]`)?.focus();
    });
  }

  function onkeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        set(0.5);
        break;
      case 'End':
        event.preventDefault();
        set(5);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        set(undefined);
        break;
    }
  }
</script>

<div class="rating row">
  <div
    class="control"
    role="radiogroup"
    aria-label={label}
    tabindex="-1"
    bind:this={root}
    onkeydown={onkeydown}
    onmouseleave={() => (hovered = undefined)}
  >
    <span class="glyphs" aria-hidden="true">
      {#each [1, 2, 3, 4, 5] as i (i)}
        <span class="star">
          <span class="empty">★</span>
          <span
            class="fill"
            style="--fill: {shown == null
              ? 0
              : Math.min(1, Math.max(0, shown - (i - 1))) * 100}%">★</span
          >
        </span>
      {/each}
    </span>

    <span class="hits">
      {#each STEPS as step (step)}
        <button
          type="button"
          role="radio"
          data-step={step}
          aria-checked={value === step}
          aria-label="{step} out of 5"
          tabindex={focusStep === step ? 0 : -1}
          onclick={() => set(value === step ? undefined : step)}
          onmouseenter={() => (hovered = step)}
          onfocus={() => (hovered = step)}
          onblur={() => (hovered = undefined)}
        ></button>
      {/each}
    </span>
  </div>

  <span class="readout" aria-hidden="true">{value == null ? 'Not rated' : `${value} / 5`}</span>

  {#if value != null}
    <button type="button" class="btn small ghost" onclick={() => set(undefined)}>Clear</button>
  {/if}
</div>

<style>
  .rating {
    flex-wrap: wrap;
  }
  .control {
    position: relative;
    display: inline-flex;
    padding: 4px 0;
  }
  .glyphs {
    display: inline-flex;
    gap: 2px;
  }
  .star {
    position: relative;
    display: inline-block;
    line-height: 1;
    font-size: 1.9rem;
  }
  .empty {
    color: var(--border);
  }
  /* Clipped rather than width-animated: clip-path is composited and, unlike a
     transform, does not distort the glyph while a half fill slides in. */
  .fill {
    position: absolute;
    inset: 0;
    color: var(--accent);
    white-space: nowrap;
    clip-path: inset(0 calc(100% - var(--fill, 0%)) 0 0);
    transition: clip-path var(--dur-fast) var(--ease);
  }
  .hits {
    position: absolute;
    inset: 0;
    display: flex;
  }
  .hits button {
    flex: 1;
    border: 0;
    padding: 0;
    background: none;
    cursor: pointer;
  }
  .hits button:focus-visible {
    outline: 2px solid var(--semantic-border-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
  .readout {
    font-size: var(--font-size-overline);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    min-width: 4.5rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
