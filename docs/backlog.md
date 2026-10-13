# Backlog

This file holds the details of every open TODO, one section per TODO under its fixed T-number. The sections are grouped by the packages of `NextSteps.md`, and a package is one round. The next free T-number is T223.

Evidence paths that start with `r69/` are under `docs/perf/probes/2026-10-12-r69/`.

Source of the new TODOs of round 69: the lane notes, the three review lenses after the merge, the pin diagnosis of lane B and the timing windows of round 69; each claim was checked by a reviewer against the code of the merge state (`r69/review/todos-check.md`, `todos-check-2.md`). Line numbers refer to the state after round 69.

## Next rounds

User gate 13.10.2026, "9a": T221 comes first (the cut for the leaf time of lane B). T163 follows as its own small round (user 13.10.2026, "1a"), then T160 (trigger met). The new TODOs of round 69 are in the packages below; the next spec sets their order.

### T221 · boostsBiting runs one race per pair

*Tempo · mini round · small · lossless D4 · round 69 · rest of T49 and T102*

**Problem.** In the quiet timing window of round 69, lane B alone costs the singles tree +14.3% (20 positions, 56.9 to 65.1 s; D alone +1.3%), above the +5% limit of decision 4 of the round. For every stage and every opponent, boostsBiting runs its own 1-vs-1 race with and without the stage (`score/boost-bite.ts`, bitingStats). B's probe says the races and the threat lookups cost the time, not the ModifyBoost event (`lanes/B/ledger.md` line 34). B's cut: one race per pair for all values, a separate race only where the effective stages differ.

**Benefit.** Tempo: the singles analysis is as fast as before the wave again, with the same numbers.

**Success.** Features byte-identical (fit corpus and bank); singles tree in the quiet window at most +5% against the state before round 69.

**Evidence.** `r69/gate/timing-b-only-singles.txt` (B alone +14.3% singles tree), `r69/gate/timing-d-only-singles.txt` (D alone +1.3%), `r69/lanes/B/ledger.md` line 34 (cost of the races, the proposed cut), `packages/eval-engine/src/score/boost-bite.ts` (bitingStats, raceOn).

**Steps.**
- [ ] Byte check first: boostsBiting equal on all positions of the fit corpus before and after the cut, singles and doubles.
- [ ] One race per pair with all effective stages, a separate race only for values whose stage set differs.
- [ ] Quiet timing window: singles tree at most +5% against the state before round 69.

### T163 · Leaf K per family, fitted on search values

*Re-fit · round · medium · score-touching D3 · absorbs T164 · needs T144 and T102*

**Problem.** One doubles K for all doubles families did not hold. T52 fitted it on the bank and won there (fixed K −36 bp); the doubles OU holdout read it worse (own K +15 [+5, +24]); the VGC holdout read it better only late (−17 [−31, −3]). Bank doubles OU and holdout contradicted each other. Champions OU shows the same: the fitted K (1.64 + 4.41 × share of fainted Pokémon) read better early and late and worse in the middle (fixed K +35 [+7, +65], own K +26 [+3, +47]); the fit ran on static values, while the holdout searches. Untested is a K per family, fitted on the corpus with root values of the search. `winprobK` already takes a ruleset (`winprob.ts:79-82`), and Champions VGC has had its K since T138. Before any Champions doubles re-fit a new capture is needed: F3 ran under the old doubles K, and `regression/fit-families.ts:179` throws as long as `EVAL_FIT_FAMILIES` does not exclude Champions doubles.

**Benefit.** Engine: doubles OU, VGC and Champions OU each get a K that reads their own games.

**Success.** Fit per family on root values of a capture with search; bank plus holdout (D26) with a resolved better doubles row, no pooled harm and no warning in both tables; Champions OU holdout without a warning and better than the base.

**Status (round 69).** Moved behind the wave (user 13.10.2026, "1a"); the tools of lane B stay in the code (family filter of the capture, `rootScaleReports` in `regression/fit-families.ts`, 426e466).

**Evidence.** Numbers from lane F of round 67 (measurements f5 and f6), proofs in `todo-verification.md`.

**Steps.**
- [ ] New capture of the corpus in the app build with root values of the search, Champions doubles included (F3 ran under the old doubles K; `regression/fit-families.ts:179`).
- [ ] Fit per family (doubles OU, VGC, Champions OU) with the tools from T138; rules set in advance.
- [ ] Bank plus holdout (D26) with fixed and own K; Champions OU holdout.
- [ ] Adopt only with a resolved better doubles row, no pooled harm and no warning.

### T160 · Champions rules from the battle's dex

*Champions · round · medium · score-touching D3 · parked until after wave 3*

**Problem.** 82 places in eval-engine (27) and replay-core (55) read rules from the global dex instead of the battle's dex (count of 12.10. on r67); 20 of them read species or natures that the mod does not change. The mod deviates in 155 moves: 55 only in PP, 45 only in availability, 40 in mechanics (power 23, accuracy 5, flags 7, secondary effects 4, type 2, plus typed Hidden Power); also 7 abilities, 1 item, paralysis, sleep and freeze. Examples with a wrong rule in Champions: `damage-calc.ts:184` (onModifyMove from Scarlet/Violet), `pokemon-info.ts:29` (the old type of Snap Trap), `trigger-evidence.ts:78` (White Herb from Scarlet/Violet). The replay-core half has the same blocker as T159: at inference time there is no battle and no mod. Data: `docs/perf/probes/2026-10-10-r67/lanes/F/out/global-dex-census.json`, `mod-diff.json`.

**Benefit.** Champions: every rule that reads a position is the rule of the game.

**Success.** Each of the 62 open places reads the battle's dex or is proven format-free; Champions holdouts without pooled harm.

**Trigger.** Met, wave 3 is booked (13.10.). The places lie in the files of all lanes, so this gets its own round. T186 took part of the calculator places ahead.

**Evidence.** The count of 12.10. ran with the census script of lane F on r67 (82 places in 34 files); the data of round 67 is in `lanes/F/out/global-dex-census.json` and `mod-diff.json`.

**Steps.**
- [ ] Recount on the state after wave 3; prove the 20 format-free places (species, natures).
- [ ] eval-engine: every place reads the battle's dex (`battle.dex`).
- [ ] replay-core: the same solution as T159 (one dex or move reader that the host passes in).
- [ ] Champions holdouts without pooled harm; bank paired.

## Package A · Doubles search and verify rows

### T194 · Why the answer round overrates Protect plus Tera Starstorm

*Doubles search · mini round · small · score-touching D3 · round 69*

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

**Problem.** The expert pin smogtours-gen6ou-653785 t19 (3d sacrifices Weavile into Stealth Rock) has flipped since T102: p1 reads an inaccuracy (0.025 on 0.142), and the sentence about the sacrifice is missing. No single static term explains it; the regret swings with the search budget between 0.034 and 0.259 (base 0.010 to 0.046), because the verify round recalculates different rows in each run: the base checks only the cells of Pain Split, not those of Hex, and with Hex checked even the base reads 0.109. Proposal: check the same set of rows in every run (played row, best row, rows up to 0.1 behind the best), then re-read the pin. Replaces the watch item in section C ("Pin 653785 turn 19 ... hangs on shaky numbers"): the pin has flipped.

**Benefit.** Engine: a verdict does not depend on which rows the verify round happens to catch.

**Success.** Regret of 653785 t19 stable across search budgets, pin re-read; tree time within the timing window.

**Evidence.** `r69/lanes/B/diagnosis-pins.md` (pin 2, regret 0.034 to 0.259 per search budget, base 0.010 to 0.046, Hex checked 0.109), `r69/lanes/B/pins/tree-...-keephex.json`, `search/verify-select.ts:101-118` (supportMass), `e2e-feedback/corpus.ts:177-179`, the NextSteps watch item in section C (pin 653785 turn 19), `r69/review/todos-check-2.md` (T219).

**Steps.**
- [ ] Red test: the regret of 653785 t19 across search budgets of 500, 600 and 700 iterations; today 0.034, 0.142, 0.244 (singles).
- [ ] The verify round takes the same row set in every run: played row, best row and rows up to 0.1 behind the best (instead of equilibrium support plus the played row); then re-read the pin.
- [ ] Regret stable across search budgets, tree time within the timing window; the watch item in section C is struck.

### T196 · Speed tie from the simulator

