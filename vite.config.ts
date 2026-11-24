import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Packages resolve to their sources, never their dist/: one module graph for dev, HMR and the build.
const workspaceSource = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

const appVersion: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const appCommit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
})()

// The folders below hold over 60,000 files on devbox and exhausted inotify (ENOSPC); none holds an imported module.
// vite-watch-ignore.spec.ts holds the list.
const rootDir = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '')
const unwatchedFolders = ['.calibration', '.claude', '.fit-corpus', '.playwright-mcp', '.smogon-cache', 'docs']

export default defineConfig({
  plugins: [react(), tailwindcss()],

  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_APP_COMMIT': JSON.stringify(appCommit),
  },

  base: "./",

  server: {
    watch: { ignored: unwatchedFolders.map(folder => `${rootDir}/${folder}/**`) },
  },

  resolve: {
    alias: {
      '@fulllifegames/replay-core': workspaceSource('replay-core'),
      '@fulllifegames/eval-engine': workspaceSource('eval-engine'),
    },
  },

  // keepNames: @pkmn/sim's serializer rebuilds classes by constructor name (sim/state.mjs), so minified names break
  // deserialize in the eval workers; the worker bundle is configured separately and needs it too.
  build: {
    rolldownOptions: { output: { keepNames: true } },
  },
  // Pre-bundled so a lazy import found mid-session does not make Vite reload the page and abort a running e2e test.
  optimizeDeps: {
    include: ['@pkmn/client', '@pkmn/data', '@pkmn/dex', '@pkmn/mods/champions', '@pkmn/protocol', '@pkmn/sim', '@pkmn/smogon', '@smogon/calc'],
  },
  // ES-module workers let the build code-split; as iife every dynamic import is inlined into the eval pool's script.
  worker: {
    format: 'es',
    rolldownOptions: { output: { keepNames: true } },
  },
})
