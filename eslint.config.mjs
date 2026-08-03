import js from '@eslint/js';
import next from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'vendor/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // vendor/@jrm/tokens is generated + synced; never linted or edited here.
    plugins: { '@next/next': next },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
    },
  },
);