*Rule fidelity · mini round · small · rest of T146 · round 69*

**Problem.** `search/leaf.ts:83-91` (speedTie) decides a tie by hand from dex priority and effective speed (effective initiative) and has driven the root sampler, the tree and rollSensitivePair since T146. Prankster, Gale Wings, Quick Claw and Stall are missing. Where the rule reports a tie that does not exist, it only costs compute time; where it misses a real one, the tree lacks the second order. This contradicts the guideline of 02.10.; `search/event-reach.ts` shows the pattern (script, read the log).

**Benefit.** Engine: one game rule less by hand, no missed tie.

**Success.** Checker against the simulator (Prankster and Quick Claw on a tie), bank byte-identical or paired.

**Evidence.** `search/leaf.ts:83-91` (speedTie), callers in `cell-sampler.ts:346`, `expansion.ts:88`, `outcome-children.ts:216`, `:253` and `leaf.ts:101` (rollSensitivePair), `forward/scripted-prng.ts:106-115`, pattern `search/event-reach.ts`, `r69/review/lens-BD.md` (finding 8), `r69/review/todos-check.md` (T196: a real, missed tie stays unpriced).

**Steps.**
- [ ] Red checker against the simulator: a Prankster status move against a move of equal priority at equal speed (false tie), Prankster Thunder Wave against Quick Attack and a Quick Claw case (real tie that the rule misses); singles and doubles.
- [ ] Answer `speedTie` through the simulator (script, read the log, like `event-reach.ts`) instead of by hand from dex priority and effective speed.
- [ ] Bank byte-identical or paired, tree time within the timing window.

### T198 · Fickle Beam in the scripted chance

*Search · mini round · small · rest of T154 · round 69*

**Problem.** For a kill class that only the doubled power of Fickle Beam reaches, `search/outcome-children.ts:131-136` writes the roll -1 (101%); `forward/scripted-prng.ts` does not know the doubling. No wrong value reaches the tree (the roll drops out), but the class stays unreached. Affects the singles path (scriptFor); doubles draw the power in `pair/prng.ts`.

**Benefit.** Engine: the rare kill class is drawn instead of estimated.

**Success.** Checker against the simulator (Fickle Beam doubled, kill only that way), singles.

**Evidence.** `search/outcome-children.ts:131-136` (scriptFor, roll -1), `:197-203` (forceMissing), `ko-odds.ts:180-184`, `forward/scripted-prng.ts` (no doubling), `calc/fickle.ts` (strengthMix), `pair/prng.ts` (strengthDraw, doubles path), `r69/lanes/D/ledger.md:73` (point 1), `r69/review/lens-BD.md` (finding 7).

**Steps.**
- [ ] Red checker against the simulator: a kill class that only the doubled power of Fickle Beam reaches; the tree draws it instead of leaving it unreached (singles; doubles draw the power in `pair/prng.ts` and are not affected).
- [ ] Script the power through `ScriptedPRNG`; its factor comes from the dex handler, as with `strengthMix`, not from a list.
- [ ] Bank paired.

## Package B · Static evaluation repairs

### T199 · pairFocus as a ramp instead of a switch

*Static weights · mini round · small · score-touching D3 · rest of T42 · round 69*

**Problem.** pairFocus is a 0/1 gate: "alone neither makes it, together both do" (`score/field-pair.ts:43`). On the final state the VGC grade drops in 24 of 103 runs when an opponent takes further damage (all 54 VGC positions, probe `lanes/B/vgc-monotone.vt.ts`; 16 before the VGC adoption of boostsBiting); the largest drop is 0.098, Calyrex-Shadow in 2630677822#6 from 60 to 50%. With pairFocus at 0, 9 runs still break: boostsBiting 16 in VGC itself depends on the race and so on the opponent's HP. Proposal: a continuous ramp over the KO window, then re-fit. (Gate question 13.10.: keep −188 or 0 until then.)

**Benefit.** Engine: more damage on the opponent does not lower the grade through pairFocus.

**Success.** Monotony probe without breaks through pairFocus, R1 to R3 in VGC (bank plus holdout).

**Evidence.** `score/field-pair.ts:43` (gate `best < foeHp && total >= foeHp`), `score/weights.ts:307`, `:315`, `:321` (VGC_DOUBLES_FEATURE_WEIGHTS, pairFocus -188), `r69/lanes/B/vgc-monotone.vt.ts` and `r69/lanes/B/out/vgc-monotone-all.json`, `r69/review/todos-check-2.md` (T199: 24 of 103 on the merged state, 16 before S17), `r69/review/lens-BD.md` (finding 2), gate question in `r69/progress-ledger.md:138`.

**Steps.**
- [ ] Red check: the monotony probe (54 VGC positions, 103 runs) on the merged state; success counted as breaks through pairFocus (24 at -188, 9 at pairFocus 0; the second source is boostsBiting 16 in VGC).
- [ ] pairFocus as a continuous ramp over the KO window instead of a 0/1 gate; then re-fit (weight -188 or 0 until then, after the gate answer).
- [ ] Monotony probe without breaks through pairFocus, R1 to R3 in VGC (bank plus holdout); standard doubles does not carry the feature and stays untouched.

### T218 · boostsBiting sees who stands in front

*Static weights · mini round · small · score-touching D3 · rest of T49 · round 69*

**Problem.** The expert pin smogtours-gen8ou-562428 t10 (an open read move, Heatran switch) has flipped since T49: boostsBiting 95 rates Tapu Bulu +2 Atk at 63 points (before: 24), because the stage bites 2 of 6 living opponents. In the cell Swords Dance against the Heatran switch, Rotom and Landorus-T on the bench count, while Heatran stands in front, which the stage does not bite and which Bulu hits for 98%. p2's Pain Split thus reads as an error (regret 0.029 to 0.285). A weight alone probably does not help (by B's estimate it would have to be below 50, outside the fit band 77 to 112). Proposal: the gate counts a bench opponent only if the front opponent does not stop the stage, then re-fit.

**Benefit.** Engine: a boost counts as much as it is worth against the actual opponent in front.

**Success.** Pin 562428 t10 OK again, R1 to R3 in the singles families.

**Evidence.** `r69/lanes/B/diagnosis-pins.md` (pin 1, cell Swords Dance against the Heatran switch, 0.667 times 95 equals 63 points against 24), `r69/lanes/B/pins/matrix-smogtours-gen8ou-562428#10.json` (tables w70, w50, w25), `r69/lanes/B/pins/bite-...txt`, `score/boost-bite.ts:143`, `:159`, `e2e-feedback/corpus.ts:161-163`, `r69/review/todos-check-2.md` (T218: "below 50" is an estimate).

**Steps.**
- [ ] Red test: the position 562428 t10 (singles); a stage counts a bench opponent only if the front opponent does not stop it (Heatran hits Bulu for 98%); today Rotom and Landorus-T count too.
- [ ] The gate in `boost-bite.ts` aware of the front, stage and race from the simulator; then re-fit (the band 77 to 112 holds for the old form).
- [ ] Pin 562428 t10 OK again; R1 to R3 in the singles families (bank plus holdout); T199 checks the doubles tables with boostsBiting.

### T220 · Drain moves are not healers

*Statics · mini round · small · score-touching D3 · round 69*

**Problem.** `score/races.ts` (healProfile) reads the heal flag of drain moves such as Horn Leech as a 50% healer with 16 AP. Tapu Bulu thus counts against Heatran, Corviknight, Weavile and Blacephalon as a healer that never attacks. The dex distinguishes healing (Recover) from draining (drain).

**Benefit.** Engine: races with drain attackers run as in the game.

**Success.** Checker against the simulator (Horn Leech against Recover), bank paired.

**Evidence.** `score/races.ts:22` (HEAL_FRACTION_DEFAULT), `:49-60` (healProfile), `:106-110` (raceClocks), `r69/review/todos-check-2.md` (T220: dex probe, Horn Leech has `flags.heal` and `drain: [1,2]`, no `heal`; Recover and Roost have `heal: [1,2]`), `r69/lanes/B/pins/bite-...txt` (Bulu against Heatran, Blacephalon, Corviknight, Weavile: duration Infinity).

**Steps.**
- [ ] Red checker against the simulator: Horn Leech against Recover; Horn Leech heals 50% of the damage and attacks, Recover heals 50% of the HP.
- [ ] `healProfile` distinguishes healing (`heal`) from draining (`drain`) through the dex.
- [ ] Bank paired; singles and doubles share `races.ts`.

