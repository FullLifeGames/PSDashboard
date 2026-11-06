# Backlog

This file holds the details of every open TODO, one section per TODO under its fixed T-number. Release v1.1.0 is out (06.11.2026), with rounds 81 to 87 since v1.0.2 (the reload after a deploy, forced dice in branches, the GitHub issues #2 and #3, the turn dock, the smooth UI, the engine that reads the dice, the dependencies with T313 and T317). Round 88 carries T322 (the search explores the strands of a turn by their chance, blocks 1 and 2), and T319 (an inventory of dead code) follows it; T314, T316, T324 to T329 and T336 to T339 are approved and wait for a round of 1.1.1; every other TODO is parked with a trigger, and a trigger that fires brings its TODO to a gate. The next free T-number is T343.

Evidence paths of the form `r<NN>/…` point to that round's probe folder, `docs/perf/probes/<date>-r<NN>/`; `docs/` is local, so they exist only on the maintainer's machine. Each round's entry in `docs/completed/` names its folder and the gate that approved its TODOs. Line numbers in a section refer to the state when the TODO was written.

## Round 88 · the search explores the strands of a turn

The gates of 05.11.2026 (18:19, "1b 2a 3a"; 20:47, "1a 2a 3a 4a") approved T322 for lane A of round 86. Round 86 delivered its stage 0 as probes and built hashed tree seeds first (T323); the gate of 06.11.2026 08:00 ("2a") left the trust rule unbuilt, and the final gate (11:50, "7a") made blocks 1 and 2 with the rule's variant the next round, on the merged base; the user moved it behind the release wave of 1.1.0 (06.11.2026), so it runs as round 88. It leaves this file with that round's booking.

### T322 · The search explores the strands of a turn by their chance

*Eval engine · round 88 · feature · score-touching (D3)*

**Approved for round 86 (gates of 05.11.2026, 18:19, "1b 2a 3a", and 20:47, "1a 2a 3a 4a"); the next round after the final gate of round 86 (06.11.2026, 11:50, "7a"), round 88 behind the release wave of 1.1.0 (user 06.11.2026).**

**Problem.** Each outcome of a turn is a strand: Iron Head flinches (30 %) or it does not. Since T305 the verify round weights every strand of a root cell by its Dex chance. A strand gets the trees' depth only when at least two trees drew it, they agree within `VERIFY_DISAGREEMENT` and the pool has played the cell out (`deepPool` in `packages/eval-engine/src/mcts-merge.ts`); every other strand takes the one-ply estimate. Four trees draw each root cell once by their seed, so a 30 % strand gets two trees in about a third of the searches and none in a quarter. Before T323, Doubles OU gen9doublesou-2694111300 t13 read +0.440 for the side that lost, because two thin trees spread the pool past the limit; with the hashed tree seeds of round 86 it reads -0.938 against a reference of -0.983 +- 0.007, and the strands four trees happen to draw still decide the other cells: over the 38 census cells round 86 reread, the mean distance to the reference stays 0.332 with or without the trust rule (A14).

**Idea.** On the merged base of round 86:
1. Fresh references: a search of 9,600 iterations per tree from each class child of the pre-registered scenes (600 iterations do not carry a value: 655336 t24 reads 0.612 at 600 and 0.821 at 19,200), the endgame solver where at most three bodies stand, and a fresh census draw. 43 of round 86's 103 reference classes no longer occur at c743f2e, and both halves of its census are read. The scenes add VGC 2629703929 t10, whose biggest-roll sentence T323 removed (gate 6a).
2. The trust rule for keyed class pools in its variant without the middlegame floor (ruling of 06.11.2026 08:00): thin trees leave the count and the spread, a standard error replaces the fixed 0.075, and a single played-out tree with enough visits may stand. A14 found two clauses of round 86's draft that cost accuracy on the census: a per-tree floor of 8 visits and an endgame test of at most two bodies per side.
3. Block 1, the trees cover the strands, in A11's form (morning gate 06.11.2026, "3a"): tree k answers each named die of a root draw with the systematic quantile `U = (k + u_d) / 4`, `u_d` hashed from the position, the cell and the die, so each strand gets on average four times its chance of the four trees, without forks and without an order by value. The score weights each world by its Dex chance, and the line the app shows comes from a tree of the main strand.
4. Block 2, a strand that can tip the decision gets its own search. It runs only at the best options and the played one, screened by the bound a strand of chance p and one-ply value q puts on its cell (at most p (1 - q) up and p (1 + q) down), with every compared option at one depth. It starts by softening a grade and naming the strand ("only the 30 % flinch saves this"), and it re-prices only where the references back it.

**Benefit.** Engine and app: a move whose only out is an unlikely die reads its real chance, and a grade no longer hangs on the strands four trees happened to draw.

**Success.** Set in the round's spec before the first measurement: the flagship cells land as close to the reference as a tree of production size can (A14: a 600-iteration tree reads 0.03 to 0.04 short of its asymptote, so the gate reads the distance and not 2.5 SE of the reference); 655336 t24 keeps Dragon Dance level with Dragon Claw; the trust rule's acceptances lie closer to the reference than the one-ply estimate in at least 70 % of the census; no harm on the bank or the four holdouts (`holdout-vgc2` in place of `holdout-vgc` since round 86). Cost against the merged base: the trust rule adds no forks, block 1 at most 2 % forks, block 2 at most 10 % mean wall per tree turn and 25 % on the slowest turn, singles and doubles counted apart.

**Singles and doubles.** Both in each stage; Doubles OU, VGC and Champions VGC each get their own row.

**Evidence.** `r86/research/t322-chance-strands.md` (prior art and the ranked options); `r86/lanes/A/ledger.md` (A8, A9, A9b; A11 the plan; A12 the references; A14 the analysis); the probes `r86/lanes/A/t322-*`.

## Approved, waiting for a round

The gates of round 84 (02.11.2026 and 03.11.2026) approved T313, T314, T316 and T317: round 87 delivered T313 and T317, T314 is a larger bug (D3) and T316 a feature, each its own round. The gate of 04.11.2026 approved T319 for after round 86; the final gate of round 86 (06.11.2026, "7a") put it after T322, which runs as round 88. The gates of round 86 approved T324 to T329 (06.11.2026, about 07:50) and T336 to T339 (11:50). Each leaves this file with its round's booking.

### T314 · A bench offers bodies the side never brought

*Replay core and app · round 84 · larger bug · score-touching (D3)*

**Approved (final gate of round 84, 02.11.2026, "3a").**

**Problem.** In a bring-limited format the app pins the brought bodies only when both sides fielded all of them during the game: `replayBringOnly` (`packages/replay-core/src/replay-format.ts:280-298`) returns null when either side shows fewer, by design for the evaluation. The null opens both sides: the reconstruction builds the whole team of six (`src/hooks/controller/replay-context.ts:91`, `bringOnlyLists`; `src/hooks/branch/session.ts:170`), so the dock's bench, the What-if and the engine's ranked choices offer bodies that never came to the battle. Champions VGC game 2625939941: P1 fielded three bodies, so P2's four are known (Aerodactyl, Kingambit, Farigiraf, Sylveon), yet the bench of P2A at turn 1 reads Kangaskhan, Farigiraf, Torkoal, Sylveon. In `.fit-corpus`, 111 of the 511 Champions VGC bo1 games (regma, regmb, regmc) are open, and the bo3 games (file names with a bo3 prefix) hold 174 more of 690, files with a hash suffix left out; 102 of the 111 have one side short and the other fully known. Scarlet/Violet VGC goes through the same rule: 236 of 1,200 bo1 games are open. Battle Stadium Singles has no corpus game.

**Idea.** Pinning each side on its own is the per-side variant that A.3c measured and rejected: a pinned four against an open six flipped game 2630452654 from 4/4 to 0/4 (`docs/completed/timeline-ux.md:66`). The fix therefore has to price the open side fairly. The build starts by choosing among (a) a bench-only change that leaves the evaluation as it is (two readings of one game), (b) per-side pins that keep the open side's unfielded bodies and weight them, (c) a list type of known bodies plus one unknown, with a chance step in the engine. Option (c) needs four parts the code lacks: the list type (it crosses the worker types), a rule in `trimTeamToBring` (today it keeps exactly the named sets and would leave the open side with three bodies), the engine's step for the unknown body (chance node, sample or placeholder), and a bench row for it. Per-side lists already flow: an empty or absent list leaves that side whole (`team-order.ts:16`, `picker-state.ts:311`).

**Benefit.** App and engine: a switch the game cannot have is no longer offered, and the evaluation of those games prices only bodies the side could have brought.

**Success.** A sweep over the bring-limited games of `.fit-corpus` and `.calibration/replays` (2630452654 is only in the latter), with Champions VGC and Scarlet/Violet VGC as separate rows and Battle Stadium Singles on a synthetic log, holds every bench to the bodies the log fields or the chosen option allows. Game 2630452654 keeps its four of four samples of the A.3c gate. Bank plus the VGC and Champions VGC holdouts without harm, with the cache version bumped once (D3). The specs that move are re-pins for the gate: `bring-limit.spec.ts:104` ("both sides or neither"), case 1 of `dock-bring-fixture.spec.ts`, and the comment of that rule. The stale comment at `replay-context.ts:88-90` ("`[]` on a side stays whole", which `replayBringOnly` never returns now) goes with the fix.

**Singles and doubles.** Both: Battle Stadium Singles brings three, VGC and Champions VGC four.

**Evidence.** `r84/lanes/A/ledger.md`, A6d (the first draft and count); `r84/review/t313-t314-review.md` (the corrected counts, the bo3 and Scarlet/Violet rows); `docs/completed/timeline-ux.md:66` (the A.3c measurement); `test/regression/dock-bring-fixture.spec.ts`.

### T316 · The replay frame drops the turn buttons the timeline covers

*App · round 84 · feature (the dock following Switch sides is new behaviour) · lossless*

**Approved (02.11.2026, "13a"; the user: "glaube play muss bleiben?"; 20:17: "Switch Sides find ich wichtig, Color scheme und Music schon egal (solange das default off ist)").**

**Problem.** The replay frame shows Showdown's own controls (Play, Reset, Last turn, Next turn, Go to turn…, Switch sides, Speed, Music, Color scheme), and the app's timeline under it moves through the same turns (`TimelineBar.tsx`: the turn slider, the arrows, T0). Two controls for one job; on a phone Showdown's rows take two lines and get cut (`r84/gate/preview/m-phone-390x844-1-first-screen.png`).

**Idea.** The app builds the frame's document itself (`src/lib/replay-html.ts`), so it hides the buttons the timeline covers (Last turn, Next turn, Go to turn…) and keeps what the timeline lacks. The user's answers (the question round, 20:14 to 20:18): Play (the timeline has no autoplay), Reset, Speed and Switch sides stay; Last turn, Next turn and Go to turn… go; Music and Color scheme may go as long as the music stays off by default. The dock follows Switch sides: today the dock puts P1, the side the frame shows near (at its foot), in the top row (`DockRows.tsx:18`); after Switch sides P2 stands near, and its row moves to the top. The frame tells the app its side state (it is same-origin), and the chips keep their labels. The frame can start from P2's side (`viewpoint`, the `?p2` link flag, `replay-html.ts:208`), and a rebuild of the frame resets Switch sides; the dock reads the frame's state after each of these, never a count of clicks. `test/e2e/branch.spec.ts:262-266` clicks the frame's Last turn and Next turn and moves to the timeline.

**Benefit.** App: one way to move through the turns, and the frame's controls fit a phone.

**Success.** An e2e that the hidden buttons are gone and Play, Reset, Speed and Switch sides still work, the music off at load; the dock's top row belongs to the side the frame shows near, at load (P1, and P2 with `?p2`), after Switch sides and after a rebuild of the frame, in singles and doubles; on the phone case of T315 the frame's remaining controls fit the 362 px frame without a cut (today the row needs about 390 px before Switch sides joins it).

**Singles and doubles.** Both: the dock's row order follows Switch sides in singles (one row, the two sides' chips swap places) and in doubles and VGC (the two rows swap).

**Evidence.** The user's screenshots and `r84/gate/preview/m-phone-*.png` (02.11.2026).

### T319 · An inventory of dead code, before it misleads the next round

*Engine, replay core and app · gate of 04.11.2026 · probe first, deletions as TODOs at its gate · lossless*

**Approved for after round 86 (04.11.2026, "1c"; the user on 03.11.2026: "dass wir vielleicht einmal analysieren sollten wie viel und ob wir toten Code aktuell mit uns rumschleppen"; on 04.11.2026: adding `@vitest/coverage-v8` for the coverage run is okay).**

**Problem.** T305 named the tree's chance-node path (`groupedDraw` with `TREE_FORCED_CAP` in `packages/eval-engine/src/search/expansion.ts`) as the class path round 86 should widen. That path runs only with `CHANCE_NODES` on, and the switch stays off since round 43; the review of the ADR sweep found the slip on 03.11.2026 (f0bd821). Switched-off code reads like live code. `npx knip` on dev 3e742b6 reports one unused file (`packages/eval-engine/src/dice/index.ts`), 56 unused exports and 27 unused exported types; an unused export may still serve its own module, so the list needs sorting. knip cannot see code behind a fixed switch (`CHANCE_NODES = false` in `search/expansion.ts`, the other branch of `FORCED_SWITCH_NODES = true` in `mcts.ts` and of `FIRST_TURN_JOINS_LOG = true` in `dice/turn.ts`), variants and environment levers that default off, or tests that cover only switched-off code.

