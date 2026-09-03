import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

// Kept isolated from vite.config.ts on purpose: no PWA/service-worker build here.
// The Svelte plugin plus a jsdom environment lets modules that touch the DOM (or
// re-export from a `.svelte` file) be imported directly in tests.
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
    alias: { '@jrm/tokens': resolve('vendor/@jrm/tokens') },
  },
  test: {
    include: ['src/**/*.{test,spec}.ts', 'bridge/src/**/*.{test,spec}.ts'],
    environment: 'jsdom',
  },
});