### T201 · The static capture knows its form

*Fit tool · mini round · small · rest of T102 · round 69*

**Problem.** Since T102 the statics in standard singles compute with the phase form (EVAL_STATIC_FORM, on by default). A new capture stores the grade with the form, the fit rebuilds it from the table; the identity check holds only if you name the form columns and the weights of the capture by hand (`regression/fit-families.ts`, B ledger line 122). The capture should write form and weights itself.

**Benefit.** Measurement: a re-fit starts without manual work and without false alarms.

**Success.** Capture plus fit without extra variables, identity 0.

**Evidence.** `score/phase-form.ts:34-35`, `:52-55` (staticFormOn), `eval-function.ts:46`, `regression/fit-families.ts:234-235`, `:244-252` (identity check), `regression/eval-calibration.spec.ts:5531`, `:5819-5823` (leafValue as capture grade), `regression/eval-fit.spec.ts:175-176`, `:246-250` (EVAL_FIT_FORMS, EVAL_FIT_CAPTURED), `r69/lanes/B/ledger.md:122`, `r69/review/lens-BD.md` (finding 4).

**Steps.**
- [ ] Red test: a new capture of the standard singles statics, then `familyReports`; today the identity check throws `identity: N of M captured scores differ`.
- [ ] The capture writes the form (EVAL_STATIC_FORM) and the weights of the capture itself; the fit reads them from there, not from environment variables set by hand.
- [ ] Capture plus fit without extra variables, identity 0 (standard singles; the other families carry no form).

## Package C · Spread solver, hits and the Choice check

### T202 · Expanding Force and Tera Starstorm without [spread]

*Calculator fidelity · mini round · small · library gap · round 69*

**Problem.** calc 0.12 sets the spread target and the 0.75 cut itself for Expanding Force in Psychic Terrain (`gen789.js:773-774`) and for Tera Starstorm of Stellar Terapagos (`gen789.js:228-229`), even when the log shows no `[spread]`; the target override in `spreads/observation-read.ts:56-58` is thereby undone. Scene: Hatterene hits Clefable alone with Expanding Force, simulator 322 damage, calculator 237 to 279. The same gap hits the doubles preview and kill table (lane D, ledger line 73, point 2). Noted on the upstream list for the user; until the fix, such an observation drops out, recognised by the calculator's result, not by move names.

**Benefit.** Sets and preview: no spread and no kill odds from a wrongly cut hit.

**Success.** Checker against the simulator, doubles and VGC; after the upstream fix the removal of the workaround.

**Evidence.** `@smogon/calc/dist/mechanics/gen789.js:773-774` (Expanding Force), `:228-229` (Tera Starstorm, Stellar Terapagos only), `:1224-1226` (spread factor), `spreads/observation-read.ts:56-58`, `r69/review/lens-AFE.md` (finding 1, scene Hatterene against Clefable, 322 against 237 to 279), `r69/review/todos-check.md` (old T201: own probe confirms the mechanism), `r69/lanes/D/ledger.md:73` (point 2, preview and kill table), `:74` (upstream list).

**Steps.**
- [ ] Red checker against the simulator: doubles, Psychic Terrain, Hatterene hits Clefable alone with Expanding Force; the observation holds the simulator damage (322); plus a VGC scene with Tera Starstorm of Stellar Terapagos on a single target.
- [ ] Detection from the calculator's result (spread target set although the log shows no `[spread]`), not from move names: the observation drops out; the same detection for the preview and the kill table of doubles.
- [ ] Remove it once calc has the fix; until then the entry stays on the upstream list for the user. Checker against the simulator, doubles and VGC.

### T203 · Field abilities of the partner in the hit

*Spread solver · mini round · small · rest of T86 · round 69*

**Problem.** Battery, Power Spot, Steely Spirit and Friend Guard print nothing in the log; `protocol/hit-facts.ts` (fieldFactsOf) reads them only if the ability became visible another way. Flower Gift is missing from the tables (`calc-field.ts:31-39`). Review probe p7: Charjabug (Battery) next to Garchomp, Clefairy (Friend Guard) next to Blissey, all four observations without fieldFacts. Two ways: the dex for species with a single ability (Charjabug) and the ability from the built set of the partner (lane A, ledger line 90, point 4); Clefairy's hidden Friend Guard only the second covers.

**Benefit.** Sets: doubles hits next to such partners are priced correctly.

**Success.** Checker against the simulator (both scenes), doubles.

