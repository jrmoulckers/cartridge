<script lang="ts">
  /**
   * One headline number, its label, and the truth about how much of the library it saw.
   *
   * A measure with no value renders its reason instead of a figure. That is the whole point:
   * "no platform reports playtime for these games" is information, and "0h" in the same slot
   * would be a fabrication that looks identical to a fact.
   */
  import type { Measure } from '../stats/types';
  import { coverageBadge } from '../stats/format';
  import Coverage from './Coverage.svelte';

  interface Props {
    label: string;
    /** The measure behind the number — drives the badge, the coverage line and the empty state. */
    measure: Measure<unknown>;
    /** The formatted headline. Ignored when the measure has no value. */
    display?: string;
    noun?: string;
    /** A second line under the number, e.g. a game title. */
    detail?: string;
  }

  let { label, measure, display = '', noun = 'game', detail = undefined }: Props = $props();

  const badge = $derived(coverageBadge(measure));
  const known = $derived(measure.value !== null);
</script>

<div class="stat">
  <p class="overline label">{label}</p>
  {#if known}
    <p class="value">{display}</p>
    {#if detail}
      <p class="detail">{detail}</p>
    {/if}
    {#if badge}
      <!-- Text, not a colour: partial is a property of the data, not a warning. -->
      <p class="badge">{badge}</p>
    {/if}
  {:else}
    <p class="value unknown">Not enough to say</p>
  {/if}
  <Coverage {measure} {noun} />
</div>

<style>
  .stat {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    padding: var(--spacing-md);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .label {
    margin: 0;
  }
  .value {
    margin: 0;
    font-size: var(--text-display-size);
    font-weight: var(--text-display-weight);
    line-height: var(--font-line-height-tight);
    font-variant-numeric: tabular-nums;
  }
  .value.unknown {
    font-size: var(--font-size-body);
    font-weight: var(--font-weight-regular);
    color: var(--muted);
  }
  .detail {
    margin: 0;
    font-size: var(--font-size-label);
  }
  .badge {
    margin: 0;
    align-self: flex-start;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    background: var(--surface-3);
    color: var(--muted);
    font-size: var(--text-overline-size);
    font-variant-numeric: tabular-nums;
  }
</style>
