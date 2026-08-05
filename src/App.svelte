<script lang="ts">
  /**
   * The app shell.
   *
   * A sticky app bar plus a bottom tab bar on phones; both collapse into a left rail from
   * 900px (see app.css). Routing is a plain `{#if}` over the parsed route — five screens
   * do not need a router framework, and this keeps the whole navigation model readable.
   */
  import { pathStore, parseRoute, link, titleForRoute } from './lib/router';
  import Banners from './lib/components/Banners.svelte';
  import Toast from './lib/components/Toast.svelte';
  import Library from './lib/pages/Library.svelte';
  import AddGame from './lib/pages/AddGame.svelte';
  import GameDetail from './lib/pages/GameDetail.svelte';
  import Shelves from './lib/pages/Shelves.svelte';
  import Stats from './lib/pages/Stats.svelte';
  import YearInReview from './lib/pages/YearInReview.svelte';
  import Settings from './lib/pages/Settings.svelte';
  import NotFound from './lib/pages/NotFound.svelte';

  const route = $derived(parseRoute($pathStore));

  /** A game page names itself; every other page has a static title. */
  let subject = $state<string | undefined>(undefined);

  $effect(() => {
    document.title = titleForRoute(route, route.name === 'game' ? subject : undefined);
  });

  const NAV = [
    { href: '/', label: 'Library', icon: '🎮', match: (n: string) => n === 'library' },
    { href: '/add', label: 'Add', icon: '＋', match: (n: string) => n === 'add' },
    { href: '/shelves', label: 'Shelves', icon: '🗂', match: (n: string) => n === 'shelves' },
    // Stats and the year in review are one destination in the nav: the year is the artifact
    // you arrive at from the everyday page, not a fifth thing to keep in your head.
    { href: '/stats', label: 'Stats', icon: '📊', match: (n: string) => n === 'stats' || n === 'year' },
    { href: '/settings', label: 'Settings', icon: '⚙', match: (n: string) => n === 'settings' },
  ];
</script>

<div class="shell">
  <nav class="sidebar" aria-label="Main">
    <a class="brand" href="/" use:link>
      <span aria-hidden="true">🕹️</span>
      <span>Cartridge</span>
    </a>
    {#each NAV as item (item.href)}
      <a
        href={item.href}
        use:link
        class:active={item.match(route.name)}
        aria-current={item.match(route.name) ? 'page' : undefined}
      >
        <span class="ico" aria-hidden="true">{item.icon}</span>
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>

  <div class="viewport">
    <header class="appbar">
      <a class="brand" href="/" use:link>
        <span aria-hidden="true">🕹️</span>
        <span>Cartridge</span>
      </a>
      <a class="btn small primary" href="/add" use:link>Add a game</a>
    </header>

    <main class="app" id="main">
      <Banners />

      {#if route.name === 'library'}
        <Library />
      {:else if route.name === 'add'}
        <AddGame />
      {:else if route.name === 'game'}
        <GameDetail id={route.params.id} bind:title={subject} />
      {:else if route.name === 'shelves'}
        <Shelves />
      {:else if route.name === 'stats'}
        <Stats />
      {:else if route.name === 'year'}
        <YearInReview year={route.params.year} />
      {:else if route.name === 'settings'}
        <Settings />
      {:else}
        <NotFound />
      {/if}
    </main>

    <nav class="tabbar" aria-label="Main">
      {#each NAV as item (item.href)}
        <a
          href={item.href}
          use:link
          class:active={item.match(route.name)}
          aria-current={item.match(route.name) ? 'page' : undefined}
        >
          <span class="ico" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>
  </div>
</div>

<Toast />