**Idea.** A probe that deletes nothing, in three parts. (1) Sort knip's list into unused code and a superfluous `export`. (2) Find the code behind fixed switches and default-off levers in `packages/*/src` and `src/`, with its lines and its tests. (3) A coverage run of the suites (`@vitest/coverage-v8` as a dev dependency at the version of `vitest`) shows the code no test reaches; code that only a test reaches stands out against the feedback harness. The result is one table with a recommendation per finding: delete, keep with its reason (ADR 0009 keeps the chance-node machinery on purpose), or a new TODO.

**Benefit.** Engine and app: an agent that plans a round reads only code that runs, or code whose ADR says why it waits; the suite stops testing paths no user reaches.

**Success.** The table covers every knip finding, every fixed switch and every default-off lever, each with its lines, its tests, the game type it serves and a recommendation; the user rules on it at the probe's gate. Each deletion that follows is lossless (D4): three byte-identical feedback runs, the bank digit-identical, regression, e2e, lint, `tsc -b`, and the API snapshot with `npm run pack:smoke` where a barrel changes.

**Singles and doubles.** Both: a switch can hold a doubles-only path (the pair sampler, the doubles prover), so the table names the game type of each finding.

**Evidence.** `docs/perf/probes/2026-11-04-dead-code/knip-2026-11-03.txt` (the knip run on 3e742b6); `docs/perf/probes/2026-11-03-adr/review/A.md` (the T305 finding); commit f0bd821.

### T324 · The verify round, the samplers and the endgame still draw from the lattice

*Engine · round 86 · larger bug · score-touching (D3) once the probe finds a bias*

**Approved (round 86 gate of 06.11.2026, 6). The probe comes first; the build waits for its table.**

**Problem.** Round 86 hashed the tree's seeds (T323), because the five `SEARCH_SEEDS` (`packages/eval-engine/src/search/leaf.ts:17`) are one arithmetic progression of the Gen 5 LCG state: at one draw index a 10 % die came true in 0 % or 20 % of a tree's cells, never in a tenth, and the singles tree's 90 % move hit 94, 27, 100, 99 and 100 % of the time by seed slot (A10). T323 changed `treeSeed` only. Every other path still draws from the lattice. The verify round prices a plain cell with `VERIFY_PLAIN_SEEDS = [...SEARCH_SEEDS, ...PROBE_SEEDS]` (`search/verify-cell.ts:43`), and `PROBE_SEEDS` (`cell-blend.ts:45-49`: `21,22,23,24`, `25,26,27,28`, and on in steps of four) is the same progression, so all 16 draws of a plain cell sit on it. The pair sampler holds `FALLBACK_SEEDS` (`pair/sampler.ts:30`) and its base draws (`:225-264`); the singles matrix search reads `SEARCH_SEEDS` in `search/cell-sampler.ts:46,103-120,265,314` and `search/position.ts:367,393`; the trend probe (`search/trend-probe.ts:19`), the endgame's children (`endgame/children.ts:69-101`), the order of a log (`mcts.ts:264`) and a tree expansion's class children and single child (`search/expansion.ts:35,133-147`) read them too. The scene: the verify round pays for a cell by the Dex weights of its outcome classes and uses the draws to pick one child per class (A10, point 5), so a class is reached through its lattice slot, and the same slot gives the same child in every cell. Round 62 measured the second fixed seed missing in 21 of 22 cells with a miss chance and the first never missing (the note at `search/verify-cell.ts:17-19`). Round 63 replaced that single seed by 16 draws grouped by outcome, so the damage that remains is unmeasured.

**Idea.** Two steps. First a probe with no score effect: a recorder like `a10-dice.vt.ts` over the verify round's, the samplers', the matrix search's and the endgame's draws, with the hit rate against the Dex per band (accuracy, secondaries at 10, 20, 30 and 50 %, crit) and the binomial z by events and by streams, per group. If every band sits inside its binomial band, T324 closes without a build. If a band does not, the build hashes the seed of each path from its own name and the draw's index through the module that holds `treeSeed`'s hash (`mix32` in `search/leaf.ts`), so one rule makes the seeds, and a fork count shows the cost (the hash itself costs no fork, the draws it changes can). The build follows T309, the refit that T323 started: the weights and the K were fitted on lattice draws, and a second change of the draws before that refit would blur its reading. It also follows the next T322 round.

**Benefit.** Engine: a cell's rare outcomes (a 10 % paralysis, a 5 % miss) come in the share the Dex gives, in the verify round and the endgame as in the tree, so a grade that rests on one such outcome stops depending on which slot drew it.

**Success.** The probe's table: per group and band, the count, the observed frequency, the Dex chance and the z, with the clone counts of the recorded run equal to the unrecorded run (A10's invariance check). If the build runs: the paired bank and the four holdouts against the base after T323 and T309, the cache version bumped once (D3), three byte-identical feedback runs, the tier census, and the cost probe `a9-cost.vt.ts` with forks per group within the round 86 budget (+20 % against the base). The specs that move are the ones that name `SEARCH_SEEDS` or `VERIFY_PLAIN_SEEDS` as a rule (search the tests for both names); each goes to the gate with its old and new expectation.

**Singles and doubles.** Both. The verify round and the samplers run in both, the matrix search in singles, the pair sampler in doubles. Singles matrix, singles tree, Doubles OU, VGC and Champions VGC each get their own row.

