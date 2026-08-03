/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * Default metadata bridge URL, baked in at build time. Optional: with no bridge the app
   * is fully functional, just with more typing. A per-device Settings value overrides it.
   */
  readonly VITE_BRIDGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
