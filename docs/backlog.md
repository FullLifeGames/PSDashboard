# Backlog

This file holds the details of every open TODO, one section per TODO under its fixed T-number. The sections follow the finish line of `NextSteps.md` (user 21.10.2026): the release (wave 5, T163, T160 and the last wave are booked); every other TODO is parked with a trigger. The next free T-number is T272.

Evidence paths that start with `r69/` are under `docs/perf/probes/2026-10-12-r69/`, those that start with `r72/` under `docs/perf/probes/2026-10-19-r72/`, those that start with `r73/` under `docs/perf/probes/2026-10-21-r73/`, those that start with `r74/` under `docs/perf/probes/2026-10-22-r74/`, those that start with `r76/` under `docs/perf/probes/2026-10-23-r76/`.

Source of the new TODOs of round 69: the lane notes, the three review lenses after the merge, the pin diagnosis of lane B and the timing windows of round 69; each claim was checked by a reviewer against the code of the merge state (`r69/review/todos-check.md`, `todos-check-2.md`). Line numbers refer to the state after round 69.

Source of the new TODOs of round 70 (T224 to T246): the findings of the batch (`docs/perf/probes/2026-10-13-*`, `2026-10-15-*`), the lessons (`docs/perf/probes/2026-10-15-lessons/findings.md`) and the batch gate of 17.10.2026 (T242 to T245) and the full VGC holdout after it (T246); a reviewer checked each claim against the code (`docs/perf/probes/2026-10-15-r70-check/review/`). Their line numbers refer to the state after round 70.

Source of the new TODOs of round 72 (T248 to T255): the lane notes of wave 4, the merge and its timing windows; a reviewer checked each claim against the code of the merge state twice (`r72/booking/todos-review.md`, `r72/booking/backlog-review.md`). Their line numbers refer to the state after round 72. T256 and T257 were found and fixed inside round 72 and have no section.

Source of the new TODOs of round 73 (T258 to T263): the lane notes of wave 5 and its gate of 22.10.2026 ("5a", "4a"); a reviewer checked each claim against the code of the merge state (`r73/booking/backlog-review.md`). Their line numbers refer to the state after round 73.

Source of T264 and T265: the two proposals of round 73 that the design gate of round 74 approved (22.10.2026, "5a", "6a"); a reviewer checked both scenes against the code before the gate (`r74/review/gate-design-facts.md`, claims 10 and 11).

Source of T266: the gate of round 74 (23.10.2026, "4a"); a reviewer checked its facts against the run logs before the gate (`r74/review/gate-end-facts.md`).

Source of T267 to T271: the user's report of 28.10.2026 (draft 2058494320, variation turn 63) and the branching swarm of that day (`docs/perf/probes/2026-10-24-r77/swarm/findings.md`), with the user's gates of 28.10. ("1a 2d 3a 4b + A-5 5b", recorded in `docs/perf/probes/2026-10-24-r77/wave-fix/BRIEF.md`); a reviewer checked T268 to T271 against the code of 29.10. (`docs/perf/probes/2026-10-24-r77/review/findings.md`). Their line numbers refer to the state after round 77.

## Next rounds

Wave 5 (round 73), T163 with T263 (round 74, measured, nothing adopted), T160 (round 75) and the last wave (round 76, user gate 24.10.2026, "1a 2a 3a 4a 5a"; T259 reverted and parked) are booked. Next: the release with T43. Every other TODO is parked with a trigger.

## The release

### T267 · An endgame keeps the trees' verdict in the verify round

*Engine · round 77 · small · rankings and verdicts move, the score does not*

**Problem.** Draft 2058494320, a variation from turn 54, turn 63: Mienshao (Choice Scarf, locked into Close Combat) and Kyurem at 48 % face Dragapult at 45 % (Choice Specs) and Muk-Alola. The panel read "puffelmaedchen 15 % · Bene 85 %" above lines that advised U-turn for Bene at 16 % and Kyurem's switch for puffelmaedchen at 84 %. The score is the trees' visit mean; the lines come from the pooled matrix after the verify round. The trees played Kyurem's switch into each of Dragapult's attacks out to 11 to 17 % for puffelmaedchen over 400 to 650 visits, the one-ply sampler of the verify round read 84 to 93 %, and `VERIFY_DEPTH_FLOOR` (0.9) lets the trees' depth stand only near ±1, so the sampler priced the cells and turned the ranking around (probe `docs/perf/probes/2026-10-24-r77/t63/`).

**Idea.** With at most two living Pokémon on each side the trees play the game to its end, so an agreeing pool that played its cell out is a verdict at any magnitude; damage rolls, critical hits and misses keep the mean of a played-out endgame off ±1. "Played out" means 100 visits: the first fix took any pool of 8 visits and lost two proofs in CI, bank smogtours-gen9ou-750540 turn 22 (score −0.929 to −0.864) and Champions VGC 2628166702 turn 7 (the last pair, p1 won; score 1 to 0.954). In the second the trees visited Dark Pulse into Protect 24 times and read about 0.1, the sampler one ply deeper read the win (Protect holds once), Dark Pulse fell to third at 0.14, and the prover, which tries the ranked moves in order, found no proof (probe `docs/perf/probes/2026-10-24-r77/t267/`). With the bar both proofs return. The middlegame keeps the floor (655336 t24).

**Benefit.** In an endgame the advice and the score tell the same story; Bene's lines lead with the attacks that win, and a short winning line the trees visited too little keeps the sampler's read.

**Success.** `packages/eval-engine/test/endgame-verify-t63.spec.ts` (both scenes) and the three endgame rows of `verify-depth.spec.ts`; the score of the trees stays, so the bank and the holdouts move only where a proof moves, and the feedback corpus moves only endgame turns; the gate reads them. The engine suite stays green (the first fix moved the pin 912045 t8; the visit bar keeps it).

### T43 · Release check before every package release

*Tool · mini round · mini · no score touch*