**Evidence.** `r86/lanes/A/ledger.md` (A10 from its line 629, point 5 and the closing note; A13 open point 5); `r86/gate/todo-review.md` (P1: the wider list of paths, and that round 62's reading is the single seed, not the present verify round).

### T325 · A body that never acts in the log gets a stand-in that keeps the logged order

*Engine, reconstruction · round 86 · small fix · score-touching (the rebuilt positions of six turns move)*

**Approved (round 86 gate of 06.11.2026, 6).**

**Problem.** When the log shows no action for a slot, the rebuild fills the click in with the first enabled move of the request: `defaultChoiceForSlot` (`packages/eval-engine/src/branch/protocol-choices.ts:369`) calls `defaultMoveChoice` (`:195`), which takes `active.moveSlots[0]`. In the Gen 6 OU game 653785 turn 23 Lopunny faints before it moves, the log shows no move for it, the rebuild plays Fake Out, and Fake Out's priority flips the turn (the pinned row `moveCount p1:lopunny:fakeout log=0 sim=1`, `test/regression/forced-reconstruction.spec.ts:52`). Six turns of the corpus show the same flip from an unlogged choice: 653785 t23, 2628340185 t23 (Shadow Sneak, `:53`), 2663093831 t9 and t10 (flinched bodies that get Protect; the log shows a `|cant|` line and no move, `:58-59`), 2695803506 t1 (Sneasler's Fake Out, `:60`) and 2629703929 t9 (Chi-Yu's Protect, `:61`).

**Idea.** A clerk who never spoke gets the form that keeps the queue as it was. The fill-in takes the enabled move of the lowest priority at 0 or below, as `slowestRequestMove` (`:282`) already does for a body that switched out before it acted (`:324-331`), and falls back to the first move when none qualifies. The Dex gives the priorities; no name list.

**Benefit.** Engine and app: six more turns of the singles, Doubles OU, VGC and Champions VGC corpus rebuild as the log shows them, and the positions after them carry the right faints and moves.

**Success.** The six residual rows leave `RESIDUALS` (`forced-reconstruction.spec.ts:52-61`) and turn plain; no turn that is perfect on the drift line breaks (the line counted 343 of 356 at lane B's b1 run; read the count again at the build); a sweep over the Dex's priority brackets in every rule set the corpus plays, singles and doubles, keeps the stand-in from moving before a flincher or a killer that the log shows first. Score-touching, so the batch check reads the cache version, the feedback runs and the tier census, and the bank and the four holdouts check for harm, because the six turns sit in singles, Doubles OU, VGC and Champions VGC.

**Singles and doubles.** Both: 653785 (Gen 6 OU) and 2628340185 (Champions OU) are singles, 2663093831 is Doubles OU, 2629703929 VGC and 2695803506 Champions VGC. The sweep plays singles and doubles in every rule set.

**Evidence.** `r86/lanes/B/ledger.md` (B2, proposal 1, which counts seven because it adds the unlogged aim of the Meteor Beam turn; B3, B7); `r86/gate/todo-review.md` (P4: six turns, the fix site and the model).

### T326 · A copy of the biggest roll that ends the game goes into the cache

*App · round 86 · small fix · lossless*

**Approved (round 86 gate of 06.11.2026, 6).**

**Problem.** The report's biggest-roll sentence plays the roll the other way on a copy of the turn and prices the copy's next root. When the copy ends the game (VGC 2629703929 turn 10, where the turned die ends the game with the terminal score -1), `flipOf` returns that score at once (`src/hooks/evaluation/sweep-rolled.ts:74`), before `searchCopy` writes the cache (`:31-35`). A second sweep of the same game finds no entry (`loadCachedResult`, `:69`), rebuilds the position of the turn (`env.positionFor`, `:53`) and plays the copy again (`:55`): about 15 ms in the worker plus the position, which a fully cached sweep otherwise skips.

**Idea.** `flipOf` writes the terminal result under the copy's key (`keyFor`, `src/lib/rolled-copy-stage.ts:64`, a key that no other code reads), in memory and in the store as `searchCopy` does. The cache holds an `EvalResult` (`loadCachedResult`, `src/hooks/evaluation/sweep-replacements.ts:15-27`; required fields `score`, `interval`, `depthCompleted` and `perSide`, `packages/eval-engine/src/types.ts:216-232`), so the entry is a minimal result with the terminal score, an interval of 0, depth 0 and empty `perSide`; the alternative is a small store of terminals beside it.

**Benefit.** App: a second analysis of a game whose biggest roll ends it plays no copy and rebuilds no position.

**Success.** A row in `test/ui/hooks/useEvaluation.rolled.spec.tsx`, beside "a second sweep of the same game reads the evaluation from the cache: no new copy, no new search" (`:165`), for an ending copy (2629703929 turn 10): the second sweep plays no copy and the flip's score stands. Lossless: no score and no sentence moves.

**Singles and doubles.** Both. The stage is one code path for every game type (a named roll decides, not the type), and the rows of that spec run on the stage's fake; the one corpus scene that ends in the copy is VGC.

**Evidence.** `r86/lanes/B/ledger.md` (B6 open point 3, B8 open point 2); `r86/gate/todo-review.md` (P9: the code that decides is `sweep-rolled.ts`, not `rolled-copy-stage.ts`).

### T327 · A body the log never shows stays on the field after a simulator-only faint

*Engine, reconstruction · round 86 · larger bug · score-touching (D3)*

**Approved (round 86 gate of 06.11.2026, 6).**

**Problem.** In VGC game 2565721987 the log shows four bodies of p1 (Iron Bundle, Grimmsnarl, Ditto, Miraidon); Kyogre and Archaludon never leave the bench. At turn 5 the simulator knocks out Iron Bundle, whom the log leaves at 1 hit point, after an order and three crits that the log lacks. The replacement round runs `retireUnshownBench` (`packages/eval-engine/src/branch/team-order.ts:189`), which returns at once because the simulator forces a slot the log did not faint: `if (!forcedSlots.every(slot => fainted.has(slot))) return false;` (`:195`). The simulator sends Kyogre in, the boundary correction then revives Iron Bundle from the snapshot (1/100) and moves the bodies back, and the entry hides from the position of turn 6. The same refusal repeats at turn 6, and at turn 7 p1 holds three living bodies (Miraidon and Archaludon on the field, Kyogre on the bench) where the log has one. The engine prices a team with two bodies too many.

**Idea.** Do not loosen the guard: with no living body left, `retireUnshownBench` calls `battle.checkWin()` (`:199`), and the simulator would end a game that the log continues. Take the body out where the correction meets it. After `correctActivesFromSnapshot` (`packages/eval-engine/src/branch/corrections.ts:269`, called at `:347`), an active body that the snapshot never saw leaves through `takeBodyOut` (on the field, End events included) and its slot stays empty, as the log's slot is. The guard has three callers to read first: `corrections.ts:143`, and `retireBenchAfterFaints` (`team-order.ts:210-221`, called at `corrections.ts:348`).

**Benefit.** Engine and app: after a knockout that only the simulator makes, the position carries the bodies the game has, and the evaluation of the turns that follow stops counting a body the log never shows.

**Success.** Rows for 2565721987 turns 6 and 7 hold one living body of p1 as the log has it; a sweep in the shape of `packages/eval-engine/test/body-out-sweep.spec.ts` plays every Dex ability with an End handler on a replacement the log does not show, in every rule set the corpus plays, singles and doubles; the VGC and Champions VGC holdouts show no harm. 2565721987 sits in the VGC holdout manifest (`test/regression/fixtures/fit-holdout-manifest.json`), so the holdout does not judge this scene independently: the rows and the sweep do.

**Singles and doubles.** Both: the guard and the correction are one code path for every game type, so the sweep plays singles and doubles; the scene is VGC.

**Evidence.** `r86/lanes/B/ledger.md` (B10, the 2565721987 t7 diagnosis and its proposal; B7); `r86/gate/todo-review.md` (P11: the guard's callers and the corrected hook). The second cause of the same row is T334.

### T328 · The feedback harness stops on a dead renderer within minutes

*Test harness · round 86 · small fix · lossless*

**Approved (round 86 gate of 06.11.2026, 6).**

**Problem.** When the page dies, the feedback harness waits for the whole test timeout. In round 86 the 573756 test ran out of memory in the renderer (B8): all workers closed in one millisecond, the page's own timer stopped, and `page.evaluate` never returned. Playwright raised no `crash` event. `waitForSweepEnd` (`test/e2e-feedback/feedback-drift.spec.ts`) calls `page.evaluate` at `:92` with no timeout inside a loop whose stall check (`STALL_MS` 6 minutes, `:85`, checked at `:111`) and cap (`CAP_MS` 35 minutes, `:86`, checked at `:116`) sit after it, so a dead renderer never reaches either. The only bound is the test timeout of 2,400,000 ms, 40 minutes (`playwright.feedback.config.ts:16`). The three other `page.evaluate` calls of the file (`:155`, `:162`, `:184`) are unguarded as well. The cause of B8's hang is fixed (`ff2b344`); this is the guard for the next one.

**Idea.** Race each `page.evaluate` against a timeout of a few poll intervals and count consecutive timeouts; after three, return `{ ok: false, reason }`. The reason text stays fixed with no elapsed seconds, because the report keeps determinism diffs clean (the doc comment above `waitForSweepEnd`). The function moves into a helper module so that a plain spec can import it.

**Benefit.** Harness: a feedback run that loses its page fails within minutes with a stable reason, instead of holding the machine for 40 minutes.

**Success.** A spec hands `waitForSweepEnd` a page whose `evaluate` never settles and expects `{ ok: false, reason }` within the poll time, with a reason free of elapsed seconds; the other three evaluates go through the same race. Lossless: the report of a healthy run stays byte for byte.

**Singles and doubles.** Not affected (harness only).

**Evidence.** `r86/lanes/B/ledger.md` (B8, cause and open point 3); `r86/gate/todo-review.md` (P13: the unguarded evaluate and the constants' lines).

### T329 · Weather and terrain prove the setter's item

*Replay core and app · round 86 · feature (a second reader beside T310's) · score-touching (D3)*

**Approved (round 86 gate of 06.11.2026, 6). The count of observed weather ends comes first; if the corpus holds too few, the build waits.**

**Problem.** A sun team opens with Torkoal. With a Heat Rock the sun lasts eight turns, without it five. The replay shows only `-weather|SunnyDay` at the start and `-weather|none` at the end, so the build takes Torkoal's item from usage. When the guess lacks the rock, the simulator's own count is five, which lies inside the client's range of 5 to 8 (`snapshotConditionRange`, `packages/eval-engine/src/branch/field-correction.ts:29-39`). `syncWeather` (`:88-96`) returns at `:90` when the simulator's weather id matches the snapshot's, so the simulator's five turns stand. A branch that starts on turns 1 to 4 drops the sun at turn 5, where the game keeps it until turn 8. A branch from turn 6 on is right: the simulator's sun has ended, the log's has not, and `syncWeather` takes the snapshot's remaining turns. Terrain Extender on a terrain setter, Damp Rock, Smooth Rock and Icy Rock behave the same way. In Gen 9 the Dex has 18 conditions with a `durationCallback` and 12 condition and item pairs that change the count: the three screens with Light Clay (T310), Hail and Snowscape with Icy Rock, the four terrains with Terrain Extender, Rain Dance with Damp Rock, Sandstorm with Smooth Rock and Sunny Day with Heat Rock. That makes six items, of which T310 covers one: nine pairs and five items are new.

**Idea.** Extend T310's reader to the field. `conditionTurns` (`packages/replay-core/src/dex-facts/screen-turns.ts:50`) already reads turns from the simulator, and `screen-evidence.ts` watches `-sidestart` only (`packages/replay-core/src/inference/screen-evidence.ts:137`). A sibling reader watches `-weather` and `-fieldstart`. The setter is the user of the move, or the body named by `[of]` on a `[from] ability:` line (Drizzle, Drought, Snow Warning, Grassy Surge). The interval ends at the residual `-weather|none` or `-fieldend`: its length proves or rules out the item. A second setter that replaces the weather ends the first outside the residual, so it gives no verdict, as a removal does for a screen. The cost is one more file in `inference/` of about the screen reader's size, with its sweeps.

**Benefit.** App: the opponent's set names the rock in the team panel when the weather's turns prove it, and the what-if lines hold the weather for the right number of turns.

**Success.** Entry gate: count the weather and terrain intervals of `.fit-corpus` that end in a residual `-weather|none` or `-fieldend`, per rule set and per game type; the user rules on the count before the build. Then: a sweep over every weather and terrain setter, moves and abilities, in each rule set the corpus plays, compares the reader with the simulator (the model is `screen-turns-sweep.spec.ts`, whose S1 holds the conditions' turns to the simulator already); set diffs on every build path before the bank (AGENTS.md); a branch row that starts on turn 3 of a Heat Rock game and keeps the sun to its logged end; the batch check or D3 as the set diffs say.

**Singles and doubles.** Both: weather and terrain setters appear in singles, Doubles OU and VGC. Doubles OU, Scarlet/Violet VGC and Champions VGC get their own rows in the count, since terrain teams are most common in VGC.

**Evidence.** `r86/lanes/C/ledger.md` (C2, the proposal for the weather and terrain reader; C3, the screen reader's design); `r86/gate/todo-review.md` (P15: the corrected scene, the count of 18 conditions, 12 pairs and 6 items). Lane C's ledger says a branch from turn 6 on loses the sun two turns too early; the reviewer found the error in turns 1 to 4 instead, and the scene above follows the reviewer.

### T336 · The prover carries a proof over a secondary that only helps the mover

*Engine, prover · round 86 · feature (a game rule in the prover) · score-touching (D3)*

**Approved (round 86 final gate of 06.11.2026, 3).**

**Problem.** A Gengar with a 70 % Focus Blast faces a Blissey whose Seismic Toss cannot touch a Ghost. The win is certain, but only after a chain of up to twelve turns in which the Focus Blast misses now and then. Until round 86 the prover proved it (mass 0.9999 in 12 turns). Since T305 the 10 % Special Defense drop of the Focus Blast is a class of its own (`hit-nokill+boosts:spd`), the memo no longer collapses the hit positions, and the proof needs 163 cells where `PROVER_BUDGET.cells` allows 100 (`packages/eval-engine/src/endgame/prover.ts:44`). The prover returns no proof, and the forced-win label is gone for a chain whose attack carries a secondary effect. The position is still a win by the game: at 200 cells and 400 states the proof returns 0.9989 in 12 turns. The round re-pinned the row `focus-blast-range` of `test/regression/forced-win.spec.ts:54` to no proof (user gate of 06.11.2026, 2a).

**Idea.** `dominates` (`prover.ts:104`) already lets a class that no draw showed inherit the proof of a drawn class when the two differ in one event only: the opponent's move missed, or the side's own move knocked out. Add a third case. A class in which a secondary effect that only helps the mover fired inherits the proof of the class in which it did not fire, because the effect can only improve the mover's position. The Dex says which secondary only helps the mover (a stat drop on the target, a stat gain on the user); no name list. This is a game rule, so the build starts with the sweep that AGENTS.md asks for. The alternative, a larger `PROVER_BUDGET`, costs time on every position, and the bank cannot judge it.

**Benefit.** App: a won endgame in which the winning attack carries a side effect shows its forced-win label again, as it did before round 86.

**Success.** The row `focus-blast-range` returns to mass 0.9999 (`digits: 3`) in 12 turns with the caveat `sampled-rolls`; a sweep over every Dex move with a secondary entry that only helps the mover, in every generation and mod the corpus plays, singles and doubles, compares the reading with the simulator (models: `pair-stall-guard.spec.ts`, `power-handlers-census.spec.ts`); the fingerprint proof for every stand-in that calls a Dex handler. Score-touching, so the batch check reads the cache version, the feedback runs and the tier census.

**Singles and doubles.** Both: `dominates` serves the singles and the doubles prover. The fixture is singles; the doubles prover rows pass today and stay as the guard, and the sweep plays both.

**Evidence.** `r86/lanes/D/ledger.md` (F1, row 2: the bisect to `ca8223f`, the cell counts and the options); `r86/lanes/A/ledger.md` (A3 and A5 gate list, the class `hit-nokill+boosts:spd`).

### T337 · An accuracy die per hit of a multi-accuracy move

*Engine, reconstruction · round 86 · feature · score-touching (the rebuilt positions of the chain turns move)*

**Approved (round 86 final gate of 06.11.2026, 3).**

**Problem.** In the Champions OU game 2628340185 turn 13 Triple Axel lands once and misses its second hit. The rebuild plays two hits, and a new knockout follows. `DieName` has no hit field (`packages/eval-engine/src/dice/types.ts:19`), and `dieKey` drops repeats on purpose (`:38-43`: a forced die applies to every repeat), so the accuracy of one hit is no die the module names. The dice sweep keeps the multi-accuracy rows red on purpose as `test.fails` (ruling Q4, `packages/eval-engine/test/dice-logged-sweep.spec.ts:228-246`), and the residual row sits at `test/regression/forced-reconstruction.spec.ts:54`.

**Idea.** A hit index in `DieName` (an optional field), read by the log reader and carried by the key of an accuracy die of a move with `multiaccuracy`. `dice/recognize.ts`, `answer.ts`, `offer.ts` and `types.ts` change; the engine protocol does not. `DieName` is exported (`packages/eval-engine/src/index.ts:35`), so the API snapshot moves; a new optional field keeps the formats that leave the app. The same index serves T332 (a proc the log shows) for a move that hits several times.

**Benefit.** Engine and app: a chain that broke after one or two hits rebuilds as the log shows it, and a branch from such a turn starts from the game's position. A chip "second hit misses" becomes possible.

**Success.** The multi-accuracy rows of the dice sweep turn plain (`test.fails` off) in every generation and mod the corpus plays, singles and doubles; the residual row of 2628340185 turn 13 leaves `RESIDUALS` and turns plain; the drift line's perfect count does not fall; the fingerprint proof for every stand-in that calls a Dex handler. Score-touching: the batch check, and the bank and the four holdouts for harm.

**Singles and doubles.** Both: the sweep plays the multi-accuracy moves of the Dex in both modes; the scene is singles.

**Evidence.** `r86/lanes/B/ledger.md` (B2, proposal 2; B3); `r86/gate/todo-review.md` (P5: the first of its four parts).

### T338 · The log reader forces Diamond Storm's gain once per move in doubles

*Engine, reconstruction · round 86 · small fix · score-touching (the rebuilt positions of the affected turns move)*

**Approved (round 86 final gate of 06.11.2026, 3).**

**Problem.** In a doubles turn a Diancie fires Diamond Storm into two foes. From Gen 7 the simulator draws the move's own `self.chance` once per move, not once per target: `selfDrops` in `@pkmn/sim` (`battle-actions.js:1346-1360`) sets `move.selfDropped` after the first draw for a move without `multihit`. The reviewer's probe (300 seeds, `gen9doublescustomgame`) gave no boost line in 150 runs and exactly one in the other 150, never two. The reader demands one gain line per struck foe: `selfEffectDice` (`packages/eval-engine/src/dice/logged-results.ts:290-300`) returns a die only when `times === 0 || times >= struck` (`:297`). A log with one gain line against two struck foes returns no die, and the rebuild draws the gain by seed. The comment in `dice-logged-sweep.spec.ts:59` ("a log where only one target gave the gain") describes a log the simulator cannot write.

**Idea.** For a `self.chance` entry from Gen 7 the die holds when the log shows at least one gain (`times > 0`); a Gen 6 secondary entry keeps the count per target (`dice-logged-sweep.spec.ts:69`). No hit index is involved (that is T337). The build starts with a sweep over every Dex move with a `self.chance` entry in every generation and mod the corpus plays.

**Benefit.** Engine and app: a branch from a doubles turn with Diamond Storm starts with the stat gain the game had.

**Success.** The Diamond Storm doubles row of the dice sweep (`dice-logged-sweep.spec.ts:59`) leaves `GAPS` for `FIXED`; the sweep over the `self.chance` moves passes for singles and doubles; the drift line's seeded and fallback counts do not rise. The cartridge may roll once per target where the simulator rolls once per move; the reader follows the simulator, and a difference belongs on the upstream list.

**Singles and doubles.** Doubles for the change (the spread move strikes two foes); the singles row of the same sweep (`:69`) stays as the guard.

**Evidence.** `r86/lanes/B/ledger.md` (B3, gap 4); `r86/gate/todo-review.md` (P5: the corrected cause and the probe).

### T339 · Five VGC turns whose set cannot reach the logged knockout

*Engine, set inference · round 86 · larger bug (the cause is unproven) · diagnosis first, then by its score class*

**Approved (round 86 final gate of 06.11.2026, 3). The diagnosis comes first.**

**Problem.** In 5 of the 22 VGC turns that only the head leaves residual (4 of 16 in Champions VGC) the inferred set of the attacker cannot knock out at the maximum damage roll. The base reached the knockout only through a crit that the log does not show, and the head's forced no-crit is right by the game, so the defender survives in the rebuild. The solver already reads a lethal hit as a lower bound: `observationError` (`packages/replay-core/src/spreads/fit.ts:251`, the comment at `:262-265` and the distance at `:266-270`) refutes a rung only when its best roll falls short of the observed fraction and accepts overkill; `spread-inference.ts:223-226` documents the same, and `choice-lock.ts:337` does it for the choice-lock reader (`DamageObservation.lethal`, `packages/replay-core/src/types.ts:98`, set at `protocol/handlers.ts:268`). So the cause is not a missing bound. One candidate: an attacker seen only in knockouts gets `keep.add(offenseStat)` (`packages/replay-core/src/spread-inference.ts:279`), so the bound can refute rungs but never raises the offense.

**Idea.** Find why each of the five sets misses the knockout. Name the five turns (lane B's ledger never listed them), run the solver on each with the observations it saw, and write down the set that makes the knockout reachable and the step of the solver that rejects it. Then book the fix as its own TODO, or close this one if the cause lies in the log and not in the solver.

**Benefit.** Engine and app: a VGC attacker's set explains the knockouts the log shows, and the rebuilt turn keeps its faint without a crit.

**Success.** The five turns named, each with the set diff that makes the knockout reachable, and a decision on the fix. Set and solver changes read set diffs on every build path before the bank (AGENTS.md).

**Singles and doubles.** VGC and Champions VGC (doubles): the five turns sit in doubles formats. A singles turn of the same kind is not known; the diagnosis counts it.

**Evidence.** `r86/lanes/B/ledger.md` (B7, cause C4 and the proposal for the solver); `r86/gate/todo-review.md` (P10: the solver already reads the bound; the count of 5 of 22 is not shown to the file).

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

### T272 · Old share links name their moves

*App · round 77 · small · cosmetic · rest of D6*

**Parked (release gate 29.10.2026, "3a").** Trigger: a user report.

**Problem.** Since 4cc36e0 a shared branch link carries the names of its choices (`p1Label`, `p2Label`, `forcedSide` in `src/lib/branch-share.ts:14-17`), and the shared view prints them. A link made before round 77 holds the simulator commands alone, and `choiceLine` (`src/components/SharedBranchView.tsx:50`) prints those: "Turn 2: P1 move 1 / P2 move 2" (`test/e2e/embed.spec.ts:69` holds that fallback).

**Benefit.** App: an old link reads like a new one.

**Success.** A link without names shows the move and Pokémon names; a spec with an old payload in singles and doubles.

**Evidence.** Lane L3 (`docs/perf/probes/2026-10-24-r77/wave-fix/L3/ledger.md`, D6).

**Steps.**
- [ ] Find out whether the names can come from the link's `finalLog`: old payloads hold no slot choices and mark no forced replacement, so each entry has to be matched to its log turn, its doubles slots and its forced switches.
- [ ] A red spec with a payload of format 1 without names, then the names.

### T273 · The player picks the slot of a lone replacement

*Branch · round 77 · small · rest of B1*

**Parked (release gate 29.10.2026, "3a").** Trigger: a user report.

**Problem.** After a double knock-out with one Pokémon in the back (gen9vgc2026regi-2629703929 turn 8: Groudon and Solgaleo faint, Jumpluff is left), the simulator asks both slots for a replacement and takes one switch and one pass in either order (`forcedPasses` in side.js `clearChoice`; `choosePass` counts the passes and checks no slot). Since a0500bb the app sends the Pokémon to slot A and passes slot B (`fillableForcedSlots`, `packages/eval-engine/src/branch-choices.ts:79`), so a user cannot fill slot B.

**Benefit.** App: the replacement lands in the slot the player chooses, where Future Sight, Wish or an ally's move targets a slot.

**Success.** The picker offers the lone replacement in both slots, and the other slot passes; doubles and VGC rows against the simulator.

**Evidence.** Lane L1 (`docs/perf/probes/2026-10-24-r77/wave-fix/L1/ledger.md`, B1).

**Steps.**
- [ ] A red spec that fills slot B. The slot rule lives in `requiredChoicesForActiveSlots` (`packages/eval-engine/src/branch-choices.ts:85`), `forceSwitches` (`packages/eval-engine/src/branch/forced-slots.ts`) and `src/hooks/branch/shared.ts`, and every hook reads it without the pending picks: the choice of slot has to reach them, `src/hooks/branch/execute.ts` included.

### T274 · No evaluation at an ended position

*Eval · round 77 · small · rest of C7 and of the play-out fix*

**Parked (release gate 29.10.2026, "3a"; the review of 29.10. found that the ended tip and the ended play-out share the cause).** Trigger: a user report.

**Problem.** At a variation's ended tip the panel says who won and offers no Evaluate (05956c0), but two effects of `src/hooks/useEvalView.ts` have no `ended` input: Auto (`:245`) and "Always on" (`:253-262`) can still start an evaluation behind the notice. The same Auto effect evaluates the ended position once after the last turn of a play-out; the loop of `src/hooks/usePlayOut.ts` reads the end only from that result (`:175`, `:181`). Whether such a result writes a point into the variation graph (`useEvalView.ts:125-134`) and what it costs (the tree returns early at an ended root, `packages/eval-engine/src/mcts.ts:74`) is unchecked.

**Benefit.** App: no search runs for a game that is over, and the variation graph holds no point for it.

**Success.** No evaluation starts at an ended position, with Auto or "Always on", and a play-out that ends the game asks for none after its last turn; a spec over the controller in singles and doubles, and a row in `test/ui/hooks/usePlayOut.evaluations.spec.tsx`.

**Evidence.** Lanes L5 (`docs/perf/probes/2026-10-24-r77/wave-fix/L5/ledger.md`, item 6) and L4 (`wave-fix/L4/ledger.md`, item 6); the review of the TODOs (`docs/perf/probes/2026-10-24-r77/review/todos-review.md`).

**Steps.**
- [ ] Red specs, then an `ended` input from `src/hooks/controller/engine-controller.ts` (`:91-96`) to both effects; the play-out loop reads the end from the battle.

### T275 · An unknown species keeps its name in the import's message

*App · round 77 · small · cosmetic · rest of D5*

**Parked (release gate 29.10.2026, "3a").** Trigger: a user report.

**Problem.** An import that names a species the Dex does not know is refused with the name turned into its id ("P1 foomon: not on P1's team, so its set cannot apply.", `src/lib/sets-io.ts:174`): `Teams.import` reads "Foo Mon" as the species `foomon`, because the Dex names an unknown species by its id. A species the Dex knows keeps its name ("MissingNo.").

**Benefit.** App: the message names the species as the user typed it.

**Success.** The refusal quotes the typed name; the specs of `test/regression/sets-import-validation.spec.ts` (`:52`, `:85`, today case-blind) match "Foo Mon" exactly.

**Evidence.** Lane L3 (`docs/perf/probes/2026-10-24-r77/wave-fix/L3/ledger.md`, D5).

**Steps.**
- [ ] A red spec, then the typed name carried out of `parsePastedTeam` (`packages/replay-core/src/team-paste.ts:49`) or `parseSetsImport` (`src/lib/sets-io.ts:96`) to the message.

### T276 · One loader for the editor's pools, and real pools in the UI specs

*Test and code health · round 77 · small · rest of D5*

**Parked (release gate 29.10.2026, "3a", the three internal points as one).** Trigger: the next change to the set editor or the sets import.

**Problem.** (1) `loadImportPools` (`src/lib/sets-io.ts:134`) repeats the pool loading of `useEditorPools` (`src/hooks/useTeamDraft.ts:9`). (2) In the jsdom round trip of `test/ui/components/sets-roundtrip-t205.spec.tsx` every move pool of the import held one move per species, Body Press not among them (`docs/perf/probes/2026-10-24-r77/measure/poolprobe-jsdom.log`, from a log line the integrator added to the hook for one run); in Node, Magnezone's Gen 8 pool holds 50 moves. (3) The import validation spec has no Champions row (`test/regression/sets-import-validation.spec.ts:24-27`).

**Benefit.** Packages and app: one place loads the pools, and the UI specs test the editor and the import against the pools a user meets.

**Success.** One `loadEditorPools` in `src/lib/team-editor.ts` serves both; a UI spec reads a full pool under jsdom; a Champions row in the import validation spec.

**Evidence.** Lane L3 (`docs/perf/probes/2026-10-24-r77/wave-fix/L3/ledger.md`), the night's acceptance (`docs/perf/probes/2026-10-24-r77/swarm/findings.md`, "Found in the acceptance").

**Steps.**
- [ ] Find why the pools hold one move in the jsdom run, then the shared loader and the Champions row.

### T277 · Champions OU leaf K on the rebuild of simulator 0.10.12

*Engine · round 78 · small to medium · score touch: a fit after a game-correct change*

**Parked (user gate 29.10.2026, round 78, "1a 3b").** Trigger: a user report on Champions OU, or the next round that touches weights or K.

**Problem.** Round 78 moved the simulator to @pkmn 0.10.12, whose Champions mod plays Regulation M-C and allows 35 species the 0.10.11 mod did not, though the games played them (Golisopod first, then Rillaboom, Cinderace and Absol-Mega-Z). On the Champions OU holdout the candidate reads harm on the luck-adjusted rows under the base's fixed K (+31 [+2, +68] bp, a late warning of +63 [+4, +140]) and none in the full rows or under its own K per phase (luck-adjusted +39 [−1, +91], unresolved). In the 116 of 149 games with such a species 49 % of the rows moved, in the other 33 games 10 %, and every large flip holds Golisopod (2692358324 turn 15: 0.628 to −0.345, the base right). The Champions OU entry of the leaf K (`CHAMPIONS_WINPROB_K.singles`, `packages/eval-engine/src/winprob.ts:86-89`) holds the standard singles values 2.28 + 1.49·ff; round 74 fitted 2.05 + 3.22·ff on rebuilds of 0.10.11 (the ledger in the same file, lines 43-44: −12 bp unresolved with a mid warning) and did not adopt it.

**Idea.** Fit the Champions OU leaf K on a capture of the fit corpus with simulator 0.10.12, the holdout kept out of the fit (round 74's 2.05 + 3.22·ff is the stale 0.10.11 reference), and adopt it by round 74's pre-registered rule; then pair the bank and the Champions OU holdout against the round 78 candidate. AGENTS.md: a re-fit runs where the bank reads harm after a game-correct change.

**Benefit.** Engine: the Champions OU win percentages fit the rebuild that plays the games' legal teams.

**Success.** On the Champions OU holdout no pooled row reads harm (at least 5 bp worse with its band wholly on the bad side) in the full or the luck-adjusted rows, under the fixed K or under its own K per phase; the bank and the other holdouts unmoved.

**Evidence.** `r78/measure/pair-championsou.txt`; the legality census `r78/measure/champions-legality.txt`.

**Singles and doubles.** Singles: this TODO (Champions OU). Doubles: Champions VGC reads −4 [−12, +3] full and −5 [−17, +4] luck-adjusted under the base's K, no harm and no warning; its K is not touched.

### T278 · An M-B replay plays on its own regulation

*Engine and app · round 78 · medium · rule*

**Parked (user gate 29.10.2026, round 78, "3b").** Trigger: a user report.

**Problem.** Since @pkmn/mods 0.10.12 the `champions` mod plays Regulation M-C and lists only its formats. Regulation M-B lives on as the overlay `championsregmb` with four formats (`gen9championsbssregmb`, `gen9championsvgc2026regmb`, `gen9championsvgc2026regmbbo3`, `gen9champions4v4doublesuu`) and its own PP, legality and learnsets (Wish and Strength Sap at base 10 instead of 5); M-A has none. The app registers `champions` alone (`packages/eval-engine/src/forward/sim-mods.ts:28-49`) and branches every Champions replay on the mod's OU or Doubles Custom Game (`getBranchSimulatorFormat`, `packages/replay-core/src/replay-format.ts:327-345`), so an M-B game plays with M-C's PP: Wish and Strength Sap get 8 PP in the rebuild where M-B gives 16 (the base times 8/5), a Blissey's ninth Wish finds no PP, and the pricing that reads `slot.pp` sees fewer uses left. The team editor's legal pools show M-C as well.

**Idea.** Register `championsregmb` beside `champions` and pick the Dex of the replay's regulation by the overlay's format list or the format's own `mod` (a substring `regmb` misses `gen9champions4v4doublesuu`). The overlay has no Custom Game, and the app branches on one because a VGC format's team preview keeps only the first four of a team, so an M-B replay branches on a Custom Game built with `mod: 'championsregmb'`. Nine modules pick the Dex by the one constant `CHAMPIONS_MOD` or `dexes.champions` (replay-core's `calc-gen`, `format-generations`, `rules-dex`, `inference/inferrer-state` and `spreads/race-speed`, eval-engine's `calc/move` and `branch/team-order`, the app's `picker-state` and `pokemon-options`), and each has to ask for the replay's regulation. M-A games (313 in the fit corpus) stay on M-C.

**Benefit.** App and engine: an M-B game's PP, legality and learnsets follow M-B.

**Success.** A sweep over every move, species and learnset the overlay changes, against the overlay's Dex; an M-B replay rebuilds with 16 PP of Wish; the Champions VGC holdout, mostly M-B games (the fit corpus holds 160 `regmb` and 750 `regmbbo3` replays), pairs against r78-cand without harm.

**Singles and doubles.** Both: the M-B formats are VGC and 4v4 doubles, and BSS singles.

### T279 · The chip of a hit carries its crit share

*Engine · round 78 · small · score touch*

**Parked (user gate 29.10.2026, round 78, "3b").** Trigger: a user report.

**Problem.** The hit reader plays a hit on quantiles of its dice and first tries two probes, u = 0.075 and 0.925 (`packages/eval-engine/src/score/contact-play.ts:31-34`); when both leave the same status, their mean is the cost. At the ordinary crit stage neither probe crits (1 in 16 in Gens 3 to 6, 1 in 24 later, 17 in 256 in Gen 2), so a recoil move reads about 6 % low in Gens 2 to 5, where a crit doubles the damage, about 3 % in Gen 6 and 2 % from Gen 7, where it multiplies by 1.5: in Gen 3 Snorlax's Double-Edge read 0.1708 of its HP, the simulator's mean over 600 seeds 0.1825. At a raised stage (Scope Lens, Focus Energy, a high-crit move: 1 in 8) the low probe crits and the high one does not, so the mean weights the crit at 50 % instead of 12.5 %: the same Double-Edge with Scope Lens reads 27 % high in Gen 3 (0.2452 against 0.1924) and 20 % in Gens 6 and 9. Since round 78 `packages/eval-engine/test/contact-hits.spec.ts:401` holds the reader to the turns without a crit.

**Idea.** Price a hit with the crit share the simulator plays: the multiplier from a crit forced with `move.willCrit`, the chance from a quantile probe near 0 that finds the largest u at which the crit fires (a chance of n in d fires when u < n / d, `contact-play.ts:16-17`), no table. Gen 1 rates a crit by base Speed and stays out of scope.

**Benefit.** Engine: recoil and the other chip costs of a hit read at their mean, at every crit stage.

**Success.** One scene per generation 2 to 9 and the raised-crit scene, each within 3 % of the simulator's mean over 600 seeds; `contact-hits.spec.ts` returns from `meanLossWithoutCrit` to `meanLoss`; the bank and the holdouts without harm.

**Singles and doubles.** Both.

### T289 · An item taken away is a lasting loss

*Engine · round 79 · medium · score-touching*

**Parked (user gate 30.10.2026, "6a").** Trigger: a Knock Off turn in a pinned replay reads wrong.

**Problem.** The static prices items in three places: `itemMultiplier` (`score/features.ts`, Leftovers and Black Sludge x1.03 on the body's share, a fixed list of item ids), the threat proxy of the pairs on the field (`score/threat.ts`), and `choiceMismatch`. Taking Leftovers away is worth about 1% of a game, a Life Orb or a Rocky Helmet on a benched Pokémon nothing, and `features.ts`, `threat.ts` and `hazards.ts` name item ids where the rest of the code reads the Dex (AGENTS.md names species and moves; whether its rule covers items is the user's call).

**Idea.** Price an item by what it does while its holder is on the field (the residual reader of the active bodies, played for a benched body on a twin), over the rest of the game, never by an item list.

**Benefit.** Engine: Knock Off reads at the worth of the item it takes.

**Success.** A sweep over every Dex item with a residual, damage or stat effect against the simulator; a Knock Off scene pin; bank without harm.

**Evidence.** `r79/lanes/B/plan.md` (B3).

**Singles and doubles.** Both.

### T291 · A sacrifice credit reads the turns that followed

*Engine · round 79 · small to medium · rule, moves tiers*

**Parked (final gate 30.10.2026 15:05, "5a").** Trigger: a sacrifice credit in a pinned replay that the game refutes.

**Problem.** In smogtours-gen9doublesou-912045 turn 1 both of p2's leads attack at full HP and fall to Gholdengo's Make It Rain, and since T287 the census credits p2 with a sacrifice (the inaccuracy of 0.174 drops, marked [sacrifice]). The payoff window of the stayed feed (`stayedFeedPayoff`, `packages/eval-engine/src/turn-analysis/sack-gates.ts`) counts turn 2 at its expected pair value (the root's cell, 0.156 for p1; the window's `futureOutcomes` come from `graph.playedOutcome`, `src/lib/analysis-context.ts`) although the search read turn 2's result at 0.784 for p1. The user's screenshot of gen9championsvgc2026regmc-2695803506 turn 1 shows a similar credit ("learningthegame234 fed Sneasler (100% HP) ... verified as a win-condition sacrifice"); whether it has the same cause is open.

**Idea.** The window that repays a sacrifice reads each following turn at the score the search found after it (`scoreAfter`), not at the cell of its played pair.

**Benefit.** App: a lead that simply fell is not called a sacrifice.

**Success.** A red test on the 912045 t1 shape (no credit); the credits of 653785 t19 (hazard sack), 573756 t68 (stayed feed) and 2663093831 t11 stay; two feedback runs byte-identical and the tier census read at the gate.

**Evidence.** `r79/lanes/D/ledger.md` (step 3).

**Singles and doubles.** Both; the scenes are doubles.

### T292 · The open gaps of the near-decided stage

*Engine · round 79 · small · rule · score-touching (the prover and the sack gate read the stage)*

**Parked (final gate of round 80, 30.10.2026 22:05, "2a"). Trigger: a near-decided sentence in the corpus or in a report of the user that one of the three gaps below makes wrong.**

**Delivered in round 80 (quick fix, 4754c58).** The near stage names the clicker, who clears the rest itself, and records its click (`click`: the move id and, in doubles, the target's location). The stage's own comment has said "Own active, own click" since round 15, but `nearDecidedFor` returned `sweepSurvivor(ctx, mine, rest)`, any teammate. The denied end speaks only when the played choice made that click (`clickPlayed` in `packages/eval-engine/src/denied-end.ts`, which reads the first action of the played choice). The scene of 2695803506 turn 2 is gone: Basculegion's 94 % Wave Crash stood against Incineroar, the sentence named Kingambit, Basculegion switched out, and the only rolls the log marks on that turn were Matcha Gotcha's burns. Six of the ten near stages on the corpus's turn cards went with it; each named a Pokémon other than the clicker, twice the doubles partner (Kingambit in 2695803506 turns 2 and 7) and four times a benched Pokémon. A seventh went from the replacement root after the knockouts of turn 3 of 912045.

**Problem.** Three gaps stay. First, the stage reads a move's priority from the Dex move only, in the click test (`foeActsBefore`, `packages/eval-engine/src/score/unanswered.ts`) and in the clean-up order (`threat.priority` in `score/threat.ts`, read by `movesFirst` in `sweepClocks` and in `beatsEntry`), so a priority that an ability or a terrain sets (Prankster, Gale Wings, Triage, Grassy Glide) and an item's fractional priority (Quick Claw, Custap Berry) go unread. Second, doubles read the first active of each side only: the partner's click and the partner's kill chance on the clicker are both outside the model. Third, the clean-up lets a holder of a Choice item that is not locked yet pick its best move against each foe (`pairThreat` locks only on the live `choicelock` volatile), though in the game it is locked after its first move; Gorilla Tactics keeps its lock in the ability's state, not in that volatile. The four near stages that stay in the corpus (655336 t25 and t27, 573756 t77, 2695803506 t13) name their own clicker; only 655336 played its click, so no denied end can speak at the other two. Nobody has played them out against the simulator.

**Idea.** Each gap with its sweep. The order comes from the simulator: `packages/eval-engine/src/sim-ask/action-order.ts` (round 72, `actionsTie`) already asks `queue.resolveAction` on a copy with fixed dice and reads Prankster, Gale Wings, Triage, Grassy Glide, Stall, Quick Claw and Custap Berry for the tie question, and it gains an "acts before" answer that the click test and the clean-up order both read (one rule in one module, never a list of abilities or items). Both slots in doubles. A Choice lock read from what the simulator applies, item or ability, so the holder plays one move through the clean-up.

**Benefit.** App: the "one roll from clearing the rest" sentence stands only where the game bears it out.

**Success.** The three sweeps against the simulator; each remaining stage played out on a copy (the click forced, both sides on their best moves, a fixed set of seeds), and its sentence kept only where the clicker clears the rest in most seeds; the batch check (two feedback runs byte-identical, the tier census with `--moved`) and the count of turns where the prover names a side, before and after.

**Singles and doubles.** Both: the slot question is the doubles half, and the priority and Choice gaps show in singles too (655336 and 573756 are singles stages that stay).

### T293 · The first-mover tie on the score path

*Engine · round 79 · small · score-touching (D3)*

**Parked (final gate 30.10.2026 15:05, "7a").** Trigger: the next round that touches races or weights.

**Problem.** T283 gave a finite race tie to the first mover only when its own hit finishes the foe, in the near-decided profile (`packages/eval-engine/src/score/unanswered.ts`). The same bare tie stands in the score path: `score/last-pair.ts` and `score/matchup.ts` (two places).

**Idea.** The same rule there, in one module that all three readers import (AGENTS.md: one rule, one module).

**Benefit.** Engine: the last-pair and matchup terms do not count end-of-turn damage as the winning blow.

**Success.** A sweep spec that drives the last-pair and matchup readers over every residual status in every generation, the simulator as the judge; the bank and the holdouts without harm.

**Singles and doubles.** Both.

### T300 · The Champions preview prices every hit of a Past multi-hit move

*App · round 82 · small · lossless (preview only)*

**Parked (final gate of round 82, 01.11.2026, "2a"). Trigger: a Champions Custom Game replay or a draft-league report with one of the 17 moves, or a `@smogon/calc` release that changes its Champions move list.**

**Problem.** In a Champions Custom Game (a draft league) the branch panel's damage preview prices one hit of the 17 multi-hit moves that the Champions mod marks `isNonstandard: 'Past'`: Double Kick previews 23 where the simulator deals 46, Fury Attack 18 against 54 at three hits (roll step 0, singles). The calculator's Champions data lacks 15 of them and holds Gear Grind and Triple Dive as entries without type, category or hit count (upstream list in `NextSteps.md`). Two places in our code expect the calculator to read the hit count itself. `modOverrides` (`packages/eval-engine/src/calc/move.ts:63-73`) copies power, type, category, flags and target for a move the calculator lacks and compares power, type and category for a move it holds, Gear Grind and Triple Dive included, never `multihit` or `multiaccuracy`. `hitCounts` (`packages/eval-engine/src/damage-calc.ts:233-239`, called at `:336-338`) leaves a fixed count to the calculator and passes Fury Attack's `hits`, which the calculator ignores for a move without `multihit` data. The team validator rejects all 17 moves in Champions OU and VGC; only the two Custom Game formats (`gen9championscustomgame`, `gen9championsdoublescustomgame`) accept them, and none of the 1,875 Champions logs of `.fit-corpus` and the feedback fixtures uses one. The engine's prices read the simulator's hit count (`ko-odds.ts:123-126`, `pair/guards.ts:50`, `score/move-facts.ts:279-292`), so only the preview is wrong.

**Idea.** Both branches of `modOverrides` carry `multihit` and `multiaccuracy` from the battle's Dex move whenever the calculator lacks them. Triple Kick, whose power rises per hit, gets its own row in the sweep.

**Benefit.** App: the preview of a draft-league team with Double Kick or Fury Swipes shows the damage the simulator deals.

**Success.** A sweep over every multi-hit move of the simulator's Champions Dex (31 today, 17 of them Past) compares the preview's range at every roll step and hit count with the simulator; the four Champions rows of `packages/eval-engine/test/damage-calc-rolls.spec.ts:73-86` (Double Kick and Fury Attack in singles and doubles, `test.fails` today) become plain tests. No score moves.

**Singles and doubles.** Both: the preview prices a doubles target the same way, and the sweep plays both boards.

**Evidence.** `r82/review/champions-multihit.md` with its probes (`multihit.vt.ts`, `legal.vt.ts`, `preview.vt.ts`, `scene.cjs`).

### T301 · A dice list after Execute

*App · round 82 · feature · lossless*

**Parked (final gate of round 82, 01.11.2026, "2a"). Trigger: the user wants to force a die that no chip offers.**

**Problem.** Round 82 sets dice before Execute only (spec decision 3, option a). The chips offer the dice the module can name from the chosen moves and the bodies' state at choice time (`offeredDice`, `offeredOrderDice` and `offeredEndDice` in `packages/eval-engine/src/dice/offer.ts`; `checkOffers` reads `status` and `volatiles` at `:203-212`). A die that arises during the turn gets no chip, such as the status check of a paralysis or a confusion that starts in the same turn (`dice-offer-turn.spec.ts:122-146`). A forced die still applies to it, but only a restored state file of `Report issue` can carry one; a share link keeps the dice as text marks. After Execute the frame names the forced dice only ("Forced: Air Slash flinch, 30 %", `src/lib/branch-dice-lines.ts`). The natural copy records every die it rolls by name (`naturalTurn` in `packages/eval-engine/src/dice/play.ts`: `names`, `chances`), and `playForcedTurn` returns the forced dice only (`DiceReport.forced`).

**Idea.** `playForcedTurn` also returns the dice the turn rolled, by name and result. The history row of a branch turn opens a list of them; a click flips one die and replays the turn with it forced, every other die as the turn rolled it (spec decision 3, option b).

**Benefit.** App: the user sees every die of a turn after it ran and can flip any of them, also the dice no chip offered.

**Success.** A ui spec over the list (it shows the turn's dice and their results; a click replays the turn with that die flipped and leaves the others); an e2e scene on the GPL replay; criterion 2 of round 82 (`dice-keep-dice.spec.ts`) holds for a flip from the list.

**Singles and doubles.** Both: doubles list the dice per slot and target.

### T302 · A chip that a rule blocks turns gray

*App · round 82 · small · lossless*

**Parked (final gate of round 82, 01.11.2026, "2a"). Trigger: a report of a chip that took no effect.**

**Problem.** A chip stays clickable when a rule keeps its result from taking effect (spec decision 10, option a). `secondaryOffers` (`packages/eval-engine/src/dice/offer.ts:112-124`) offers every entry that `ModifySecondaries` leaves, so a flinch chip stands on a move whose target acts first, and a burn chip against a Fire type. The user learns it after Execute, from the frame line "Forced burn had no effect" with the report's reason (`noEffectText` in `src/lib/branch-dice-lines.ts:57-58`; `took: 'blocked'`, `DieTook` in `packages/eval-engine/src/dice/types.ts:31`, set for a secondary in `dice/report-moves.ts:69`).

**Idea.** Before the chips render, a trial run on a copy plays the turn with each chip's die forced, and a chip whose result takes no effect turns gray with the reason as its tooltip (spec decision 10, option b). The trial reads the chosen moves of both sides, so it runs again when a choice changes.

**Benefit.** App: the user sees before Execute which dice can change the turn.

**Success.** A ui spec over the panel: the flinch chip of a slower Air Slash user is gray with its reason, the same chip on the faster user is not; a sweep over every offered chip in the scenes of the dice sweeps compares the trial's verdict with the report of the real turn; a Node probe prices the trial runs per turn on the main thread in singles, doubles and VGC, and the gate decides with that cost.

**Singles and doubles.** Both: a doubles turn has a chip per target.

### T303 · Duration dice, random picks and three draws without a kind

*Engine · round 82 · feature · lossless*

**Parked (final gate of round 82, 01.11.2026, "2a"). Trigger: a request from the user for one of them.**

**Problem.** The dice module names and forces the dice that decide one result. Duration dice (sleep turns, confusion turns, Outrage's lock, the turns of a trap) and random picks (Metronome, Sleep Talk, Assist, Tri Attack's and Dire Claw's status, Moody, Pickup, random targets in doubles, Trace, Forewarn) follow the seed (spec, "Out of scope"). The census of draw handlers marks three draws in scope that no recognition names yet (`packages/eval-engine/test/dice-census-support.ts:162-174`): a second Ally Switch in a row draws `randomChance(1, counter)` under `Restart`, not `StallMove`, and the move has no `stallingMove` flag; Gen 2 Pursuit settles a speed tie against a switching body with a coin that the order's shuffle does not carry; Gen 1 draws a secondary effect against a Substitute inside the Substitute handler, which the secondary rule skips. All of them follow the stream, and no chip offers them.

**Idea.** A duration die answers with a number of turns, a random pick with an entry of its list; both need a chip with more than two results, like the damage roll's select. The three draws get their recognition from the hook that runs before them.

**Round 86 gate 06.11.2026.** Present's power pick joins this TODO. The pinned simulator (0.10.12) draws `this.random(10)` in `onModifyMove` (`data/moves.js:14131-14141`): 0 or 1 heals a quarter of the target, 2 to 5 gives power 40, 6 to 8 gives 80, anything else 120. No kind of die names it (`packages/eval-engine/src/dice/recognize.ts`). It is a pick with four results, so `DieResult` already has the shape (`{ option }`, `dice/types.ts:25`) and no hit index is involved. The scene: a Present that healed the foe at full hit points in the game hits under another seed in the rebuild (lane B, B3). The earlier ledger wrote `random(100)`; the reviewer read `random(10)`. The old cartridge used a different table in Gens 2 to 4; the sweep reads the simulator, and a difference belongs on the upstream list. Tri Attack's and Dire Claw's status pick, already in the list above, stays with this TODO too.

**Benefit.** App: the user can let a sleep last one turn or a Metronome call a chosen move.

**Success.** A sweep per new kind over every Dex entry that draws it, in every generation and mod the corpus plays, singles, doubles and VGC; the three census rows lose their `open` mark; the fingerprint proof for every stand-in that calls a Dex handler.

**Singles and doubles.** Both; random targets are doubles only.

### T311 · The turn boundary keeps a condition the client cannot see

*Engine · round 83 · small · score-touching*

**Parked (gate of round 83, 01.11.2026 13:26, "3a"). Trigger: a report or a replay with Fairy Lock, or with Lucky Chant, Mud Sport or Water Sport in Gens 8 and 9.**

**Problem.** At every turn boundary `syncEffectTableFromSnapshot` (`packages/eval-engine/src/branch/field-correction.ts`) deletes each side condition and pseudo weather the client's snapshot does not hold. The client holds what it can name. Fairy Lock writes only `-fieldactivate` (Gens 6 on), so the client never tracks it. The client of Gens 8 and 9 does not know the Past moves Lucky Chant, Mud Sport and Water Sport and files them under a stray key such as `moveluckychant`, so the boundary deletes the real condition and writes the stray entry into the simulator's table. The simulator keeps each of them, and the boundary takes them away: a variation that starts on the turn after Fairy Lock lets both sides switch, where the game traps them. The sweep of T307 holds these 22 rows as expected fails (`packages/eval-engine/test/field-correction-sweep.spec.ts`, `clientBlind`).

**Idea.** The boundary deletes a condition only when the client showed it before and no longer does (the previous snapshot), so a condition the client never saw keeps the simulator's state, and a key the simulator's Dex does not know never enters its table; for the Past moves, the client's Dex knows the Past entries in a format that plays them.

**Benefit.** Engine and app: a variation keeps Fairy Lock's trap and the Past conditions as the game keeps them.

**Success.** The 22 rows turn into plain tests, and a row holds the simulator's table free of stray keys; the batch check.

**Singles and doubles.** Both.

**Reach.** No replay of `.fit-corpus` or the feedback fixtures plays Fairy Lock, Lucky Chant, Mud Sport or Water Sport. The usage fixtures show Fairy Lock only on Klefki: Gen 9 OU on 0.12 of Klefki's sets (Klefki on 0.35 % of teams), Champions OU 0.056, Champions VGC 0.006, Gen 9 Doubles OU 0.004, Gens 6 and 8 OU 0.0004 to 0.0026; Lucky Chant, Mud Sport and Water Sport in none.

### T321 · The merge of the trees leaves the main thread

*App and eval engine · round 85 · larger bug · lossless (D4)*

**Parked (final gate of round 85, 04.11.2026, "3a"). Trigger: a frame over 100 ms in a dock fill or in Analyze game at the user's window.**

**Problem.** Round 85 left this part of T318 out (design gate of 04.11.2026, "2a"). After the round, one scene of its probe blocks the main thread: Doubles OU 2695411495, Analyze game at a pool of 12, with frames of up to 70 ms and 17 to 18 ms of blocking per run, before the change as after. The long frames name `Worker.onmessage`, 249 ms over three runs. The main thread merges the workers' trees there: `src/lib/eval/worker-client.ts:226` calls `searchTreesOrchestrated` (`packages/eval-engine/src/tree-orchestrator.ts`), which runs `mergeMctsTrees` (`mcts-merge.ts`), and the merge ranks through `rankFromMatrix` (`ranking/order.ts`) and `solveMatrixGame` (`ranking/solve.ts`); the answer round reaches the ranking a second way (`answerRound`, `gradedRanking` in `search/answers.ts`). The probe does not split the 249 ms between the merge, the answer round and the structured clone of the trees that arrive. Every other scene of the probe reads no blocking in the fills and in Analyze game.

**Idea.** Split the time first: the stages of `perfSync` (`packages/eval-engine/src/perf-trace.ts`) around the merge, the ranking and the answer round, read in that scene. Then move what dominates into a worker: a new request and response variant of `EvalWorkerRequest` and `EvalWorkerResponse` (`packages/eval-engine/src/types.ts`) and a branch in `src/workers/eval-worker.ts`. Sending the trees to that worker costs a second clone, and the probe weighs it against the gain. `mergeMctsTrees` is in the barrel already, so the API snapshot moves only if a new name enters it; `ENGINE_PROTOCOL` versions the HTTP engine format and stays.

**Benefit.** App: Analyze game and the dock's fills stay free of long frames when the search grows (a longer budget, larger doubles trees).

**Success.** At the user's window on a production build, three runs per scene with the median read: Doubles OU's Analyze game at most half of round 85's blocking, no other scene worse, in Chromium and in Firefox. Lossless (D4): the feedback harness drives the real app through the pool, so three byte-identical feedback runs see the change; the bank searches in process (`test/regression/bank-search.ts`), so a spec compares the worker-side merge with the in-process result byte for byte; regression, e2e, lint, `tsc -b`.

**Singles and doubles.** Both; the doubles trees are the larger ones, so Doubles OU, Scarlet/Violet VGC and Champions VGC each get their own row.

**Evidence.** `docs/perf/probes/2026-11-04-r85/` (`findings.md`, source 3; `compare.md`, the row Doubles OU, pool 12, Analyze game).

### T330 · A move without a secondary effect gets its rare miss class priced

*Engine · round 86 · larger bug · score-touching (D3)*

**Parked (round 86 gate of 06.11.2026, 6). Trigger: a scene in which the missing miss class flips a note (a tier or a key moment).**

**Problem.** In singles game 573756 turn 73 Garchomp's 95 % Fire Fang would end the game by knocking out Corviknight, and it missed. The verify round prices the cell Body Press against Fire Fang. Fire Fang carries a burn and a flinch entry in the Dex (10 % each), so `hasSecondary` is true for the cell and `blendCellSample` (`packages/eval-engine/src/search/cell-sampler.ts:296`) takes `forceMissingClasses` (`:331-332`): one scripted draw prices the 5 % miss class, and the cell reads -0.8711 where the base read -0.8908 (A7). A move with no secondary entry takes the other route, `chaseMissingClasses` (`:333`): up to 16 draws on probe seeds, and a class below `MISSING_WEIGHT_CUT` of 0.2 (`:83`) that no draw reached is dropped and the others renormalised. Fourteen hits in a row come up in 0.95^14, 49 % of the cases, so the base priced that cell as a sure kill by luck of its seeds. The route depends on `hasSecondary` (`:241`, `:308`), not on whether the plan holds a rare class.

**Idea.** Force the missing plan classes by script in every cell that has a plan, as the secondary route does today, so a 5 % miss gets its price whether or not the move carries a secondary entry. The cost is a draw per missing class in cells the chase covers now; the build starts from the fork probe `a9-cost.vt.ts`.

**Benefit.** Engine: a rare miss or a rare crit is priced at its Dex weight in every cell, not only in the cells of moves with a side effect.

**Success.** A sweep over every move with an accuracy below 100 % and no secondary entry compares the cell's class prices with the plan in every rule set the corpus plays; forks per group stay within round 86's budget (+20 %); the bank and the four holdouts show no harm against the base after T323; the scene that fires the trigger is one row of the sweep.

**Singles and doubles.** Both: `blendCellSample` serves the singles matrix and tree; the doubles pair plan has its own sampler (`pair/sampler.ts`), which the build reads for the same route.

**Evidence.** `r86/lanes/A/ledger.md` (A7: the diagnosis of 573756 turn 73 and the rest it names).

### T331 · The rests of T305's class plans

*Engine · round 86 · feature (five rests of T305) · score-touching (D3)*

**Parked (round 86 gate of 06.11.2026, 6). Trigger: a feedback scene that one of the five prices wrongly.**

**Problem.** T305 prices a secondary effect at its chance through outcome classes. Five cases keep the older, coarser price. (1) Gens 1 and 2 have no class plan: `boundaryEvent` returns null for `genNum <= 2` (`packages/eval-engine/src/ko-odds.ts:222`), so no class path sees a cell. (2) A multi-hit move with a secondary entry draws the entry at every hit (Twineedle in Gens 3 to 7, Double Iron Bash from Gen 8); the script rows skip those moves (`packages/eval-engine/test/secondary-classes.spec.ts:124`), and so do the weights and record rows (A5b). (3) Random-target moves in doubles. (4) A self effect on a knockout. (5) A flinch that another status of the same hit pre-empts: the singles cell falls back, and in doubles the record says `happened` while the class carries the token. All five follow the plain draws that every cell used before round 86, so none is a regression. The bank holds no Gen 1 or 2 position (A3).

**Idea.** One rest at a time, each with its own sweep: a class plan for Gens 1 and 2 (the calculator has no hit there, so the plan needs another source for the hit chance), a die per hit for multi-hit entries, a class per target for random-target moves, and so on.

**Benefit.** Engine: the dice of these moves read at their chance, as the rest of T305's dice do.

**Success.** Per rest, a sweep over every Dex entry that reaches it, in every generation and mod the corpus plays, singles and doubles, compares the class prices with the simulator; the fingerprint proof for every stand-in that calls a Dex handler; the bank and the holdouts without harm.

**Singles and doubles.** Both: random targets exist in doubles only; Gens 1 and 2 are singles.

**Evidence.** `r86/lanes/A/ledger.md` (A4 findings 2 to 4 and the rests of A5a and A5b).

### T332 · A proc the log shows fires in the rebuild

*Engine, reconstruction · round 86 · feature · score-touching*

**Parked (round 86 gate of 06.11.2026, 6). Trigger: a second scene, a corpus turn where the log shows a proc and the rebuild lacks its effect.**

**Problem.** The rebuild forces the dice the log names and quiets a proc the log does not show (`quietProcs`, `packages/eval-engine/src/dice/phantom-procs.ts:31`). A proc the log does show stays with the frozen seed (`:38` skips it), and the seed may say no. A Focus Band that saves a body in the game, or a Flame Body burn, then does not fire in the rebuild. The position lacks the rescue or the burn until the next boundary corrects it, or the whole block falls back to the seed search.

**Idea.** The other half of the same rule: force the proc the log shows to happen, and the end-of-turn dice with it. Where a move hits several times, the die needs a hit index in `DieName` (`dice/types.ts`), the multi-accuracy hit index (T337).

**Benefit.** Engine and app: a branch opened on a turn with a shown proc starts from the position the game had.

**Success.** A row for the scene that fires the trigger; the sweep of `dice-logged-sweep.spec.ts` gains a row per proc kind (ability proc, item proc), singles and doubles; the drift line's seeded and fallback counts do not rise.

**Singles and doubles.** Both: the sweep plays both, and the rebuild reads one die key in either.

**Evidence.** `r86/lanes/B/ledger.md` (B4b, proposal 1).

### T333 · The report names a roll of the loser that hit

*Engine, report · round 86 · feature · score-touching (the report's prose is pinned by the feedback corpus)*

**Parked (round 86 gate of 06.11.2026, 6). Trigger: a user asks for a sentence on a roll that hit, or a feedback scene whose biggest swing is the loser's hit.**

**Problem.** In Doubles OU game 912045 turn 5 the loser's 80 % Gunk Shot hit and Volcarona fell. The report says nothing about it. `carriedRoll` (`packages/eval-engine/src/biggest-roll.ts:52`) names a roll only when the winner's played move provably carried it, and `biggestRollSentence` (`:111`) speaks of a miss. The copy of the turn flips a hit into a miss as it flips a miss into a hit (a row of `test/regression/rolled-copy.spec.ts` proves it), so the sentence is buildable: "Gunk Shot (80%) hit. A miss would have left Smudge X% to win; after the hit Smudge stood at Y%."

**Idea.** A second sentence shape for a roll that hit and helped the loser, with the same two chances. The gate's wording of 04.11.2026 (2a) said "missed" only, so the user rules on the words first.

**Benefit.** App: the report of a Doubles OU game explains a swing that came from a hit, not only one that came from a miss.

**Success.** The sentence for 912045 turn 5 with both chances; a row per game type; the feedback corpus's pins re-pinned at the gate that accepts the words.

**Singles and doubles.** Both: 912045 is the one scene known, and B5 counted no singles scene; a doubles click finds its die through the copy and `koOdds.label` (B6).

**Evidence.** `r86/lanes/B/ledger.md` (B5, the question for the gate; B6).

### T334 · A revived body keeps the boost its terrain gave

*Engine, reconstruction · round 86 · larger bug (the cause is not examined to the end) · score-touching*

**Parked (round 86 gate of 06.11.2026, 6). Trigger: a second scene, a corpus turn where a revived body loses a boost that the log's `-start` line gave it.**

**Problem.** In VGC game 2565721987 turn 6 Iron Bundle comes back from a correction at 1/100 without its Quark Drive speed boost, so Landorus moves before it in the simulator, survives Icy Wind and hits Miraidon with Earth Power, where the log's Landorus faints at once. `playProtocolStarts` (`packages/eval-engine/src/branch/entry-effects.ts:319`, called at `corrections.ts:88`) reads a `-start|...|quarkdrivespe` line only from the block that shows it, and the simulator had knocked the body out in that block. The speed factor reads `pokemon.volatiles[ability]?.bestStat` (`packages/eval-engine/src/speed.ts:58`), which the revive loses. B10 did not examine it further.

**Idea.** Start with the sweep: every Dex ability whose `-start` volatile a revive can lose (Protosynthesis, Quark Drive, and what the sweep finds), then one rule that carries the volatile across the revive. It belongs next to T327, the first cause of the same row.

**Benefit.** Engine and app: a body that returns from the correction keeps the speed and stat boosts the game gave it.

**Success.** The row for 2565721987 turn 6 shows Iron Bundle's boost after the revive; the sweep passes in every rule set the corpus plays, singles and doubles; the VGC and Champions VGC holdouts show no harm.

**Singles and doubles.** Both: the abilities exist in every game type; the scene is VGC.

**Evidence.** `r86/lanes/B/ledger.md` (B10, the second cause).

### T335 · A new worker beside a full pool can take a long game's page down

*App · round 86 · larger bug · lossless*

**Parked (round 86 gate of 06.11.2026, 6). Trigger: a second scene in which a worker beside a full pool takes the page down (a user report of a hung analysis on a long game, or a feedback run that dies the same way).**

**Problem.** In round 86 the feedback test of the 139-turn game 573756 hung for 40 minutes: the renderer died at about 6.2 GB with 12 pool workers, the replay worker and the new worker of the biggest-roll copy, 14 in all (B8). The commit `ff2b344` frees the pool before the copy spawns (`src/hooks/evaluation/sweep-rolled.ts:50-52`), which closes that path. The pool's own brake does not cover the others: `computePoolSize` (`src/lib/eval/pool-size.ts:19`) lowers the size by `navigator.deviceMemory` at 0.6 GB per worker, and Chrome reports at most 8, so the brake allows 13 workers and never lowers a pool of 12. Any other worker that starts beside a full pool on a long game meets the same ceiling.

**Idea.** A worker budget per sweep that counts every worker (the pool, the replay worker, any extra), or one rule that every extra worker takes the pool down first, as the copy does now.

**Benefit.** App: the analysis of a long game ends instead of hanging, on a machine with many cores.

**Success.** A spec on a fake `Worker` counts live workers across the stages of one sweep and holds them to the budget; a probe on 573756 reads the peak count of workers and the renderer's memory and stays below B8's 14 workers and 6.2 GB. Lossless: no score moves.

**Singles and doubles.** Not affected: the ceiling is a property of the pool and the game's length (B8 saw it on the longest singles game).

**Evidence.** `r86/lanes/B/ledger.md` (B8, cause, fix and open point 1); the ruling "After B8" of the round's brief.

### T340 · The root cell's undrawn speed-tie order carries its Dex weight

*Engine · round 86 · feature · score-touching (D3)*

**Parked (round 86 final gate of 06.11.2026, 3). Trigger: a feedback scene in which an equal-speed tie that no tree drew at its Dex weight flips a note (a tier or a key moment).**

**Problem.** Two Machamps at 1 hit point, equal speed, Close Combat each: the first mover wins, a coin flip. The solver reads 0 exactly and the prover reads 0.5. The tree's score is the plain mean of the trees' root cells, and each tree draws the tie once, with `treeSeed(0, offset)` (`packages/eval-engine/src/search/leaf.ts:40`; the first visit of the root cell is iteration 0). Under the hashed seeds that draw puts p2 first for offsets 0 to 13, so four trees read -1 where the lattice seeds read 0.5 (F1, row 3). The weakness is older: two or three trees read 1 at c104389. The fixture is `doubles-ohko-tie` (`test/regression/endgame-fixtures.ts:142`). Round 86 dropped the row's tree-score assertion (`test/regression/tree-endgame-cases.spec.ts`, user gate of 06.11.2026, 2a).

**Idea.** Price the tie order at its Dex weight instead of by one draw per tree: a class per order in the cell, or the systematic quantile per die and cell that T322's block 1 prescribes (the gate of 06.11.2026, 3a). It belongs beside T322.

**Benefit.** Engine: a speed tie in the cell reads one half, whatever number of trees the search runs.

**Success.** The row `doubles-ohko-tie` regains an assertion that the tree's score stays inside a band around 0 at the default four trees and at 2, 3, 6, 8 and 16 trees; a sweep over the equal-speed fixtures of singles and doubles; the bank and the four holdouts show no harm against the base after T323.

**Singles and doubles.** Doubles for the scene; the singles `ohko-tie` rows pass (F1), and the sweep covers both.

**Evidence.** `r86/lanes/D/ledger.md` (F1, row 3: the tree counts at c104389 and under the hashed seeds, the offsets 0 to 199).

### T341 · A charge move's aim comes from the `|-anim|` line

*Engine, reconstruction · round 86 · feature · score-touching*

**Parked (round 86 final gate of 06.11.2026, 3). Trigger: a second scene, a corpus turn where a charge move fires with no target in its `|move|` line and the rebuild aims it at the other foe.**

**Problem.** In VGC game 2630685175 turn 3 Terapagos holds a Power Herb, so its Meteor Beam fires on the first turn. The log writes `|move|p1b: TeraTurtle|Meteor Beam||[still]` with no target and shows the aim only in `|-anim|p1b: TeraTurtle|Meteor Beam|p2b: Dragonite`. The forced turn takes the empty target (`packages/eval-engine/src/branch/protocol-choices.ts:338-346`), `protocolTargetLoc` (`:110`) returns 0, and `targetLocSuffixForChoice` (`:160-177`) falls back to `firstLegalTargetLoc` (`:179`): the first legal foe. The aim can differ from the game's. The pinned row says it (`test/regression/forced-reconstruction.spec.ts:62`, `stays: null`). The earlier proposal named Ruination, but Ruination names its target in the log (`|move|p2a: Chien-Pao|Ruination|p1b: TeraTurtle|[miss]`); the move without a target is the Meteor Beam.

**Idea.** A reader of the `|-anim|` line for a move whose `|move|` line names no target. The dice reader already reads `|-anim|` for the later hits of Dragon Darts (`readAnim`, `packages/eval-engine/src/dice/logged-results.ts:138`); the build checks whether the two share it. Random-target moves (Outrage and its kind) have no scene in the corpus and stay with T303.

**Benefit.** Engine and app: a charge move that fires with a Power Herb, or the second turn of a semi-invulnerable move, hits the foe the game chose.

**Success.** The row 2630685175 turn 3 leaves `RESIDUALS` and turns plain; a sweep over every Dex move whose `|move|` line carries no target in doubles (Power Herb and semi-invulnerable second turns), in every rule set the corpus plays. Score-touching: the batch check.

**Singles and doubles.** Doubles only: singles have one foe, so the aim cannot differ.

**Evidence.** `r86/lanes/B/ledger.md` (B2, proposal 4; B3); `r86/gate/todo-review.md` (P6: the corrected scene, the Meteor Beam and the fix site).

### T342 · A fresh draw for every holdout family, and a rotation

*Measurement · round 86 · tooling · lossless*

**Parked (round 86, gate of 06.11.2026 14:47, "1a"). Trigger: a holdout family other than VGC reads harm in a pooled row that the fit side does not repeat. AGENTS.md's rule then asks for a fresh draw of that family before any refit, and the draw tool knows VGC only.**

**Problem.** A holdout that serves round after round can drift. The VGC holdout, in service since round 65 (round 66 grew it to 415 games), read the wave of round 86 as harm (hq +18, luck-adjusted +21 bp at the fixed K; the null measurement ties the harm to the hashed tree seeds of T323). The VGC fit side read the same wave without harm (full -5.9 bp, warnings only in early cells), and 1,245 fresh games of the same seven formats read it better (full -15 bp [-25, -5], no harm), so `holdout-vgc2` replaced it. `holdout-doublesou`, `holdout-championsou` and `holdout-championsvgc` have served since round 65 as well (the manifest's `note`). `scripts/fresh-holdout.mjs` cannot draw them: its format table holds VGC formats only (`FRESH_FORMATS`), its readers of known ids match VGC ids only (`idsIn` at line 55, `knownIds` at line 177), and the rule it writes into the manifest's `drawn` names "Round 86" in its text (line 236).

**Idea.** Two parts. First the tool: a format table with quotas per family, a reader of known ids for that family's formats, a new family name for a replacement (`appendFamily` refuses a family drawn before, line 128), and the round as an argument. A count probe in the form of `r86/lanes/H/h1-count.mjs` counts the fresh rated games per family before the first draw (VGC had about 5,900). Second the rotation: each family serves a number of score-touching rounds that the gate of this TODO sets, then a fresh draw takes its place; the manifest keeps the old sets, and the fits keep dropping them.

**Benefit.** Users of the app and the packages: a refit or a re-pin follows a loss that games no measurement has read show too.

**Success.** `scripts/fresh-holdout.mjs` draws a Doubles OU, a Champions OU and a Champions VGC family, each with spec rows for its formats and its known ids; every family in `test/regression/fixtures/fit-holdout-manifest.json` names the round of its draw in `drawn`, the four families of round 65 included; the first fresh family outside VGC reads base against head under round 86's rule H5 (R, S or U, fixed before the run).

**Singles and doubles.** Three families are doubles (Doubles OU, VGC, Champions VGC) and one is singles (Champions OU); the tool and the rotation cover all four, and the bank stays as it is.

**Evidence.** `r86/lanes/H/ledger.md` (H1 the plan and the reading, H2 the tool, H4 and H5 the measurement); `r86/gate/pair-wave-hold-vgc2-seven.txt`; `r86/gate/pair-e-fit-wave.txt` (the fit side of T309); `r86/gate/t342-review.md` (the check of this TODO against the code).

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

**Status.** 05.10.: since round 61 the layer carries the time gate, and no hash check runs in the browser (guard.ts:85-88); at the upgrade T103 runs first. Round 62 restated this; the old checkboxes in the source plan were background, and the round's spec rewrites the steps. Round 78 (29.10.2026, user gate "2a": only what the upgrade needs) moved the simulator to 0.10.12: three of the fourteen hashes changed and a review against 0.10.11 found no code the layer needs (runEvent's syntax, getCallback's SwitchIn fallback in every generation, getRuleTable's tag rules), so six pins moved; the engine suite passed in all three speed-layer modes; an agent read every gap above against 0.10.12 and found none that the release reaches (`r78/notes.md`). The gaps stay.

**Trigger.** The next change of the @pkmn/sim version: upgrade (D24) or a new version in the weekly version check (section C of `NextSteps.md`). State 06.11.2026: 0.10.15 is the newest, installed in round 87; none of the fourteen hashes moved and the release reaches none of the points above (round 87, lane A, step A2), so the TODO stays parked.

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

Every gap has its TODO. The pins are in `test/e2e-feedback/corpus.ts`; re-pins only at the user gate.

| Gap | State | Handled in |
| --- | --- | --- |
| 573756 t73 | The Fire Fang miss is a key moment and books as chance; the sentence "one 95% roll from clearing the rest" does not render, and Body Press reads no tier (regret 0.0995 against Defog; Monte Carlo 0.085 and 0.095). | Open since round 76 (T264) |
| 649664 t23 | The observed attribution reads chance since the final gate of round 79. The bar reads 0.79 instead of 0.92, because the proof leaves the next 80% Hydro Pump open; the verdict hangs on Keldeo's item (Choice Scarf: fine, Mystic Water: blunder). | Read at the next gate |
| Draft game t48, 573756 t70 | Chance booked without dice: the read payoff fizzles (t48), and the setup payoff comes one evaluation too late (t70 reads quiet, −0.145). | T189 |
| GPL DzBQ5azlO5l t13 | Stone Edge is missing from the set, a limit of the reconstruction. Added by hand, the cell Air Slash against Stone Edge reads −0.336 against the Monte-Carlo reference −0.328 ± 0.033, Stone Edge stands first for p2, and Heavy Slam has a regret of about 0.007. Fixture `test/e2e/fixtures/gpl-replay-DzBQ5azlO5l.html`. | Gate question (reconstruction) |
| smogtours-gen9ou-750267 Weavile | Builds Jolly 0/0/0/0/0/252 at 41 damage observations and 11 move orders: the move order holds the speed, and the budget pays for it out of the attack. Bank build and app build agree. | T26 |
| smogtours-gen9ou-751207 t6, VGC 2629703929 t10 | Tera in the statics: Ceruledge (Tera Fighting) counted as immune to Body Press, Koraidon (Tera Fire) read −0.645 instead of −0.396. T57 and T81 are done; nobody has re-read the scenes. | T127 |

## Watch list

Each bullet reads "signal → when to act".

**Surface and speed**

- [ ] Replay iframe: seeks and log appends cost 200 to 350 ms each, the last long-task source of a play-out → act when the battle window visibly stutters; lever: `hold` without pre-parsing, or appends in packets.
- [ ] Eval panel during the search: every render under 50 ms → if busy segments pass 30% again, `React.memo` on `GameGraphSection` and `EvalResultBlock`.
- [ ] First worker spawn: 12 eval workers and the replay worker parse 7 MB at once → progressive spawn or a pool warm-up if the first Evaluate stutters (`src/lib/eval/worker-client.ts`, `pool-size.ts`).
- [ ] The `pre` task before loading takes 200 to 290 ms against 130 to 150 ms, measured under foreign load → re-measure on an idle machine before it becomes a finding.

**Report and booking**

- [ ] Praise and inaccuracy on the same click (VGC Bo3 2634199230 turn 5: a p1 read of +0.33 and an inaccuracy of −9%) → act when a corpus game shows the case.
- [ ] Doubles rows show the KO odds without slot and target: `KoSuffix` (`src/components/eval/analysis-bits.tsx`) ignores `koOdds.label` → act when someone assigns the odds of a doubles row to the wrong Pokémon; lever: the label in the suffix or the tooltip.
- [ ] Doubles KO figures are root odds without the partner's effects of the same turn (Howl, a Pollen Puff, a Tera click; 2663093831 turn 4, 2629703929 turn 1) → act when a prose number or the sack rule goes wrong because of it.
- [ ] 2663093831 turn 7: p1's played combination is not among the 12 options, and the partial match fills the hidden slot with a switch the log rules out → read together with the options cap.
- [ ] The favor boundary checks only the sign (`favorBoundary`, `resolutionTurns` in `report.ts`) → add a size condition when a real luck event of a start-goal winner books as a resolution.
- [ ] Setup moves without a feed stay unrelieved (573756 t70, the second Swords Dance: regret 0.075, no tier) → act if the expert claims such spots; credit only with a floor anchor.

**Engine and measurement**

- [ ] The set fallback for doubles and VGC is Gen 9 only (`src/lib/smogon/format-fallback.ts`) → act before a doubles game older than Gen 9 enters a measurement.
- [ ] A new live access in `pairThreat` or `singleMoveFraction` needs its key term in `pairKey` → with every change to `score/threat.ts`, extend `threat-memo.spec.ts` by the new access.
- [ ] The opponent model reads a doubles pair row only at the first slot (`isSwitchChoice` in `opponent-model.ts`) → act when the read is needed in doubles (T42).
- [ ] 573756 turns 134 to 136: the bar stands at 0.33 to 0.60, though the decided detection names the right side from turn 92 (the search does not see the Struggle plan over twelve plies) → act on a user report about a late bar in a Struggle endgame.
- [ ] 2663093831 turn 10: p2's inaccuracy disappeared with T81 although its regret rose from 0.152 to 0.276; the cause is unread → read it when T127 re-fits the static weights.
- [ ] Gen 2 logs show Leftovers holders under full HP without healing (684843 turn 34) → act before a Gen 2 game enters a measurement whose verdict hangs on a Leftovers exclusion.
- [ ] Doubles with a hidden slot: the played combination is chosen before the verification, so the grade can land on another combination (`tree-orchestrator.ts`) → act when a doubles grade is wrong on a partly seen move (T148).
- [ ] Rage Fist, Last Respects and Retaliate compute with catalog power in the statics, and `side.faintedLastTurn` does not follow the faints of the corrections (Retaliate reads wrong both ways; two games of the Doubles OU holdout use it) → act as soon as a holder is on the bank or in the corpus.
- [ ] The spread solver gives GPL Cobalion Timid at 252 Attack EVs, from incompatible templates → act when a fitter round shows the same contradiction on further sets (T166).
- [ ] The harness fixtures carry an older data state than `.smogon-cache` (gen6ou: 292 against 297 species) and move 4 of 72 singles sets in 649664 and 655336 → expect moved pins in these two games when the fixtures are re-recorded.
- [ ] VGC 2629703929 turns 9 to 11: doubles verdicts jumped between two states of round 54; these turns run through MCTS (p2 regrets 0.104, 0.102 and 0.044) → at the next change of the doubles statics, compare the same moves.
- [ ] Three bank positions carried a doubles mid hq warning of round 54 (smogtours-gen9doublesou-937928 turn 6, 913993 turn 6, 939625 turn 8, each friendlier for the later loser) → read them with T31.
- [ ] `gimmickSuffixForSlot` (`branch/protocol-choices.ts`) checks the slot, not the body behind it, so a rebuild with another body there terastallizes the wrong one → count how often the rebuild deviates when a round walks the rebuild anyway.
- [ ] `parsePlayedActions` (`played.ts`) records no action for a move with `|cant|`, so no Tera either → take it along when T59 or T64 build on `played.ts`.
- [ ] `carryPreSolve` (`team-builder.ts`): how often its middle branch applies is uncounted → whoever rebuilds the app back to one solution needs a case for the item branch first.
- [ ] A play-out burned a win condition in the wrong order (draft t56 to t62); the e2e pin checks the core (p2 wins by turn 75 with at most six switches) → on a further case, pull Q5 (T39) forward.
- [ ] Early Brier: round 40 cost 28 bp early hq while it won 84 bp late → pre-register the early hq column in every fitter round; act if two rounds in a row lose early.
- [ ] hq tranche: n=560 (smogtours plus ladder from rating 1700) → re-cut it if n falls below 500 or a new tranche tips the ratio.
- [ ] Premature-end remainder: only 2663093831 turn 14 → a backstop only if the rate grows with the corpus.
- [ ] MCTS moves move without a verdict change when root hints change (648453 turn 23: 26 of 28 cells) → act when a pin hangs only on such a shift; lever: measure the tree variance before a verdict is read.
- [ ] The golden 655336 drifts in twelve channels in the feedback run of round 80: extra key moments t12 (chance), t18 (unclear) and t19 (chance); the t13 key moment reads p2-decision where the golden expects p1-read; missing key moments t5, t6 and t26; extra misplays 9:p2 and 24:p2; missing misplay 26:p2; extra read 16:p1; turning point 19 instead of 4 (history in the pin's essence, `test/e2e-feedback/corpus.ts`) → read them together at the next golden refresh at the user gate; T127 measures against the golden first.
- [ ] 20 wrong hits outside all families in the referee of round 57 (Air Balloon, Psychic Terrain, Armor Tail against priority) → act when one of them carries a verdict; lever: families in the referee.
- [ ] On a Bo3 ladder only the deciding game carries the rating, so `withoutUnratedLadder` drops games 1 and 2 of a rated set → pull the rating onto the set before a Bo3 ladder extension.
- [ ] Champions VGC fills species missing from its usage file from Scarlet/Violet files instead of `gen9championsou` → act when a corpus species builds wrong because of it.
- [ ] 2026 Reg F without a set file of the year: the usage file guesses moves worse than the Doubles OU sets (77.1% to 72.8%) → act when data.pkmn.cc carries a 2026 set file or a verdict hangs on 2024 games.
- [ ] Partner targets at every node would enlarge the raw combination count by a factor of 1.55 → act when a doubles verdict hangs on an unled partner move away from the root and the tree time has room.
- [ ] Blockers behind a `|cant|` other than Taunt (Imprison, Heal Block, Gravity, Throat Chop) block by other properties than the rebuild's substitute rule (`branch/protocol-choices.ts`) → act when T175 fails to bring a move into the set or a substitute under another blocker carries a verdict.
- [ ] An unknown format takes over only Sleep Clause (`getBranchSimulatorFormat` in `replay-format.ts`), so a draft league with Terastal Clause loses the lock in the branch → act as soon as a replay with a declared Terastal Clause appears.
- [ ] 2630685175 turn 1: the worker pool and local execution differ by 0.0002 (same tier, cause open; the bank computes locally) → act when a pin, a tier or a bank row hangs on the difference.
- [ ] Monte-Carlo references value their leaves with the engine's statics → recompute them with MC_N > 0 before the next census and after every weight change.
- [ ] Own K per phase sticks to the upper limit 50 in small cells (hq doubles late, 45 rows) → act when such a cell carries a verdict; lever: limit the K fit of small cells or pool them with the neighbouring phase.
- [ ] Max moves in the hazard and removal reads (G-Max Steelsurge, G-Max Wind Rage) are skipped by `hazard-removal-oracle.spec.ts` → act when a Gen 8 game enters a measurement whose verdict hangs on one.
- [ ] The commit repair of the rebuild (`branch/runtime-session.ts`) counts a side whose half-built choice the simulator rejected as done, since `side.isChoiceDone()` ignores `choice.error` → act on the first scene.
- [ ] A body on the bench reads "No Ability" under an active Neutralizing Gas, even when the gas holder goes before it → act when a scene shows this.

**Environment**

- [ ] e2e "a long forward slider jump lands the scene" (`test/e2e/timeline.spec.ts`) fails on a cold Vite dependency cache, and every checkout shares one cache through the `node_modules` junction → run a warm-up before a counted e2e run after a checkout switch.
- [ ] The browser build is part of the feedback anchor: a Chromium change shifts the last floating-point place → every Playwright upgrade re-anchors with `FEEDBACK_DUMP=1`.
- [ ] TypeScript stays on 6.x until typescript-eslint parses the native compiler; `@types/node` follows the CI Node major (24) → watch the peer range.
- [ ] `ubuntu-latest` moves to Ubuntu 26; `bank.yml` pins Node 24.21.0 → once the runs report Ubuntu 26, run the identity pair again (two CI runs and a local run of one commit, `docs/perf/probes/2026-10-19-r71/compare.mjs`) before a verdict pairs a new CI run with an older base.
- [ ] Weekly version check of `@pkmn/sim` (pin 0.10.15, exact in every manifest) → on a new version, `npm run upgrade:pkmn <version>` moves sim, mods, dex and data together and prints the checks (T103, the engine suite in all speed-layer modes, the batch check).
- [ ] Screenshot probe `docs/probes/2026-09-03-css/` (32 tests, 34 screens, 0 pixel tolerance; `node scripts/run-e2e.mjs -c docs/probes/2026-09-03-css/shots.config.ts`, fixed on port 5174) → reuse it as a pixel gate for a UI round; re-record the baseline with `--update-snapshots` when copy or layout change on purpose.
- [ ] Library bugs still open after `@pkmn` 0.10.15: the Mega-Z formes carry no Mega flag, and `@pkmn/client` 0.7.4 books a Z-move or Max-move name as a move slot and lacks a null check (T188); scenes and drafts in the upstream list of `NextSteps.md` → the user reports them; watch for a fix. Since 0.10.12 `DexFormats.extend` writes `data.Rulesets`, which may fix the silent base-Dex fallback of `Dex.formats.get('gen9championsou@@@Sleep Clause Mod')` → probe it first before `replay-format.ts:265` relies on it.
- [ ] `@smogon/calc` 0.12 lets Unseen Fist hit through Protect at a quarter in Gen 7 to 9, the Champions reading; in Scarlet/Violet it hits in full. `calc/protect.ts` asks the simulator for the mode first. The user decides on a report as a mode question (draft `r68/steps/upstream-calc-draft.md`) → watch whether the calculator binds the reading to the mode, then simplify `calc/protect.ts`.

**Parked branches**

- `r41-wide` (163efcc): the wide reading of the speed release, reference for T26; its numbers are in `docs/perf/probes/2026-09-11-r41/paired-wide-*.txt`.
- `r58-oracle` (33c93c5): the throwaway branch of round 58; `score/oracle.ts` computes the statics' damage with `@smogon/calc` or the simulator (`EVAL_STATIC_ORACLE=calc|sim`). Never merge; a referee. Probes in `r58/`; round 61 unpacked its code to `r61/static/src`.
- `w5-f2` (802565f): the Doubles OU refit of `boostsBiting` to 41 from round 73 (T224), adopted and reverted on the branch, never merged.
- Deleted round and lane branches come back with `git branch <name> <hash>` from the hash lists `gate/deleted-branches.txt` in the folders of rounds 63 to 67, as long as Git holds the objects.

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

