import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** The workspace packages resolve to their sources (one module graph for dev, HMR and the build); the built dist/ is for consumers only. */
const workspaceSource = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

/** The version and commit a bug report names (src/lib/app-version.ts). */
const appVersion: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const appCommit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
})()

/**
 * The dev server watches the repository root. On devbox the local folders below hold more than 60,000 files and used up the inotify
 * budget (`ENOSPC`). None of them holds a module the app imports; tracked root files (README.md, index.html, the configs) stay watched.
 * test/regression/vite-watch-ignore.spec.ts holds the list.
 */
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

  /**
   * @pkmn/sim's battle serializer encodes every object reference as `[${obj.constructor.name}:id]` (sim/state.mjs) and rebuilds the
   * classes from those names on deserialize. Minified class names ("Pokemon" to "t") round-trip into objects that are no longer
   * Pokemon/Side instances, and the first method call on one throws ("e?.getMoveRequestData is not a function"). Inside the eval
   * workers the sweep swallowed that as a per-turn gap, so every turn failed and the game graph came out empty. Dev is unminified, so
   * only the build breaks. Both bundles need it: the main thread serializes the position and the worker deserializes it, and the
   * worker bundle is configured separately from the app bundle.
   */
  build: {
    rolldownOptions: { output: { keepNames: true } },
  },
  /**
   * Pre-bundle every package the app reaches through a lazy import (the protocol parser, move pools, branch engine, damage calc).
   * Discovered on first use, Vite bundles them mid-session and reloads the page, which tears apart the dynamic import of whichever e2e
   * test runs at that moment ("Failed to fetch dynamically imported module").
   */
  optimizeDeps: {
    // The Champions mod loads on the first Champions replay; pre-bundled here so the dev server does not re-optimize and reload the
    // page in the middle of a run.
    include: ['@pkmn/client', '@pkmn/data', '@pkmn/dex', '@pkmn/mods/champions', '@pkmn/protocol', '@pkmn/sim', '@pkmn/smogon', '@smogon/calc'],
  },
  /**
   * ES-module workers so the worker build can code-split: the replay jobs (spread solve, reconstruction) reach replay-core's team
   * builder and with it the standalone dex plus the learnsets. As an iife every dynamic import is inlined and the eval pool's script
   * grows from 7 to 12 MB, parsed by every one of the 12 evaluation workers. As ES modules the replay handlers become a chunk only the
   * replay worker instance loads.
   */
  worker: {
    format: 'es',
    rolldownOptions: { output: { keepNames: true } },
  },
})
