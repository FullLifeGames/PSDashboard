# Next Steps (as of 31.10.2026, after round 81)

Open work only. Each step is one round; its TODOs carry fixed T-numbers, and their details are in `docs/backlog.md`. Rules for agents: `AGENTS.md`. Finished rounds: `docs/completed/`. Next free T-number: T299.

## State

Release v1.0.2 (30.10.2026) is on master, on GitHub Pages with the frozen copies `/v1.0.0/` to `/v1.0.2/`, on npm with both packages, and in production on fulllifegames.com. dev carries T298 (round 81: after a deploy the app reloads once when a lazy chunk is gone) for the next release. master moves only with the user's okay.

## Next rounds

No round is open. Bug reports from real use and the dependency upkeep of AGENTS.md bring the next one, and a parked TODO whose trigger fires comes to a gate.

## Parked

The TODOs in the backlog's section "Parked" wait for their trigger. The Showdown Companion is its own project after the release (user gate 21.10.2026).

## Known drifts

- smogtours-gen8ou-562428 t10 and t12: expert pins in known drift. t10 still misses the Heatran read; t12 reads LordEnz's Close Combat as a shift, not as a read that paid off.
- smogtours-gen8ou-573756 t73: the gap pin reads open. The Fire Fang miss is a key moment, and the verify scene reads Body Press without a tier, as the Monte-Carlo reference does (a margin of 0.004 to the decided line).
- The golden 655336 stays in known drift. The tiers of VGC 2629703929 turn 8 expect the reference and fail until T242. The draft t56 play-out pin is armed.

## Upstream list for the user

- `@smogon/calc` 0.12 sets the spread target and the 0.75 cut for Expanding Force in Psychic Terrain and for Tera Starstorm against a lone foe (T202).
- `@smogon/calc` 0.12 has no flag for Mud Sport, Water Sport or Ion Deluge, which change a damage roll in Generations 3 to 8.
- `@smogon/calc` 0.12 prices Rage Fist at its base power of 50 whatever the hits taken, and its `Pokemon` has no option for hits taken; Last Respects has the same gap for the faints so far (T265; scene: Annihilape in gen9championsou-2691703002 turn 7 after four hits, 250 in the game).
- `@smogon/calc` 0.12 lists Obliteryx with a Special Defense of 90, where `@pkmn/dex` 0.10.12 has 78, and Shox as Electric/Normal, where the Dex has Normal/Electric. The calculator body takes the Dex values (`speciesOverrides` in `packages/replay-core/src/calc-build.ts`, swept by `calc-dex-values.spec.ts`).
- `@pkmn/client` 0.7.4 books the generic Z-move or Max-move name as a revealed move slot (`Pokemon.useMove`, `build/index.js:1291-1307`; smogtours-gen7ou-450650 p2 Garchomp `['devastatingdrake']`, smogtours-gen8ubers-486661 `['earthquake', 'maxquake']`); check play.pokemonshowdown.com's own tooltip before a report. Its `getPressurePP` and the `types` getter throw when the generation does not know the species (no null check, T188). Draft of the client report: `docs/perf/probes/2026-10-10-r67/gate/upstream-issues-draft.md`.
- `@smogon/calc` 0.12 lets Unseen Fist hit through Protect at a quarter in Gen 7 to 9, the Champions reading, where Scarlet/Violet hits in full; a report as a mode question waits for the user (draft `docs/perf/probes/2026-10-12-r68/steps/upstream-calc-draft.md`).
- `@pkmn/sim` 0.10.12 gives the Mega-Z formes no Mega flag (`dex-species.mjs:49` counts Mega, Mega-X and Mega-Y; Showdown's own source at b354a81f reads `forme.includes('Mega')`).
- Showdown's `replay-embed.js` appends its sixteen scripts without `async = false`, so they run in the order they arrive. When jQuery comes after `data/graphics.js`, `Object.assign($.easing, …)` throws "$ is not defined" and the replay never builds; holding jQuery back reproduces it (`test/e2e/replay-sprites.spec.ts`). The dashboard's frame document orders the scripts itself (`EMBED_SCRIPT_ORDER_SCRIPT` in `src/lib/replay-compat.ts`).
- `@pkmn/smogon` 0.6.1 keeps a sets file in `Smogon.get` only once its response arrived, so concurrent `sets()` calls of one format fetch it once per call (a VGC 2026 team asked twelve times for the missing `sets/gen9vgc2026.json`). The app shares one fetch per file (`keepingSetsFiles` in `src/lib/smogon-sets.ts`).
