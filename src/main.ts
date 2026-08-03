import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { applySettings } from './lib/stores/settings';
import { initPWA } from './lib/stores/pwa';
import { refreshLibrary } from './lib/stores/library';
import { refreshShelves } from './lib/stores/shelves';

/**
 * Boot.
 *
 * Nothing here talks to the network. Appearance is applied, the service worker is wired,
 * the app mounts, and the library loads from IndexedDB — an install with no connectors and
 * no connectivity reaches a usable Library screen by exactly this path.
 */
async function boot() {
  applySettings();
  initPWA();
  mount(App, { target: document.getElementById('app')! });
  await refreshShelves();
  await refreshLibrary();
}

void boot();
