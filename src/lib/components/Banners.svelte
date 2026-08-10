<script lang="ts">
  /**
   * The two pieces of app-level chrome that must never be missed: a storage failure
   * (the library could not be read or written) and a waiting app update.
   *
   * Storage errors are shown, not swallowed. If IndexedDB is unavailable — private
   * browsing, a blocked upgrade, a full disk — the user needs to know before they type a
   * review that will not survive the reload.
   */
  import { storageError, clearStorageError } from '../stores/storage';
  import { needRefresh, applyUpdate, dismissUpdate } from '../stores/pwa';
</script>

{#if $storageError}
  <div class="banner bad" role="alert">
    <div class="grow">
      <strong>{$storageError}</strong>
      <p class="muted">
        Recent changes may not have been saved. This usually means private browsing, a full disk, or
        another tab upgrading the database — try closing other Cartridge tabs and reloading.
      </p>
    </div>
    <button type="button" class="btn small" onclick={clearStorageError}>Dismiss</button>
  </div>
{/if}

{#if $needRefresh}
  <div class="banner" role="status">
    <span class="grow">A new version of Cartridge is ready.</span>
    <button type="button" class="btn small primary" onclick={applyUpdate}>Refresh</button>
    <button type="button" class="btn small ghost" onclick={dismissUpdate}>Later</button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
    margin: var(--spacing-sm) 0;
    padding: var(--spacing-md);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .bad {
    border-color: var(--bad);
  }
  .banner p {
    margin: 4px 0 0;
    font-size: var(--font-size-overline);
  }
</style>
