import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { ratchetBase, ratchetOverrides } from './eslint.ratchet.mjs'

export default defineConfig([
  globalIgnores(['dist', '.remember']),
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
])
