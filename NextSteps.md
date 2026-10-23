# Next Steps (as of 23.10.2026, after round 74)

Open work only, along the finish line. Each step is one round; its TODOs carry fixed T-numbers, and their scenes, numbers and steps are in `docs/backlog.md`. Rules for agents: `AGENTS.md`. Finished rounds: `docs/completed/`. Next free T-number: T267.

## Finish line

The goal is a release: v1 onto master and the GitHub Pages site built from it (user 21.10.2026). The way there, in this order: wave 5, T163, T160, one last wave with the rest a user sees, then the release. After the release only bug reports from real use add work. master moves at the release only, and only with the user's okay.

## Next rounds

Wave 5 (round 73) and T163 with T263 (round 74) are booked. Round 74 fitted a leaf K per family and the matchup weights on the search's own values, and the bank and the holdouts adopted none (user gate 23.10.2026). The way on:

1. **Champions rules from the battle's Dex (T160).** 62 code paths still read rules from the global Dex, and in Champions some of them read the Scarlet/Violet rule. Success: every path reads the battle's Dex or is shown to be format-free.
2. **The last wave:** the rest a user sees.
   - T233 with T264: cards that lose their read; a game report that quotes the odds of a stopped hit; a dice turn against the winner joins the key moments (573756 turn 73).
   - T234: the team editor and early exports keep the inference.
   - T244: a cheap hazard sack read as a blunder in 655336 turn 25.
   - T243 with T258: the draft t56 play-out (p2 wins 13 of 16 dice), and the healer race against Shore Up.
   - T259: the last HP jump of the bar above 1e-3 (Champions VGC 2634199230 turn 5).
   - T260: a kill the log does not show, which ends a branch early.
   - T261: a Taunt from a `-start` line ticks once too long.
   - T262: VGC tree time +9.1 % after wave 5.
   - T265: Rage Fist after hits taken, in the kill table, the card odds and the static.
   - T266: the bank in CI comes back without hand work after a hung run or an ended watcher, on a pinned runner image.
3. **The release:** T43 (the release check), then v1 onto master and the Pages site after the user's okay.

## Parked

The TODOs in the backlog's section "Parked" wait for their trigger; a trigger that fires brings its TODO to a gate. After the release the Showdown Companion is its own project (user gate 21.10.2026, "3b").

## Known drifts and upstream

- The expert pins smogtours-gen8ou-562428 t10 and t12 stay known drift. For t10, T218 removed the false Pain Split mistake in round 70, and the Heatran read is still missing. t12 has drifted since T249 in round 73: LordEnz's Close Combat reads as a shift, not as a read that paid off (user gate 22.10.2026). smogtours-gen6ou-653785 t19 is green again since round 70; T219 is parked.
- The gap pin smogtours-gen8ou-573756 t73 is watched (user gate 22.10.2026, "2a"). Its turn left the key moments in round 73, and its verify scene now grades Body Press an inaccuracy, as the fresh Monte-Carlo reference does. T264 brings the turn back to the key moments in the last wave.
- The draft t56 play-out pin is `test.fixme` until T243; the golden 655336 drifts in 11 channels (T244). The tiers of VGC 2629703929 turn 8 expect the reference and fail until T242.
- Upstream list for the user:
  - `@smogon/calc` 0.12 sets the spread target and the 0.75 cut for Expanding Force in Psychic Terrain and for Tera Starstorm against a lone foe (T202).
  - `@smogon/calc` 0.12 has no flag for Mud Sport, Water Sport or Ion Deluge, which change a damage roll in Generations 3 to 8 (round 72).
  - `@smogon/calc` 0.12 prices Rage Fist at its base power of 50 whatever the hits taken (T265).
  - `@pkmn/client` 0.7.3 books a Z-move or Max-move name as a move of the set (library bugs, point 6, in the watch list of `docs/backlog.md`).
