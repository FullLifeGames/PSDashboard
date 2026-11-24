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
  // docs/ holds Markdown and the local, gitignored probes (copies of old sources among them), and .claude/ holds the local agent
  // worktrees (foreign checkouts with their own tsconfigs) beside Markdown role files: CI never sees them,
  // and a local `npm run lint` must read only what CI reads.
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
  // Dex reads: replay-core, eval-engine and the app read rules through the resolver of generation and mod, never the global Dex (see eslint.dex.mjs).
  {
    files: ['packages/replay-core/src/**/*.ts', 'packages/eval-engine/src/**/*.ts', 'src/**/*.{ts,tsx}'],
    ignores: ['packages/replay-core/src/rules-dex.ts'],
    plugins: { dex: dexPlugin },
    rules: { 'dex/no-global-dex-read': 'error' },
  },
  // History in comments: counted per file against comment-ratchet.json, which only falls (see eslint.comments.mjs).
  {
    files: ['packages/*/src/**/*.ts', 'src/**/*.{ts,tsx}'],
    plugins: { comments: commentsPlugin },
    rules: { 'comments/no-history': 'error' },
  },
  // History in test titles and spec file names (see eslint.tests.mjs).
  {
    files: ['test/**/*.{ts,tsx}', 'packages/*/test/**/*.ts'],
    plugins: { tests: testsPlugin },
    rules: { 'tests/no-history': 'error' },
  },
  // Dash rule: the report's prose sources and every label of src/components carry no em or en dash (see eslint.prose.mjs).
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
