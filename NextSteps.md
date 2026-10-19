# Next Steps (as of 19.10.2026, after round 71)

Open work only, as packages. A package is one round; its TODOs carry fixed T-numbers, and their scenes, numbers and steps are in `docs/backlog.md`. Rules for agents: `AGENTS.md`. Finished rounds: `docs/completed/`. Next free T-number: T248.

## Next rounds

1. **Wave 4 · Library instead of hand work (package G).** Two causes made 12 of round 70's 18 faults: our code decides a game question the Dex or the simulator answers, or two places answer one question. Lanes A to D move the largest of those places into one module each and add the checks that catch the rest (design `docs/superpowers/specs/2026-10-15-wave-4-library-design.md`; user gates 15.10.2026, "3a", and 19.10.2026, "3a": its own gate over the design's open decisions comes first, and T246 goes into the lane it fits). The wave measures in CI since round 71 (`node scripts/bank-ci.mjs`). Success: name lists held to the Dex by a test 18 of 18 (2 today), a name ratchet that only shrinks, generated games across Gen 1 to 9 without an impossible reveal.
2. **Leaf K per family (T163).** Doubles OU, VGC and Champions OU each get a K fitted on the search's own root values instead of one doubles K. Success: bank plus holdout reads the doubles row better, with no warning.
3. **Champions rules from the battle's Dex (T160).** 62 code paths still read rules from the global Dex, and in Champions some of them read the Scarlet/Violet rule. Success: every path reads the battle's Dex or is shown to be format-free.

The order of 2 and 3 is open.

## Packages

Each package is one round; the order is open.

- **A · Doubles search and verify rows** (T246, T194, T195, T219, T196, T198, T227, T242): the answer round prices one column three ways and its doubles verdicts rest on ties; the verify round re-prices different rows from run to run; speed ties and Fickle Beam scripting should come from the simulator; the trend probe should cost less; since the Protect tempo a VGC verdict (2629703929 turn 8) is softer than the Monte-Carlo reference's; a commanding Tatsugiri gets a move in the search's choices and ends the search (T246, a small fix with a known cause).
- **B · Static evaluation repairs** (T199, T201, T224, T225, T226, T243): pairFocus as a ramp instead of an on/off gate, a capture that records its own model form, the re-fit of `boostsBiting` on its round-70 definition, the front gate's bench credit and the open contact costs, residuals and drain heal outside the boost races, and the draft t56 play-out after the re-fit.
- **C · Spread solver, hits and the Choice check** (T202, T203, T204, T207, T208, T209, T210, T228, T229, T230, T231): hits the solver drops or misprices (the calc 0.12 spread target, partner field abilities, Hidden Power in doubles, Transform, move power from the battle, Z-move and Max-move hits), a prior that names its source, a Choice check that reads the field of the hit, one Special value in Gen 2, Illusion in the nickname lookup, and the crit and accuracy census over conditions.
- **D · Rebuild fidelity** (T212, T213, T214, T232, T245): start volatiles the protocol shows, an Outrage lock that ends the other way round, a Sitrus Berry witness from HP, the logged dice for every unchanged action of a branch's first turn, and the saved-replay checkpoint that reads 93 % against 94 %.
- **E · App and report** (T233, T234, T244): cards for tied punishers, quiet turns and stopped hits; the team editor and early exports without guessed values; a hazard sack of a nearly fainted Pokémon read as a blunder (655336 turn 25).
- **F · Cleanup and tooling** (T197, T200, T211, T247): one rule each for the target at use and for redirection, bank rows from forfeited games, one forme-origin helper, and the feedback corpus in CI like the bank.
- **G · Library instead of hand work** (T235 to T241, with T196): wave 4, item 1 of the next rounds.

## Off-cycle and parked

- T43: release check before every package release (on the next release day; the exact simulator pin is done since round 70).
- T103, T170, T185, T189: parked until their trigger fires (triggers in `docs/backlog.md`).

## Known drifts and upstream

- The expert pin smogtours-gen8ou-562428 t10 stays known drift: T218 removed the false Pain Split mistake in round 70, and the Heatran read is still missing. smogtours-gen6ou-653785 t19 is green again since round 70; T219 stays open.
- The draft t56 play-out pin is `test.fixme` until T243 (user gate 17.10.2026, "2a"); the golden 655336 drifts in 11 channels (T244).
- Upstream list for the user: `@smogon/calc` 0.12 sets the spread target and the 0.75 cut for Expanding Force in Psychic Terrain and for Tera Starstorm against a lone foe (T202); `@pkmn/client` 0.7.3 books a Z-move or Max-move name as a move of the set (library bugs, point 6, in the watch list of `docs/backlog.md`).
