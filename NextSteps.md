# Next Steps (as of 29.10.2026, after the release of 1.0.1)

Open work only, along the finish line. Each step is one round; its TODOs carry fixed T-numbers, and their scenes, numbers and steps are in `docs/backlog.md`. Rules for agents: `AGENTS.md`. Finished rounds: `docs/completed/`. Next free T-number: T282.

## Finish line

The release is out: v1.0.1 since 29.10.2026, after v1.0.0 the same morning, on master with the Pages site and the frozen copies `/v1.0.0/` and `/v1.0.1/`, both packages on npm, and the production copy on fulllifegames.com. The way there ran through wave 5, T163, T160, one last wave and round 77 (user 21.10.2026). From here only bug reports from real use add work, plus the dependency upkeep of AGENTS.md. master moves only with the user's okay.

## Next rounds

Wave 5 (round 73), T163 with T263 (round 74), T160 (round 75) and the last wave (round 76) are booked. The last wave closed T233, T234, T243, T244, T258, T260, T261, T262, T264, T265 and T266; T259 went back and waits parked (user gate 24.10.2026). Round 77 is booked (release gate 29.10.2026, "1a 2a 3a 4a 5a 6a 7a 8b"): the user's reports A to J, the report dialog, the engine protocol, the branching swarm with its two fix waves, and T267; T268 to T276 wait parked. The release of 1.0.0 followed on 29.10. (T43 closed): master by fast-forward with the link preview, the tag and both packages through `release.yml`, then `deploy.ps1` for production. Round 78 is booked (user gate 29.10.2026, 15:15, "1a 2a 3b 4a"): the @pkmn train 0.10.12 (Showdown b354a81f) with client and protocol 0.7.4 and smogon 0.6.1, the rest of `npm outdated`, the corrected Gen 1 to 4 entry, the Dex values in the calculator body and the Pages build started by `release.yml`; T103 stays parked, T277 to T279 wait parked. The release of 1.0.1 followed the same evening (user gates 17:29 to 18:40): the README picture cropped to the app, the package manifests on the release version, and T280, the branch replay's browser flow, which now reads the log once the frame has played to its end. master moved by fast-forward to 84bef28, `release.yml` set the tag, published both packages and started the Pages build, and `deploy.ps1` moved production. After the release T281 steadied the play controls flow of the branch replay the same way (user 20:35, "1a"); it waits on dev for the next release. No round is open.

## Parked

The TODOs in the backlog's section "Parked" wait for their trigger; a trigger that fires brings its TODO to a gate. After the release the Showdown Companion is its own project (user gate 21.10.2026, "3b").

## Known drifts and upstream

- The expert pins smogtours-gen8ou-562428 t10 and t12 stay known drift. For t10, T218 removed the false Pain Split mistake in round 70, and the Heatran read is still missing. t12 has drifted since T249 in round 73: LordEnz's Close Combat reads as a shift, not as a read that paid off (user gate 22.10.2026). smogtours-gen6ou-653785 t19 is green again since round 70; T219 is parked.
- The gap pin smogtours-gen8ou-573756 t73 reads open again since round 76: T264 brings the Fire Fang miss back to the key moments, and the verify scene reads Body Press without a tier, as the fresh Monte-Carlo reference does (a margin of 0.004 to the decided line).
- The draft t56 play-out pin is armed again since round 76 (T243 with T258). The golden 655336 stays known drift; its turn-25 channel is gone (T244). The tiers of VGC 2629703929 turn 8 expect the reference and fail until T242.
- Upstream list for the user:
  - `@smogon/calc` 0.12 sets the spread target and the 0.75 cut for Expanding Force in Psychic Terrain and for Tera Starstorm against a lone foe (T202).
  - `@smogon/calc` 0.12 has no flag for Mud Sport, Water Sport or Ion Deluge, which change a damage roll in Generations 3 to 8 (round 72).
  - `@smogon/calc` 0.12 prices Rage Fist at its base power of 50 whatever the hits taken, and its `Pokemon` has no option for hits taken; Last Respects has the same gap for the faints so far (T265; scene: Annihilape in gen9championsou-2691703002 turn 7 after four hits, 250 in the game).
  - `@pkmn/client` 0.7.3 and 0.7.4 book a Z-move or Max-move name as a move of the set (library bugs, point 6, in the watch list of `docs/backlog.md`).
  - `@smogon/calc` 0.12 lists Obliteryx with a Special Defense of 90, where Obliteryx 2.0 of `@pkmn/dex` 0.10.12 has 78, and Shox with its types as Electric/Normal, where the Dex has Normal/Electric. Since round 78 the calculator body takes the Dex values (`speciesOverrides` in `packages/replay-core/src/calc-build.ts`, swept by `calc-dex-values.spec.ts`).
  - `@pkmn/sim` 0.10.12 still gives the Mega-Z formes no Mega flag (`dex-species.mjs:49` counts Mega, Mega-X and Mega-Y; Showdown's own source at b354a81f reads `forme.includes('Mega')`): the sync of 0.10.12 did not bring Showdown's fix, so it needs a report (library bugs, point 4).
  - Showdown's `replay-embed.js` appends its sixteen scripts as dynamic scripts without `async = false`, so they run in the order they arrive. When jQuery comes after `data/graphics.js`, `Object.assign($.easing, …)` (line 2940 of `graphics.js?a7`) throws "$ is not defined", `BattleBackdrops` stays undefined and the replay never builds. Scene: a cold first load of any replay; holding jQuery back reproduces it every time (`test/e2e/replay-sprites.spec.ts`). Since round 77 the dashboard's frame document orders the scripts itself (`EMBED_SCRIPT_ORDER_SCRIPT` in `src/lib/replay-compat.ts`).
  - `@pkmn/smogon` 0.6.0 and 0.6.1 keep a sets file in `Smogon.get` only once its response arrived, so concurrent `sets()` calls of one format fetch it once per call: a VGC 2026 team asked twelve times for the missing `sets/gen9vgc2026.json`. Since round 77 the app shares one fetch per file (`keepingSetsFiles` in `src/lib/smogon-sets.ts`).
