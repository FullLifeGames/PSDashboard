# Next Steps (as of 21.10.2026, after round 72 and the triage)

Open work only, along the finish line. Each step is one round; its TODOs carry fixed T-numbers, and their scenes, numbers and steps are in `docs/backlog.md`. Rules for agents: `AGENTS.md`. Finished rounds: `docs/completed/`. Next free T-number: T258.

## Finish line

The goal is a release: v1 onto master and the GitHub Pages site built from it (user 21.10.2026). The way there, in this order: wave 5, T163, T160, one last wave with the rest a user sees, then the release. After the release only bug reports from real use add work. master moves at the release only, and only with the user's okay.

## Next rounds

The triage of 21.10.2026 (user gate "1a 2a 3b") kept 21 TODOs, each with a scene a user sees; 28 are parked with a trigger in `docs/backlog.md`, and 3 closed (`docs/completed/triage.md`).

1. **Wave 5 · the static, the rebuild and the solver.** Three lanes that share no file (the booking gate of round 72 chose four with "3b", the triage kept three with "2a"); its own gate over the open decisions of its design comes first, and it measures in CI (`node scripts/bank-ci.mjs`).
   - F · Static evaluation: T224 (the re-fit of `boostsBiting`), T225 (the front gate's bench credit), T248 (17 HP-monotony breaks), T249 (a stage on a body that cannot act first), then T243 (the draft t56 play-out). The relation specs of round 72 are the red tests.
   - H · Rebuild fidelity: T250 (phantom bodies in short VGC games), T212 (start volatiles such as Salt Cure), T214 (a Sitrus Berry the game keeps), T232 (the logged roll of every unchanged action in a branch's first turn).
   - I · Spread solver and hits: T202 (Expanding Force and Tera Starstorm), T203 (a partner's field ability), T204 (the Choice check reads the field of the hit), T210 (move powers from the battle history), T229 (Z-move and Max-move hits), T230 (Illusion in the nickname lookup).

   Success: each TODO's own line; bank plus holdout (D26) without harm, with Doubles OU, VGC and the Champions families counted on their own.
2. **Leaf K per family (T163)**, right after wave 5, since it fits K on the search's root values, which lane F changes. Doubles OU, VGC and Champions OU each get a K fitted on the search's own root values instead of one doubles K. Success: bank plus holdout reads the doubles row better, with no warning.
3. **Champions rules from the battle's Dex (T160).** 62 code paths still read rules from the global Dex, and in Champions some of them read the Scarlet/Violet rule. Success: every path reads the battle's Dex or is shown to be format-free.
4. **The last wave:** T233 (cards that lose their read, a game report that quotes the odds of a stopped hit), T234 (the team editor and early exports keep the inference), T244 (a cheap hazard sack read as a blunder in 655336 turn 25).
5. **The release:** T43 (the release check), then v1 onto master and the Pages site after the user's okay.

## Parked

28 TODOs wait for their trigger in `docs/backlog.md` (section "Parked"); a trigger that fires brings its TODO to a gate. After the release the Showdown Companion is its own project (user gate 21.10.2026, "3b").

## Known drifts and upstream

- The expert pin smogtours-gen8ou-562428 t10 stays known drift: T218 removed the false Pain Split mistake in round 70, and the Heatran read is still missing. smogtours-gen6ou-653785 t19 is green again since round 70; T219 is parked.
- The draft t56 play-out pin is `test.fixme` until T243 (user gate 17.10.2026, "2a"); the golden 655336 drifts in 11 channels (T244).
- Upstream list for the user: `@smogon/calc` 0.12 sets the spread target and the 0.75 cut for Expanding Force in Psychic Terrain and for Tera Starstorm against a lone foe (T202), and it has no flag for Mud Sport, Water Sport or Ion Deluge, which change a damage roll in Generations 3 to 8 (round 72); `@pkmn/client` 0.7.3 books a Z-move or Max-move name as a move of the set (library bugs, point 6, in the watch list of `docs/backlog.md`).
