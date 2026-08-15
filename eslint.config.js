import { svelteConfig } from '@jrmoulckers/eslint-config/svelte';

export default svelteConfig({
  ignores: ['dev-dist/**', 'bridge/node_modules/**'],
});
