# Next Steps (as of 21.10.2026, after round 72)

Open work only, as packages. A package is one round; its TODOs carry fixed T-numbers, and their scenes, numbers and steps are in `docs/backlog.md`. Rules for agents: `AGENTS.md`. Finished rounds: `docs/completed/`. Next free T-number: T258.

## Finish line

The goal is a release: v1 onto master and the GitHub Pages site built from it (user 21.10.2026). The way there, in this order: wave 5, T163, T160, one last wave with the rest a user sees, then the release. After the release only bug reports from real use add work. master moves at the release only, and only with the user's okay.

## Next rounds

1. **Wave 5 · The static, the feedback corpus in CI, the rebuild and the solver** (user gate 21.10.2026, "3b"). Four lanes that share no file; its own gate over the open decisions of its design comes first, and it measures in CI (`node scripts/bank-ci.mjs`).
   - F · Static evaluation: T224 (the re-fit of `boostsBiting`), T248 (17 HP-monotony breaks), T249 (a stage on a body that cannot act first), then T243 (the draft t56 play-out). The relation specs of round 72 are the red tests.
   - G · The feedback corpus in CI (T247), like the bank.
   - H · Rebuild fidelity: T250 (the bring restriction in short VGC games) with package D (T212, T213, T214, T232, T245).
   - I · Spread solver and hits: package C (T202, T203, T204, T207 to T210, T228 to T231).
   - The small fixes T251, T252 and T255 go into G or H.

   Success: each TODO's own line; bank plus holdout (D26) without harm, with Doubles OU, VGC and the Champions families counted on their own.
2. **Leaf K per family (T163)**, right after wave 5, since it fits K on the search's root values, which lane F changes. Doubles OU, VGC and Champions OU each get a K fitted on the search's own root values instead of one doubles K. Success: bank plus holdout reads the doubles row better, with no warning.
3. **Champions rules from the battle's Dex (T160).** 62 code paths still read rules from the global Dex, and in Champions some of them read the Scarlet/Violet rule. Success: every path reads the battle's Dex or is shown to be format-free.
4. **The last wave:** the rest a user sees, as the triage keeps it.
5. **The release:** v1 onto master and the Pages site, after the user's okay.

## Packages

Each package is one round; the order is open. Wave 5 takes packages C and D whole, T224, T243, T248 and T249 from B, T247 from F, and the small fixes T251, T252 and T255.

- **A · Doubles search and verify rows** (T194, T195, T219, T198, T227, T242, T253): the answer round prices one column three ways and its doubles verdicts rest on ties; the verify round re-prices different rows from run to run; Fickle Beam scripting should come from the simulator; the trend probe should cost less; since the Protect tempo a VGC verdict (2629703929 turn 8) is softer than the Monte-Carlo reference's; Quick Claw, Quick Draw and Custap Berry change a move order the tree meets through the seed alone.
- **B · Static evaluation repairs** (T199, T201, T224, T225, T226, T243, T248, T249): pairFocus as a ramp so it can carry a weight again, a capture that records its own model form, the re-fit of `boostsBiting` on its round-70 definition, the front gate's bench credit and the open contact costs, residuals and drain heal outside the boost races, the draft t56 play-out after the re-fit, the HP-monotony breaks of the relation specs, and a stage on a body the foe KOs first.
- **C · Spread solver, hits and the Choice check** (T202, T203, T204, T207, T208, T209, T210, T228, T229, T230, T231): hits the solver drops or misprices (the calc 0.12 spread target, partner field abilities, Hidden Power in doubles, Transform, move power from the battle, Z-move and Max-move hits), a prior that names its source, a Choice check that reads the field of the hit, one Special value in Gen 2, Illusion in the nickname lookup, and the crit and accuracy census over conditions.
- **D · Rebuild fidelity** (T212, T213, T214, T232, T245, T250, T251): start volatiles the protocol shows, an Outrage lock that ends the other way round, a Sitrus Berry witness from HP, the logged dice for every unchanged action of a branch's first turn, the saved-replay checkpoint that reads 93 % against 94 %, phantom bodies in short VGC games, and the shiny flag of Champions previews.
- **E · App and report** (T233, T234, T244, T252): cards for tied punishers, quiet turns and stopped hits; the team editor and early exports without guessed values; a hazard sack of a nearly fainted Pokémon read as a blunder (655336 turn 25); Gen 1 screens in the damage preview.
- **F · Cleanup and tooling** (T197, T200, T211, T247, T235, T241, T254, T255): one rule each for the target at use and for redirection, bank rows from forfeited games, one forme-origin helper, the feedback corpus in CI like the bank, the rests of T235 (21 unpriceable candidates, two lists without an oracle, screen and weather literals), the next step of the log-line epic, the rests of T239 (eleven files with their own handler call, a plain PRNG, `twinFormat`), and a `gen.num` guard that reads types.

## Off-cycle and parked

- T43: release check before every package release (on the next release day; the exact simulator pin is done since round 70).
- T103, T170, T185, T189: parked until their trigger fires (triggers in `docs/backlog.md`).

## Known drifts and upstream

- The expert pin smogtours-gen8ou-562428 t10 stays known drift: T218 removed the false Pain Split mistake in round 70, and the Heatran read is still missing. smogtours-gen6ou-653785 t19 is green again since round 70; T219 stays open.
- The draft t56 play-out pin is `test.fixme` until T243 (user gate 17.10.2026, "2a"); the golden 655336 drifts in 11 channels (T244).
- Upstream list for the user: `@smogon/calc` 0.12 sets the spread target and the 0.75 cut for Expanding Force in Psychic Terrain and for Tera Starstorm against a lone foe (T202), and it has no flag for Mud Sport, Water Sport or Ion Deluge, which change a damage roll in Generations 3 to 8 (round 72); `@pkmn/client` 0.7.3 books a Z-move or Max-move name as a move of the set (library bugs, point 6, in the watch list of `docs/backlog.md`).
