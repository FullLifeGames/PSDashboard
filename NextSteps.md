# Next Steps (as of 22.10.2026, after round 73)

Open work only, along the finish line. Each step is one round; its TODOs carry fixed T-numbers, and their scenes, numbers and steps are in `docs/backlog.md`. Rules for agents: `AGENTS.md`. Finished rounds: `docs/completed/`. Next free T-number: T264.

## Finish line

The goal is a release: v1 onto master and the GitHub Pages site built from it (user 21.10.2026). The way there, in this order: wave 5, T163, T160, one last wave with the rest a user sees, then the release. After the release only bug reports from real use add work. master moves at the release only, and only with the user's okay.

## Next rounds

Wave 5 is booked (round 73, user gate 22.10.2026). The way on:

1. **Leaf K per family (T163) with the matchup weights (T263).** Both fit on one new capture with search root values. Doubles OU, VGC and Champions OU each get a K fitted on the search's own root values instead of one doubles K, and the matchup weight is fitted again for the winner-share pair value of T248. Success: bank plus holdout reads the doubles row better, with no warning; each weight by a rule set before the fit.
2. **Champions rules from the battle's Dex (T160).** 62 code paths still read rules from the global Dex, and in Champions some of them read the Scarlet/Violet rule. Success: every path reads the battle's Dex or is shown to be format-free.
3. **The last wave:** the rest a user sees.
   - T233: cards that lose their read; a game report that quotes the odds of a stopped hit.
   - T234: the team editor and early exports keep the inference.
   - T244: a cheap hazard sack read as a blunder in 655336 turn 25.
   - T243 with T258: the draft t56 play-out (p2 wins 13 of 16 dice), and the healer race against Shore Up.
   - T259: the last HP jump of the bar above 1e-3 (Champions VGC 2634199230 turn 5).
   - T260: a kill the log does not show, which ends a branch early.
   - T261: a Taunt from a `-start` line ticks once too long.
   - T262: VGC tree time +9.1 % after wave 5.
4. **The release:** T43 (the release check), then v1 onto master and the Pages site after the user's okay.

Two proposals wait for the user's approval at the next gate:
- The key moments of 573756 turn 73: the Fire Fang miss that stopped a direct win left the top four after two game-correct changes (`docs/perf/probes/2026-10-21-r73/lanes/D/diagnosis.md`). The proposal: the list keeps its top four and adds every visible dice turn whose luck ran against the winner.
- Rage Fist in the damage preview: `CALC_LACKS_POWER` in `calc/move.ts` holds Last Respects alone, so the preview prices Rage Fist at its base power after the user took hits.

## Parked

The TODOs in the backlog's section "Parked" wait for their trigger; a trigger that fires brings its TODO to a gate. After the release the Showdown Companion is its own project (user gate 21.10.2026, "3b").

## Known drifts and upstream

- The expert pins smogtours-gen8ou-562428 t10 and t12 stay known drift. For t10, T218 removed the false Pain Split mistake in round 70, and the Heatran read is still missing. t12 has drifted since T249 in round 73: LordEnz's Close Combat reads as a shift, not as a read that paid off (user gate 22.10.2026). smogtours-gen6ou-653785 t19 is green again since round 70; T219 is parked.
- The gap pin smogtours-gen8ou-573756 t73 is watched (user gate 22.10.2026, "2a"). Its turn left the key moments in round 73, and its verify scene now grades Body Press an inaccuracy, as the fresh Monte-Carlo reference does.
- The draft t56 play-out pin is `test.fixme` until T243; the golden 655336 drifts in 11 channels (T244). The tiers of VGC 2629703929 turn 8 expect the reference and fail until T242.
- Upstream list for the user:
  - `@smogon/calc` 0.12 sets the spread target and the 0.75 cut for Expanding Force in Psychic Terrain and for Tera Starstorm against a lone foe (T202).
  - `@smogon/calc` 0.12 has no flag for Mud Sport, Water Sport or Ion Deluge, which change a damage roll in Generations 3 to 8 (round 72).
  - `@pkmn/client` 0.7.3 books a Z-move or Max-move name as a move of the set (library bugs, point 6, in the watch list of `docs/backlog.md`).
