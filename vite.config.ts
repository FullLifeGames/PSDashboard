import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  base: "./",

  /**
   * @pkmn/sim's battle serializer encodes every object reference as
   * `[${obj.constructor.name}:id]` (sim/state.mjs) and rebuilds the classes
   * from those names on deserialize. Minified class names ("Pokemon" → "t")
   * therefore round-trip into objects that are no longer Pokemon/Side
   * instances, and the first method call on one throws ("e?.getMoveRequest
   * Data is not a function"). That happened inside the eval workers, where
   * the sweep swallowed it as a per-turn gap — every turn failed and the
   * game graph came out EMPTY (reported 2026-08-12). Dev is unminified, so
   * only the BUILD broke.
   *
   * Both bundles need it: the main thread serializes the position and the
   * worker deserializes it, so the two must agree on class names — the
   * worker bundle is configured separately from the app bundle.
   */
  build: {
    rolldownOptions: { output: { keepNames: true } },
  },
  /**
   * Pre-bundle every package the app reaches through a lazy import (the
   * protocol parser, move pools, branch engine, damage calc). Discovered
   * on first use instead, Vite bundled them mid-session and reloaded the
   * page, which tore apart the dynamic import of whichever e2e test was
   * running at that moment ("Failed to fetch dynamically imported module").
   */
  optimizeDeps: {
    include: ['@pkmn/client', '@pkmn/data', '@pkmn/dex', '@pkmn/sim', '@pkmn/smogon', '@smogon/calc'],
  },
  worker: {
    rolldownOptions: { output: { keepNames: true } },
  },
})
