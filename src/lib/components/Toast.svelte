<script lang="ts">
  /** Transient status messages. Polite by default; errors assert. */
  import { toast, dismissToast } from '../stores/toast';
</script>

{#if $toast}
  <div
    class="toast {$toast.tone}"
    role={$toast.tone === 'error' ? 'alert' : 'status'}
    aria-live={$toast.tone === 'error' ? 'assertive' : 'polite'}
  >
    <span>{$toast.message}</span>
    <button type="button" class="iconbtn" onclick={dismissToast} aria-label="Dismiss">✕</button>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(76px + env(safe-area-inset-bottom));
    z-index: 60;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    max-width: min(92vw, 520px);
    padding: 10px 10px 10px var(--spacing-md);
    border-radius: var(--radius-pill);
    background: var(--surface-3);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    color: var(--text);
  }
  .success {
    border-color: var(--good);
  }
  .error {
    border-color: var(--bad);
  }

  @media (min-width: 900px) {
    .toast {
      bottom: var(--spacing-lg);
    }
  }
</style>
