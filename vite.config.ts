import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Copy index.html to 404.html so GitHub Pages serves the SPA for deep links.
function spa404() {
  return {
    name: 'spa-404',
    closeBundle() {
      const index = resolve('dist', 'index.html')
      if (existsSync(index)) copyFileSync(index, resolve('dist', '404.html'))
    },
  }
}

// Deploy base: '/' for a custom domain served at root. Use '/cartridge/' to serve
// from the github.io project URL instead.
const base = '/'

export default defineConfig({
  base,
  resolve: {
    alias: {
      // Design tokens are vendored (registry-free) from jrmoulckers/studio — see
      // vendor/@jrm/tokens/README.md. The alias keeps imports package-shaped so
      // swapping to the published npm package later is a one-line change.
      '@jrm/tokens': resolve('vendor/@jrm/tokens'),
    },
  },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        id: base,
        name: 'Cartridge',
        short_name: 'Cartridge',
        description: 'Track the games you play, have played, and want to play.',
        lang: 'en',
        dir: 'ltr',
        categories: ['games', 'entertainment', 'productivity'],
        theme_color: '#7c5cff',
        background_color: '#0f1020',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: `${base}index.html`,
      },
    }),
    spa404(),
  ],
})
