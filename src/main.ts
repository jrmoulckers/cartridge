import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { applySettings } from './lib/stores/settings';
import { initPWA } from './lib/stores/pwa';
import { refreshLibrary } from './lib/stores/library';
import { refreshShelves } from './lib/stores/shelves';
import { registerConnector } from './lib/connectors/registry';
import { steamConnector } from './lib/connectors/steam';
import { xboxConnector } from './lib/connectors/xbox';
import { refreshConnections } from './lib/stores/connectors';

/**
 * Boot.
 *
 * Nothing here talks to the network. Appearance is applied, the service worker is wired,
 * the app mounts, and the library loads from IndexedDB — an install with no connectors and
 * no connectivity reaches a usable Library screen by exactly this path.
 *
 * Registering a connector is inert: it puts an object in a map. Steam is only contacted when
 * someone presses a button, so an offline boot never notices it exists.
 */
async function boot() {
  applySettings();
  initPWA();
  registerConnector(steamConnector);
  registerConnector(xboxConnector);
  mount(App, { target: document.getElementById('app')! });
  await refreshShelves();
  await refreshLibrary();
  await refreshConnections();
}

void boot();
