<script lang="ts">
  /**
   * The denominator under a number.
   *
   * This is the component that makes the phase honest, and it is deliberately the *only*
   * place a coverage sentence is worded — see `stats/format.ts`. A complete measure renders
   * nothing at all: "across 91 of your 91 games" is noise, and noise here teaches people to
   * skip the sentence on the measures where it matters.
   */
  import type { Measure } from '../stats/types';
  import { coverageSentence } from '../stats/format';

  interface Props {
    measure: Measure<unknown>;
    /** Singular noun for the denominator — "game", "platform", "rating". */
    noun?: string;
    id?: string;
  }

  let { measure, noun = 'game', id = undefined }: Props = $props();

  const sentence = $derived(coverageSentence(measure, noun));
</script>

{#if sentence}
  <p class="coverage" {id}>{sentence}</p>
{/if}

<style>
  .coverage {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-overline-size);
    line-height: var(--font-line-height-normal);
  }
</style>
