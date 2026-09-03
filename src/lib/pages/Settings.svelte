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
  import { bridgeHealth, bridgeUrl, checkBridge } from '../metadata/igdb';
  import ConnectorImport from '../components/ConnectorImport.svelte';
  import { readSteamResult, steamLoginUrl } from '../connectors/steam-auth';
  import { STEAM_PRIVACY_URL } from '../connectors/steam';
  import { OPENXBL_KEY_URL } from '../connectors/xbox';
  import {
    connections,
    connectionsLoaded,
    connectSteam,
    connectXbox,
    disconnect,
    linkedGameCounts,
    needsReconnect,
    prepareSync,
    refreshConnections,
    resetSync,
    syncState,
  } from '../stores/connectors';
  import { onMount } from 'svelte';

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
      showToast(
        // The restore brought links back but not the account behind them. Say so now rather
        // than letting them find out when a sync they didn't run doesn't happen.
        $needsReconnect.length
          ? `Restored ${counts.games} games — reconnect your platforms below to resume syncing`
          : `Restored ${counts.games} games`,
        'success',
        $needsReconnect.length ? 6000 : undefined,
      );
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

  // ── Platforms ─────────────────────────────────────────────────────────────

  let confirmingDisconnect = $state(false);
  let steamNotice = $state('');

  const steam = $derived($connections.steam);
  const steamNeedsReconnect = $derived($needsReconnect.includes('steam'));
  const steamLinkedCount = $derived($linkedGameCounts.steam ?? 0);
  const syncing = $derived($syncState.phase === 'fetching' || $syncState.phase === 'matching');
  const showImport = $derived(
    $syncState.phase === 'reviewing' ||
      $syncState.phase === 'applying' ||
      $syncState.phase === 'done',
  );
  const steamSyncing = $derived(syncing && $syncState.platform === 'steam');

  // ── Xbox ──────────────────────────────────────────────────────────────────
  // The credential here is a secret the user typed, which Steam's never was. So the input is
  // a password field, the stored value is never rendered back, and the only thing shown once
  // it works is the gamertag.

  let xboxKey = $state('');
  let xboxNotice = $state('');
  let xboxBusy = $state(false);
  let confirmingXboxDisconnect = $state(false);

  const xbox = $derived($connections.xbox);
  const xboxNeedsReconnect = $derived($needsReconnect.includes('xbox'));
  const xboxLinkedCount = $derived($linkedGameCounts.xbox ?? 0);
  const xboxSyncing = $derived(syncing && $syncState.platform === 'xbox');

  async function connectXboxNow() {
    xboxNotice = '';
    if (!xboxKey.trim()) {
      xboxNotice = 'Paste your OpenXBL API key first.';
      return;
    }
    xboxBusy = true;
    try {
      await connectXbox(xboxKey);
      // Out of the component's memory the moment it is stored. There is no reason to keep a
      // secret sitting in a reactive variable behind a page the user has moved on from.
      xboxKey = '';
      showToast('Xbox connected', 'success');
    } catch (e) {
      xboxNotice = e instanceof Error ? e.message : 'That key could not be checked.';
    } finally {
      xboxBusy = false;
    }
  }

  async function syncXbox() {
    xboxNotice = '';
    await prepareSync('xbox');
  }

  async function confirmXboxDisconnect() {
    confirmingXboxDisconnect = false;
    const counts = await disconnect('xbox');
    resetSync();
    showToast(`Xbox disconnected — ${counts.links} links removed`, 'success');
  }

  /**
   * On arriving back from Steam, read the verified id out of the fragment and store it.
   * `readSteamResult` is a pure look at `location.hash` — no network — so this stays inside
   * the offline guarantee even though it runs on every visit to Settings.
   */
  onMount(() => {
    void (async () => {
      // Settings is the status surface, so refresh its evidence when it is actually opened.
      // This does not run during ordinary app boot and an unconfigured device stays network-free.
      if ($bridgeUrl) {
        checking = true;
        void checkBridge().finally(() => {
          checking = false;
        });
      }
      const outcome = readSteamResult();
      if (outcome?.kind === 'connected') {
        await connectSteam(outcome.steamId);
        showToast('Steam connected', 'success');
      } else if (outcome?.kind === 'failed') {
        steamNotice = outcome.message;
      }
      await refreshConnections();
    })();
  });

  function connect() {
    const url = steamLoginUrl();
    if (!url) {
      steamNotice = 'Set a bridge URL above first — Steam sign-in goes through it.';
      return;
    }
    window.location.href = url;
  }

  async function syncSteam() {
    steamNotice = '';
    await prepareSync('steam');
  }

  async function confirmDisconnect() {
    confirmingDisconnect = false;
    const counts = await disconnect('steam');
    resetSync();
    showToast(`Steam disconnected — ${counts.links} links removed`, 'success');
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
    Your library lives in this browser, on this device. A backup is a single JSON file you own —
    covers included — and both saving and restoring work with no network.
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
        Restoring <strong>replaces</strong> everything currently in this browser. Cartridge will download
        a copy of your current library first, just in case. Platform connections aren’t included in a
        backup — you’ll reconnect them afterwards.
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
    The bridge is a small worker that looks up cover art and release details so you don't have to
    type them. It never sees your library, your ratings or your reviews — only the words you type
    into a search box. Leave it blank and Cartridge works exactly as it does now, just with more
    typing.
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
    {:else if $bridgeHealth === 'reachable'}
      Connected.
    {:else if $bridgeHealth === 'slow'}
      Reachable, but responding slowly. Adding games by hand still works.
    {:else if $bridgeHealth === 'unreachable'}
      Not reachable. Adding games by hand still works.
    {:else}
      Configured. It will be tried the next time you search.
    {/if}
  </p>
</section>

<section class="card stack" aria-labelledby="platforms-h">
  <h2 id="platforms-h">Platforms <span class="pill">Optional</span></h2>
  <p class="muted">
    Connecting a platform imports what you own and how long you've played it. Cartridge works
    exactly as well with nothing connected — this only saves typing.
  </p>

  <div class="platform">
    <div class="row spread wrap">
      <div class="grow">
        <h3>Steam</h3>
        {#if !$connectionsLoaded}
          <p class="muted status">Checking…</p>
        {:else if steam}
          <p class="muted status">
            Connected as {steam.account}.
            {#if steam.syncedAt}
              Last synced {new Date(steam.syncedAt).toLocaleDateString()}.
            {:else}
              Not synced yet.
            {/if}
          </p>
        {:else}
          <p class="muted status">
            Signs in through Steam itself. Cartridge never sees your password — only your public
            account number.
          </p>
        {/if}
      </div>

      <div class="row wrap">
        {#if steam}
          <button type="button" class="btn primary" onclick={syncSteam} disabled={syncing}>
            {steamSyncing ? 'Reading your library…' : 'Sync now'}
          </button>
          <button
            type="button"
            class="btn ghost"
            onclick={() => (confirmingDisconnect = true)}
            disabled={syncing}
          >
            Disconnect
          </button>
        {:else}
          <button type="button" class="btn primary" onclick={connect} disabled={!$bridgeUrl}>
            Connect Steam
          </button>
        {/if}
      </div>
    </div>

    {#if !$bridgeUrl}
      <p class="muted status">
        Steam needs a bridge: its API has no browser access and requires a server-side key. Set one
        above and this button turns on.
      </p>
    {/if}

    {#if steamNeedsReconnect}
      <div class="notice">
        <p>
          <strong>{steamLinkedCount}</strong>
          {steamLinkedCount === 1 ? 'game in your library is' : 'games in your library are'}
          linked to Steam, but this device isn’t connected to it.
        </p>
        <p class="muted">
          Account connections aren’t part of a backup — on purpose, so a backup file never carries
          an account with it. Everything you wrote came across fine; reconnecting just starts
          playtime and achievements updating again.
        </p>
        <div class="row wrap">
          <button type="button" class="btn primary" onclick={connect} disabled={!$bridgeUrl}>
            Reconnect Steam
          </button>
        </div>
      </div>
    {/if}

    {#if steamNotice}
      <p class="error" role="alert">{steamNotice}</p>
    {/if}

    {#if steamSyncing}
      <p class="muted status" aria-live="polite">
        {$syncState.phase === 'fetching'
          ? 'Asking Steam what you own…'
          : `Identifying games… ${$syncState.done} of ${$syncState.total}`}
      </p>
    {/if}

    {#if $syncState.platform === 'steam' && $syncState.error}
      <div class="notice" role="alert">
        <p>{$syncState.error}</p>
        {#if $syncState.helpUrl === STEAM_PRIVACY_URL}
          <p class="muted">
            Steam only shares a library when the profile allows it. Open
            <a href={$syncState.helpUrl} target="_blank" rel="noopener noreferrer">
              your Steam privacy settings
            </a>
            and set <strong>Game details</strong> to <strong>Public</strong>. You can set it back
            afterwards — Cartridge keeps what it imported.
          </p>
        {:else if $syncState.helpUrl}
          <p class="muted">
            <a href={$syncState.helpUrl} target="_blank" rel="noopener noreferrer">
              How to fix this
            </a>
          </p>
        {/if}
      </div>
    {/if}

    {#if confirmingDisconnect}
      <div class="confirm">
        <p>Disconnect Steam?</p>
        <p class="muted">
          This removes your Steam account number and the Steam playtime and achievement figures from
          your library. <strong
            >Your games, ratings, reviews, notes and shelves stay exactly as they are</strong
          > — they're yours, and they have nothing to do with Steam.
        </p>
        <div class="row wrap">
          <button type="button" class="btn danger" onclick={confirmDisconnect}>
            Disconnect Steam
          </button>
          <button type="button" class="btn ghost" onclick={() => (confirmingDisconnect = false)}>
            Keep it connected
          </button>
        </div>
      </div>
    {/if}
  </div>

  <div class="platform">
    <div class="row spread wrap">
      <div class="grow">
        <h3>Xbox <span class="pill">Unofficial</span></h3>
        {#if !$connectionsLoaded}
          <p class="muted status">Checking…</p>
        {:else if xbox}
          <p class="muted status">
            Connected as {xbox.account}.
            {#if xbox.syncedAt}
              Last synced {new Date(xbox.syncedAt).toLocaleDateString()}.
            {:else}
              Not synced yet.
            {/if}
          </p>
        {:else}
          <p class="muted status">
            Uses your own free key from OpenXBL, a third-party service. Microsoft has no public Xbox
            library API, so this is the only route there is — and it can break without warning. If
            it does, only this tab stops working.
          </p>
        {/if}
      </div>

      <div class="row wrap">
        {#if xbox}
          <button type="button" class="btn primary" onclick={syncXbox} disabled={syncing}>
            {xboxSyncing ? 'Reading your library…' : 'Sync now'}
          </button>
          <button
            type="button"
            class="btn ghost"
            onclick={() => (confirmingXboxDisconnect = true)}
            disabled={syncing}
          >
            Disconnect
          </button>
        {/if}
      </div>
    </div>

    {#if !xbox}
      <div class="stack">
        <div>
          <label class="fieldlabel" for="xbl-key">OpenXBL API key</label>
          <!--
            A password field for a key rather than a token, because it is one: it grants read
            access to an Xbox account for as long as it exists. It is stored on this device
            with your other credentials, sent to your bridge only for the request that needs
            it, and deliberately left out of backups.
          -->
          <input
            id="xbl-key"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="Paste your key"
            bind:value={xboxKey}
            disabled={!$bridgeUrl || xboxBusy}
          />
        </div>
        <p class="muted status">
          Sign in at
          <a href={OPENXBL_KEY_URL} target="_blank" rel="noopener noreferrer">xbl.io</a>
          with your Microsoft account and copy the key it shows you. It is yours rather than Cartridge's,
          so your rate limit is your own — and it stays on this device.
        </p>
        <div class="row wrap">
          <button
            type="button"
            class="btn primary"
            onclick={connectXboxNow}
            disabled={!$bridgeUrl || xboxBusy}
          >
            {xboxBusy ? 'Checking the key…' : 'Connect Xbox'}
          </button>
        </div>
      </div>
    {/if}

    {#if !$bridgeUrl}
      <p class="muted status">
        Xbox needs a bridge too — OpenXBL sends no browser CORS headers, so the request has to go
        through it. Set one above and this turns on.
      </p>
    {/if}

    {#if xboxNeedsReconnect}
      <div class="notice">
        <p>
          <strong>{xboxLinkedCount}</strong>
          {xboxLinkedCount === 1 ? 'game in your library is' : 'games in your library are'}
          linked to Xbox, but this device isn’t connected to it.
        </p>
        <p class="muted">
          Your OpenXBL key isn’t part of a backup, on purpose — a backup file is not a place for a
          secret. Everything you wrote came across fine; paste the key again to resume syncing.
        </p>
      </div>
    {/if}

    {#if xboxNotice}
      <p class="error" role="alert">{xboxNotice}</p>
    {/if}

    {#if xboxSyncing}
      <p class="muted status" aria-live="polite">
        {$syncState.phase === 'fetching'
          ? 'Asking Xbox what you’ve played…'
          : `Identifying games… ${$syncState.done} of ${$syncState.total}`}
      </p>
    {/if}

    {#if $syncState.platform === 'xbox' && $syncState.error}
      <div class="notice" role="alert">
        <p>{$syncState.error}</p>
        {#if $syncState.helpUrl}
          <p class="muted">
            <a href={$syncState.helpUrl} target="_blank" rel="noopener noreferrer">
              Get a new key from xbl.io
            </a>
          </p>
        {/if}
      </div>
    {/if}

    {#if confirmingXboxDisconnect}
      <div class="confirm">
        <p>Disconnect Xbox?</p>
        <p class="muted">
          This forgets your OpenXBL key and removes the Xbox playtime and achievement figures from
          your library. <strong
            >Your games, ratings, reviews, notes and shelves stay exactly as they are.</strong
          > The key itself lives in your xbl.io account — delete it there if you want it gone for good.
        </p>
        <div class="row wrap">
          <button type="button" class="btn danger" onclick={confirmXboxDisconnect}>
            Disconnect Xbox
          </button>
          <button
            type="button"
            class="btn ghost"
            onclick={() => (confirmingXboxDisconnect = false)}
          >
            Keep it connected
          </button>
        </div>
      </div>
    {/if}
  </div>

  <p class="muted status">PlayStation and Nintendo are still to come.</p>
</section>

{#if showImport}
  <ConnectorImport />
{/if}

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
  .platform h3 {
    margin: 0 0 var(--spacing-xs);
  }
  .platform > * + * {
    margin-top: var(--spacing-sm);
  }
  .notice {
    padding: var(--spacing-md);
    border: 1px solid var(--warn);
    border-radius: var(--radius-sm);
  }
  .notice p {
    margin: 0 0 var(--spacing-sm);
  }
  .notice p:last-child {
    margin-bottom: 0;
  }
</style>
