# Next Steps (as of 13.10.2026, after round 69)

Open work only, as packages. A package is one round; its TODOs carry fixed T-numbers, and their scenes, numbers and steps are in `docs/backlog.md`. Rules for agents: `AGENTS.md`. Finished rounds: `docs/completed/`. Next free T-number: T223.

## Next rounds

1. **Round 70 · Tree time back (T221).** The static term `boostsBiting` runs one 1v1 race per stage and foe; in the quiet window of 13.10. it cost the singles tree +14.3 % (lane B alone). One race per pair for all stats keeps every number byte-identical. Success: the singles tree at most +5 % against the state before round 69.
2. **Leaf K per family (T163).** Doubles OU, VGC and Champions OU each get a K fitted on the search's own root values instead of one doubles K. Success: bank plus holdout reads the doubles row better, with no warning.
3. **Champions rules from the battle's Dex (T160).** 62 code paths still read rules from the global Dex, and in Champions some of them read the Scarlet/Violet rule. Success: every path reads the battle's Dex or is shown to be format-free.

The order of 2 and 3 is open.

## Packages

Each package is one round; the order is open.

- **A · Doubles search and verify rows** (T194, T195, T219, T196, T198): the answer round prices one column three ways and its doubles verdicts rest on ties; the verify round re-prices different rows from run to run; speed ties and Fickle Beam scripting should come from the simulator.
- **B · Static evaluation repairs** (T199, T218, T220, T201): pairFocus as a ramp instead of an on/off gate, `boostsBiting` that sees which foe stands in front, drain moves that are not healing, a capture that records its own model form.
- **C · Spread solver, hits and the Choice check** (T202, T203, T204, T207, T208, T209, T210, T222): hits the solver drops or misprices (the calc 0.12 spread target, partner field abilities, Hidden Power in doubles, Transform, move power from the battle, Gen 1 and 2 starts), a prior that names its source, a Choice check that reads the field of the hit.
- **D · Rebuild fidelity** (T212, T213, T214): start volatiles the protocol shows, an Outrage lock that ends the other way round, a Sitrus Berry witness from HP.
- **E · App and report** (T205, T215, T216, T217): export and re-import without guessed values, the quick picker's move types, one map for variation and main line, doubles report sentences on turns without protocol.
- **F · Cleanup and tooling** (T197, T200, T206, T211): one rule each for the target at use and for redirection, bank rows from forfeited games, CRLF logs in the published package, one forme-origin helper.

## Off-cycle and parked

- T43: release check before every package release (on the next release day).
- T103, T170, T185, T189: parked until their trigger fires (triggers in `docs/backlog.md`).

## Known drifts and upstream

- The expert pins smogtours-gen8ou-562428 t10 and smogtours-gen6ou-653785 t19 drift since round 69 (user gate 13.10.2026, "2a"); T218 and T219 are their fixes.
- Upstream list for the user: `@smogon/calc` 0.12 sets the spread target and the 0.75 cut for Expanding Force in Psychic Terrain and for Tera Starstorm against a lone foe (T202).
