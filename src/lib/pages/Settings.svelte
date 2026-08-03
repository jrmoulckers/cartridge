<script lang="ts">
  /**
   * Settings: how the app looks, where your data goes, and the one optional network
   * dependency in the whole product.
   *
   * Backup and restore live here because they are the only durable answer to "what happens
   * to my library if this device dies" in a local-first app — and both work offline.
   */
  import { settings, setTheme, setView, setBridgeUrl, type Theme } from '../stores/settings';
  import { library, refreshLibrary } from '../stores/library';
  import { refreshShelves } from '../stores/shelves';
  import { showToast } from '../stores/toast';
  import {
    downloadBackup,
    readBackupFile,
    restoreBackup,
    createBackup,
    countBackup,
    backupFileName,
    BackupError,
    type Backup,
  } from '../storage/backup';
  import { bridgeAvailable, bridgeUrl, checkBridge } from '../metadata/igdb';

  const THEMES: { value: Theme; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'dark-oled', label: 'OLED black' },
    { value: 'light', label: 'Light' },
    { value: 'high-contrast', label: 'High contrast' },
  ];

  let pending = $state<Backup | null>(null);
  let error = $state('');
  let busy = $state(false);
  let bridgeDraft = $state($settings.bridgeUrl);
  let checking = $state(false);

  async function exportNow() {
    busy = true;
    try {
      const name = await downloadBackup();
      showToast(`Saved ${name}`, 'success');
    } catch {
      error = 'The backup could not be written.';
    } finally {
      busy = false;
    }
  }

  async function pickFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = '';
    try {
      pending = await readBackupFile(file);
    } catch (e) {
      pending = null;
      error = e instanceof BackupError ? e.message : 'That file could not be read.';
    }
  }

  async function confirmRestore() {
    if (!pending) return;
    busy = true;
    try {
      // Safety net: a restore replaces everything, so keep the old state on disk first.
      if ($library.length) {
        const before = await createBackup();
        const blob = new Blob([JSON.stringify(before, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `before-restore-${backupFileName()}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }

      await restoreBackup(pending);
      await refreshShelves();
      await refreshLibrary();
      const counts = countBackup(pending);
      pending = null;
      showToast(`Restored ${counts.games} games`, 'success');
    } catch {
      error = 'The restore failed. Your library has not been changed.';
    } finally {
      busy = false;
    }
  }

  async function saveBridge() {
    setBridgeUrl(bridgeDraft);
    bridgeDraft = $settings.bridgeUrl;
    checking = true;
    await checkBridge();
    checking = false;
  }
</script>

<h1>Settings</h1>

<section class="card stack" aria-labelledby="look-h">
  <h2 id="look-h">Appearance</h2>

  <div>
    <span class="fieldlabel" id="theme-label">Theme</span>
    <div class="row wrap" role="group" aria-labelledby="theme-label">
      {#each THEMES as theme (theme.value)}
        <button
          type="button"
          class="pill"
          class:on={$settings.theme === theme.value}
          aria-pressed={$settings.theme === theme.value}
          onclick={() => setTheme(theme.value)}
        >
          {theme.label}
        </button>
      {/each}
    </div>
  </div>

  <div>
    <span class="fieldlabel" id="view-label">Library view</span>
    <div class="row wrap" role="group" aria-labelledby="view-label">
      <button
        type="button"
        class="pill"
        class:on={$settings.view === 'grid'}
        aria-pressed={$settings.view === 'grid'}
        onclick={() => setView('grid')}>Grid</button
      >
      <button
        type="button"
        class="pill"
        class:on={$settings.view === 'list'}
        aria-pressed={$settings.view === 'list'}
        onclick={() => setView('list')}>List</button
      >
    </div>
  </div>
</section>

<section class="card stack" aria-labelledby="backup-h">
  <h2 id="backup-h">Your data</h2>
  <p class="muted">
    Your library lives in this browser, on this device. A backup is a single JSON file you
    own — covers included — and both saving and restoring work with no network.
  </p>

  <div class="row wrap">
    <button type="button" class="btn primary" onclick={exportNow} disabled={busy}>
      Save a backup
    </button>
    <label class="btn" for="restore-file">Restore from a file</label>
    <input
      id="restore-file"
      class="sr-only"
      type="file"
      accept="application/json,.json"
      onchange={pickFile}
    />
  </div>

  {#if pending}
    {@const counts = countBackup(pending)}
    <div class="confirm">
      <p>
        That backup holds <strong>{counts.games} games</strong>, {counts.entries} entries and
        {counts.shelves} shelves.
      </p>
      <p class="muted">
        Restoring <strong>replaces</strong> everything currently in this browser. Cartridge will
        download a copy of your current library first, just in case.
      </p>
      <div class="row wrap">
        <button type="button" class="btn danger" onclick={confirmRestore} disabled={busy}>
          {busy ? 'Restoring…' : 'Replace my library'}
        </button>
        <button type="button" class="btn ghost" onclick={() => (pending = null)}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</section>

<section class="card stack" aria-labelledby="bridge-h">
  <h2 id="bridge-h">Metadata bridge <span class="pill">Optional</span></h2>
  <p class="muted">
    The bridge is a small worker that looks up cover art and release details so you don't have
    to type them. It never sees your library, your ratings or your reviews — only the words you
    type into a search box. Leave it blank and Cartridge works exactly as it does now, just
    with more typing.
  </p>

  <div class="row wrap">
    <div class="grow">
      <label for="bridge">Bridge URL</label>
      <input
        id="bridge"
        type="url"
        bind:value={bridgeDraft}
        placeholder="https://cartridge-bridge.example.workers.dev"
      />
    </div>
    <button type="button" class="btn" onclick={saveBridge}>Save and test</button>
  </div>

  <p class="muted status">
    {#if checking}
      Checking…
    {:else if !$bridgeUrl}
      Not configured — metadata lookup is off.
    {:else if $bridgeAvailable === true}
      Connected.
    {:else if $bridgeAvailable === false}
      Not reachable. Adding games by hand still works.
    {:else}
      Configured. It will be tried the next time you search.
    {/if}
  </p>
</section>

<style>
  .confirm {
    padding: var(--spacing-md);
    border: 1px solid var(--warn);
    border-radius: var(--radius-sm);
  }
  .confirm p {
    margin: 0 0 var(--spacing-sm);
  }
  .error {
    margin: 0;
    color: var(--bad);
  }
  .status {
    margin: 0;
    font-size: var(--font-size-overline);
  }
</style>