**Problem.** Both packages are on npm, 0.7.0 and 0.7.1. The next release picks its packages by what has changed since the previous release tag. The local checkout does not know v0.7.1, because CI sets the tag on its own copy. A local dry run therefore compares against v0.7.0 and would publish a package that has not moved since 0.7.1. The barrel pins (`test/regression/fixtures/api/`), `pack:smoke` and a new chunk map belong to the check (the old script lived in the scratchpad and is gone). The exact simulator pin is done since round 70 (642b940, 5ae498f): every manifest pins @pkmn/sim and @pkmn/mods to one version, `npm run upgrade:pkmn` moves the release train and prints the checks a new simulator needs, and `test/regression/pkmn-pins.spec.ts` holds the pin, because the speed layer is bound to exactly this version and checks no hash in the browser. (Round 62 restated this; the old checkboxes in the source plan were background, and the round's spec rewrites the steps.)

**Idea.** Before every release, fetch the tags first, then read the plan of the dry run. The plan must name the same previous tag that CI sees, otherwise you measure against an old state.

**Benefit.** App and package users: a release pulls no unchecked simulator version on which the speed layer could silently compute wrongly.

**Success.** The local dry run names the same previous tag as CI, the published column matches `npm view`, the barrel pins show no unintended diff. npm view shows the exact simulator version as a dependency.

**Trigger.** Due on the next release day, independent of the waves.

**Gate.** No score path, no feedback runs, no bank. Gates are lint, tsc -b, regression and pack:smoke.

**Singles and doubles.** Touches no game logic. The published packages carry both game types; the package suites under packages/*/test already cover singles and doubles and run in the regression gate.

**Open decisions (at the user gate before the build).**
- Does the script abort on a missing remote tag, or is a warning line in the plan enough?
- Does the chunk map stay a probe under docs/, or does it move to scripts/ as a script?

**Background.**
- The first real publish has happened: origin/master is at ba2ce5b "Release 0.7.1: the first release that publishes itself", refs/tags/v0.7.0 and v0.7.1 are on origin, v0.7.1 is missing locally.
- npm holds @fulllifegames/replay-core and @fulllifegames/eval-engine, each with 0.7.0 and 0.7.1.
- The publish runs through npm trusted publishing from release.yml, without an npm secret, with provenance; the CI checkout uses fetch-depth 0 so the previous tag is right.
- A sibling skip with a never-published replay-core aborts on purpose.
- README line 97 describes the flow and names the dry run.
- The chunk map used to run through scratchpad/phase6/chunk-map.cjs on npx vite build --sourcemap against the base scratchpad/phase6/chunks-6-3b.txt; the signal was a growing entry chunk or a vanished lazy chunk, the inventory was INEFFECTIVE_DYNAMIC_IMPORT for smogon-stats.ts.
- Round 34 extended the barrel by the solver (types and three values only, no app import).

**Origin.** Old NextSteps.md (dcf9526): line 181; line 180; line 178; line 43 (rest). Merged because all four hang on the same trigger, a package, barrel or release change, and are checked in one pass. Line 43 names the first npm publish as a precondition of the big step; that is done, the recurring check stays open.

**Evidence.** Code state dcf9526:
- scripts/publish-packages.mjs:72-81, previousReleaseTag reads only the local tag list
- scripts/publish-packages.mjs:91-101, publishedVersion asks the registry through npm view
- scripts/publish-packages.mjs:103-121, buildPlan joins registry state and tag diff into the selection
- .github/workflows/release.yml:112-117, the publish job checks out with fetch-depth 0 so the previous tag is right
- README.md:97, describes the dry run as a local plan print
- test/regression/package-api.spec.ts:98-118, pins the barrel surface of both packages
- package.json, root version 0.7.1 with the tag v0.7.1 missing locally

**Steps.**
- [ ] **1.** Fetch the tags and compare the local tag list against the remote list; today v0.7.1 is missing locally.
- [ ] **2.** Run the dry run of the publish script and read per package the line with published, changed since and reason.
  - Files: `scripts/publish-packages.mjs`
- [ ] **3.** Match the published column against the registry, with npm view per package name and version.
- [ ] **4.** Decide whether previousReleaseTag reports a missing remote tag itself and aborts, instead of silently diffing against an older tag.
  - Files: `scripts/publish-packages.mjs`
- [ ] **5.** Run pack:smoke and check the fixture diff of the barrel pins before a barrel change goes into a release.
  - Files: `scripts/pack-smoke.mjs`, `test/regression/package-api.spec.ts`, `test/regression/fixtures/api/`
- [ ] **6.** Record the production chunk map again as a probe and file it under docs/perf/probes/; the old script lived in the session scratchpad and is gone.
- [ ] **7.** Run lint, tsc -b and the regression, and record the plan of the dry run in the release note.

## Parked

The triage of 21.10.2026 and the user gates after it parked these TODOs; each section names its trigger, and a trigger that fires brings its TODO to a gate.

### T268 · The set editor shows the moves the branch plays

*Teams · round 77 · larger bug · confusing · score-touching (the sets the engine plays move: set diffs on every build path before the bank) · swarm finding D4*

**Parked (user gate 28.10.2026, "4b").** Trigger: a user report, or the first round after the release.

**Problem.** smogtours-gen8ou-562428, Edit Opp, Corviknight: remove the guessed Roost and add Body Press. Editor and stats panel then read Brave Bird, U-turn, Defog (guessed) and Body Press (manual); the picker and the built set read Brave Bird, U-turn, Body Press and Roost, and a variation with Defog fails with "no longer knows Defog" while the panel still lists it. Scizor's Roost replaced by U-turn keeps Roost in the picker and drops Knock Off; Earthquake removed without a replacement changes nothing, because a guess fills the slot again; on the draft's open sheet a removed revealed Freeze-Dry comes back as SHEET (4 of 4). The set resolver puts the revealed and manual moves first and fills the rest from the guesses (`packages/replay-core/src/team/set-resolvers.ts:142`, `:221`), and `statsInfoOf` (`src/hooks/useTeamKnowledge.ts:252`) shows the guesses of before the edit.

**Benefit.** App: the editor and the stats panel show the four moves the branch plays, and a removed move stays removed.

**Success.** After an edit, the editor, the stats panel and the picker list the same four moves in singles and doubles; a removed guessed or revealed move does not come back; a spec per scene.

**Evidence.** Lane D of the branching swarm (`docs/perf/probes/2026-10-24-r77/swarm/findings.md`, D4; report `swarm/reports/lane-D-report.txt`), its scripts `swarm/D-scripts/s1b-edit-cases.mjs` and `s1h-panel-vs-picker.mjs`.

**Steps.**
- [ ] Red specs for scenes A to D (removed guess, replaced guess, removed move without a replacement, removed revealed move on an open sheet).
- [ ] Decide with the user whether a removed revealed move may leave the set at all (the replay showed it).
- [ ] One source for the editor, the stats panel and the built set.

### T269 · Say what a reload keeps

*App · round 77 · small · confusing · swarm finding D8*

**Parked (user gate 28.10.2026, "4b").** Trigger: a user report, or the first round after the release.

**Problem.** A reload loses the open variation, the pointer and the drafts without a warning (no `beforeunload` guard). Sets from `Edit Player` and `Edit Opp` are lost on reload, while an import persists per replay (`ps-replay-interceptor:sets:<id>`, `src/hooks/useTeamKnowledge.ts:97`, `:125`) with no way to clear it. A saved branch opens only as a read-only view, so its Save does not mean resume.

**Benefit.** App: a user knows before a reload what stays, edits and imports behave alike, and an import can be taken back.

**Success.** A reload with an open variation asks first; edits and imports persist the same way and the Setup menu clears them; a saved branch says it opens read-only, or opens as a variation.

**Evidence.** Lane D of the branching swarm (D8; `swarm/reports/lane-D-report.txt`), its scripts `swarm/D-scripts/s4-reload-same.mjs` and `s4c-persist-newreplay.mjs`.

**Steps.**
- [ ] Decide with the user which of the three is wanted: the reload guard, edits that persist like imports, a saved branch that resumes.
- [ ] Red specs, then the fixes.

### T270 · Leaving a replay with a variation open

*App · round 77 · small · cosmetic · swarm findings D9 and D10*

**Parked (user gate 28.10.2026, "4b").** Trigger: a user report, or the first round after the release.

**Problem.** In the shared-branch view, "New Replay" returns to the replay that was loaded before, with its variation, instead of the loader (D9). Loading another replay drops an open variation without a confirm; loading the same id does nothing (D10).

**Benefit.** App: "New Replay" does what it says, and a played variation does not vanish with one click.

**Success.** "New Replay" in the shared view opens the loader; loading another replay with a variation open asks first, as the replace confirm does.

**Evidence.** Lane D of the branching swarm (D9, D10; `swarm/reports/lane-D-report.txt`), its script `swarm/D-scripts/s4-reload-same.mjs`.

**Steps.**
- [ ] Red specs for both scenes, then the fixes.

### T271 · Doubles slots of the approximated position follow the protocol

*App · round 77 · small · confusing · swarm finding B4*

**Parked (user gate 28.10.2026, "4b").** Trigger: a user report, or the first round after the release.

**Problem.** gen9doublesou-2663093831, main line: until the exact position is rebuilt, the picker shows the approximation from the turn snapshot and the guessed teams (`pickerStateFromSnapshot`, `src/lib/picker-state.ts:391`). At T5 it reads "P2A kanye | P2B the aids missle", the exact position "P2A the aids missle | P2B kanye", and the protocol puts Glimmora in `p2a`; T12 is reversed the same way; at T15 the approximation shows one slot a side, the exact position four (3 of 3). No wrong execution from a click in that window was shown.

**Benefit.** App: the slots a doubles player sees while the position loads are the slots the move goes to.

**Success.** The approximation orders each side's actives as the protocol does, and a two-slot side keeps two slots; a doubles and a VGC row in a spec.

**Evidence.** Lane B of the branching swarm (`docs/perf/probes/2026-10-24-r77/swarm/findings.md`, B4; report `swarm/reports/lane-B-report.txt`).

**Steps.**
- [ ] A red spec from the three turns, then the fix in the snapshot picker.

### T259 · A smoother price for a stage drop at the bench gate

*Static weights · larger bug · score-touching D3 · rest of T248 · round 73 (F5)*

**Problem.** One HP-monotony break above 1e-3 is left after wave 5: in gen9championsvgc2026regmbbo3-2634199230 turn 5, Incineroar falls from 81 to 80 of 174 HP and the bar jumps 0.031 (`relation-checks.spec.ts`, the pending entry). When the holder starts to win its front race, the drop starts to count against the bench behind it, and the whole step lands where a priced recoil moves an integer clock by one turn. The gate is round 69's rule and right by the game, so the spec waits for a smoother price, not for a new gate.

**Benefit.** Engine: the last jump a user sees on the bar after a hit goes.

**Success.** The relation spec without the pending entry (design gate of round 73: breaks above 1e-3); bank plus holdout (D26) and Champions VGC without harm.

**Evidence.** `r73/lanes/F/ledger.md` (step 3), `r73/lanes/F/out/hp-causes-step3.json`, `packages/eval-engine/test/relation-checks.spec.ts:26-32`.

**Status (round 76).** Built as a ramp of the bench share over the race margin (9b2e591): the relation spec went green, but with it Champions VGC read harm (luck-adjusted +7, none without it) and the bank's doubles rows +9 instead of +5; the ramp is a price, not a game rule, so 1459923 reverted it and the relation spec keeps its pending entry (user gate 24.10.2026, "3a"). Trigger: a user report of the bar jumping at one HP.

**Steps.**
- [ ] The drop's price ramps over the race margin where the recoil moves the clock.
- [ ] The relation spec green; bank paired.

### T194 · Why the answer round overrates Protect plus Tera Starstorm

*Doubles search · mini round · small · score-touching D3 · round 69*

**Parked (triage 21.10.2026).** Trigger: the pin gen9vgc2026regi-2630685175 turn 8 flips at a gate.

**Problem.** The doubles expert pin gen9vgc2026regi-2630685175 t8 (Taunt is the error) flips on almost every doubles change, because the answer round sits on a tie of 0.003: p1's answer Protect plus Tera Starstorm gets too high a value. The pin stays (user 13.10., 1a); this TODO looks for the cause in the answer round (`search/answers.ts`), not in the pin. The diagnosis predates T149: first re-read the pin on the merged state.

**Benefit.** Engine: a doubles verdict no longer hangs on a chance tie.

**Success.** Checker on the scene against a Monte Carlo reference; the pin holds across the doubles changes of the next round.

**Evidence.** `r69/lanes/A/diagnosis-pin-2630685175.md` (tie 0.003, price of the column; diagnosis predates T149), `r69/progress-ledger.md:88` and `r69/lanes/B/ledger.md:41` (the pin flips on almost every doubles change), user answer 1a in `r69/lanes/A/ledger.md:155`, `search/answers.ts`, reference format `r69/lanes/D/out/mc-pins-w.json`.

**Steps.**
- [ ] Re-read pin gen9vgc2026regi-2630685175 t8 on the merged state: which rows lie 0.003 apart, how the column Protect plus Tera Starstorm is priced today (T149 prices near rows deeper since 5477eda; the diagnosis does not know this).
- [ ] Red checker on the scene against a Monte Carlo reference (pattern `mc-pins-w.json`, tolerance 0.02 between engine and MC regret); doubles only, singles have no answer round.
- [ ] Fix the cause in `search/answers.ts`, not in the pin; the pin holds across the doubles changes of the next round; bank plus holdout doubles paired.

### T195 · One column, one price in the answer round

*Doubles search · round · medium · score-touching D3 · rest of T149 · round 69*

**Parked (triage 21.10.2026).** Trigger: a doubles verdict at a gate hangs on a row priced at a lighter depth.

**Problem.** Since T149 a found answer gets three different prices in the same column: confirmed cells get the full depth-1 sub-search, two deep rows the light sub-search, further rows a plain move (`tree-orchestrator.ts:158`, `search/answers.ts:212`). Nearly equal rows further down probably get the more pessimistic value this way (not measured). In addition, the order spec of the answer round and the scene readings of lane D run under the standard ruleset, while the app plays VGC under 'vgc': on 2629703929 t4 both rulesets have 7 near rows for p1 and 3 are checked (`ANSWER_NEAR_ROWS`), and for p2 the round finds 0 refutations under 'vgc' against 4 under 'standard'.

**Benefit.** Engine: rows in one column are compared at equal depth; the specs check the app's path.

**Success.** Answer round specs under 'vgc' and 'standard'; bank plus holdout doubles (D26); tree time within the timing window.

**Evidence.** `r69/review/lens-BD.md` (findings 3 and 5, probe on 2629703929 t4: 7 near rows in both rulesets, 3 checked), `r69/review/todos-check.md` (T195), `tree-orchestrator.ts:154-158` (sideExtension), `search/answers.ts:52`, `:57`, `:212`, `test/doubles-answers-t149.spec.ts:200-218`, scene readings in `r69/lanes/D/ledger.md` (ruleset 'standard').

**Steps.**
- [ ] Red specs of the answer round under 'vgc' and 'standard': the order spec and the scene readings run with the app's ruleset (`settings.ruleset`); on 2629703929 t4 the same number of near rows and the same refutations for p2 in both.
- [ ] Measure the three prices (full depth-1 sub-search, light sub-search, plain move) against the Monte Carlo count from `verify-cover-doubles` before anything changes; otherwise the hypothesis about the pessimistic value below place three stays unmeasured.
- [ ] Price the rows of a column at equal depth (tie ANSWER_NEAR_ROWS to the size of the tie, or price the tail rows against the same sibling probes); bank plus holdout doubles (D26), tree time within the timing window.

### T219 · The same verify rows in every run

*Search · mini round · small · score-touching D3 · round 69*

**Parked (triage 21.10.2026).** Trigger: the pin smogtours-gen6ou-653785 turn 19 turns red again, or a verdict at a gate swings with the search budget.

**Problem.** The expert pin smogtours-gen6ou-653785 t19 (3d sacrifices Weavile into Stealth Rock) has flipped since T102: p1 reads an inaccuracy (0.025 on 0.142), and the sentence about the sacrifice is missing. No single static term explains it; the regret swings with the search budget between 0.034 and 0.259 (base 0.010 to 0.046), because the verify round recalculates different rows in each run: the base checks only the cells of Pain Split, not those of Hex, and with Hex checked even the base reads 0.109. Proposal: check the same set of rows in every run (played row, best row, rows up to 0.1 behind the best), then re-read the pin. Replaces the watch item in section C ("Pin 653785 turn 19 ... hangs on shaky numbers"): the pin has flipped.

**Benefit.** Engine: a verdict does not depend on which rows the verify round happens to catch.

**Success.** Regret of 653785 t19 stable across search budgets, pin re-read; tree time within the timing window.

**Evidence.** `r69/lanes/B/diagnosis-pins.md` (pin 2, regret 0.034 to 0.259 per search budget, base 0.010 to 0.046, Hex checked 0.109), `r69/lanes/B/pins/tree-...-keephex.json`, `search/verify-select.ts:101-118` (supportMass), `test/e2e-feedback/corpus.ts:177-179`, the NextSteps watch item in section C (pin 653785 turn 19), `r69/review/todos-check-2.md` (T219).

**Steps.**
- [ ] Red test: the regret of 653785 t19 across search budgets of 500, 600 and 700 iterations; today 0.034, 0.142, 0.244 (singles).
- [ ] The verify round takes the same row set in every run: played row, best row and rows up to 0.1 behind the best (instead of equilibrium support plus the played row); then re-read the pin.
- [ ] Regret stable across search budgets, tree time within the timing window; the watch item in section C is struck.

### T198 · Fickle Beam in the scripted chance

*Search · mini round · small · rest of T154 · round 69*

**Parked (triage 21.10.2026).** Trigger: a KO in a measurement hangs on the doubled power of Fickle Beam.

**Problem.** For a kill class that only the doubled power of Fickle Beam reaches, `search/outcome-children.ts:131-136` writes the roll -1 (101%); `forward/scripted-prng.ts` does not know the doubling. No wrong value reaches the tree (the roll drops out), but the class stays unreached. Affects the singles path (scriptFor); doubles draw the power in `pair/prng.ts`.

**Benefit.** Engine: the rare kill class is drawn instead of estimated.

**Success.** Checker against the simulator (Fickle Beam doubled, kill only that way), singles.

**Evidence.** `search/outcome-children.ts:131-136` (scriptFor, roll -1), `:197-203` (forceMissing), `ko-odds.ts:180-184`, `forward/scripted-prng.ts` (no doubling), `calc/fickle.ts` (strengthMix), `pair/prng.ts` (strengthDraw, doubles path), `r69/lanes/D/ledger.md:73` (point 1), `r69/review/lens-BD.md` (finding 7).

**Steps.**
- [ ] Red checker against the simulator: a kill class that only the doubled power of Fickle Beam reaches; the tree draws it instead of leaving it unreached (singles; doubles draw the power in `pair/prng.ts` and are not affected).
- [ ] Script the power through `ScriptedPRNG`; its factor comes from the dex handler, as with `strengthMix`, not from a list.
- [ ] Bank paired.

### T227 · The trend probe at lower cost and by class

*Search · mini round · small · score-touching D3 · round 70*

**Parked (triage 21.10.2026).** Trigger: a user finds the analysis slow.

**Problem.** Since round 70 the trend probe reads every base draw of a decisive cell (`search/trend-probe.ts`, `search/position.ts`, `orchestrator.ts`), and early singles matrix searches at three draws cost about 41% more CPU (34 saved positions, 14.5 s to 20.4 s; the pool runs the probes in parallel). A class-weighted probe over the cell's outcome classes would be exact at one sub-search per class; duplicate boards among draws (25 of 223 jobs) could share one probe; blend cells take the unweighted mean of their base draws; `search/deepening.ts:34` books the depth-2 trend with the old first-seed formula.

**Benefit.** Tempo and engine: the same trend reading for less time.

**Success.** The rankings of the 34 positions as with the round-70 probe, or each change explained; CPU within 10% of v1.

**Evidence.** `docs/perf/probes/2026-10-13-search-fixes/` (timing, `out/identity-*.json`).

**Status (round 76).** Champions OU 2628340185 turn 16 reads a blunder since T258 (p2 clicks Hyper Voice after a Calm Mind while Floette-Eternal mega-evolves and boosts; regret 0.509), where the fresh Monte-Carlo reference reads a mistake (0.20 and 0.25 on two seed blocks): the trend probe reads one cell with two outcomes from three draws, all three on the bad branch (`r76/lanes/P/ledger.md`, 12c). More draws per cell, at the cost this TODO names (user gate 24.10.2026, "4a": parked).

**Steps.**
- [ ] Probe per outcome class with its weight; one probe per distinct board.
- [ ] The depth-2 trend with the per-draw formula.
- [ ] Timing interleaved with v1 on a quiet machine.

### T242 · The Protect tempo softens a VGC verdict the reference keeps

*Doubles search · mini round · small · score-touching D3 · round 70 (gate 17.10., 1a)*

**Parked (triage 21.10.2026).** Trigger: a second scene where the Protect tempo softens a verdict the reference keeps, or a user report.

**Status (round 73).** Under the wave-5 static the engine reads no tier for either side of 2629703929 turn 8, while the fresh reference grades p1 a mistake (0.255 and 0.298) and p2 at least an inaccuracy: the distance widened from one tier to two on p1. `verify-spread-scenes.spec.ts` expects the reference and fails until this TODO closes it (user gate 22.10.2026, 2a).

**Problem.** Since the Protect tempo (7b4b73f, user gate 13.10., 3a) a Protect earns the damage it denies in the doubles hints. In gen9vgc2026regi-2629703929 turn 8 the engine now grades p1's played Heat Wave + Protect an inaccuracy (0.1736) where the Monte-Carlo reference on the same rows grades a mistake (0.326 and 0.299 on 24 draws, 0.280 on 96), and p2's Protect + Encore→Koraidon an inaccuracy (0.1936; the reference none on 24 draws, 0.147 on 96); before the tempo both graded p1 a mistake and p2 no tier. A bisection over the batch commits moves the scene at 7b4b73f only. The rows change: Protect + Flare Blitz→Jumpluff enters, the played Heat Wave + Protect moves from an appended thirteenth row into the twelve, and Heat Wave + Flare Blitz→Groudon (the round-69 reference's best) and Tera Blast→Groudon + Flare Blitz→Jumpluff leave. The reference's best row on the new list (Dark Pulse→Groudon + Flare Blitz→Jumpluff) stays listed, so the distance lies in cell values: Heat Wave + Protect × Rock Slide + Sleep Powder→Chi-Yu reads −0.307 against the reference's −0.437 ± 0.076, and Tera Blast→Jumpluff + Collision Course→Jumpluff × Protect + Encore→Koraidon 0.210 against 0.008 ± 0.033 (96 draws). The quarter-tier VGC holdout of the batch check shows harm on the hq table's luck-adjusted row (+37 [+0, +74]); no run separates 7b4b73f from the rest of the batch.

**Benefit.** Engine: Protect stays in the doubles search without softening the verdicts the reference keeps.

**Success.** The scene grades p1 a mistake again, as the reference does, with the two cells within 2.5 standard errors of the reference; the VGC and Doubles OU holdouts paired in full without harm, with and without the Protect tempo.

**Evidence.** `docs/perf/probes/2026-10-17-vgc-bisect/out/` (verdicts and row lists per commit snapshot), `docs/perf/probes/2026-10-15-mc/out/` (references; `mc-pins/big-gen9vgc2026regi-2629703929-t8-C.json` with 96 draws per cell), `docs/perf/probes/2026-10-15-r70-check/paired-r70-hold-vgc-q-vs-r69-w2-hold-vgc-hq.txt`.

**Steps.**
- [ ] Price the two cells as the verify step does, with and without the tempo, and find what moves them.
- [ ] Full VGC and Doubles OU holdouts with and without the tempo.
- [ ] Fix test-first; the scene pin moves at its gate.

### T253 · Move order by Quick Claw, Quick Draw and Custap Berry in the search

*Search · feature · score-touching D3 · rest of T196 · round 72*

**Parked (triage 21.10.2026).** Trigger: an activation of Quick Claw, Quick Draw or Custap Berry decides a verdict in a measurement or a user report.

**Problem.** A Quick Claw holder moves before a faster foe in 20% of turns (`randomChance(1, 5)`, `@pkmn/sim` `data/items.js:5057`), a Quick Draw holder in 30% (`data/abilities.js:3903`), and a Custap Berry holder at a quarter of its HP or less (a half with Gluttony) moves first for certain once the berry triggers. `speedTie` (`search/leaf.ts:84-90`) scripts true ties in singles only, and the queue's answer (`sim-ask/action-order.ts`) calls two different action speeds no tie whatever either body holds, so a claw against a faster foe reaches the tree through the seed alone. In doubles no tie is scripted; the pair plan hands a claw or Quick Draw mover to the simulator's own dice (`pair/guards.ts:46`, fallback `quick`). T196's checker named singles and doubles; round 72 delivered the singles tie.

**Benefit.** Engine: a turn a Quick Claw can steal counts at its chance instead of at the seed's draw.

**Success.** In singles the claw and Quick Draw chances are priced like a tie (Custap Berry as the certain order it gives), with a checker against the simulator; the doubles path measured on its own.

**Evidence.** `packages/eval-engine/src/search/leaf.ts:84-90`, `packages/eval-engine/src/sim-ask/action-order.ts` (doc comment), `packages/eval-engine/src/pair/guards.ts:46`.

**Steps.**
- [ ] A checker against the simulator: a claw holder against a faster foe, singles and doubles, Gen 9 and Champions, and the claw's chance in older generations.
- [ ] The chance in the singles leaf; the doubles path through the pair plan measured.

### T199 · pairFocus as a ramp instead of a switch

*Static weights · mini round · small · score-touching D3 · rest of T42 · round 69*

**Parked (triage 21.10.2026).** Trigger: a doubles verdict misses a KO that only the pair makes.

**Problem.** pairFocus prices a pair that can KO a foe only together, as a 0/1 gate: "alone neither makes it, together both do" (`score/field-pair.ts:43`). At its fitted weight of -188 the VGC grade dropped in 24 of 103 runs when a foe took more damage (round 69, `r69/lanes/B/vgc-monotone.vt.ts`), so the user gate of 13.10. (6b) set it to 0 in every table (aafd8c5, `score/weights.ts:230, 269, 332, 391, 440`). Since then the doubles static has no term for a KO the pair makes together. The monotony breaks that remain run through other terms (T248).

**Benefit.** Engine: a doubles position where only both attackers together KO a foe gets credit again, and more damage on that foe never lowers the grade.

**Success.** A continuous ramp over the KO window earns a nonzero weight in a re-fit; the relation specs of round 72 (`test/relation-checks.spec.ts`) show no HP-monotony break through it; bank plus holdout (D26) without harm, R1 to R3 in VGC.

**Evidence.** `score/field-pair.ts:43` (gate `best < foeHp && total >= foeHp`), `score/weights.ts:230, 269, 332, 391, 440` (pairFocus 0 in every table since aafd8c5; -188 in VGC before), `r69/lanes/B/vgc-monotone.vt.ts` and `r69/lanes/B/out/vgc-monotone-all.json`, `r69/review/todos-check-2.md` (T199: 24 of 103 on the merged state, 16 before S17), `r69/review/lens-BD.md` (finding 2), gate question in `r69/progress-ledger.md:138`.

**Steps.**
- [ ] pairFocus as a continuous ramp over the KO window instead of a 0/1 gate.
- [ ] Re-fit; the relation specs show no break through pairFocus.
- [ ] Bank plus holdout (D26), R1 to R3 in VGC.

### T201 · The static capture knows its form

*Fit tool · mini round · small · rest of T102 · round 69*

**Parked (triage 21.10.2026).** Trigger: a re-fit errs at the static form.

**Problem.** Since T102 the statics in standard singles compute with the phase form (EVAL_STATIC_FORM, on by default). A new capture stores the grade with the form, the fit rebuilds it from the table; the identity check holds only if you name the form columns and the weights of the capture by hand (`test/regression/fit-families.ts`, B ledger line 122). The capture should write form and weights itself.

**Benefit.** Measurement: a re-fit starts without manual work and without false alarms.

**Success.** Capture plus fit without extra variables, identity 0.

**Evidence.** `score/phase-form.ts:34-35`, `:52-55` (staticFormOn), `eval-function.ts:46`, `test/regression/fit-families.ts:234-235`, `:244-252` (identity check), `test/regression/eval-calibration.spec.ts:5531`, `:5819-5823` (leafValue as capture grade), `test/regression/eval-fit.spec.ts:175-176`, `:246-250` (EVAL_FIT_FORMS, EVAL_FIT_CAPTURED), `r69/lanes/B/ledger.md:122`, `r69/review/lens-BD.md` (finding 4).

**Steps.**
- [ ] Red test: a new capture of the standard singles statics, then `familyReports`; today the identity check throws `identity: N of M captured scores differ`.
- [ ] The capture writes the form (EVAL_STATIC_FORM) and the weights of the capture itself; the fit reads them from there, not from environment variables set by hand.
- [ ] Capture plus fit without extra variables, identity 0 (standard singles; the other families carry no form).

### T226 · Residuals and drain heal outside the boost races

*Static · mini round · small · score-touching D3 · round 70*

**Parked (triage 21.10.2026).** Trigger: a scene where a race misjudges Leftovers, Leech Seed or a drain move.

**Problem.** The played end of turn (`score/residuals.ts`: Leech Seed with its heal, items, weather, terrain, statuses) feeds only the boostsBiting races, for the holder and the foes on the field. Benched bodies, the matchup term, the last pair and the unanswered profile keep the status table (`races.ts` `statusResidual`: burn, poison, toxic). No race counts the drain heal inside an attack (half the damage dealt).

**Benefit.** Engine: every race reads the residuals the game plays.

**Success.** Matchup and last-pair races read the played residual; checker against the simulator (Leech Seed, Leftovers, a drain attacker); bank paired.

**Evidence.** `docs/perf/probes/2026-10-13-boost-bite/findings.md` (open points 3 and 4).

**Steps.**
- [ ] Red checker: a seeded body in the matchup race; a Giga Drain user's race.
- [ ] The played residual for every race side; the drain heal as negative chip on attacking turns.
- [ ] Bank paired; static time within noise.

### T207 · Hidden Power in doubles

*Spread solver · mini round · small · round 69*

**Parked (triage 21.10.2026).** Trigger: a doubles replay from Generations 2 to 7 in a user report or a measurement.

**Problem.** Since T31 the parser reads doubles hits, but the Hidden Power hints remain in singles only. Doubles formats with Hidden Power (older generations) lose the type hint this way.

**Benefit.** Sets: Hidden Power is read in doubles as in singles.

**Success.** Checker against the simulator, doubles of a generation with Hidden Power.

**Evidence.** `protocol/handlers.ts:233-235` (recordHiddenPowerHit: `!state.singles`), `:196` (recordImmuneHiddenPower), `r69/lanes/A/ledger.md:14` (the exception as a decision, "a small TODO of its own").

**Steps.**
- [ ] Red checker against the simulator: a doubles format of a generation with Hidden Power; the hit yields the type hint as in singles.
- [ ] The singles lock in `recordHiddenPowerHit` goes.
- [ ] Holdout doubles paired; singles stay byte-identical.

### T208 · Transformed Mew and Ditto

*Spread solver · mini round · small · round 69*

**Parked (triage 21.10.2026).** Trigger: a user report on a Ditto or Mew set.

**Problem.** Hits of a transformed Mew or a Ditto drop out: 26 doubles hits of the bank (bank-doubles 2, doublesou 14, vgc 10). The simulator knows the copied values.

**Benefit.** Sets: more observations in games with Transform.

**Success.** Count per family, checker against the simulator.

**Evidence.** `r69/lanes/A/ledger.md:40-41` (26 hits in three families, all Transform; the parser does not hold the Transform state), count bank-doubles 2, doublesou 14, vgc 10.

**Steps.**
- [ ] Count per family before (26 discarded doubles hits) and a red checker against the simulator: a hit of a transformed Mew or a Ditto carries the copied values of the target.
- [ ] The parser tracks the Transform state; the observation computes with the copied values, not those of the species. The count covers doubles; the same count shows whether singles have the same gap.
- [ ] Count after, set diff (D8) on the holdouts.

### T209 · The prior names its source

*Sets · mini round · small · score-touching D3 · rest of T132 · round 69*

**Parked (triage 21.10.2026).** Trigger: a guessed speed value beats a published one in a set diff or a user report.

**Problem.** Without a published set the solver starts from a default per species. Lane A proposes naming the source of the prior (published set, usage data, default per species), so that the T132 rule treats a guessed speed value differently from a published one.

**Benefit.** Sets: the speed rule knows how much a starting value weighs.

**Success.** Set diff (D8), fit error per family, bank paired.

**Evidence.** `r69/lanes/A/ledger.md:105` (point 1: name the source of the prior; example GPL Uxie 0/252/0/0/4/252), `r69/review/todos-check.md` (old T208: the goal is the gate of the T132 rule, not a ranking of the sources), `replay-core/src/spreads/ev-budget.ts:22-23`, `:45`.

**Steps.**
- [ ] Red test: two solver runs with the same starting value, one from a published set, one from the default per species; the T132 rule treats the guessed speed value differently from the published one (singles and doubles).
- [ ] The prior carries its source (published set, usage data, default per species) up to the rule.
- [ ] Set diff (D8), fit error per family, bank paired.

### T228 · Gen 2 Special stats apart in the solver

*Spread solver · mini round · small · score-touching D3 · round 70 · rest of T222*

**Parked (triage 21.10.2026).** Trigger: a Gen 2 user report.

**Problem.** `topUp` in `spread-inference.ts` hands out EV room one stat at a time and leaves Special Attack and Special Defense apart in 10 of 1,077 Gen 2 fit-corpus sets (all Raikou, e.g. smogtours-gen2ou-684843 at 184/252/252/0/252/216). The calculator couples them (`coupleSpecial`, `spreads/ev-budget.ts`); the simulator plays them apart in custom games. A probe fix moves 11 builds, because the second solve pass reads the first's answers.

**Benefit.** Sets: every Gen 1 and 2 body plays one Special value, as the game does.

**Success.** Every Gen 1 and 2 build carries one Special value; set diff over the fit corpus explained.

**Evidence.** `docs/perf/probes/2026-10-13-replay-core/findings.md` (open point 2), `docs/perf/probes/2026-10-13-replay-core/out/setdiff-report.txt`.

**Steps.**
- [ ] Red test on 684843 p14.
- [ ] `topUp` keeps the pair equal where the budget has one Special.
- [ ] Set diff (D8).

### T231 · Crit and accuracy: conditions, evasion, the pair plan

*KO odds · mini round · small · score-touching D3 · round 70 · rest of N1*

**Parked (triage 21.10.2026).** Trigger: a verdict hangs on one of these conditions.

**Problem.** Since round 70 a closed census decides the crit and accuracy guard for items and abilities (`ko-odds.ts`); among volatiles and field conditions the guard checks only Focus Energy by hand, while Dragon Cheer, G-Max Chi Strike, Laser Focus, Lock-On, Telekinesis, Glaive Rush, Minimize, Gravity, Lucky Chant and Toxic (Gen 7 and earlier) carry such handlers. Keen Eye, Mind's Eye, Illuminate (`ignoreEvasion`) and Unaware change the accuracy reading without an accuracy handler. `pair/pattern.ts:94` (`missedCrit`) ignores crit-stage items and abilities; `pair/snapshot.ts:79` keeps a hand list of crit blockers. `parsePlayedActions` reads the newest Dex because its signature carries no generation.

**Benefit.** Engine: one census decides every crit and accuracy effect, in singles and in the pair plan.

**Success.** One census over items, abilities and conditions; the pair plan reads it; bank paired.

**Evidence.** `docs/perf/probes/2026-10-15-n1/out/crit-acc-handlers.txt`, `docs/perf/probes/2026-10-15-n1/crit-acc-conditions.mjs`.

**Steps.**
- [ ] Extend the census to conditions and evasion-ignoring effects.
- [ ] The pair plan reads the census; the hand list goes.
- [ ] Decide whether `parsePlayedActions` takes a generation (package API).

### T213 · Outrage lock in the opposite direction

*Rebuild · mini round · small · rest of T187 · round 69*

**Parked (triage 21.10.2026).** Trigger: a second scene.

**Problem.** Lane E found the reverse case: the game holds the lock, the simulator ends it (2663114473 t12, Dragonite). Counted, not built.

**Benefit.** Engine: locks end in the rebuild as in the game.

**Success.** Count, checker.

**Evidence.** `r69/lanes/E/ledger.md:36`, `:40` (2663114473 turn 12, p2 Dragonite: the game holds the lock, the board has lost it and is confused), `:58` (point 2), T187 (751466 turn 7, the other direction).

**Steps.**
- [ ] Count in the corpus: games in which the simulator ends a lock that the game holds (Outrage and other random lengths), singles and doubles.
- [ ] Red checker against the simulator on 2663114473 turn 12: the rebuild keeps the lock.
- [ ] Count after.

### T245 · The saved-replay checkpoint reads 93 % where the snapshot says 94 %

*Rebuild · larger bug (cause open) · lossless D4*

**Parked (triage 21.10.2026).** Trigger: a user sees an HP display that differs from the replay.

**Problem.** `packages/eval-engine/test/reconstruction.spec.ts` ("reconstructs stable checkpoints from a real saved replay") fails on round 70: p1's active Pokémon reads 93 % HP where the replay's snapshot says 94 % (the assertion at `:93`). The test runs only where the gitignored saved replay HTML exists, so CI never sees it; it passed on 24.09.2026 (round 59) and failed in the logs of 13.10.2026.

**Benefit.** Tests: the local suite runs green.

**Success.** The checkpoint test green; the cause named (turn, body, rounding) with a test that fails without the fix.

**Evidence.** `docs/perf/probes/2026-10-17-vgc-bisect/red/reconstruction.log`.

**Steps.**
- [ ] Find the first failing commit between 24.09. and 13.10., then the turn and the body.
- [ ] Fix test-first.

### T251 · The shiny flag of Champions team previews

*Rebuild · small fix · cosmetic · rest of T238 · after T250 · round 72*

**Parked (triage 21.10.2026).** Trigger: a user report.

**Problem.** A shiny body that never switches in loses its shine in a Champions branch. Champions previews write `, shiny` on their `|poke|` lines (940 fit-corpus games, all Champions formats: 205 `gen9championsou`, 735 Champions VGC), and the build reads the flag only from switch, drag and replace lines (`noteLogIdentities`, `replay-core/src/team-identity.ts:48-59`); the comment above it (`:42-47`) says the preview strips the flag, which holds for Scarlet/Violet only.

**Benefit.** App: the branch shows a Champions body as the replay does.

**Success.** A body that never switches in keeps its preview's flag in Champions; Scarlet/Violet unchanged. If T250 trims the bodies a side never brought, the fix matters most where all six bodies stay (the 205 Champions OU games); decide T250 first.

**Evidence.** `packages/replay-core/src/team-identity.ts:42-59`; the count from the TODO review of round 72 (`r72/booking/todos-review.md`, item 4).

**Steps.**
- [ ] A red spec with a Champions preview line that carries `, shiny` for a body that never switches in.
- [ ] Read the flag from the preview in Champions formats; fix the comment.

### T252 · Generation 1 screens in the damage preview

*App · small fix · round 72*

**Parked (triage 21.10.2026).** Trigger: a Gen 1 replay in a user report or a measurement.

**Problem.** A Gen 1 branch under Reflect or Light Screen would show the hit in the damage preview as if no screen stood: `src/lib/picker-state.ts:372-373` hands the side conditions to `src/lib/branch-damage.ts:131-132`, while Generation 1 builds both screens as volatiles of the user (`@pkmn/mods` gen1 `reflect`: `volatileStatus`, no `sideCondition`). The engine's readers add them through `standingScreens` (`replay-core/src/dex-facts/screens.ts:34-35`). The scene is read from the code: the bank, the fit corpus and the fixtures hold no Gen 1 game.

**Benefit.** App: a Gen 1 branch prices a hit under a screen as the game does.

**Success.** The preview prices a hit under a Gen 1 screen the way the simulator plays it, held by a spec against the simulator.

**Evidence.** `src/lib/picker-state.ts:372-373`, `src/lib/branch-damage.ts:131-132`, `packages/replay-core/src/dex-facts/screens.ts:34-35`, `r72/lanes/C/out/corpus-coverage.txt` (Gen 1: 0 games).

**Steps.**
- [ ] A red spec: a Gen 1 board with Reflect on the defender's side, the preview against the simulator's damage.
- [ ] The preview reads the screens through `standingScreens`.

### T197 · One target at use, one redirect rule

*Cleanup · mini round · small · round 69*

**Parked (triage 21.10.2026).** Trigger: a doubles verdict hangs on a hint for Expanding Force or on a redirect.

**Problem.** "Target at use" exists twice with different reach (`search/hints.ts:199-203` without Expanding Force, `pair/odds.ts:34-49` with it), `redirectsFoes` twice with the same body (`search/hints.ts:61`, `score/field-pair.ts:25`). One place per rule stops the drift.

**Benefit.** Engine: the hints and the odds read the same rule.

**Success.** Specs of both places green, bank byte-identical.

**Evidence.** `search/hints.ts:199-203` (RULE_MOVES, `move-use.ts:66`, `move-use-rules.ts:100-113`), `pair/odds.ts:34-49` (targetAtUse, exported since c7a78b4), `search/hints.ts:61` and `score/field-pair.ts:25` (redirectsFoes), `r69/review/lens-BD.md` (findings 6 and 10).

**Steps.**
- [ ] Red test: doubles, grounded user in Psychic Terrain with Expanding Force; the hint (combinedOptionHints) and the odds read the same target (today a single target against both opponents).
- [ ] Merge `targetAtUse` into one place (the handler reading from `pair/odds.ts`) and `redirectsFoes` into one place; the second place imports.
- [ ] Specs of both places green, bank byte-identical; singles are not affected (the rules apply only with several targets).

### T211 · One forme origin

*Cleanup · mini round · small · round 69*

**Parked (triage 21.10.2026).** Trigger: a set or Choice reading of Ogerpon, Zygarde or Necrozma goes wrong.

**Problem.** Three functions answer "which species does this forme come from": `spreads/battle-forme.ts:45`, `choice-lock-defender.ts:15`, `team/item-damage-shared.ts` (defenderOf). They differ at the edges: Zygarde-Mega, Necrozma-Ultra, Floette-Mega and the Tera formes of Ogerpon. Also: `format-generations.ts` exports a scope 'legal' that nobody calls, while `src/lib/pokemon-options.ts:10` and `src/lib/smogon-sets.ts:33` build their own generations; `DEFENDER_ITEMS` in `team/item-damage-defender.ts:25` is a typed list where dex hooks could answer.

**Benefit.** Engine: one answer per question.

**Success.** Specs of the three places green, bank byte-identical.

**Evidence.** `replay-core/src/spreads/battle-forme.ts:45` (formeOrigin), `eval-engine/src/choice-lock-defender.ts:15` (formeOrigins), `team/item-damage-shared.ts:76` (defenderOf), `format-generations.ts:46` (scope 'legal'), `src/lib/pokemon-options.ts:10`, `src/lib/smogon-sets.ts:33`, `team/item-damage-defender.ts:25` (DEFENDER_ITEMS, use at `:171`), `r69/review/lens-AFE.md` (findings 8, 9, 11), `r69/review/todos-check.md` (old T210: probe p3, six deviating formes).

**Steps.**
- [ ] Red test over every dex species: the three functions answer the same; today Zygarde-Mega, Necrozma-Ultra, Floette-Mega and the Tera formes of Ogerpon deviate.
- [ ] One exported helper in replay-core for the forme origin; the two other places call it. `pokemon-options.ts` and `smogon-sets.ts` call `generationsFor` with scope 'legal'; `DEFENDER_ITEMS` from the dex hooks (`onModifyDef`, `onModifySpD`) instead of a typed list.
- [ ] Specs of the three places green, bank byte-identical; singles and doubles share the functions.

### T247 · The feedback corpus in CI

*Tooling · round (feature, like round 71) · small to medium · no score touch · rest of round 71 (user gate 13.10.2026, "4a")*

**Parked (triage 21.10.2026).** Trigger: after the release, bug-report rounds wait on local feedback runs.

**Problem.** Since round 71 the bank and the holdouts run in GitHub Actions; the feedback corpus (`test/e2e-feedback/`, 12 replays with the expert pins) still runs on this machine: `npm run test:feedback` starts a Vite dev server on port 5176 and Chromium, one run took 393 s in round 70, and a lossless change needs three byte-identical runs. Its anchor is the browser build: a Chromium change shifts the last floating-point place (watch list), so a CI run has to reproduce the local dumps byte for byte before it replaces them.

**Benefit.** Measurement: the feedback runs of a gate run side by side in CI, and the machine stays free.

**Success.** Two CI runs and one local run of one commit give byte-identical dumps (`FEEDBACK_DUMP=1`) and the same drift report (`feedback-drift.json` beside the dumps); three CI runs side by side finish in less wall time than one run here (393 s).

**Evidence.** `docs/perf/probes/2026-10-15-r70-check/check.log` (393 s), `docs/superpowers/specs/2026-10-13-round-71-bank-in-ci-design.md` (gate question 4), `.github/workflows/bank.yml` (the security rules to copy).

**Steps.**
- [ ] A workflow for the feedback corpus with the rules of `bank.yml`, Chromium pinned to the local version.
- [ ] Dumps compared CI against local and two CI runs against each other.
- [ ] AGENTS.md: the feedback runs of a gate in CI.

### T235 · Rules from the Dex in one module

*Rule fidelity · round · medium · lossless D4 · see T160*

**Parked (triage 21.10.2026).** Trigger: a rule fault traced to one of these lists.

**Problem.** A replay where Wide Guard decides a turn showed it: the stall guard and the planner each kept their own list of protecting moves, with different entries. About 22 name lists and 440 name literals sit in 71 files; list groups repeat in two to five files (choice items, random-call moves, screens); the Protect family has five Dex predicates in four files (`damage-calc.ts`, `pair/guards.ts`, `search/hints.ts`, `cell-blend.ts`; `calc/protect.ts` is a sixth reader); 2 of 18 list names appear in any spec. T160 moves the same reads onto the battle's Dex.

**Benefit.** Engine: one answer per rule, held to the Dex by one closed census.

**Success.** Each list derived from the Dex through one facts table per Dex object (the shape of `score/contact-filter.ts` `factsOf`) or held by an `oracle:` spec; bank digit-identical; static time within noise.

**Evidence.** `docs/perf/probes/2026-10-15-lessons/out/name-census.txt`, `out/dex-lists.txt`, `out/dex-unpriceable.txt`.

**Status (round 72).** Steps 1 and 2 and the setup moves of step 3 delivered in wave 4 (`dex-facts/` in both packages: the Protect family as one predicate, 7 lists derived from the Dex, 12 held by `oracle:` specs, 9 readings that differed from the simulator fixed; `dex-facts/setup.ts` with `test/setup-moves-oracle.spec.ts`). Open: the 21 unpriceable candidates of `test/unpriceable-oracle.spec.ts:33-41`, of which five have a pricing rule of their own (superfang, naturesmadness and ruination in `HALVING_MOVES`, `score/threat.ts:126`; Psywave in `fixedDamage`, `:259`; Endeavor in `score/move-facts.ts:119`) and Guardian of Alola has none a grep finds, so each adoption is its own D3 measurement; oracle specs for `SWAP_PAIR_MOVES` and `MOLD_BREAKER_ABILITIES` (`replay-core/src/inference/handlers.ts:28`, `:30`); the three screen literals of `pair/kill-table.ts:73-75` onto `SCREENS`; the weather id table `CLIENT_WEATHER_IDS` of `branch/field-ids.ts:17`.

**Steps.**
- [x] Facts table and the Protect family in one predicate.
- [x] Choice items, random-call moves, screens, hazards.
- [x] Setup moves (round 72).
- [ ] The unpriceable list of `ko-odds.ts`: the 21 candidates, one D3 measurement each.
- [ ] Oracle specs for `SWAP_PAIR_MOVES` and `MOLD_BREAKER_ABILITIES`; the screen literals of `pair/kill-table.ts` onto `SCREENS`; `CLIENT_WEATHER_IDS` from the Dex.

### T241 · One door for log lines (epic)

*Epic · in steps · lossless D4 per step · see T170*

**Parked (triage 21.10.2026).** Trigger: a parser fault traced to a reader with a raw prefix.

**Problem.** A Windows log made the parser read 0 of 15 hits (T206); round 70 put twenty `split('\n')` sites behind doors, but about 30 files still read raw commands by prefix, and a replay load walks the log three times with `@pkmn/client`. Since round 72 the header facts come from the client and the bring count reads the rule table, then `|teampreview|N`, then the format id (`replay-format.ts:207-238`).

**Benefit.** Engine and app: one reading of each log line, from the library's parser.

**Success.** Per step: identical results on the fixtures and the corpus.

**Evidence.** `docs/perf/probes/2026-10-15-lessons/findings.md` (library items 5, 6 and 9).

**Steps.**
- [x] Header facts (game type, generation, bring count) from the client in `replay-format.ts` (24 of 24 fixtures agree); `Teams` or `@pkmn/sets` for team text; `gen.stats.calc` for max HP (round 72).
- [ ] `LogLine` and `readLine` into the barrel (API snapshot change); `observedMaxHp` (`replay-core/src/spreads/max-hp.ts:20`, which still reads the log string) onto `LogLine`.
- [ ] Engine readers one family per round; one client walk feeding parser, hit reader and item reader.

### T254 · The rests of T239

*Refactor · larger bug · lossless D4 with a quiet timing window · round 72*

**Parked (triage 21.10.2026).** Trigger: a test or a report shows a question that changed the live battle.

**Problem.** In round 70 a hand-built stand-in wrote five shields' contact penalties into the live battle (7b4b73f). Round 72 moved the engine's stand-ins onto `sim-ask/`, and some places still build their own: `Object.create` views of live bodies in `score/boost-race.ts:68`, `score/matchup.ts:45`, `score/move-facts.ts:287` and `:362`, and `calc/body.ts:108`; eleven files call a Dex handler on a hand-built `this` (`test/sim-ask-callers.spec.ts:66-69`: seven in eval-engine, four in replay-core); `score/status-factor.ts:75` builds a plain `new PRNG('1,2,3,4')`; `twinFormat` returns a plain string.

**Benefit.** Engine: no question to the simulator can write the live battle.

**Success.** The census spec without rests; D4: the bank byte-identical, three byte-identical feedback runs, regression, e2e, lint and `tsc -b`; tree time within +5 % of the base in a quiet window.

**Evidence.** `packages/eval-engine/test/sim-ask-callers.spec.ts:61-70`, `r72/lanes/B/ledger.md`.

**Steps.**
- [ ] The five views onto `isolated()` or a copy, with the module's fingerprint check.
- [ ] The eleven handler callers onto `callHandler`, the PRNG onto `FixedDice`, `twinFormat` typed.

### T189 · Luck: the played cell against the next root (T22 stage b)

*Report and search · round · medium · score-touching D3 · parked until T146*

**Parked (triage 21.10.2026).** Trigger: a user report finds the chance attribution of a turn wrong.

**Problem.** Stage b of T22: the report prices the played cell against the next root and so separates what the move itself cost from what the search read anew afterwards. The draft scene t48 and 573756 turn 70 from section B wait for it: the read payoff fizzles, and the setup payoff comes one evaluation too late. T146 removes a known source of re-reading (653785 turn 24), so measure after it.

**Benefit.** App: report and cards separate dice, re-reading and move value.

**Success.** The two gap scenes book their luck correctly; bank paired; the chance pins hold.

**Trigger.** T146 is booked.

**Evidence.** From the old section T22 (restated in round 62): stage b reconciles the cell price against the follow-up root and belongs to the family T16 (verify merge). Scenes of that time: draft gen9draft-2058494320 turn 48 (−0.472 chance on the U-turn read move, state 05.09.), 573756 turn 70 (reads quiet with chanceDelta −0.145, state round 45; the turn 70 matrix read +0.31 for SOULWIND, after mixing +0.19, the turn 71 root −0.05).

**Steps.**
- [ ] Re-read the two scenes on the app path after T146.
- [ ] The reconciliation of cell price against follow-up root; pre-registered verdict rule on the hq tranche, paired bank bench with a fresh base on the same day, feedback 3×.
- [ ] Re-pins only at the user gate; the chance pins 573756 t73 and 649664 t23 hold.

### T103 · Harden the speed layer before the simulator changes

*Tool · parked · small to medium · lossless D4*

**Parked (triage 21.10.2026).** Trigger: the next simulator upgrade (unchanged).

**Problem.** The speed layer of round 59 (`packages/eval-engine/src/forward/sim-fast/`) passed all gates of the round on `@pkmn/sim` 0.10.11 (bank in Gen 9 and Gen 3, census over Gen 1 to 9); on this version none of the points below leads to a deviation. The hash gate and the guard spec do not cover everything the layer builds on, though; there a new simulator can change something without a test turning red. Open from the reviews of the round (ledger `.superpowers/sdd/2026-09-24-round-59-plan/progress.md`, "minor (deferred)"):
- The hash gate does not check the source text of the classes that the copy mimics, and a deviation always switches off the whole layer, not only the affected lever; the skeptic of the final review downgraded this to minor, because there is no path for it in 0.10.11.
- The pre-check builds on helpers without a hash: `alliesAndSelf`, `foes`, `allies`, `activeTeam`, `speedSort`.
- Keys with `undefined` below Battle, Field, Side and Pokemon (fields of an ActiveMove, volatiles, choice, queue) do not fall under the rule from 4aaad44; the copy shares the nested data of the ActiveMoves in the history without value rules.
- `check()` is not exception-safe: if a future simulator throws already in `new Battle({formatid: 'gen9customgame'})`, `prepareFormat` aborts with an exception in the default mode instead of reporting `hash-mismatch`.
- The keys of the constructors are read per format from the teams of the first template and are taken as independent of the team (true in 0.10.11, only `modifiedStats` in Gen 1 depends on it); at runtime nobody checks this, only the pin and the census in CI.
- Missing test pins: the adopted default (a rollback to `[]` would pass CI); the caching of the templates; the doubles matrix (`forkBattleWithPrng` of the pair plan) in the search with frozen templates; the snapshot mid-turn through `adoptTemplate`; the build smoke classifies only answers with a report (a last answer without a report or a worker without reports passes); the stamp of `runTree` is untested.
- App kill switch: an unknown value in the `localStorage` key `ps-replay-interceptor:sim-fast` (such as `off` instead of `0`) falls back to the default, so the layer stays on (`src/lib/eval/sim-fast-setting.ts`, `readSimFastLevers`).

**Idea.** As when changing a supplier: before the new part arrives, check every place where the old part was silently assumed, and write a test for each that trips on the new part.

**Benefit.** On the simulator upgrade, identity (0 deviations) and the app's speed (tree 2.35× and 1.81×, matrix 2.39×) stay protected.

**Success.** Every gap above is closed or carries a test that turns red on a simulator change; every new test is shown red without its fix; engine suite green in the default, forced on and with `EVAL_SIM_FAST=0`; the identity gates of round 59 stay at 0 deviations.

**Status.** 05.10.: since round 61 the layer carries the time gate, and no hash check runs in the browser (guard.ts:85-88); at the upgrade T103 runs first. Round 62 restated this; the old checkboxes in the source plan were background, and the round's spec rewrites the steps.

**Trigger.** The next change of the @pkmn/sim version: upgrade (D24) or a new version in the weekly version check (section C of `NextSteps.md`). State 05.10.2026: 0.10.11 is the newest.

**Open decisions.** (1) Should an unknown value in the app's kill switch switch the layer off, report loudly, or fall back to the default as today? (2) Does the layer check data below the top classes at runtime (costs time per copy), or only the census in CI?

**Singles and doubles.** Both; the census runs over Gen 1 to 9 and Gen 9 doubles, the doubles matrix gets its own pin.

**Origin.** Round 59: task reviews and final review (four lenses with skeptics), decision at the end of the round to park T103 before the first upgrade; ledger `SPEED LAYER 2026-10-01`.

**Evidence.** Ledger `.superpowers/sdd/2026-09-24-round-59-plan/progress.md` ("minor (deferred)"), `docs/perf/probes/2026-09-24-r59/gate/` (identity chain of round 59), `packages/eval-engine/src/forward/sim-fast/`.

**Steps.**
- [ ] **1.** Extend the hash gate: the sources that the copy mimics and the helpers of the pre-check into the hash list (ESM and CJS), verdict per lever; every extension with a counter-test (a falsified hash switches off exactly this lever).
  - Files: `packages/eval-engine/src/forward/sim-fast/guard.ts`, `clone-plan.ts`, `dispatch.ts`, `packages/eval-engine/test/sim-fast-guard.spec.ts`
- [ ] **2.** Robustness: make `check()` exception-safe (a throw in the probe battle yields `hash-mismatch` in the default mode, forced it throws); check the keys of the constructors per team; take empty keys and data below the top classes into the dynamic census over Gen 1 to 9.
  - Files: `packages/eval-engine/src/forward/sim-fast/guard.ts`, `clone.ts`, `clone-plan.ts`, `packages/eval-engine/test/sim-fast-guard.spec.ts`
- [ ] **3.** Test pins: default `['rules', 'clone', 'dispatch']`, caching of the templates, doubles matrix with frozen templates, snapshot mid-turn through `adoptTemplate`, build smoke with every answer (report exactly at the last), stamp of `runTree`; the app kill switch after decision (1). Every new test shown red without its fix.
  - Files: `packages/eval-engine/test/sim-fast-state.spec.ts`, `sim-fast-fork.spec.ts`, `test/e2e-build/build-smoke.spec.ts`, `src/lib/eval/sim-fast-setting.ts`, `test/regression/eval-sim-fast-setting.spec.ts`
- [ ] **4.** Gate D4, plus the identity chain of round 59 (`docs/perf/probes/2026-09-24-r59/gate/`) with 0 deviations and the engine suite in the default, forced on and with `EVAL_SIM_FAST=0`.

### T170 · Rest of T108 step 2: five fact handlers

*Tool · round · medium · score-touching D3 · parked*

**Parked (triage 21.10.2026).** Trigger: `@pkmn/client` tracks the five facts (unchanged).

**Problem.** Gate of round 67 ("6a"): since round 67, 4 of 11 fact handlers read the client. The other five stay own code (`inference/handlers.ts:150, 165, 226, 269, 284`: addFromPreview, addFromSwitch, recordItem, recordTera, recordAbilityAttribution), because `@pkmn/client` does not track these facts (decision R8 of lane C): it deletes the Tera type on faint (139 team members), shows the item of now instead of the set item before a swap (17), has no flag for the item marker of the preview (15) and misses two ability attributions (Natural Cure, Grassy Surge). A replacement would therefore change the output; it cannot be lossless.

**Benefit.** Less own protocol code, once the client tracks the facts.

**Success.** The five handlers read the client, the set diff is explained, bank paired.

**Trigger.** A `@pkmn/client` version that tracks these facts.

**Evidence.** Count and decision R8 of lane C of round 67.

**Steps.**
- [ ] On a new `@pkmn/client` version, repeat lane C's count of client against inference.
- [ ] Replace the handlers whose facts the client then tracks; explain the set diff; bank paired.

### Parked without a T-number

- [ ] Round 76: Bodies built from a snapshot (the quick picker) read 0 hits taken, so Rage Fist prices at 50 there; the snapshot carries `timesAttacked` for the rebuild only. Trigger: a user report or a corpus scene in the picker.
- [ ] Round 76: An open team sheet's solved EVs are fitted under the solver's nature (Hardy for Mawile) and built under the sheet's (Adamant). Trigger: a sheet set whose damage misreads.
- [ ] Round 76: The team editor cuts an input to the free points: on a solved spread of 508 EVs, typing 252 HP first gives 2. Trigger: a user report.
- [ ] Round 76: A memo of `threat(attacker, defender)` per evaluation would spare `usableSlots`, `keyedAnswers` and `pairKey` on every call (T262 found it; VGC is at +3.4 % of the base before wave 5). Trigger: a tree time over +5 % of its base.
- [ ] Round 76: 655336 turn 25 reads no tier again (healed by round 73), but without the hazard-sack praise: the position after the pair beats the pair by 0.139, over the stamp's 0.02. Trigger: a hazard-sack turn that reads quiet where the expert praises the sack.
- [ ] Round 74: A target without dice and player errors for the evaluation: a fit against the deeper search, or a strength test engine against engine on fixed dice. The bank measures against game outcomes, which carry both (T52, T224 and T163 adopted nothing). Trigger: after the release, a user report of a misread that neither the bank nor the expert pins catch.
- [ ] Round 73: The healer chip charged every turn in `races.ts` (4 of 585 positions move when scaled). Trigger: a scene where a healer's race misreads.
- [ ] Round 73: The halved Speed of a paralysis after the hit lands, in the race's move order. Trigger: a scene where a paralyzed body's race order misreads.
- [ ] Round 73: `sweepCells` and `beatsPair` read the pair on raw HP without the heal strip of T248. Trigger: a relation spec or a scene reaches it.
- [ ] Round 73: Per-target dice in a branch's first turn (VGC 2630181744 turn 3: a changed move lets Astral Barrage hit both foes where the log rolled once). Trigger: a scene where the targets change order.
- [ ] Round 73: Payback, Bolt Beak and Fishious Rend take the move order from speeds, not from the log. Trigger: a measured hit misreads.
- [ ] Round 73: Stakeout after a forced replacement reads without the boost (the client clears `newlySwitched` at `|turn|`). Trigger: a measured hit misreads.
- [ ] Round 73: Two same-species team members without nicknames count as one fainted for Last Respects (two Shedinja in a draft league). Trigger: a user report.
- [ ] Round 73: A move used under Illusion books on the disguised species, the rest of T230 (smogtours-gen7uu-321437, not in the repo). Trigger: a corpus game or a user report.
- 17 corpus species are in the tier list of the Champions mod 0.10.11 as banned and illegal (Rillaboom 656 sightings, Golisopod 505, Cinderace 375, Pawmot 212, Indeedee, Salamence); the validator rejects real teams ("Rillaboom does not exist in Gen 9" on Reg M-B). No code uses a legality filter today. Trigger: a Champions legality filter or a mod version with the game's list.

## Corpus gaps

Every gap has its TODO. The pins themselves are in `test/e2e-feedback/corpus.ts`; re-pins only at the user gate.

| Gap | State 19.09. | Handled in |
| --- | --- | --- |
| 573756 t73 (since round 32) | Chance and key moment have been pinned since round 40 (dbffb5f). State 17.10. (round 70): the miss is a key moment again and books as chance (+0.286), but the sentence "one 95% roll from clearing the rest" no longer renders (observed re-pinned without it, gate 17.10., "4a"); Body Press reads no tier (regret 0.0995 against Defog; Monte Carlo 0.085 and 0.095). | Round 73: the key moment lost to two game-correct changes (T225a lifts t70, the healer rule of T248 lowers t73's chance share 0.286 to 0.267; `r73/lanes/D/diagnosis.md`); round 76: T264 adds a dice turn against the winner to the list, and the gap reads open again |
| 649664 t23 | observed has been on shift since round 70 (gate 17.10., "4a"): a turn reads chance only where the chance part outweighs the decision part (7ecaac4), here 0.354 against 1.304; from round 42 to round 69 it was on chance. The bar reads 0.79 instead of 0.92, because the proof leaves the next 80% Hydro Pump open, no crit (round 62). Since round 63 the card for turn 24 names the open 80% Hydro Pump (T19) and says in turn 23 that the verdict hangs on Keldeo's item (Choice Scarf: fine, Mystic Water: blunder). Since round 64 (T121 point 1) Keldeo's guessed Choice item gets the damage check that refutes it; the gap stayed open in the wave run, nobody has read it yet. | Re-pin question at the gate |
| Draft game t48, 573756 t70 | Chance booking without dice: the read payoff fizzles (t48), the setup payoff comes one evaluation too late (t70, reads quiet today with −0.145). | T189 |
| GPL DzBQ5azlO5l t13 | State 17.10. (round 70): the rebuild plays turn 13 under the log's seed (0ec3352), so Air Slash no longer flinches there, and the trend probe reads each base draw against its own leaf (8d5642b); with Stone Edge set by the editor it ranks first or second, where round 69's matrix path had it third (`docs/perf/probes/2026-10-13-gpl-flinch/findings.md`). Before: Heavy Slam reads without an error band. Stone Edge is missing from the set (gen9ou 0.35%, a limit of the reconstruction); with Stone Edge added by hand, the cell Air Slash against Stone Edge has read −0.336 against the MC reference −0.328 ± 0.033 since round 64 (T119); Stone Edge stands first for p2, Heavy Slam has a regret of about 0.007, there is no grade. The gap thus hangs on the missing Stone Edge in the set (limit of the reconstruction), not on the verification. t15 reads right in Auto (Vileplume regret 0 to 0.018 in three seed sets, round 62) and is done. Fixture `test/e2e/fixtures/gpl-replay-DzBQ5azlO5l.html`. | Gate question (reconstruction) |
| smogtours-gen9ou-750267 Weavile | Stands with Jolly 0/0/0/0/0/252 at 41 damage observations and 11 move orders: the fulfilled order holds the speed, the budget pays for it out of the attack. Bank build and app build equal. | T26 |
| smogtours-gen9ou-751207 t6, VGC 2629703929 t10 | Tera in the statics: Ceruledge (Tera Fighting) counted as immune to Body Press; Koraidon (Tera Fire) read −0.645 instead of −0.396. The carrier T57 has been done since round 54, T81 (statics ask the simulator, STAB by the game rules) since round 63; nobody has re-read the scenes. | T127 |

## Watch list

Each bullet reads "signal → when to act".

**Surface and speed**

- [ ] Replay iframe: seeks and log appends cost 200 to 350 ms each, the last long-task source (play-out: 8 tasks, 1.8 s over 4 moves) → act when the battle window visibly stutters during play-out; lever: `hold` without pre-parsing, or appends in packets.
- [ ] Eval panel during the search: every render under 50 ms (throttle: 10 progress updates, 4 partials per second) → if the probe shows busy segments over 30% again: `React.memo` on `GameGraphSection` and `EvalResultBlock`, `variation` through useMemo.
- [ ] First worker spawn: 12 eval workers plus the replay worker each parse 7 MB at the same time → progressive spawn or pool warm-up if the first Evaluate stutters (`src/lib/eval/worker-client.ts`, `pool-size.ts`).
- [ ] `pre` task before loading 200 to 290 ms against 130 to 150 ms, measured under foreign load (entry chunk 8.7 MB) → re-measure on an idle machine before it becomes a finding.

**Report and booking**

- [ ] Praise and inaccuracy on the same click (VGC Bo3 2634199230 turn 5, from section B): since round 56 the card praises wb_vg as a p1 read (+0.33) and names the same click an inaccuracy (−9%) → act when a corpus game shows the case.
- [ ] Doubles rows of the app have shown the KO odds since round 56 ("· 90% KO"), but without slot and target: `KoSuffix` (`src/components/eval/analysis-bits.tsx`) does not read `koOdds.label`, the tooltip says "vs the standing active" → act when someone assigns the odds of a doubles row to the wrong Pokémon; lever: label in the suffix or tooltip.
- [ ] Doubles KO figures are root odds (round 56, as in singles): Howl, a Pollen Puff scratch or a Tera click in the same turn are missing from them (2663093831 turn 4, 2629703929 turn 1); the cells price it → act when a prose number or the sack rule goes wrong because of it.
- [ ] In 2663093831 turn 7, p1's played combination (Orthworm attacks, Dragonite protects) is not among the 12 options; the partial match fills the hidden slot with "→ Ting-Lu", a switch that the log rules out (a switch would go before Flare Blitz) → read together with the options cap.
- [ ] The favor boundary checks only the sign (655336 books +0.274 as a resolution today, state 05.10.) → add a size condition as soon as a real luck event of a start-goal winner is booked as a resolution (`report.ts`: `favorBoundary`, `resolutionTurns`).
- [ ] Setup moves without a feed deliberately stay unrelieved (573756 t70, second Swords Dance: regret 0.075 today, no tier) → act if the expert claims such spots; credit only with a floor anchor, otherwise outcome laundering.

**Engine and measurement**

- [ ] The set fallback for doubles and VGC is hard-wired to Gen 9 (`src/lib/smogon/format-fallback.ts`): a doubles replay before Gen 9 would get Gen 9 sets. Today every doubles replay in bank, fit corpus and feedback run is Gen 9 → act before an older doubles game enters a measurement.
- [ ] A new live access in `pairThreat` or `singleMoveFraction` needs its key term in `pairKey` (round 49: HP, types and base values were missing, doubles cells differed from run to run) → with every change to `score/threat.ts`, extend the test `threat-memo.spec.ts` by the new access (since round 64, T125, the key also carries the values that a move reads outside its axis: Body Press, Foul Play). Since round 54 the key carries the Tera type next to the raw types, for attacker and defender (be95961); a leaf that reads the living types is thus covered, the case is in `threat-memo.spec.ts`.
- [ ] The opponent model reads a doubles pair row only at the first slot (`isSwitchChoice` in `opponent-model.ts`); in doubles it therefore rarely becomes sure (favorite from 0.6 on 10 of 496 pages) → act when the read is needed in doubles (T42).
- [ ] 573756 turns 134 to 136: the decided detection has named the right side since turn 92, the bar stands at 0.33 to 0.60, because the search does not compute the Struggle plan over twelve plies. Since round 50 the sentence is silent there until turn 137 → act on a user report about a late bar in a Struggle endgame (T185, the deeper analysis this waited for, closed at the triage of 21.10.2026; T109 removed "Think deeper" in round 67; T33 was closed in round 62): if the bar stands at 0.7 from turn 134, the sentence speaks earlier by itself.
- [ ] 2663093831 turn 10: p2's inaccuracy disappears with T81 (round 63, lane B), although its regret rises from 0.152 to 0.276; the cause is unread → read it when T127 re-fits the static weights.
- [ ] Gen 2 logs show Leftovers holders under full HP without healing (684843 turn 34; 72 moves in 30 Gen 2 games; round 63, lane D) → act before a Gen 2 game enters a measurement whose verdict hangs on a Leftovers exclusion.
- [ ] Doubles with a hidden slot: the played combination is chosen before the verification, so the grade can land on another combination (`tree-orchestrator.ts:104`, review of round 63) → act when a doubles grade is wrong on a partly seen move; T148 reads along.
- [ ] Rage Fist, Last Respects and Retaliate compute with catalog power in the statics (0 holders on the bank; round 63, lane B). From round 67 in addition: Rage Fist needs `timesAttacked` in odds and kill table like Last Respects (T76); `side.faintedLastTurn` does not follow the faints of the corrections, so Retaliate then reads wrongly in both directions (no engine code sets the value; the simulator sets it at the end of the turn, `battle.js:1567`, and only Retaliate reads it, `moves.js:15254`); 2 games of the doubles OU holdout use Retaliate (2693420914, 2693814077) → act as soon as a holder is on the bank or in the corpus.
- [ ] The spread solver gives GPL Cobalion Timid at 252 Attack EVs: nature and EVs come from incompatible templates. The observed hit (106) does not prove the error, it binds Cobalion's attack and Noivern's defense together → act when a fitter round shows the same contradiction on further sets. T166 reads along.
- [ ] The harness fixtures carry an older data state than `.smogon-cache` (gen6ou: 292 against 297 species, file of 14.08.) and move 4 of 72 singles sets in 649664 and 655336 → expect moved pins in exactly these two games when the fixtures are next re-recorded.
- [ ] Doubles verdicts jump between two states of a round (round 54, VGC 2629703929): with the living defender type a blunder appears in turn 11 (regret 0.00 to 0.51), with the STAB rule it disappears again (0.01), and in turn 9 another appears (0.12 to 0.48). Since round 56 (T58) a doubles root cell of the matrix with a dice event is the mix of its classes or the mean of eight draws. That does not answer the question: turns 9 to 11 run through MCTS (fainted share 0.50 to 0.63), the pair plan reaches them only through verify cells, and their regrets are equal in rounds 55 and 56 (p2 0.1043, 0.1022, 0.0437) → at the next change of the doubles statics, compare the same moves; if they then jump, it is not the matrix cell (read with the doubles part of T81; state 05.10.: p2 0.104, 0.102, 0.044 as in round 55).
- [ ] Warning of round 54 on the bank: doubles mid hq +96 bp [+8, +198] on 49 positions (with the STAB rule +98 [+11, +196]); three positions carry 92 of it (smogtours-gen9doublesou-937928 turn 6, -913993 turn 6, -939625 turn 8, all read friendlier for the later loser after the correction) → round 56 barely moved them (937928 turn 6: 0.4718 to 0.4719, 913993 turn 6: 0.05266 to 0.05272; 939625 turn 8 runs through MCTS and is byte-identical), nobody has read them yet → read them first with T31.
- [ ] `gimmickSuffixForSlot` (`branch/protocol-choices.ts`) checks the slot, not the body behind the colon: if the rebuild has another body in the slot, the wrong one terastallizes (measured against the simulator in the preparation of round 54, `docs/perf/probes/2026-09-20-r54/T57/wf1/check-teraloss.md`). Since T238 (round 72) the built sets carry the replay's names, so a name comparison holds for every body the log shows (1 of 8,449 nicknamed bodies drops its nickname). How often the rebuild deviates there is unmeasured → count when a round walks the rebuild anyway.
- [ ] `parsePlayedActions` (`played.ts`) records no action on a move with `|cant|`, so no Tera either: the "played against options" match does not see the Tera click of a flinched body → take it along when T59 or T64 build on `played.ts`.
- [ ] `carryPreSolve` (`team-builder.ts`, `carryItemDecisions` until round 53) gives a Pokémon that the full solution discards and strikes from its result the entry of the speed pre-solve back. Without items that is 165 entries on the 129 bank replays, 9 of them move a set (8 replays); how often the middle branch applies (discarded, but kept in the result by the log with fixed HP) is uncounted. The statement on the item branch (no hit in the 139 measured replays) is unchanged from round 52 → whoever wants to rebuild the app back to one solution needs a case for the item branch first.
- [ ] A play-out burns a win condition in the wrong order (draft t56 to t62). Since round 64 (gate 08.10., "2a") the e2e pin checks the intent instead of the order; since round 67 (gate 11.10., "5b") it pins the core: p2 wins by turn 75 with at most six switches (in turn 57 Iron Head, Earth Power and Freeze-Dry lie within 0.01, the played line wins in turn 72, every other choice by turn 66); since round 70 the pin is `test.fixme` until T243 (gate 17.10., "2a": under the log's dice p2 sends Heatran into Mienshao's Knock Off at turn 61 and p1 wins at turn 67) → on a further case, pull Q5 (T39) forward.
- [ ] Early Brier: round 40 cost early 28 bp hq (0.2569 → 0.2597), late it won 84 bp; suspicion: exact HP bodies give too extreme bars early → pre-register the early hq column in every fitter round; act if two rounds in a row lose early.
- [ ] hq tranche: n=560 (r61-t98b; smogtours plus ladder from rating 1700) → re-cut the tranche if n falls below 500 or a new tranche tips the ratio.
- [ ] Premature-end remainder: today only 2663093831 turn 14 (1 of 320 blocks of the dumps; 648453 has no remainder left) → a backstop only if the rate grows with the corpus.
- [ ] Moved MCTS moves whose verdict does not hang on the repriced move (round 57, 648453): new hints at the root (Hidden Power Ice in turn 23: 0.21 → 0.85) reorder the tree expansion, redraw the one random outcome of every root cell (chance nodes off) and change which cells the verification reprices (turns 24 and 33; turn 31 a newly drawn 70% cell). Almost every cell of an MCTS move moves (turn 23: 26 of 28 cells), although no verdict hangs on the root price of Hidden Power Ice → act when a pin hangs only on such a shift; lever: measure tree variance (more trees or iterations) before a verdict is read.
- [ ] Golden 655336 has drifted in nine channels since round 64, in ten since round 69 (new: an extra key moment turn 12 and an extra read 16:p1; the truths of turns 13, 23 and 24 hold), in eleven since round 70 (new: misplays 9:p2 and 25:p2, the hazard sack of turn 25 read as a blunder, T244; an extra read 16:p2; the turn-26 key moment back, read as shift; healed: the extra key moment 27 and the extra misplay 22:p1) (gate 06.10.: the trick in turn 5 is not an unconditional error, mistake 5:p2 is out of the golden): missing key moments turns 5, 6 and 26, extra key moments turns 18, 22 and 27 (turn 27 reads shift instead of p1-read since T119), missing mistake 26:p2, extra mistake 22:p1, no turning point instead of 4. Turn 13 is healed by T16, the read 27:p1 by T119 → read together at the next golden refresh at the user gate; T127 measures against the golden first (D7).
- [ ] 20 wrong hits outside all families (referee of round 57, row "without family": Air Balloon, Psychic Terrain, Armor Tail against priority) → act when one of them carries a verdict; lever: create families in the referee and count them.
- [ ] On a Bo3 ladder only the deciding game of a set carries the rating (M-C-Bo3: 16 of 51 games rated; review of round 66). The fit rule against unrated ladder games (`withoutUnratedLadder`) would discard games 1 and 2 of a rated Bo3 set, and `--sort rating` would find only the deciding games there → before a Bo3 ladder extension, pull the rating onto the set. Today no rated Bo3 ladder game is in the corpus.
- [ ] Champions VGC fills species missing from its usage file from SV files (doubles OU, OU, Ubers) instead of from `gen9championsou`, and `@pkmn/sim` does not know the Champions ability "Aura Guard" (round 66) → act when a species in the corpus builds wrongly because of it or a game shows the ability (upstream only after the user's okay).
- [ ] T142 in 2026 Reg F: without a set file of the year, the 2026 usage file guesses moves worse than the doubles OU sets (77.1 → 72.8%, items 59.8 → 62.5%, 120 Bo3 games with a team list); 2024 has no team lists, and the holdout reads 2024 Reg H +124 bp [−26, +284] unresolved → act when data.pkmn.cc carries a set file for 2026 or a verdict hangs on 2024 games.
- [ ] Partner targets everywhere (T113 stage 2, decision 12 of round 67): since round 67 the root knows the played choice with partner target; partner targets at every node enlarge the raw combination count by a factor of 1.55 → act when a doubles verdict hangs on an unled partner move away from the root and the tree time has room.
- [ ] Blockers behind a `|cant|` (check of T175, 12.10.): the rebuild's substitute move follows Taunt's rule (same category and priority, `branch/protocol-choices.ts:257-264`). Imprison (a move that the opponent knows), Heal Block (heal flag) and Gravity (gravity flag) block by other properties, Throat Chop names no move (`moves.js:19758`); Disable hits only the last move, which is already in the set. No wrong substitute in the corpus (16 Taunt rows, one Heal Block row) → act when T175 fails to bring a move into the set or a substitute under another blocker carries a verdict.
- [ ] An unknown format takes over only Sleep Clause (round 67, lane E): `getBranchSimulatorFormat` makes a Custom Game with Sleep Clause out of it (`replay-format.ts:259-273`, `:130-141`); a draft league with Terastal Clause loses the lock in the branch picker (`picker-tera.ts:18`) and in the branch battle, while the search already turns Tera off in "auto" if the log shows none (`tera.ts:72`) → act as soon as a replay with a declared Terastal Clause appears.
- [ ] 2630685175 turn 1: worker pool and local execution have differed by 0.0002 since T129 (−0.43798 against −0.43780, same tier, cause open). The bank computes locally (`test/regression/bank-search.ts:37`), the app in the pool. Round 72 (T257) fixed a memo key that let the order of a worker's jobs change this turn → read the difference again, and act when a pin, a tier or a bank row hangs on a pool-against-local difference.
- [ ] Monte Carlo references hang on the statics (round 69): the oracle values its leaves with the same statics as the engine; after the weights of lane B, four scene pins seemed off, freshly computed the engine hit all four. The doubles census (reference b67) has not been comparable since (cw: other job sets on 23 of 23 moves) → before the next census and after every weight change, recompute the references with MC_N > 0.
- [ ] Own K per phase sticks to the upper limit 50 in small cells (round 69: hq doubles late, 45 rows, warning +156 in the bank alone, without weight in the verdict from bank plus holdouts; likewise in a6 and e4) → act when such a cell carries a verdict; lever: limit the K fit of small cells or pool it with the neighbouring phase.

- [ ] Max moves in the hazard and removal reads: G-Max Steelsurge sets a foe-side hazard and G-Max Wind Rage clears screens, hazards and the terrain, while `test/hazard-removal-oracle.spec.ts:42` skips Max and Z moves; 1 of 5,622 fit-corpus replays holds a Max move and the bank none, so no bank pair can decide it → act when a Gen 8 game enters a measurement whose verdict hangs on it.
- [ ] The commit repair of the rebuild (`branch/runtime-session.ts:246`) counts a side whose half-built choice the simulator rejected as done, since `side.isChoiceDone()` ignores `choice.error`; no scene is left after T246c (round 72) → act on the first scene.

**Environment**

- [ ] e2e "branch replay play controls stay muted without audio errors" saw two page errors from the replay iframe in round 50 (`$ is not defined`, then `reading 'length'`): 1 of 2 full runs red, alone 10 of 12 green on the branch and 6 of 6 on the base. A Showdown script runs before jQuery is loaded (same family as the config routes fix e019a73) → act if the test tips a gate a second time; lever: load order of the dynamic scripts in the embed, or the test waits for `window.$` in the iframe before it counts errors.
- [ ] e2e "a long forward slider jump lands the scene instead of hanging on "seeking..."" (`test/e2e/timeline.spec.ts:49`) waited 30 s in vain for `Replays.battle` in the replay iframe in wave run 3 of round 63 (1 of 75 tests in a full run; alone 4 of 4 green, green in wave runs 1 and 2) → act if the test tips a gate a second time; probably the same family as the load order in the embed. Round 72: it failed on a cold Vite dependency cache, on v1 as on the merge, and passed warm; every checkout shares one Vite cache through the `node_modules` junction, so the first run after a checkout switch re-optimizes the dependencies. A warm-up run before a counted e2e run avoids it.
- [ ] The browser build is part of the feedback anchor: a Chromium change shifts the last floating-point place (573756 t81 verify selection) → every Playwright upgrade is a re-anchoring with `FEEDBACK_DUMP=1`; state `@playwright/test ^1.62.1`.
- [ ] TypeScript stays on 6.x until typescript-eslint parses the native compiler; `@types/node` follows the CI Node major (24) → watch the peer range.
- [ ] `ubuntu-latest` moves to Ubuntu 26 from 19.10.2026 (an annotation on the bank runs of round 71). The identity runs of round 71 ran on the ubuntu-24.04 image, where CI rows matched local Windows rows → once the runs report Ubuntu 26, run the identity pair again (two CI runs and a local run of one commit, `docs/perf/probes/2026-10-19-r71/compare.mjs`) before a verdict pairs a new CI run with an older base. Round 72: on 20.10. the jobs of one run got Node 24.21.0 and 24.22.0 and their fingerprints differed, so `bank.yml` pins 24.21.0 (0be7274); r72-base (19.10.) and r72-m6 (20.10.) agree on every row the code did not change (Doubles OU byte-identical), and the identity pair against a local run still waits for its trigger.
- [ ] Weekly version check of `@pkmn/sim` (from the adoption on 26.09., pin 0.10.11, exact in every manifest since round 70) → on a new version, `npm run upgrade:pkmn <version>` moves sim, mods, dex and data together and prints the checks (T103, the engine suite in all speed-layer modes, the batch check); then an upgrade PR per D24.
- [ ] Screenshot probe `docs/probes/2026-09-03-css/` (32 tests, 34 screens, 0 pixel tolerance; start with `node scripts/run-e2e.mjs -c docs/probes/2026-09-03-css/shots.config.ts`; its baseURL is fixed on port 5174, `--dev-port` does not reach it) → reuse as a pixel gate for every UI round; re-record the baseline with `--update-snapshots` when copy or layout change on purpose.
- [ ] `@smogon/calc` 0.12 has no flag for Mud Sport, Water Sport or Ion Deluge (Plasma Fists), which change a damage roll in Generations 3 to 8 (round 72, upstream list for the user; related to T202 and T203).
- [ ] Library bugs (round 67, checked 12.10.): (1) the Champions bundle of `@pkmn/mods` 0.10.11 embeds the simulator's dex with all data and loads the data of every mod on import, only for `toID` in `canMegaEvo` (`build/champions/index.mjs:423335`, `:423758-423770`; the bundle `championsregma` has 85 KB). (2) `DexFormats.extend` in `@pkmn/sim` discards the result of `concat` (`dex-formats.js:361-365`): the Champions formats are missing from `Dex.formats.all()`, `get()` finds them, a second `extend` throws "duplicate ID". (3) `Dex.formats.get('gen9championsou@@@Sleep Clause Mod')` returns a non-existing format, because `data.Rulesets` arises only on import from `formats.all()` (`dex.js:420-429`, `:498`); `new Battle` then silently builds on the base dex without mod and without rule (unreachable today, `replay-format.ts:265`). (4) The Mega Z formes carry no mega flag (`dex-species.mjs:49/54` counts only Mega, Mega-X, Mega-Y); Showdown has fixed this already, the fix comes with the next sync of `@pkmn/sim`, no report. In addition `@pkmn/client` 0.7.3 without a null check (T188: `getPressurePP` and the `types` getter throw when the generation does not know the species) → three reports (1, 2 with 3, client) drafted on 12.10. in `docs/perf/probes/2026-10-10-r67/gate/upstream-issues-draft.md`, each with a script under `gate/upstream/`, checked against the newest versions and pkmn/ps `main`; the user reports them personally (12.10., gate question 10 of round 67) → watch whether and when a fix appears; the client fix does not replace T188. (5, round 68) Double Shock carries no punch flag in the Champions mod of `@pkmn/mods` 0.10.11 and is marked as Custom; the server computes with Iron Fist (gen9championsou-2693645983: a resisted Double Shock takes 56%, without Iron Fist at most 51.5%); Showdown fixed this on 10.09. (bc4eb07b4, #12304), the fix comes with the next `@pkmn/mods`, no report; the engine's calculator already carries the flag from `@smogon/calc` 0.12. (6, round 70) `@pkmn/client` 0.7.3 books the generic Z-move or Max-move name as a revealed move slot (`Pokemon.useMove`; smogtours-gen7ou-450650 p2 Garchomp `['devastatingdrake']`, smogtours-gen8ubers-486661 `['earthquake', 'maxquake']`; `build/index.js:1291-1307`; `docs/perf/probes/2026-10-15-zmoves/findings.md` open point 2, `docs/perf/probes/2026-10-15-lessons/out/client-zmax.txt`); since 73d7cad `inference/power-moves.ts` reads the Dex instead → check play.pokemonshowdown.com's own tooltip before a report; the user reports it.
- [ ] `@smogon/calc` 0.12 (round 68): Unseen Fist also hits through Protect at a quarter in Gen 7 to 9 in the calculator (`mechanics/gen789.ts:655-664`). That is the reading of Champions, where the mod changed Unseen Fist this way; in Scarlet/Violet Unseen Fist hits with full damage (the ability deletes the Protect flag on contact). Both are right, the mode of the battle decides (user 12.10.). `calc/protect.ts` asks the simulator for the mode before the calculator sees Protect. A draft of a report as a mode question is in `docs/perf/probes/2026-10-12-r68/steps/upstream-calc-draft.md`; the user decides → watch whether the calculator binds the reading to the mode, then simplify `calc/protect.ts`.
- [ ] Round 68, rest of T156: a body on the bench reads "No Ability" under an active Neutralizing Gas (own or opposing), even when the gas holder goes before it → act when a scene shows this.

**Parked branches**

- Cleaned up on 06.10. after round 63: `r54-stab` (252ade4, contained in master and v1), `r57-power` (34f84b9) and `r57-with-power` (66ba26f) are deleted, because STAB and the power at use have been in the code through the simulator since round 63; likewise the round branches `r59` and `r63` (in `v1`) and the lane branches `w1-a` to `w1-h` with `w1-d-fix`, `w1-e-fix`, `w1-f-fix` (every commit cherry-picked into `v1`). Hashes in `docs/perf/probes/2026-10-05-r63/gate/deleted-branches.txt`; as long as Git holds the objects, `git branch <name> <hash>` brings one back. Bank folders `.calibration/r54-review`, `r54-stab`, `r57-power` stay.
- `r58-oracle` (33c93c5, on 85eb5ad): the throwaway branch of the round 58 sighting: `score/oracle.ts` computes the statics' damage either with @smogon/calc or with an adapted `getDamage` of the simulator (`EVAL_STATIC_ORACLE=calc|sim`); the commit message carries the pre-registered thresholds. Never merge; referee. Probes under `docs/perf/probes/2026-09-24-r58/`; round 61 (T97) unpacked its code with `git archive` to `docs/perf/probes/2026-10-02-r61/static/src` and added the mode `mean` there, without a worktree.
- Cleaned up on 08.10. after round 64: the round branch `r64` (in `v1`) and the lane branches `w15-a` and `w15-c` to `w15-h` (every commit cherry-picked into `v1`) are deleted. Hashes in `docs/perf/probes/2026-10-06-r64/gate/deleted-branches.txt`; as long as Git holds the objects, `git branch <name> <hash>` brings one back.
- Cleaned up on 09.10. after round 65 (user okay): the round branch `r65` (in `v1`), the probe branch `r65-cand` (2f0d3db, candidate weights of the family fit; its tables are in `v1`) and `w15-b` (043baf1, re-fit E of round 64, overtaken by the tool of round 65) are deleted. Hashes in `docs/perf/probes/2026-10-09-r65/gate/deleted-branches.txt`; as long as Git holds the objects, `git branch <name> <hash>` brings one back.
- Cleaned up on 09.10. after round 66 (user gate 19:40, "5a"): the round branch `r66` (in `v1`) and the probe branch `r66-cand` (05ae0fa, the candidate with the Champions doubles weights; in `v1` as 8e629a4 with corrected comments) are deleted. Hashes in `docs/perf/probes/2026-10-09-r66/gate/deleted-branches.txt`; as long as Git holds the objects, `git branch <name> <hash>` brings one back.
- Cleaned up on 12.10. after round 67 (user okay): the round branch `r67` and the merge branch `r67-merge` (both in `v1`), the lane branches `w2-a` to `w2-g` (every commit in `v1`; three of them with the same changed lines under a new hash) and the measurement branch `r67-f` (4c0d50d, never merged: lane F's measurement helper let the eval worker wait for the Champions mod before it revived a Champions position) are deleted. Hashes in `docs/perf/probes/2026-10-10-r67/gate/deleted-branches.txt`; as long as Git holds the objects, `git branch <name> <hash>` brings one back.
- `r41-wide` (163efcc): wide reading of the speed release, reference for T26. The bank folder is deleted, the numbers are in `docs/perf/probes/2026-09-11-r41/paired-wide-*.txt`.

## After the release: Showdown Companion (own project)

*Programme, its own project after the release (user gate 21.10.2026, "3b"); the finish line of `NextSteps.md` comes first.*

Precondition (user ordering 04.09. 11:08): first finish the small rounds from the list above, until the dashboard is round as a product (the rounds of choice, a clean release; the app test suite and the package remainders have been done since round 39, `docs/completed/test-infrastructure.md`; the first npm publish has been done since 06.09., both packages are on npm in 0.7.0 and 0.7.1, `docs/completed/architecture-refactor.md`). Then the programme starts; none of it runs next to an engine round, because step 0 moves every path in the repo and the feedback gates are calibrated against today's paths.

What gets built (exploration `docs/superpowers/specs/2026-09-04-player-evaluation-brainstorm.md`, spec `docs/superpowers/specs/2026-09-04-showdown-companion-design.md`, plan `docs/superpowers/plans/2026-09-04-showdown-companion-plan.md`, exploration page <https://claude.ai/code/artifact/66add92b-95be-40dd-b0ee-b6f1049ad63c>, design canvas in the dashboard skin with nine screens <https://claude.ai/code/artifact/8f53a60d-2d50-4ba5-81fa-57c0f3cfaa39>):

- **Companion** at the site root: one input field plus a format selection. A replay link or file goes in, and the analysis runs at once as in the dashboard today (embedded, full height). A username goes in (usually with a format), and the companion collects all public replays of the player (`search.json`, 51 per page, `before` paging, `user2` for head-to-head, private links and files on top), stores them in an IndexedDB library, pools the teams (identity = sorted species list, as in the old scouter, forme dedupe) and what was revealed across games (moves with counter and date, items, abilities, Tera, damage observations for the spread fit), and shows profile, teams, games and protocol facts (results, leads, switch rate, Tera move, thinking time from `|t:|`, doubles facts per slot).
- **Engine grades in the library**: the grading pipeline moves from the dashboard hooks into a package `eval-runtime` (worker pool with browser and `worker_threads` adapter, team knowledge with the Smogon fetchers, position pipeline, whole-game sweep, cache stores), gated byte-identical like the refactor phases. Companion, bot and live assistant call it directly; the iframe serves only for viewing. On top, the package `player-insights`: accuracy, loss per decision, blunder rate and clustering, engine agreement, safe-line share, conversion, opportunism and luck (Lichess pair), net luck, consistency and tilt, Pokémon in hand; pivot metric × dimension; baselines from an offline sweep of the fit corpus per engine version; style words only over fixed percentile rules; strength band as "experimental" with `n` and held-out error, none under ten games.
- **Opponent model**: conditional tendencies ("switches in 14 of 17 situations with a slower active in KO range"), the read lens with player prior (RNR anchor stays, grading stays equilibrium), later a learned choice model with population prior and shrinkage, pre-registered against held-out log loss. On top, the prepare view `/player/<name>/vs/<opponent>`.
- **Two surfaces** (user 04.09. 11:48): the public site (companion and dashboard, runs in the browser, never holds a Showdown account) and the local app (`apps/local`, Node on the own machine with a console on localhost in the same skin, golden header bar): bot, live assistant, guardrail switch, account; library by export/import between the two, no server in between.
- **Backup** (user 05.09.): "Back up all replays" in the settings (and per player): a JSON library file (every replay with log, index row, facts, grades; the same format as the exchange with the local app) and a ZIP with one replay .html each in the Showdown "Download replay" format (the parser moves to replay-core, the export is its exact inverse); restoring by drop on the entry, never deletes.
- **Battle bot** (in the local app, Node): logs in through `@pkmn/login`, plays with the engine on the Node executor (own team exactly from the request, opponent by inference plus library), samples the equilibrium mix or plays the read, picks teams from the Smogon dump and from scouted open team sheets (Champions VGC has no dump and its own EV system), writes every game into the library. Never on smogtours; ladder only with an account marked by PS staff; on a self-hosted server without permission.
- **Live assistant** last, with guardrails: no help on the smogtours host, in tournament battles (`|rated|` with message), in tournament rooms; ladder-rated off by default, on through a setting with a clear confirmation; spectator overlay for public battles.
- **Team picker** (`team-picker`): parse dump and sheets, check with `TeamValidator`, format fitness against current usage stats (usage rank, set match, threat coverage by KO odds, age discount), rank = normalized source score × fitness, top 10 in round robin, optionally against the concrete opponent.

Decisions of 04.09. (user): audience tournament players, opponent scouting first; measurement formats `gen9ou` and Champions VGC 2026 (`gen9championsvgc2026regma/regmb` + Bo3), all others run along; compute in the browser; strength band experimental; port the scouter rules to TS and improve them, the old Replay Scouter stays unchanged; opponent grades behind a setting; monorepo in THIS repo with `apps/dashboard` and `apps/companion`; companion at the root WITH `/latest/`, `/v<version>/`, `/versions/` (tags `companion-v*`, start 1.0.0), dashboard under `/dashboard/` with its four channels, old `/v0.x/` paths as redirect stubs, `?replay=` deep links at the root are forwarded.

Order and gates (spec §2): 0 monorepo → 1 scouting core and companion → 2a `eval-runtime` → 2b grades and profiles / 4a bot without model (any order) → 3 opponent model → 4b bot with model → 6 team pipeline → 5 live assistant. Every step has brainstorming polish, a spec section, a plan phase and a gate (lint, knip, package suites, e2e of both apps, API snapshot; three byte-identical feedback runs as soon as a shared package or the pipeline is touched; calibration paired as soon as scores are touched). Phase 0 of the plan is ready at step level (eight tasks: baseline capture, `git mv`, suites with file-relative fixtures, zones and ratchet path rewrite, companion scaffold with redirect, `assemble-site.mjs` with two release lines and `ci.yml`, docs, gate); phases 1 to 6 are written out at step level at the start of each.

First move when it starts: plan task 0.1 (branch `monorepo`, secure the feedback baseline with `FEEDBACK_DUMP=1`), execution at choice subagent-driven or inline.