**Evidence.** `protocol/hit-facts.ts:48-62` (fieldFactsOf), `calc-field.ts:31-39` (tables without Flower Gift; `field.d.ts:43` knows `isFlowerGift`), `r69/review/lens-AFE.md` (finding 3, probe p7), `r69/lanes/A/ledger.md:90` (point 4: ability from the built set), `r69/review/todos-check.md` (old T202: Clefairy's Friend Guard is hidden, the dex way alone is not enough).

**Steps.**
- [ ] Red checkers against the simulator: doubles, Charjabug (Battery) next to Garchomp, Clefairy (Friend Guard) next to Blissey; today all four observations have no `fieldFacts`.
- [ ] Two ways: the dex for species with a single ability (Charjabug) and the ability from the built set of the partner (covers Clefairy's hidden ability); Flower Gift into the tables.
- [ ] Doubles and VGC; the doc at `types.ts:156` says "when the ability was shown"; holdout doubles paired.

### T204 · The Choice check reads the field of the hit

*Calculator fidelity · mini round · small · score-touching D3 · rest of T193 · round 69*

**Problem.** After T193 the Choice check knows the defender's item, but it computes every hit on an empty field, without Tera, without a Paradox value and with the built item (`choice-lock.ts:318`, explainsWith). Since this round the observation carries the item at the hit, Tera, Paradox value, weather and screens (T86, T167, T191). Only singles are affected; doubles bypass the check.

**Benefit.** Engine: a Choice lock is not read from a Quark Drive or Tera hit.

**Success.** Checker (Quark Drive Atk, Tera STAB), bank paired.

**Evidence.** `eval-engine/src/choice-lock.ts:279-286` (calcAttacker: `tera: null`), `:318` (`new Field({})`, explainsWith), `:383-385` (doubles path), `replay-core/src/types.ts:98-160` (DamageObservation), `r69/review/lens-AFE.md` (finding 4).

**Steps.**
- [ ] Red tests: a guessed Choice Band on a Quark Drive attacker (Atk ×1.3) and a Tera STAB hit; today the check reads them as Band proof or contradiction for the wrong reason. Singles only; doubles bypass the check.
- [ ] `explainsWith` computes with the item at the hit, Tera, Paradox value, weather and screens of the observation (T86, T167, T191) instead of an empty field and the built item.
- [ ] Bank paired.

### T207 · Hidden Power in doubles

*Spread solver · mini round · small · round 69*

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

**Problem.** Without a published set the solver starts from a default per species. Lane A proposes naming the source of the prior (published set, usage data, default per species), so that the T132 rule treats a guessed speed value differently from a published one.

**Benefit.** Sets: the speed rule knows how much a starting value weighs.

**Success.** Set diff (D8), fit error per family, bank paired.

**Evidence.** `r69/lanes/A/ledger.md:105` (point 1: name the source of the prior; example GPL Uxie 0/252/0/0/4/252), `r69/review/todos-check.md` (old T208: the goal is the gate of the T132 rule, not a ranking of the sources), `replay-core/src/spreads/ev-budget.ts:22-23`, `:45`.

**Steps.**
- [ ] Red test: two solver runs with the same starting value, one from a published set, one from the default per species; the T132 rule treats the guessed speed value differently from the published one (singles and doubles).
- [ ] The prior carries its source (published set, usage data, default per species) up to the rule.
- [ ] Set diff (D8), fit error per family, bank paired.

### T210 · Move powers from the battle history in the spread solver

*Spread solver · round · medium · rest of T86 · round 69*

**Problem.** Lane A found hits that the solver prices wrongly or skips: Last Respects and Rage Fist (power from the history), Hex and Venoshock (defender's status; the solver has read Brine through the HP at the hit since T86), Stakeout, Analytic, Plus and Minus (ledger line 90, points 1 to 3; Plus and Minus need the partner's ability as in T203); in addition the item judge skips hits where the item changed, such as a resist berry (ledger line 56, point 1).

**Benefit.** Sets: more valid observations, fewer wrongly priced ones.

**Success.** Checker against the simulator per group, singles and doubles.

**Evidence.** `r69/lanes/A/ledger.md:90` (points 1 to 3), `:56` (point 1, item judge), `r69/review/todos-check-2.md` (T210: Brine read through the HP at the hit since T86, `hit-facts.ts:76`, `observation-read.ts:100`; open are Hex and Venoshock, `gen789.js:560`, `:768`; Plus, Minus, Stakeout, Analytic through `attacker.abilityOn`, `gen789.js:866-867`, `:1019`, `:1038`), `fit.ts:200`, `team/item-damage-shared.ts:64`, `team/item-damage-defender.ts:129`.

**Steps.**
- [ ] Red checkers against the simulator per group, singles and doubles: Last Respects and Rage Fist (power from the history), Hex and Venoshock (defender's status), Stakeout, Analytic, Plus and Minus; plus a hit with a changed item (consumed resist berry).
- [ ] The observation carries the number of fainted Pokémon, the defender's status and the partner's ability (Plus and Minus through the way from T203); the item judge no longer skips hits with a changed item.
- [ ] Count of valid and wrongly priced observations before and after; set diff.

### T222 · Gen 1 and 2 build at the server start

*Sets · mini round · small · score-touching D3 · round 69 · rest of T192*

**Problem.** T192 gives a set without EVs in Gen 1 and 2 the server start (252 in every stat, one Special), but the build never hands the solver a set without EVs: review probe p6 builds Starmie in gen1customgame and gen2customgame with 248/0/0/4/4/252, the 508 default per species (`spreads/ev-budget.ts:22-23`). With fewer than two clean hits this spread stays. The one-Special rule reads the format by regex over the name instead of the generation from the dex. No bank and no feedback game plays Gen 1 or 2.

**Benefit.** Sets: Gen 1 and Gen 2 bodies read the way the server plays them.

**Success.** Checker against the simulator (Starmie in Gen 1 and Gen 2), set diff without effect on later generations.

**Evidence.** `r69/review/lens-AFE.md` finding 5 (probe p6: Starmie 248/0/0/4/4/252 in gen1customgame and gen2customgame), finding 8 (one-Special rule by regex), `packages/replay-core/src/spreads/ev-budget.ts:22-23`.

**Steps.**
- [ ] Red test: the build of a Gen 1 and a Gen 2 replay gives the solver the server start (252 in every stat, one Special), checked against the simulator.
- [ ] The default prior per species gets the same start in Gen 1 and 2; the one-Special rule reads the generation from the dex instead of the format name.
- [ ] Set diff (D8) on bank and fit corpus: no movement in Gen 3 and later.

## Package D · Rebuild fidelity

### T212 · Start volatiles that the protocol shows

*Rebuild · mini round · small · rest of T172 · round 69*

**Problem.** The board does not know every `-start` that the log shows (Salt Cure in 752733, boostedStat lines). Rebuild them through the simulator's `addVolatile`.

**Benefit.** Engine: the rebuild carries the effects that the game carries.

**Success.** Count in the corpus before and after, checker against the simulator.

**Evidence.** `r69/lanes/E/ledger.md:13` (Salt Cure, 752733 turns 15 to 17), `:58` (point 1: boostedStat lines, 107 of 38,897 bank bodies deviate), `r69/lanes/E/out-c4-split.txt`.

**Steps.**
- [ ] Count in the corpus before: `-start` lines of the log that the board does not carry (Salt Cure, boostedStat), singles and doubles separately.
- [ ] Red checker against the simulator: Salt Cure in 752733 turns 15 to 17 takes effect in the rebuild; the line is played through the simulator's `addVolatile`, without a list of effects.
- [ ] Count after; the 107 deviating bodies drop.

### T213 · Outrage lock in the opposite direction

*Rebuild · mini round · small · rest of T187 · round 69*

**Problem.** Lane E found the reverse case: the game holds the lock, the simulator ends it (2663114473 t12, Dragonite). Counted, not built.

**Benefit.** Engine: locks end in the rebuild as in the game.

**Success.** Count, checker.

**Evidence.** `r69/lanes/E/ledger.md:36`, `:40` (2663114473 turn 12, p2 Dragonite: the game holds the lock, the board has lost it and is confused), `:58` (point 2), T187 (751466 turn 7, the other direction).

**Steps.**
- [ ] Count in the corpus: games in which the simulator ends a lock that the game holds (Outrage and other random lengths), singles and doubles.
- [ ] Red checker against the simulator on 2663114473 turn 12: the rebuild keeps the lock.
- [ ] Count after.

### T214 · A Sitrus witness from the HP

*Rebuild · mini round · small · rest of T172 · round 69*

**Problem.** In 939635 the simulator eats Sinistcha's Sitrus Berry, while in the game she stays at 52 to 55% and keeps the berry. Lane E restores items only for bodies that the protocol never showed. The count finds 16 Sitrus lines of switched-in bodies: 8 of Tyranitar (2660826377), which the game already refutes (it falls to 25% without eating), 4 of Sinistcha in 939635, 4 of Ogerpon and Indeedee. A witness from HP and threshold decides the 8 open ones and confirms the 8 of Tyranitar.

**Benefit.** Engine: the board carries the berry that the game still has.

**Success.** Count of the 16 lines before and after, checker against the simulator.

**Evidence.** `r69/lanes/E/ledger.md:14` (count, 16 lines), `:18` (names 15; the raw output `r69/lanes/E/out-c4-split.txt` lines 3-4 and 17-34 gives 16), `r69/review/todos-check-2.md` (T214), games 939635, 2660826377, 2660802611, 913990, 938638.

**Steps.**
- [ ] Count of the 16 Sitrus lines before: 8 of Tyranitar (2660826377, already refuted by the game), 4 of Sinistcha (939635), 1 each of Ogerpon (2660802611) and Indeedee (913990), 2 of Indeedee (938638).
- [ ] Red checker against the simulator: Sinistcha stays at 52 to 55% and keeps the berry; a witness from HP and threshold (singles and doubles, the threshold from the dex) decides the 8 open lines and confirms the 8 of Tyranitar.
- [ ] The rebuild restores the berry only after this witness; count of the 16 lines after.

## Package E · App and report

### T205 · Export and panel: guessed values as own values

*App · mini round · small · rest of T136 · round 69*

**Problem.** Since T136 the sets export also writes IVs from the published set (`src/lib/sets-io.ts:43`); on paste the app reads them as the user's own input (`team/set-resolvers.ts:46`, `:260`). A Sinistcha with a published Speed IV of 0 then keeps 0, even when the log refutes it (T132 point 2). The export reads the enriched infos, so the exported EVs are also estimates. Ways: export from `statsP1Info`, or do not read IVs as own values on re-import (App.tsx). In addition lane A's proposal 1: the panel does not show 13 of 332 built sets with non-31 IVs (team list, Hidden Power).

**Benefit.** App: an export and re-import changes no inference; the panel shows every played IV.

**Success.** UI test export and import, singles and doubles; panel count 332 of 332.

**Evidence.** `src/lib/sets-io.ts:37`, `:42`, `:43`, `replay-core/src/team/set-resolvers.ts:46`, `:260`, `replay-core/src/team-paste.ts:130`, `team-sheets.ts` (applyTeamSheetToInfo), `r69/review/lens-AFE.md` (finding 2), `r69/lanes/A/ledger.md:143` (points 1 and 2), commit f055a3c.

**Steps.**
- [ ] Red UI test export and re-import with Sinistcha (published Speed IV 0, refuted by the log): after the import the inference stays the same; singles and doubles.
- [ ] Export from `statsP1Info` (solved values) or do not read IVs as own values on re-import (settle who owns App.tsx); the guessed EVs and natures in the export fall under the same rule.
- [ ] Panel shows every played IV (team list, Hidden Power): count 332 of 332 built sets, today 13 of 332 without a display.

### T215 · The fast picker shows the base type wrongly

*App · mini round · small · rest of T158 · round 69*

**Problem.** Before any Tera click the fast picker shows the plain type instead of the type at use for some moves: 13 + 19 + 0 wrong labels in lane E's count (Weather Ball, abilities that T85 left out). In addition `probeBody` in `branch/pokemon-info.ts` stores only successes: on Champions before the mod loads, the picker rebuilds up to three failing battles per body and render.

**Benefit.** App: the label shows the type with which the move hits.

**Success.** UI test against the simulator, count 0.

**Evidence.** `r69/lanes/E/ledger.md:52`, `:58` (point 3: 13 + 19 + 0 places, snapshot path, no click effect), `branch/pokemon-info.ts` (probeBody stores only successes), `src/lib/picker-state.ts:106`, `r69/review/lens-AFE.md` (finding 12), lane G (T182, full path with `onModifyType` on a clone).

**Steps.**
- [ ] Red UI test against the simulator: before any Tera click the fast picker shows, for Weather Ball (without weather) and for abilities that change the type (Hyper Voice of a Sylveon), the type with which the move hits; singles and doubles.
- [ ] The snapshot path reads weather and ability of the body; `probeBody` also remembers failures, so that Champions before the mod loads does not build three failing battles per body and render. The intermediate type `LabelledMoveOption` in `picker-state.ts:106` goes.
- [ ] Count of wrong labels 0 (today 13 + 19 + 0).

### T216 · Variation and main line show one card

*Display · mini round · small · rest of T51 · round 69*

**Problem.** A branch result in the panel stays at the opening card, while the tooltip of a variation in the graph takes the share of the main line (`src/components/EvalPanel.tsx:134` against `src/lib/eval-graph-view.ts:162`): late variation 92% in the tooltip, 81% in the panel. The share of the main line is also not the share of the variation board.

**Benefit.** App: the same position, the same number.

**Success.** UI test, singles and doubles.

**Evidence.** `src/components/EvalPanel.tsx:134` (shownShare), `src/lib/eval-graph-view.ts:161-163` (variationHitTitle), `src/hooks/evaluation/sweep-core.ts:42-54` (faintedFractions only in the engine `auto`), `r69/review/lens-CG.md` (findings 1 and 3), `percent-share-t51.spec.tsx:59`, `:103` (feeds faintedFractions by hand).

**Steps.**
- [ ] Red UI test: late game, share 0.5, the same position in the panel and in the graph tooltip of the variation; today 92% against 81%. Additionally with the engine setting Matrix and MCTS, where `faintedFractions` stays empty; singles and doubles.
- [ ] Panel and tooltip read the same share, that of the variation board, not that of the main line (`turnFaintedFraction` with a snapshot fallback, or hold the share in every mode).
- [ ] Test green in all three engine modes.

### T217 · Luck and hindsight in doubles without a protocol

*Report · mini round · small · rest of T178 · round 69*

**Problem.** T178 carries plan and classes only for singles; a doubles move without a protocol keeps ungated luck sentences (`turn-analysis/luck.ts:103-106`, mcts.ts planRootCells). In addition luck.ts reads a cell that the planner calls deterministic as "nothing rolled", although the planner prices only hit and kill (Body Slam paralysis, Scald burn). The hindsight gate checks only the cell of the best row (`turn-analysis/signals.ts:190`), not that of the played row.

**Benefit.** Report: doubles sentences stand on the same basis as singles.

**Success.** Specs per sentence, feedback with tier count.

**Evidence.** `turn-analysis/luck.ts:103-106` (rolledFromCell), `mcts.ts:308-310` (planRootCells for singles only), `cell-blend.ts:140-152` (planCellEvents: hit and kill), `turn-analysis/signals.ts:190` (bestRow instead of the played row), `analysis-context.ts:74`, `r69/review/lens-CG.md` (findings 4, 5, 6, 8).

**Steps.**
- [ ] Red specs per sentence: a doubles move without a protocol gets only gated luck sentences; a cell `none` with Body Slam paralysis or Scald burn does not count as "nothing rolled"; the hindsight gate also checks the cell of the played row.
- [ ] Carry `plan` and `classes` for doubles too; `luck.ts` reads "no priced roll" instead of "deterministic"; the summary sentence for a pair uses the split test of `hindsightLine` (finding 8).
- [ ] Feedback with tier count for singles and doubles.

## Package F · Cleanup and tooling

### T197 · One target at use, one redirect rule

*Cleanup · mini round · small · round 69*

**Problem.** "Target at use" exists twice with different reach (`search/hints.ts:199-203` without Expanding Force, `pair/odds.ts:34-49` with it), `redirectsFoes` twice with the same body (`search/hints.ts:61`, `score/field-pair.ts:25`). One place per rule stops the drift.

**Benefit.** Engine: the hints and the odds read the same rule.

**Success.** Specs of both places green, bank byte-identical.

**Evidence.** `search/hints.ts:199-203` (RULE_MOVES, `move-use.ts:66`, `move-use-rules.ts:100-113`), `pair/odds.ts:34-49` (targetAtUse, exported since c7a78b4), `search/hints.ts:61` and `score/field-pair.ts:25` (redirectsFoes), `r69/review/lens-BD.md` (findings 6 and 10).

**Steps.**
- [ ] Red test: doubles, grounded user in Psychic Terrain with Expanding Force; the hint (combinedOptionHints) and the odds read the same target (today a single target against both opponents).
- [ ] Merge `targetAtUse` into one place (the handler reading from `pair/odds.ts`) and `redirectsFoes` into one place; the second place imports.
- [ ] Specs of both places green, bank byte-identical; singles are not affected (the rules apply only with several targets).

### T200 · Bank rows from games that end in a forfeit

*Measurement · mini round · small · round 69*

**Problem.** The T39 sighting found that 68 of 193 early singles rows of the bank come from games that end in a forfeit. An early state of a forfeited game measures the statics against an outcome that no move decided.

**Benefit.** Measurement: the bank verdict weighs rows by how much they say.

**Success.** Count per family, verdict with and without these rows; decision at the gate.

**Evidence.** `r69/lanes/B/ledger.md:125`, `:139` (68 of 193 early singles rows, 26 of 92 both-wrong rows, 9 of 28 sure ones), `r69/lanes/B/sight-t39.vt.ts` with readers `out/sight-read.mjs`, `out/sight-sum.mjs`, `r69/progress-ledger.md:105`.

**Steps.**
- [ ] Count per family (singles, doubles, VGC, Champions): rows from games that end in a forfeit, and their share of the rows of the verdict.
- [ ] Compute the bank verdict with and without these rows (error bars as in round 48), singles and doubles separately.
- [ ] Decision at the gate: exclude the rows, weigh them less or keep them.

### T206 · Replay logs with CRLF

*Parser · mini round · small · round 69*

**Problem.** The parser reads no damage observation from a log with Windows line endings (006b33c: 0 against 15 for the same log with LF); about 20 places split logs at `'\n'`, four of them already strip `\r`. The app normalises on load (`src/lib/replay-file.ts:72`), the package @fulllifegames/replay-core does not. Round 69 set the test logs to LF through `.gitattributes` (4cd32a1).

**Benefit.** Package: a user of the library gets the same facts from a CRLF log.

**Success.** Test with a CRLF log at the public entry points, result equal to LF.

**Evidence.** `r69/progress-ledger.md:116`, commit 4cd32a1 (`.gitattributes` `*.log text eol=lf`), `src/lib/replay-file.ts:72`, `replay-core/src/protocol/protocol-parser.ts`, places with their own `\r` handling `opponent-inferrer.ts:70`, `team-builder.ts:346`, `spreads/max-hp.ts:22`, `team-paste.ts:64`, `r69/review/todos-check.md` (old T205: about 20 places split at `'\n'`).

**Steps.**
- [ ] Red test at the public entry points of the package (parser, team build, set inference): the same log with CRLF and with LF; today 0 against 15 damage observations.
- [ ] Normalise line endings at one entry point, not at every split; the four places with their own `\r` go.
- [ ] Result equal to LF; singles and doubles log.

### T211 · One forme origin

*Cleanup · mini round · small · round 69*

**Problem.** Three functions answer "which species does this forme come from": `spreads/battle-forme.ts:45`, `choice-lock-defender.ts:15`, `team/item-damage-shared.ts` (defenderOf). They differ at the edges: Zygarde-Mega, Necrozma-Ultra, Floette-Mega and the Tera formes of Ogerpon. Also: `format-generations.ts` exports a scope 'legal' that nobody calls, while `src/lib/pokemon-options.ts:10` and `src/lib/smogon-sets.ts:33` build their own generations; `DEFENDER_ITEMS` in `team/item-damage-defender.ts:25` is a typed list where dex hooks could answer.

**Benefit.** Engine: one answer per question.

**Success.** Specs of the three places green, bank byte-identical.

**Evidence.** `replay-core/src/spreads/battle-forme.ts:45` (formeOrigin), `eval-engine/src/choice-lock-defender.ts:15` (formeOrigins), `team/item-damage-shared.ts:76` (defenderOf), `format-generations.ts:46` (scope 'legal'), `src/lib/pokemon-options.ts:10`, `src/lib/smogon-sets.ts:33`, `team/item-damage-defender.ts:25` (DEFENDER_ITEMS, use at `:171`), `r69/review/lens-AFE.md` (findings 8, 9, 11), `r69/review/todos-check.md` (old T210: probe p3, six deviating formes).

**Steps.**
- [ ] Red test over every dex species: the three functions answer the same; today Zygarde-Mega, Necrozma-Ultra, Floette-Mega and the Tera formes of Ogerpon deviate.
- [ ] One exported helper in replay-core for the forme origin; the two other places call it. `pokemon-options.ts` and `smogon-sets.ts` call `generationsFor` with scope 'legal'; `DEFENDER_ITEMS` from the dex hooks (`onModifyDef`, `onModifySpD`) instead of a typed list.
- [ ] Specs of the three places green, bank byte-identical; singles and doubles share the functions.

## Off-cycle and parked

### T43 · Release check before every package release

*Tool · mini round · mini · no score touch*

**Problem.** Both packages are on npm, 0.7.0 and 0.7.1. The next release picks its packages by what has changed since the previous release tag. The local checkout does not know v0.7.1, because CI sets the tag on its own copy. A local dry run therefore compares against v0.7.0 and would publish a package that has not moved since 0.7.1. The barrel pins (`regression/fixtures/api/`), `pack:smoke` and a new chunk map belong to the check (the old script lived in the scratchpad and is gone). In addition: the engine package pins @pkmn/sim exactly (today ^0.10.11 in packages/eval-engine/package.json:52, the app pins 0.10.11), because the speed layer is bound to exactly this version and checks no hash in the browser. (Round 62 restated this; the old checkboxes in the source plan were background, and the round's spec rewrites the steps.)

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
- regression/package-api.spec.ts:98-118, pins the barrel surface of both packages
- package.json, root version 0.7.1 with the tag v0.7.1 missing locally

**Steps.**
- [ ] **1.** Fetch the tags and compare the local tag list against the remote list; today v0.7.1 is missing locally.
- [ ] **2.** Run the dry run of the publish script and read per package the line with published, changed since and reason.
  - Files: `scripts/publish-packages.mjs`
- [ ] **3.** Match the published column against the registry, with npm view per package name and version.
- [ ] **4.** Decide whether previousReleaseTag reports a missing remote tag itself and aborts, instead of silently diffing against an older tag.
  - Files: `scripts/publish-packages.mjs`
- [ ] **5.** Run pack:smoke and check the fixture diff of the barrel pins before a barrel change goes into a release.
  - Files: `scripts/pack-smoke.mjs`, `regression/package-api.spec.ts`, `regression/fixtures/api/`
- [ ] **6.** Record the production chunk map again as a probe and file it under docs/perf/probes/; the old script lived in the session scratchpad and is gone.
- [ ] **7.** Run lint, tsc -b and the regression, and record the plan of the dry run in the release note.

### T103 · Harden the speed layer before the simulator changes

*Tool · parked · small to medium · lossless D4*

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
  - Files: `packages/eval-engine/test/sim-fast-state.spec.ts`, `sim-fast-fork.spec.ts`, `e2e-build/build-smoke.spec.ts`, `src/lib/eval/sim-fast-setting.ts`, `regression/eval-sim-fast-setting.spec.ts`
- [ ] **4.** Gate D4, plus the identity chain of round 59 (`docs/perf/probes/2026-09-24-r59/gate/`) with 0 deviations and the engine suite in the default, forced on and with `EVAL_SIM_FAST=0`.

### T170 · Rest of T108 step 2: five fact handlers

*Tool · round · medium · score-touching D3 · parked*

**Problem.** Gate of round 67 ("6a"): since round 67, 4 of 11 fact handlers read the client. The other five stay own code (`inference/handlers.ts:150, 165, 226, 269, 284`: addFromPreview, addFromSwitch, recordItem, recordTera, recordAbilityAttribution), because `@pkmn/client` does not track these facts (decision R8 of lane C): it deletes the Tera type on faint (139 team members), shows the item of now instead of the set item before a swap (17), has no flag for the item marker of the preview (15) and misses two ability attributions (Natural Cure, Grassy Surge). A replacement would therefore change the output; it cannot be lossless.

**Benefit.** Less own protocol code, once the client tracks the facts.

**Success.** The five handlers read the client, the set diff is explained, bank paired.

**Trigger.** A `@pkmn/client` version that tracks these facts.

**Evidence.** Count and decision R8 of lane C of round 67.

**Steps.**
- [ ] On a new `@pkmn/client` version, repeat lane C's count of client against inference.
- [ ] Replace the handlers whose facts the client then tracks; explain the set diff; bank paired.

### T185 · A deeper analysis, clearly defined

*Surface and search · programme · parked*

**Problem.** Gate of round 67 of 10.10. ("5b"): "Think deeper" is dropped. A deeper analysis returns when it is settled what it computes beyond Auto, how long a click waits (click at move 2 in the worker pool since round 67: doubles warm 2.5 s, cold 8.9 s) and how the panel shows its result. The C line on 573756 turns 134 to 136 measures against it.

**Benefit.** App: whoever wants to give more compute time gets a level with a known gain.

**Success.** A definition with budget, wait time and display, measured on the bank.

**Trigger.** The user asks for a deeper level, or a gate needs one.

**Steps.**
- [ ] Definition: budget against Auto, wait time of a click (measurement as in T111 point 11), display in the panel.
- [ ] Bank run with the budget; then brainstorming and spec.

### T189 · Luck: the played cell against the next root (T22 stage b)

*Report and search · round · medium · score-touching D3 · parked until T146*

**Problem.** Stage b of T22: the report prices the played cell against the next root and so separates what the move itself cost from what the search read anew afterwards. The draft scene t48 and 573756 turn 70 from section B wait for it: the read payoff fizzles, and the setup payoff comes one evaluation too late. T146 removes a known source of re-reading (653785 turn 24), so measure after it.

**Benefit.** App: report and cards separate dice, re-reading and move value.

**Success.** The two gap scenes book their luck correctly; bank paired; the chance pins hold.

**Trigger.** T146 is booked.

**Evidence.** From the old section T22 (restated in round 62): stage b reconciles the cell price against the follow-up root and belongs to the family T16 (verify merge). Scenes of that time: draft gen9draft-2058494320 turn 48 (−0.472 chance on the U-turn read move, state 05.09.), 573756 turn 70 (reads quiet with chanceDelta −0.145, state round 45; the turn 70 matrix read +0.31 for SOULWIND, after mixing +0.19, the turn 71 root −0.05).

**Steps.**
- [ ] Re-read the two scenes on the app path after T146.
- [ ] The reconciliation of cell price against follow-up root; pre-registered verdict rule on the hq tranche, paired bank bench with a fresh base on the same day, feedback 3×.
- [ ] Re-pins only at the user gate; the chance pins 573756 t73 and 649664 t23 hold.

### Parked without a T-number

- 17 corpus species are in the tier list of the Champions mod 0.10.11 as banned and illegal (Rillaboom 656 sightings, Golisopod 505, Cinderace 375, Pawmot 212, Indeedee, Salamence); the validator rejects real teams ("Rillaboom does not exist in Gen 9" on Reg M-B). No code uses a legality filter today. Trigger: a Champions legality filter or a mod version with the game's list.

## Corpus gaps

Every gap has its TODO. The pins themselves are in `e2e-feedback/corpus.ts`; re-pins only at the user gate.

| Gap | State 19.09. | Handled in |
| --- | --- | --- |
| 573756 t73 (since round 32) | Chance and key moment have been pinned since round 40 (dbffb5f). State 06.10. (after round 63): the sentence "one 95% roll from clearing the rest" stands, the bar goes from 24 to 33% for SOULWIND, Body Press reads inaccuracy (regret 0.12, Defog slightly better); by the Monte Carlo probe of round 62 the grade is real. Whether the pin moves to truth is for a later gate with re-pins. | Re-pin question at the gate |
| 649664 t23 | observed has been on chance since round 42. The bar reads 0.79 instead of 0.92, because the proof leaves the next 80% Hydro Pump open, no crit (round 62). Since round 63 the card for turn 24 names the open 80% Hydro Pump (T19) and says in turn 23 that the verdict hangs on Keldeo's item (Choice Scarf: fine, Mystic Water: blunder). Since round 64 (T121 point 1) Keldeo's guessed Choice item gets the damage check that refutes it; the gap stayed open in the wave run, nobody has read it yet. | Re-pin question at the gate |
| Draft game t48, 573756 t70 | Chance booking without dice: the read payoff fizzles (t48), the setup payoff comes one evaluation too late (t70, reads quiet today with −0.145). | T189 |
| GPL DzBQ5azlO5l t13 | Heavy Slam reads without an error band. Stone Edge is missing from the set (gen9ou 0.35%, a limit of the reconstruction); with Stone Edge added by hand, the cell Air Slash against Stone Edge has read −0.336 against the MC reference −0.328 ± 0.033 since round 64 (T119); Stone Edge stands first for p2, Heavy Slam has a regret of about 0.007, there is no grade. The gap thus hangs on the missing Stone Edge in the set (limit of the reconstruction), not on the verification. t15 reads right in Auto (Vileplume regret 0 to 0.018 in three seed sets, round 62) and is done. Fixture `e2e/fixtures/gpl-replay-DzBQ5azlO5l.html`. | Gate question (reconstruction) |
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
- [ ] 573756 turns 134 to 136: the decided detection has named the right side since turn 92, the bar stands at 0.33 to 0.60, because the search does not compute the Struggle plan over twelve plies. Since round 50 the sentence is silent there until turn 137 → measure with T185 (T109 removed "Think deeper" in round 67; T33 was closed in round 62): if the bar stands at 0.7 from turn 134, the sentence speaks earlier by itself.
- [ ] 2663093831 turn 10: p2's inaccuracy disappears with T81 (round 63, lane B), although its regret rises from 0.152 to 0.276; the cause is unread → read it when T127 re-fits the static weights.
- [ ] Gen 2 logs show Leftovers holders under full HP without healing (684843 turn 34; 72 moves in 30 Gen 2 games; round 63, lane D) → act before a Gen 2 game enters a measurement whose verdict hangs on a Leftovers exclusion.
- [ ] Doubles with a hidden slot: the played combination is chosen before the verification, so the grade can land on another combination (`tree-orchestrator.ts:104`, review of round 63) → act when a doubles grade is wrong on a partly seen move; T148 reads along.
- [ ] Rage Fist, Last Respects and Retaliate compute with catalog power in the statics (0 holders on the bank; round 63, lane B). From round 67 in addition: Rage Fist needs `timesAttacked` in odds and kill table like Last Respects (T76); `side.faintedLastTurn` does not follow the faints of the corrections, so Retaliate then reads wrongly in both directions (no engine code sets the value; the simulator sets it at the end of the turn, `battle.js:1567`, and only Retaliate reads it, `moves.js:15254`); 2 games of the doubles OU holdout use Retaliate (2693420914, 2693814077) → act as soon as a holder is on the bank or in the corpus.
- [ ] The spread solver gives GPL Cobalion Timid at 252 Attack EVs: nature and EVs come from incompatible templates. The observed hit (106) does not prove the error, it binds Cobalion's attack and Noivern's defense together → act when a fitter round shows the same contradiction on further sets. T166 reads along.
- [ ] The bring restriction silently drops out in short VGC games: `replayBringOnly` returns null as soon as a side shows fewer species than the bring count (2634199230: 3 of 4 after six moves). `|teamsize|` names only the number 4, not the four species → act when a measured verdict hangs on it.
- [ ] The harness fixtures carry an older data state than `.smogon-cache` (gen6ou: 292 against 297 species, file of 14.08.) and move 4 of 72 singles sets in 649664 and 655336 → expect moved pins in exactly these two games when the fixtures are next re-recorded.
- [ ] Doubles verdicts jump between two states of a round (round 54, VGC 2629703929): with the living defender type a blunder appears in turn 11 (regret 0.00 to 0.51), with the STAB rule it disappears again (0.01), and in turn 9 another appears (0.12 to 0.48). Since round 56 (T58) a doubles root cell of the matrix with a dice event is the mix of its classes or the mean of eight draws. That does not answer the question: turns 9 to 11 run through MCTS (fainted share 0.50 to 0.63), the pair plan reaches them only through verify cells, and their regrets are equal in rounds 55 and 56 (p2 0.1043, 0.1022, 0.0437) → at the next change of the doubles statics, compare the same moves; if they then jump, it is not the matrix cell (read with the doubles part of T81; state 05.10.: p2 0.104, 0.102, 0.044 as in round 55).
- [ ] Warning of round 54 on the bank: doubles mid hq +96 bp [+8, +198] on 49 positions (with the STAB rule +98 [+11, +196]); three positions carry 92 of it (smogtours-gen9doublesou-937928 turn 6, -913993 turn 6, -939625 turn 8, all read friendlier for the later loser after the correction) → round 56 barely moved them (937928 turn 6: 0.4718 to 0.4719, 913993 turn 6: 0.05266 to 0.05272; 939625 turn 8 runs through MCTS and is byte-identical), nobody has read them yet → read them first with T31.
- [ ] `gimmickSuffixForSlot` (`branch/protocol-choices.ts`) checks the slot, not the body behind the colon: if the rebuild has another body in the slot, the wrong one terastallizes (measured against the simulator in the preparation of round 54, `docs/perf/probes/2026-09-20-r54/T57/wf1/check-teraloss.md`). A name comparison does not hold, because the built sets carry the species as the name and the protocol the nickname. How often the rebuild deviates there is unmeasured → count when a round walks the rebuild anyway.
- [ ] `parsePlayedActions` (`played.ts`) records no action on a move with `|cant|`, so no Tera either: the "played against options" match does not see the Tera click of a flinched body → take it along when T59 or T64 build on `played.ts`.
- [ ] `carryPreSolve` (`team-builder.ts`, `carryItemDecisions` until round 53) gives a Pokémon that the full solution discards and strikes from its result the entry of the speed pre-solve back. Without items that is 165 entries on the 129 bank replays, 9 of them move a set (8 replays); how often the middle branch applies (discarded, but kept in the result by the log with fixed HP) is uncounted. The statement on the item branch (no hit in the 139 measured replays) is unchanged from round 52 → whoever wants to rebuild the app back to one solution needs a case for the item branch first.
- [ ] A play-out burns a win condition in the wrong order (draft t56 to t62). Since round 64 (gate 08.10., "2a") the e2e pin checks the intent instead of the order; since round 67 (gate 11.10., "5b") it pins the core: p2 wins by turn 75 with at most six switches (in turn 57 Iron Head, Earth Power and Freeze-Dry lie within 0.01, the played line wins in turn 72, every other choice by turn 66) → on a further case, pull Q5 (T39) forward.
- [ ] Early Brier: round 40 cost early 28 bp hq (0.2569 → 0.2597), late it won 84 bp; suspicion: exact HP bodies give too extreme bars early → pre-register the early hq column in every fitter round; act if two rounds in a row lose early.
- [ ] hq tranche: n=560 (r61-t98b; smogtours plus ladder from rating 1700) → re-cut the tranche if n falls below 500 or a new tranche tips the ratio.
- [ ] Premature-end remainder: today only 2663093831 turn 14 (1 of 320 blocks of the dumps; 648453 has no remainder left) → a backstop only if the rate grows with the corpus.
- [ ] Moved MCTS moves whose verdict does not hang on the repriced move (round 57, 648453): new hints at the root (Hidden Power Ice in turn 23: 0.21 → 0.85) reorder the tree expansion, redraw the one random outcome of every root cell (chance nodes off) and change which cells the verification reprices (turns 24 and 33; turn 31 a newly drawn 70% cell). Almost every cell of an MCTS move moves (turn 23: 26 of 28 cells), although no verdict hangs on the root price of Hidden Power Ice → act when a pin hangs only on such a shift; lever: measure tree variance (more trees or iterations) before a verdict is read.
- [ ] Golden 655336 has drifted in nine channels since round 64, in ten since round 69 (new: an extra key moment turn 12 and an extra read 16:p1; the truths of turns 13, 23 and 24 hold) (gate 06.10.: the trick in turn 5 is not an unconditional error, mistake 5:p2 is out of the golden): missing key moments turns 5, 6 and 26, extra key moments turns 18, 22 and 27 (turn 27 reads shift instead of p1-read since T119), missing mistake 26:p2, extra mistake 22:p1, no turning point instead of 4. Turn 13 is healed by T16, the read 27:p1 by T119 → read together at the next golden refresh at the user gate; T127 measures against the golden first (D7).
- [ ] 20 wrong hits outside all families (referee of round 57, row "without family": Air Balloon, Psychic Terrain, Armor Tail against priority) → act when one of them carries a verdict; lever: create families in the referee and count them.
- [ ] On a Bo3 ladder only the deciding game of a set carries the rating (M-C-Bo3: 16 of 51 games rated; review of round 66). The fit rule against unrated ladder games (`withoutUnratedLadder`) would discard games 1 and 2 of a rated Bo3 set, and `--sort rating` would find only the deciding games there → before a Bo3 ladder extension, pull the rating onto the set. Today no rated Bo3 ladder game is in the corpus.
- [ ] Champions VGC fills species missing from its usage file from SV files (doubles OU, OU, Ubers) instead of from `gen9championsou`, and `@pkmn/sim` does not know the Champions ability "Aura Guard" (round 66) → act when a species in the corpus builds wrongly because of it or a game shows the ability (upstream only after the user's okay).
- [ ] T142 in 2026 Reg F: without a set file of the year, the 2026 usage file guesses moves worse than the doubles OU sets (77.1 → 72.8%, items 59.8 → 62.5%, 120 Bo3 games with a team list); 2024 has no team lists, and the holdout reads 2024 Reg H +124 bp [−26, +284] unresolved → act when data.pkmn.cc carries a set file for 2026 or a verdict hangs on 2024 games.
- [ ] Partner targets everywhere (T113 stage 2, decision 12 of round 67): since round 67 the root knows the played choice with partner target; partner targets at every node enlarge the raw combination count by a factor of 1.55 → act when a doubles verdict hangs on an unled partner move away from the root and the tree time has room.
- [ ] Blockers behind a `|cant|` (check of T175, 12.10.): the rebuild's substitute move follows Taunt's rule (same category and priority, `branch/protocol-choices.ts:257-264`). Imprison (a move that the opponent knows), Heal Block (heal flag) and Gravity (gravity flag) block by other properties, Throat Chop names no move (`moves.js:19758`); Disable hits only the last move, which is already in the set. No wrong substitute in the corpus (16 Taunt rows, one Heal Block row) → act when T175 fails to bring a move into the set or a substitute under another blocker carries a verdict.
- [ ] An unknown format takes over only Sleep Clause (round 67, lane E): `getBranchSimulatorFormat` makes a Custom Game with Sleep Clause out of it (`replay-format.ts:259-273`, `:130-141`); a draft league with Terastal Clause loses the lock in the branch picker (`picker-tera.ts:18`) and in the branch battle, while the search already turns Tera off in "auto" if the log shows none (`tera.ts:72`) → act as soon as a replay with a declared Terastal Clause appears.
- [ ] 2630685175 turn 1: worker pool and local execution have differed by 0.0002 since T129 (−0.43798 against −0.43780, same tier, cause open). The bank computes locally (`regression/bank-search.ts:37`), the app in the pool → act when a pin, a tier or a bank row hangs on a pool-against-local difference.
- [ ] Monte Carlo references hang on the statics (round 69): the oracle values its leaves with the same statics as the engine; after the weights of lane B, four scene pins seemed off, freshly computed the engine hit all four. The doubles census (reference b67) has not been comparable since (cw: other job sets on 23 of 23 moves) → before the next census and after every weight change, recompute the references with MC_N > 0.
- [ ] Own K per phase sticks to the upper limit 50 in small cells (round 69: hq doubles late, 45 rows, warning +156 in the bank alone, without weight in the verdict from bank plus holdouts; likewise in a6 and e4) → act when such a cell carries a verdict; lever: limit the K fit of small cells or pool it with the neighbouring phase.

**Environment**

- [ ] e2e "branch replay play controls stay muted without audio errors" saw two page errors from the replay iframe in round 50 (`$ is not defined`, then `reading 'length'`): 1 of 2 full runs red, alone 10 of 12 green on the branch and 6 of 6 on the base. A Showdown script runs before jQuery is loaded (same family as the config routes fix e019a73) → act if the test tips a gate a second time; lever: load order of the dynamic scripts in the embed, or the test waits for `window.$` in the iframe before it counts errors.
- [ ] e2e "a long forward slider jump lands the scene instead of hanging on "seeking..."" (`e2e/timeline.spec.ts:49`) waited 30 s in vain for `Replays.battle` in the replay iframe in wave run 3 of round 63 (1 of 75 tests in a full run; alone 4 of 4 green, green in wave runs 1 and 2) → act if the test tips a gate a second time; probably the same family as the load order in the embed.
- [ ] The browser build is part of the feedback anchor: a Chromium change shifts the last floating-point place (573756 t81 verify selection) → every Playwright upgrade is a re-anchoring with `FEEDBACK_DUMP=1`; state `@playwright/test ^1.62.1`.
- [ ] TypeScript stays on 6.x until typescript-eslint parses the native compiler; `@types/node` follows the CI Node major (24) → watch the peer range.
- [ ] Weekly version check of `@pkmn/sim` (from the adoption on 26.09., pin 0.10.11) → on a new version, an upgrade PR per D24.
- [ ] Screenshot probe `docs/probes/2026-09-03-css/` (32 tests, 34 screens, 0 pixel tolerance; start with `node scripts/run-e2e.mjs -c docs/probes/2026-09-03-css/shots.config.ts`; its baseURL is fixed on port 5174, `--dev-port` does not reach it) → reuse as a pixel gate for every UI round; re-record the baseline with `--update-snapshots` when copy or layout change on purpose.
- [ ] Library bugs (round 67, checked 12.10.): (1) the Champions bundle of `@pkmn/mods` 0.10.11 embeds the simulator's dex with all data and loads the data of every mod on import, only for `toID` in `canMegaEvo` (`build/champions/index.mjs:423335`, `:423758-423770`; the bundle `championsregma` has 85 KB). (2) `DexFormats.extend` in `@pkmn/sim` discards the result of `concat` (`dex-formats.js:361-365`): the Champions formats are missing from `Dex.formats.all()`, `get()` finds them, a second `extend` throws "duplicate ID". (3) `Dex.formats.get('gen9championsou@@@Sleep Clause Mod')` returns a non-existing format, because `data.Rulesets` arises only on import from `formats.all()` (`dex.js:420-429`, `:498`); `new Battle` then silently builds on the base dex without mod and without rule (unreachable today, `replay-format.ts:265`). (4) The Mega Z formes carry no mega flag (`dex-species.mjs:49/54` counts only Mega, Mega-X, Mega-Y); Showdown has fixed this already, the fix comes with the next sync of `@pkmn/sim`, no report. In addition `@pkmn/client` 0.7.3 without a null check (T188: `getPressurePP` and the `types` getter throw when the generation does not know the species) → three reports (1, 2 with 3, client) drafted on 12.10. in `docs/perf/probes/2026-10-10-r67/gate/upstream-issues-draft.md`, each with a script under `gate/upstream/`, checked against the newest versions and pkmn/ps `main`; the user reports them personally (12.10., gate question 10 of round 67) → watch whether and when a fix appears; the client fix does not replace T188. (5, round 68) Double Shock carries no punch flag in the Champions mod of `@pkmn/mods` 0.10.11 and is marked as Custom; the server computes with Iron Fist (gen9championsou-2693645983: a resisted Double Shock takes 56%, without Iron Fist at most 51.5%); Showdown fixed this on 10.09. (bc4eb07b4, #12304), the fix comes with the next `@pkmn/mods`, no report; the engine's calculator already carries the flag from `@smogon/calc` 0.12.
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

## After stabilization: Showdown Companion

*Programme, only after stabilization.*

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
