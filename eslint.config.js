import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { ratchetBase, ratchetOverrides } from './eslint.ratchet.mjs'
import { importZones } from './eslint.zones.mjs'
import namesPlugin from './eslint.names.mjs'
import dexPlugin from './eslint.dex.mjs'
import prosePlugin from './eslint.prose.mjs'
import commentsPlugin from './eslint.comments.mjs'
import testsPlugin from './eslint.tests.mjs'

export default defineConfig([
  // docs/ and .claude/ are local and gitignored: CI never sees them, so a local lint must not read them.
  globalIgnores(['dist', 'packages/*/dist', '.remember', 'docs', '.claude']),
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
  ...ratchetBase,
  ...ratchetOverrides,
  ...importZones,
  {
    files: ['packages/*/src/**/*.ts'],
    plugins: { names: namesPlugin },
    rules: { 'names/no-new-dex-name': 'error' },
  },
  {
    files: ['packages/replay-core/src/**/*.ts', 'packages/eval-engine/src/**/*.ts', 'src/**/*.{ts,tsx}'],
    ignores: ['packages/replay-core/src/rules-dex.ts'],
    plugins: { dex: dexPlugin },
    rules: { 'dex/no-global-dex-read': 'error' },
  },
  {
    files: ['**/*.{ts,tsx,mjs,js,cjs}'],
    ignores: ['test/regression/eval-calibration.spec.ts'],
    plugins: { comments: commentsPlugin },
    rules: { 'comments/no-history': 'error', 'comments/shape': ['error', { localDoc: 'forbid' }] },
  },
  {
    files: ['test/**/*.{ts,tsx}', 'packages/*/test/**/*.ts'],
    plugins: { tests: testsPlugin },
    rules: { 'tests/no-history': 'error' },
  },
  {
    files: [
      'packages/eval-engine/src/prose/{clauses,phrases,line}.ts',
      'packages/eval-engine/src/{summary,report,win-reason,denied-end,biggest-roll,standoff}.ts',
    ],
    plugins: { prose: prosePlugin },
    rules: { 'prose/no-dash': 'error' },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    plugins: { prose: prosePlugin },
    rules: { 'prose/no-dash': ['error', { emptyValue: true }] },
  },
])
