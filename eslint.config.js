import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { ratchetBase, ratchetOverrides } from './eslint.ratchet.mjs'
import { importZones } from './eslint.zones.mjs'
import namesPlugin from './eslint.names.mjs'

export default defineConfig([
  // docs/ holds Markdown and the local, gitignored probes (copies of old sources among them): CI never sees them,
  // and a local `npm run lint` must read only what CI reads.
  globalIgnores(['dist', 'packages/*/dist', '.remember', 'docs']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // Size and complexity ceilings: targets for everyone, then the generated
  // shrink-only pins for legacy files (see scripts/update-lint-ratchet.mjs).
  ...ratchetBase,
  ...ratchetOverrides,
  // Import zones: the package layering as lint errors (see eslint.zones.mjs).
  ...importZones,
  // Name ratchet: no new Dex name literal in the package sources (see eslint.names.mjs and scripts/name-baseline.json).
  {
    files: ['packages/*/src/**/*.ts'],
    plugins: { names: namesPlugin },
    rules: { 'names/no-new-dex-name': 'error' },
  },
])
