# Next Steps (as of 24.10.2026, after round 76)

Open work only, along the finish line. Each step is one round; its TODOs carry fixed T-numbers, and their scenes, numbers and steps are in `docs/backlog.md`. Rules for agents: `AGENTS.md`. Finished rounds: `docs/completed/`. Next free T-number: T267.

## Finish line

The goal is a release: v1 onto master and the GitHub Pages site built from it (user 21.10.2026). The way there, in this order: wave 5, T163, T160, one last wave with the rest a user sees, then the release. After the release only bug reports from real use add work. master moves at the release only, and only with the user's okay.

## Next rounds

Wave 5 (round 73), T163 with T263 (round 74), T160 (round 75) and the last wave (round 76) are booked. The last wave closed T233, T234, T243, T244, T258, T260, T261, T262, T264, T265 and T266; T259 went back and waits parked (user gate 24.10.2026). The way on:

1. **The release:** T43 (the release check, the package versions and a note on the changed APIs), then v1 onto master and the Pages site after the user's okay.

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
  - `@pkmn/client` 0.7.3 books a Z-move or Max-move name as a move of the set (library bugs, point 6, in the watch list of `docs/backlog.md`).
