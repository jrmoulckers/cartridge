/**
 * A tiny history-API router — same shape as `score-king`'s. No dependency, deep-linkable,
 * and `404.html` is a copy of `index.html` so GitHub Pages serves deep links too.
 */
import { writable } from 'svelte/store';

const RAW_BASE = import.meta.env.BASE_URL || '/';
/** '' when served at root, '/cartridge' when served under a subpath. */
const BASE = RAW_BASE.replace(/\/+$/, '');

/** Strip the deploy base prefix to get an app-relative path like '/game/x'. */
function toAppPath(pathname: string): string {
  let p = pathname || '/';
  if (BASE && (p === BASE || p.startsWith(BASE + '/'))) p = p.slice(BASE.length);
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

/** Turn an app-relative path into a real URL that includes the deploy base. */
function toUrl(appPath: string): string {
  return BASE + (appPath.startsWith('/') ? appPath : '/' + appPath);
}

export const pathStore = writable<string>(toAppPath(window.location.pathname));

export function navigate(to: string): void {
  const url = toUrl(to);
  if (url !== window.location.pathname) window.history.pushState({}, '', url);
  pathStore.set(toAppPath(url));
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
  pathStore.set(toAppPath(window.location.pathname));
});

/** Svelte action: turn an <a href="/..."> into a client-side navigation. */
export function link(node: HTMLAnchorElement) {
  const handler = (e: MouseEvent) => {
    const href = node.getAttribute('href');
    if (
      !href ||
      href.startsWith('http') ||
      href.startsWith('mailto:') ||
      node.target === '_blank' ||
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    navigate(href);
  };
  node.addEventListener('click', handler);
  return {
    destroy() {
      node.removeEventListener('click', handler);
    },
  };
}

export type RouteName =
  'library' | 'add' | 'game' | 'shelves' | 'stats' | 'year' | 'settings' | 'notfound';

export interface Route {
  name: RouteName;
  params: Record<string, string>;
}

const ROUTE_TITLES: Record<RouteName, string> = {
  library: 'Library',
  add: 'Add a game',
  game: 'Game',
  shelves: 'Shelves',
  stats: 'Stats',
  year: 'Year in review',
  settings: 'Settings',
  notfound: 'Not found',
};

const APP_NAME = 'Cartridge';

/** `document.title` for a route (WCAG 2.4.2 Page Titled). */
export function titleForRoute(route: Route, subject?: string): string {
  if (subject) return `${subject} · ${APP_NAME}`;
  const label = ROUTE_TITLES[route.name];
  return route.name === 'library' || !label ? APP_NAME : `${label} · ${APP_NAME}`;
}

export function parseRoute(path: string): Route {
  const clean = path.replace(/^\/+|\/+$/g, '');
  if (clean === '') return { name: 'library', params: {} };

  const segs = clean.split('/');
  if (segs.length === 1) {
    if (segs[0] === 'add') return { name: 'add', params: {} };
    if (segs[0] === 'shelves') return { name: 'shelves', params: {} };
    if (segs[0] === 'stats') return { name: 'stats', params: {} };
    // Bare /year is this year — the page resolves "which" so the URL doesn't have to.
    if (segs[0] === 'year') return { name: 'year', params: {} };
    if (segs[0] === 'settings') return { name: 'settings', params: {} };
    return { name: 'notfound', params: {} };
  }
  const [head, second] = segs;
  if (head === 'game' && second) return { name: 'game', params: { id: second } };
  if (head === 'year' && second && /^\d{4}$/.test(second))
    return { name: 'year', params: { year: second } };
  return { name: 'notfound', params: {} };
}
