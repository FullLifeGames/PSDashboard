import { test, expect } from '@playwright/test';
import { State } from '@pkmn/sim';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { reconstructBranchRuntime } from '../src/lib/branch-engine';
import { formatEnforcesSleepClause, getBranchSimulatorFormat } from '../src/lib/replay-format';
import { parseReplayLogWithObservations } from '../src/lib/protocol-parser';
import { AUTO_MCTS_FAINTED_FRACTION, battleFaintedFraction, searchPosition } from '../src/lib/eval/search';
import { mctsSearch } from '../src/lib/eval/mcts';
import { fetchSmogonUsageStats } from '../src/lib/smogon-stats';
import { fetchSmogonSetAssumptions } from '../src/lib/smogon-sets';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';
import { createMatchupCache, evalFeatures, EVAL_WEIGHTS, FEATURE_WEIGHTS, type EvalFeatures } from '../src/lib/eval/eval-function';
import { brierScore, fitConstantK } from './fit-helpers';

/**
 * Informational calibration run against real finished replays: does the
 * score's sign predict the actual winner, and how does confidence grow over
 * the game? Not a CI gate — network + ~3 minutes of reconstruction.
 * Run: EVAL_CALIBRATION=1 npx playwright test -c playwright.regression.config.ts eval-calibration
 * Levers: EVAL_CALIBRATION_DEPTH=2 · EVAL_CALIBRATION_MODE=mcts ·
 * EVAL_CALIBRATION_SAMPLES=3 (seeds per cell, default 1 — the app default
 * line is d2s3, so the harness must be able to measure it) ·
 * EVAL_CALIBRATION_SLICE=a/b (only replays with index % b === a — long
 * engine configs split into slices whose JSONL dumps concatenate cleanly) ·
 * EVAL_CALIBRATION_TRANCHE=<name> (one corpus stratum only; slices then
 * index the filtered list) ·
 * EVAL_CALIBRATION_DUMP=<path> (per-position JSONL for paired analysis) ·
 * EVAL_CALIBRATION_SOURCE=fit (swap the universe to the weight-fitting
 * corpus' disk cache for FIT-SIDE dumps — mapping fits train there and
 * grade here; refuses to run without a dump path) ·
 * EVAL_CALIBRATION_SMOGON=1 (build teams WITH the Smogon usage/set fills
 * the app line waits for, disk-pinned in .smogon-cache/ so paired runs
 * see identical data — the information-gap experiment)
 *
 * Baseline 2026-08-04 (post ev-grading, pre boost-schedule; depth 1, samples 1):
 *   early 55% |0.23| · mid 62% |0.34| · late 81% |0.43|
 *   singles 63% (n=169) · doubles 80% (n=44)
 *   buckets 0.0–0.2: 58% · 0.2–0.4: 73% · 0.4–0.7: 67% · 0.7–1.0: 76%
 *
 * Boost-schedule comparison 2026-08-04 (same set, deterministic):
 *   offensive 12 / defensive 6: early 55 · mid 64 · late 78 · singles 63 · doubles 80
 *   offensive 6 / defensive 3:  early 55 · mid 65 · late 73 · singles 61 · doubles 77
 * Kept 12/6: net wash vs baseline (mid +2, late −3 ≈ 2 samples), halving was
 * strictly worse (falsifying "schedule too strong"), and the schedule's real
 * purpose — pricing setup turns honestly — is not measured by sign accuracy.
 * RESOLVED 2026-08-05 by a PAIRED re-test (both weight sets on identical
 * positions): 56/73 late-game correct under BOTH — zero sign flips in either
 * direction, though 35/73 positions had boosts on the field. The "late −3"
 * was sample-composition noise between runs (fetches/reconstructions vary),
 * not an effect of the schedule. Cross-run comparisons here need pairing.
 *
 * Active-pair emphasis 2026-08-05 (turn-0 lead evaluation groundwork):
 *   activePair 2:   early 56 · mid 64 · late 71(−7!) · singles 60 · doubles 77
 *   activePair 1.5: early 56 · mid 64 · late 76      · singles 62 · doubles 82
 * Kept 1.5 — late-game benches decide endgames, so the emphasis must stay
 * modest; lead ORDERING at turn 0 only needs a nonzero active delta.
 *
 * Long-term-structure terms 2026-08-08 (baseline for comparison: 56/64/76/62/82):
 *   hazards-by-victim only:              early 58 · mid 61 · late 81 · singles 62 · doubles 84
 *   + coverage + items + choice-mismatch: early 56 · mid 63 · late 80 · singles 63 · doubles 82
 *   + lock-aware threat + boost discount: early 56 · mid 64 · late 80 · singles 63 · doubles 82
 * The first run's "mid −3" recovered on the second sample (−1) — composition
 * noise again, per the paired-test precedent above. Late-game +4 across all
 * runs: victim-aware hazards genuinely help endgame sign accuracy. Full
 * WP 2–4 package: every bucket at or above baseline. GATE PASSED.
 *
 * Damage-consistent spread inference 2026-08-08 (observations → solver → overlay):
 *   early 58 · mid 67 · late 83 · singles 66 · doubles 84
 * Every bucket up vs the 56/64/76/62/82 baseline (mid +3, late +7, singles +4):
 * pair-consistent spreads make reconstructed positions genuinely more
 * predictive of outcomes. GATE PASSED.
 *
 * Win-prob-unit conversion 2026-08-08 (wpUnits at the search leaf): sign
 * accuracy is INVARIANT under the monotone sigmoid, so these buckets carry
 * over unchanged; mean|score| values are no longer comparable across the
 * conversion (wp-units compress). Verdict thresholds re-derived as 0.1/0.2/0.4
 * wp-units (5/10/20% win-prob loss — half-Lichess; the score-space bands
 * flagged 3–5% losses, the source of the T22/T26/T29 over-flagging).
 *
 * Corpus weight fit 2026-08-08 (eval-fit, 534 games / 3565 positions):
 *   ADOPTED: WINPROB_K singles 0.9→2.7, doubles 2.8→2.3 (leaf-level fit,
 *     n=3393/172) — gate with K only: 58/67/83/66/82, all at/above baseline.
 *   REJECTED: boosts 12→40 + coverage 40→80 (implied 47±12 / 224±98) —
 *     gate read 56/68/79/66/75: doubles −9, late −4. The fit is dominated
 *     by singles tournament games; those weights are singles-tuned at
 *     doubles' expense. Screens/trickRoom implied values are confounded
 *     (setup correlates with already winning); tailwind/matchup/choiceMismatch
 *     had no signal (SE ≥ estimate). Hand values stay.
 *
 * Attribution/solver fixes 2026-08-08 (action-window attribution, spread
 * rungs inherit priors, tendencies/MCTS-matrix): 58/65/82/65/84 — within
 * gate of the 58/67/83/66/82 record (mid −2 = the usual composition noise);
 * doubles +2. This run is the record for the per-gametype adoption below.
 *
 * PER-GAMETYPE weights 2026-08-08 (eval-fit on the EXPANDED corpus: 1100
 * games / 5976 positions, doubles now 590 games / 2436 positions via NPA 15
 * + OSDT + doubles ladder — the old doubles fit rested on 49 games):
 *   ADOPTED (DOUBLES_FEATURE_WEIGHTS): boosts 27 (fit 27±7), tailwind 68
 *     (68±25), trickRoom 87 (87±27) + WINPROB_K doubles 2.3→3.1 (n=2436;
 *     sign accuracy cannot see K — it is justified by the leaf-level fit
 *     alone). Gate: 58/65/80/64/82, all within 2 of the record. The
 *     direction matches doubles domain knowledge: speed control decides
 *     VGC games.
 *   REJECTED: screens 103 (103±40) — gate read 56/62/79/64/73, doubles
 *     −11: the screens fit is confounded exactly like the singles one.
 *   REJECTED (again): singles boosts 12→37 (fit 37±11, third consistent
 *     fit) — gate read 58/67/79/65/80, late −3 on a DETERMINISTIC re-test
 *     (identical numbers twice). The boost fit keeps promising and keeps
 *     failing the gate; whatever it measures correlates with winning in the
 *     corpus but does not improve position-level sign accuracy.
 *
 * Instrumented fit 2026-08-09 (eval-fit schema 2, 5,985 positions): phase-K
 * fitted at singles {k0 2.28, k1 1.49}, doubles {k0 2.98, k1 0.88} — beats
 * constant K on early Brier in both gametypes (0.2470→0.2451 / 0.2264→
 * 0.2259) with no bucket regressing.
 *
 * PHASE-AWARE WINPROB 2026-08-09 (K = k0 + k1·faintedFraction at the leaf,
 * cache v11): gate 58/67/80/66/80 vs record 58/65/80/64/82 — mid +2,
 * singles +2, doubles −2 (at the limit, within gate). GATE PASSED, ADOPTED.
 * Early mean|score| 0.33→0.30: the early game now claims less confidence,
 * which is the round's target. First Brier baseline (pooled constant K on
 * the sweep's own samples): early 0.2572 · mid 0.2268 · late 0.1791 —
 * cross-run Brier comparisons start here.
 *
 * matchupEarlyDamp grid 2026-08-09 (candidate phase multiplier on the
 * matchup feature; adoption required early sign or Brier to beat the
 * phase-K run above):
 *   1.0 (off): 58/67/80/66/80 · early brier 0.2572
 *   0.75:      58/63/81/64/82 · early brier 0.2592
 *   0.5:       58/64/84/66/80 · early brier 0.2617
 * Early Brier degrades MONOTONICALLY with damping and early sign never
 * moves — KEPT 1.0: the phase-aware K already prices early uncertainty at
 * the mapping layer; damping the matchup value on top double-counts it.
 * (The late-bucket wiggle is composition noise, per the pairing precedent.)
 *
 * Quiescence extension 2026-08-09 — REVERTED (negative result). Design:
 * depth-1 cells whose sampled advance contained a faint got a depth-1
 * sub-search of the child (cap 8, most faints first, sync/orchestrator
 * parity via a shared pure selector). Two gates rejected it:
 * 1. Bench (hard ≤1.5×): d1s1 0.3s→1.2s (4.0×), d1s3 0.3s→1.3s (4.3×);
 *    at the minimum cap 4 still 0.6s (2.0×) — each extension costs a full
 *    sub-search, so the budget is unreachable at any allowed cap.
 * 2. GPL T26 pin: the extension hits only VIOLENT rows (sacks, trades)
 *    while quiet rows keep static depth — sack lines eat one extra ply of
 *    punishment their alternatives never receive. The redundant-Jugulis
 *    sack's regret rose 0.19→0.25 (inaccuracy→mistake), breaking the pin.
 * Lesson: matrix-game quiescence needs depth SYMMETRY across rows to keep
 * relative option values honest — selective extension distorts exactly the
 * sack/trade comparisons it was meant to sharpen. A future attempt should
 * extend whole rows (or price tempo statically) rather than single cells.
 *
 * Sim-grounded hazard pricing 2026-08-09 (isGrounded + dex psn immunity,
 * bench-Levitate correction): 58/64/83/66/80, mid −3 vs the phase-K run —
 * re-test read 58/65/83/65/82 (mid −2, late +3, doubles +2) with slightly
 * different fetch composition both times: the mid dip is composition noise
 * (pairing precedent), every bucket within gate. GATE PASSED.
 *
 * Sweep feature fit 2026-08-09 (win-condition coverage-gained term,
 * captured at weight 0; eval-fit on the recaptured corpus, 5,983 positions)
 * — NEGATIVE RESULT, the FOURTH failed boost-term attempt:
 *   with the flat boosts term:  sweep implied −39±105 (noise); boosts keeps
 *     its usual 32±7.
 *   with boosts zeroed (ALL-NO-BOOSTS): sweep 169±114 — it absorbs part of
 *     the boost signal but at 1.5 SE never clears the 2-SE bar, and
 *     coverage inflates to 214±63 alongside (the columns are collinear).
 *   per-tranche sweep: singles −67±171 · doubles −58±141 · gen9 −7±142.
 * KEPT: FEATURE_WEIGHTS.sweep = 0 (feature stays captured for future fits),
 * boosts unchanged. Whatever boost value the corpus can see, the flat
 * stage term remains its best-measured carrier; "coverage gained" as
 * specified does not separate from the existing matchup/coverage terms.
 *
 * HAZARD-REMOVAL OPTION VALUE 2026-08-09 (user finding, draft T14: the
 * switch into Defog Talonflame read as an inaccuracy because standing
 * hazards were priced as if paid forever — the removal capacity was
 * invisible, and the payoff sits past the expansion horizon). Modeled as
 * an OPTION on the net board state (hazardRemovalEquity): own-side movers
 * (Rapid Spin/Mortal Spin/Tidy Up) net full relief; both-sides movers
 * (Defog/Court Change) net relief MINUS the side's own hazards' worth on
 * the opponent's board; a net-negative option is never exercised (counts
 * 0); the exercised option is tempo-discounted ×0.5. T14: regret
 * 0.165 (inaccuracy) → 0.020 (clean), the Defog switch ranks 2nd.
 * Gate 58/67/85/67/82 vs record 58/65/83/65/82 — mid +2, late +2,
 * singles +2, doubles level: the best run on record. GATE PASSED, ADOPTED
 * (cache v12). A flat remover-exists discount was tried first and gated
 * fine (58/64/82/65/80) but mispriced double-edged Defogs — superseded.
 *
 * ENTRY-COST-WEIGHTED MATCHUP 2026-08-09 (user follow-up: hazards can
 * disable a benched wincon, an interaction the additive model never saw).
 * matchupTerms weighs every BENCHED mon by the HP it would actually arrive
 * with: effHp = max(0, hp − hazardEntryFraction), applied to pair weights,
 * KO races, and coverage weights; actives pay nothing; Boots/Magic Guard/
 * airborne exempt via the shared hazardEntryFraction (extracted from
 * hazardCost). Gate 58/68/82/67/80, re-test 59/68/82/67/82 vs record
 * 58/65/83/65/82 — early 59, mid 68, singles 67 are the BEST values in
 * the history; late stable at 82 (−1; the prior run's 85 was composition
 * generosity). GATE PASSED, ADOPTED (cache v13).
 *
 * Post-re-specification refit 2026-08-09 (samples recaptured, 12,636
 * positions): the entry-cost matchup carries MORE outcome signal (implied
 * 189.6±40.9 vs 166±40 before; still 1.7 SE from hand 120 — recorded, not
 * adopted). REJECTED: hazardEntries 0.75→1.0 (fitted 1.0±0.1, 2.5 SE) —
 * gate 58/67/80/66/80, re-test 59/68/79/66/80: late −3/−4 consistently,
 * the familiar in-corpus-significant / held-out-late-harm signature
 * (late-game boards are hazard-heavy; overweighting them drowns bodies).
 * Hand 0.75 stays.
 *
 * NO-OP CANDIDATE FILTER 2026-08-09 (user finding, GPL T25: Stealth Rock
 * ranked with rocks already up — a guaranteed |-fail| click whose cell is
 * a pass with a real-looking label). searchOptions drops field moves that
 * fail deterministically against standing conditions (hazards at max,
 * standing screens/Tailwind/Safeguard/Mist; singles lists). Gate
 * 59/67/79/65/82 then re-test 59/68/81/67/80 — the late 79 was composition
 * noise (n varies run-to-run), re-test within gate everywhere. ADOPTED
 * (cache v14). Known remaining: pending Future Sight clicks are also
 * passes, but reconstructed battles store the pending marker
 * inconsistently — left unfiltered.
 *
 * EV LEGALIZATION 2026-08-09 (user findings: inferred spreads could stack
 * to 756+ EVs — the ladder inherited prior investment past the 508 budget
 * and the sim PLAYED those monsters in custom formats — or stop at 252
 * total; Champions formats use 32/stat 66 total). Rungs are legalized
 * before scoring (per-stat clamp + ordered shave, Speed last), winners are
 * topped up in unmeasured non-Speed stats, and Champions replays build
 * with their own budget end to end. Gate 59/67/79/66/80, re-test
 * 59/68/79/66/80 — late stable at 79 (−2 vs the preceding state, at the
 * limit). ADOPTED as a CORRECTNESS fix (the sim must field legal spreads;
 * precedent: the attribution/spread-solver adoptions). CAVEAT recorded:
 * today's per-step gates each passed at the limit while late drifted
 * 83→79 cumulatively (early/mid/singles +1/+3/+2) — the next round should
 * re-baseline with a paired comparison instead of chaining limit-passes.
 *
 * ROUND CLOSE 2026-08-09 (calibration/honesty round, cache v11). The
 * sim-grounded-hazards re-test above IS the closing run — no eval-changing
 * task landed after it: 58/65/83/65/82, brier 0.2585/0.2267/0.1740.
 * Adopted: phase-aware winprob (the early game claims less per point),
 * choice/AV rule-outs, sensitivity probes (acquit-only hinge softening),
 * choice-id read matching, sim-grounded hazards. Rejected with evidence:
 * matchup damping (double-counts phase-K), quiescence extension (bench +
 * depth asymmetry), sweep feature (fourth boost negative).
 *
 * GEN9-SINGLES CORPUS EXPANSION 2026-08-09 (follow-up round; manifest
 * 1,108→2,127 replays: SV OU official archive thread 3718664 + UWC thread
 * 3779021 + gen9ru cap raise — the smogtours- room prefix needed a scraper
 * regex fix; gen9 singles ~105→~840 games; fit now 12,615 positions /
 * 2,111 games, singles tranche 1,441 games and gen9-dominated):
 * - HYPOTHESIS RESOLVED: the "matchup is gen9-only signal" gap dissolved
 *   with power — oldgen implied 124 vs gen9 170±47 (previously 37 vs 146
 *   on the starved tranche = small-sample noise). Matchup reads 166±40
 *   pooled vs hand 120 everywhere: persistent but ~1.1 SE — below the
 *   2-SE adoption bar. Evidence recorded, no change.
 * - Phase-K CONFIRMED on the doubled corpus: singles k0 2.22 k1 1.37,
 *   doubles k0 2.91 k1 0.89 — within noise of the adopted 2.28/1.49 and
 *   2.98/0.88; pins stay.
 * - Sweep still dead beside boosts (−57±65); coverage sub-2-SE everywhere.
 * - REJECTED (FIFTH and final boost attempt): singles boosts 12→41
 *   (fitted 41.3±7.5, 3.9 SE — the strongest boost fit yet). Gate run
 *   58/67/81/66/80 (passed at the limit), CONFIRMING re-test 58/65/78/64/80
 *   — late −5. Same failure mode as attempts 2–4: the boost term is
 *   significant in-corpus but reliably damages late-bucket sign accuracy
 *   on held-out replays. CONCLUSION: the correlation is reverse-causal
 *   (winning positions produce standing boosts); the flat weight stays 12
 *   and the boost question is CLOSED absent a causal/interventional
 *   design. Doubles keeps its gated 27.
 *
 * SEEDED RE-BASELINE 2026-08-10 (the paired baseline every gate in this
 * round compares against; measured at 24490c6, cache v20 — fulfills the
 * substrate-change and chained-limit-pass obligations recorded last round):
 * - DETERMINISM: two pre-fix d1 sweeps were BIT-IDENTICAL (58/65/79/64/81,
 *   briers to 4 digits, all n equal) — seeded reconstruction (af2b276) made
 *   the sweep fully deterministic given full fetch success. Paired gates
 *   are now exact: any delta with matching n IS the change's effect. Check
 *   the n line before reading buckets — a fetch hiccup shows up as a
 *   composition shift (one intermediate run lost 4 singles positions to
 *   the network, nothing else).
 * - ROBUSTNESS FIXES first (c472c10, 24490c6): the Imprison-Transform Mew
 *   replay (gen9doublesou-2660802611) cost 5 positions via three defects —
 *   stale post-correction requests offering benched mons' moves, Imprison's
 *   concealed disables entering candidates (the sim's ONLY hidden disable;
 *   the Taunt/Encore/choice-lock family is visible and was never affected —
 *   pinned), and transform-shortened moveSlots crashing the sim's
 *   deserializer. Corrections now rerun the disable pass and rebuild
 *   requests; every eval deserialize boundary pad-repairs the round-trip.
 * - BASELINE d1 (depth 1, samples 1): 59/66/79/64/83
 *   n: early 66 · mid 80 · late 68 · singles 166 · doubles 48 (214 total)
 *   brier 0.2553/0.2187/0.1752
 * - BASELINE d2 (EVAL_CALIBRATION_DEPTH=2): 58/64/76/62/82
 *   n: 64/77/68 · singles 164 · doubles 45 (209) · brier 0.2570/0.2203/0.1762
 *   Depth 2 reads WORSE than depth 1 on mid/late sign accuracy (also true
 *   pre-fix: 58/63/76 vs 58/65/79) — deeper fixed-horizon search leans
 *   harder on leaf noise on this corpus. 2b gates against the d2 baseline
 *   (trends barely exist at d1).
 * - KNOWN REMAINING error positions: gen9ou-2658675391 t38 (game over
 *   mid-sample), gen9ou-2658670791 t104/t121 (deep-game divergence,
 *   unverified since the invariant repair). The Phantom Force t6/t8
 *   entries are RESOLVED (MID-CHARGE RELEASES below); the fainted-actives
 *   choice-shape family (gen9ou-2658664943 t32, gen9ou-2658661545 t20,
 *   gen9ou-2658659909 t37) is RESOLVED (SIDE-INVARIANT REPAIR below).
 *   d2 loses more to child-state mismatches: parent choices reapplied to
 *   transformed/changed children (Toxapex t70/t87, Mew t2/t4); the Meteor
 *   Beam mid-charge targeting (vgc t4) shares the fixed builder path —
 *   expected resolved, unverified until the next d2 sweep.
 *
 * SIDE-INVARIANT REPAIR 2026-08-10 (cache v26): snapshot corrections set
 * hp/fainted per mon and repoints moved actives without maintaining the
 * side-level state the sim runs on — pokemonLeft (the WIN-CHECK counter)
 * read high, so a KO of the last body left a wiped side playing on behind
 * a stale move request ("more choices than unfainted"; GPL T38's
 * sub-search), and isActive read false on the active, so bench enumeration
 * offered "switch 1" onto the field (GPL T39's root matrix) — the GPL
 * graph ended at T37 (user report). Both invariants now recompute from
 * ground truth after every correction pass AND in deserializeRepaired
 * (the choke point all eval deserialize sites share). Gate vs
 * 61/67/80/65/84 n216: TWO singles positions recovered (n 218, late
 * 71→73), late 80→81, late brier 0.1585→0.1550, mid unchanged, no bucket
 * down (early brier +0.0003 = K refit). NEW STANDING RECORD d1:
 * 61/67/81/65/84, brier 0.2516/0.2139/0.1550, n 218.
 *
 * T35 PROBE RESOLVED 2026-08-10 (during re-baseline, d1s1 on the fixture):
 * the winner's deliberate Salazzle sack dives the estimate because of the
 * BODIES term (HP-weighted body worth ~−177 raw-weighted), NOT the
 * coverage/matchup story the open finding guessed — matchup actually moves
 * TOWARD the winner across the sack (−7.1 → +4.8) and the hazard liability
 * shrinks (−56 → −19, entry costs died with the body). Two eval-quality
 * gaps recorded, deliberately NOT attempted this round: (a) the bodies term
 * prices a sacked body at full weight regardless of endgame redundancy —
 * any "redundant body in a decided endgame" discount is boost-saga-shaped
 * (in-corpus plausible, held-out poison) and needs its own causal design;
 * (b) detectSacks recognizes low-HP feeds (T29 Uxie at 9%) but not
 * healthy-body simplification sacks, so the sacrifice framing never
 * attaches — a played.ts detection item for a future round.
 *
 * HORIZON-TREND EXTRAPOLATION (2b) 2026-08-10, ADOPTED AS 2b-LITE (λ=0.5,
 * shift noise floor 0.005, cache v21). Two variants measured at T50, the
 * motivating position, against the d2 by-value criterion:
 * - REJECTED: fold trends into the tied rows' values and RE-SOLVE. The
 *   equilibrium absorbs the correction — boosting a row re-weights the
 *   opponent toward its punishers (Earth Power itself trends +0.018) —
 *   and the criterion failed at EVERY λ, non-monotonically: gap(Heatran −
 *   Recover) = −0.004 raw, −0.0065 @λ.25, −0.001 @λ.5, −0.013 @λ1.0.
 *   Forecast-then-re-solve double-counts the opponent's reaction; the
 *   trend already embeds the continuation's play.
 * - ADOPTED: the same row-uniform corrections under the STANDING
 *   equilibrium (no re-solve). T50 separates by value at d1 AND d2 (pins);
 *   the depth-symmetry invariance is EXACT (fixed mixes ⇒ row-uniform
 *   shifts add a constant to the opponent's EVs); score/mixes/gameValue
 *   never move — calibration-neutral BY CONSTRUCTION, proven by a
 *   bit-identical post-wiring d1 sweep (59/66/79/64/83, briers equal, all
 *   n equal — the determinism dividend's first use). λ has no
 *   calibration-visible axis under lite; it is a display/grading strength
 *   pinned by the T50 tests. GPL T22/T26/T29 canaries green. The noise
 *   floor keeps decided positions' structural ties (near-zero trends) out
 *   of the values the pruned sub-search path must mirror.
 *
 * SET COHERENCE + SPEED-ORDER EVIDENCE 2026-08-10 (no cache bump — teams
 * flow through the setsFingerprint cache key):
 * - Coherence layers (pairwise vetoes + curated-set selection, f189745)
 *   left the sweep BIT-IDENTICAL: corpus games build without usage/set
 *   data, so their gate is the unit/builder pins plus the app-level e2e.
 * - SPEED-ORDER CONSTRAINTS (parser move-pair evidence → hard solver
 *   constraints over the built configuration): 61/68/79/65/83 vs baseline
 *   59/66/79/64/83 — early +2, mid +2, singles +1, late/doubles level, and
 *   Brier improves in EVERY phase (0.2520/0.2181/0.1718 vs
 *   0.2553/0.2187/0.1752). Deterministic substrate: the deltas ARE the
 *   effect — order-consistent spreads make reconstructed positions more
 *   predictive. The best d1 run on record. GATE PASSED. (One mid/singles
 *   sample moved — changed spreads shift a reconstruction path; n 66/79/68,
 *   singles 165, doubles 48.)
 *
 * PIVOT PAIRS 2026-08-10, ADOPTED (cache v22). The U-turn family enumerates
 * as move-plus-switch pairs at the ROOT ("U-turn → Clefable", grammar
 * `move uturn > switch N`); the advance answers the pivot's forced-switch
 * request with the declared follow-up (greedy fallback when it never comes
 * or the target died mid-turn — an Earthquake KO'ing the incoming Heatran
 * in the fixture was the first thing the tests caught); played parsing
 * records the actual pivot target and matching prefers the exact pair.
 * Sub-searches/MCTS/doubles keep the greedy resolution — restriction paths
 * never see pairs by construction. Gate: 61/68/79/65/83, bucket-identical
 * to the speed-order record, n equal, briers to 4 digits (late 0.1718→
 * 0.1717 — pair rows re-price a few pivot roots without moving any sign).
 * Bench: non-pivot roots identical (A/B 0.9s d1s1 both ways); pivot roots
 * grow ≤ +4 rows/side by construction; d2 stays expansion-budget-bound
 * (1.0→1.1s). The "round-cumulative d1s1 bench drift 0.3→0.9s" noted here
 * did not survive profiling — see BENCH-DRIFT PROFILE below (flat 1.0s at
 * every commit of the round; the observation was sweep wallclock noise).
 *
 * SPEED-EVIDENCE FOLLOW-UPS 2026-08-10 (user findings on the GPL spreads —
 * all-zero Vileplume, 252-HP-only Clefable, bulky Noivern):
 * - GOODNESS-OF-FIT FORFEIT (fbc49c2): solves whose best rung still
 *   misfits >0.01 mean squared fraction per observation forfeit to the
 *   full-budget prior (video HP bars had Vileplume at 0.05/obs — every
 *   rung garbage, the least-bad was a paper spread); solves repairing
 *   speed violations always stand. Gate 61/67/79/65/83, Brier better in
 *   EVERY phase (0.2512/0.2149/0.1678) — real corpora carry unreliable
 *   fits too. Cascade effect: Noivern's "good" bulk fit collapsed once
 *   its garbage-fit partners forfeited — unreliable evidence quarantines
 *   itself.
 * - KO-BEFORE-ACTING EVIDENCE (user, T36: Noivern KO'd Iron Valiant before
 *   it ever moved): a KO'd mon with no action line chose a move (a chosen
 *   switch would have resolved first) and lost the race — the attacker is
 *   faster. Two-move-line extraction was blind to the class. Guards:
 *   attacker priority-0 + clean, victim unacted + clean at faint time,
 *   faint attributed via the pending-move context. Cleanliness now also
 *   excludes PARADOX BOOSTERS (Quark Drive/Protosynthesis are volatiles,
 *   not stages — the stage check never saw them). Known limitation: a
 *   victim holding a negative-priority choice reads slower than it is.
 *   GPL: +4 constraints incl. t36. Gate 61/67/80/65/83 — late +1, TWO
 *   late positions recovered (n 67→69), brier better in every phase
 *   (0.2509/0.2145/0.1617). The speed-evidence arc in one line:
 *   59/66/79/64/83 → 61/67/80/65/83, late brier 0.1752 → 0.1617.
 *
 * OPEN FINDINGS FOR THE NEXT ROUNDS (2026-08-10):
 * - Endgame-sack PRICING (eval side): the bodies term still prices a
 *   redundant body at full weight — see the T35 RESOLUTION below for why
 *   the discount was deliberately NOT built this round.
 *
 * FIRST MCTS CALIBRATION 2026-08-10 (EVAL_CALIBRATION_MODE=mcts — the
 * DUCT tree had shipped for months without corpus numbers): 56/68/82/66/80,
 * brier 0.2524/0.2147/0.1370, n 216 (two mid positions error out), vs the
 * matrix d1 record 61/67/81/65/84 / 0.2516/0.2139/0.1550 n 218. Reading:
 * MCTS is the best LATE-GAME engine on record (brier 0.1370; the 0.7–1.0
 * confidence bucket hits 85% at n 39 vs 79% at n 34) — adaptive depth pays
 * in narrow decided positions — but EARLY it wanders (56, five under the
 * matrix) and DOUBLES starves (80, the combined choice space eats the 600
 * iterations). Verdict: not default material (and it still lacks
 * verification, sensitivity, pivot pairs, and trend folding); its real
 * niche is a late-game/endgame lens. OPEN FINDING: phase-hybrid sweep
 * (matrix early/mid, MCTS late) or MCTS as the late-turn think-deeper
 * escalation. NOTE the accidental determinism proof: the first attempt
 * dispatched searchPosition (which ignores `mode`) and reproduced the
 * matrix record BIT-IDENTICAL a third time.
 *
 * PER-POSITION DUMPS 2026-08-11 (EVAL_CALIBRATION_DUMP=<path>): every sample
 * writes {id, turn, phase, gameType, score, faintedFraction, p1Won} as JSONL
 * at sweep end — purely observational (d1 AND mcts reproduced their records
 * bit-identically with the lever active; 4th/5th determinism proofs).
 * Offline paired joins on id#turn: node scripts/paired-calibration.mjs
 * <a.jsonl> <b.jsonl>. FINDINGS 2026-08-11 (paired, joined n 214–216):
 * - HYBRID COUNTERFACTUAL d1 + mcts@faintedFraction≥0.40: 61/66/84/66/84,
 *   late brier 0.1383 — beats BOTH parents and the turn-fraction oracles
 *   (bodies-down switches exactly when the DUCT tree's depth pays; the rule
 *   is observable pre-search, so a sweep can implement it verbatim). Blends
 *   all worse than switching.
 * - MCTS early −5 is NOISE AT ZERO: 3 exclusive flips, all |s|≤0.06, mean|s|
 *   identical 0.27; both-wrong dominates early (23+3 of 26+3) — routing buys
 *   nothing early; that error mass is information-level (set beliefs).
 * - d2s1 PAIRED vs d1s1 (56/64/79/63/81 vs 61/66/81/65/83 joined): d2 loses
 *   6:1 exclusive flips spread thin over ALL phases at identical confidence
 *   — equilibrium-of-equilibria amplifies opponent-model error (each child's
 *   restricted-Nash solve selects over noisy single-seed values). d2+mcts
 *   hybrid only 56/64/82/64/81. d2s3 (the app default!) unmeasured until the
 *   samples lever.
 * - Winprob K by band: below ff 0.4 the engines are calibration-identical
 *   (K≈1.97, brier 0.211 both); above it mcts supports a steeper K (2.22,
 *   brier 0.1506 vs matrix 1.85/0.1805) — per-mode late K is real but waits
 *   for a bigger corpus (n 40 in the band).
 * - RECONSTRUCTION NONDETERMINISM: gen9ou-2658670791 dropped 3/5/5 positions
 *   across three same-day runs at the SAME turns with DIFFERENT errors;
 *   gen9doublesou-2660802611 t2/t4 Transform-Mew drops appeared in one run.
 *   PROBED 2026-08-11: team build and cold reconstruction are SEMANTICALLY
 *   deterministic (3 attempts × 5 deep turns, projected-state hashes
 *   identical; raw serialization differs only in log timestamps/PRNG
 *   residue). The cross-run drop variance is load/timing-sensitive
 *   choice-replay retry behavior at deep turns (the driver's retry logic
 *   reads live stream state) — registered, not fixed; the replay is
 *   quarantined from the corpus instead.
 *
 * FIRST d2s3/d1s3 NUMBERS 2026-08-11 (EVAL_CALIBRATION_SAMPLES lever; d2s3
 * split via EVAL_CALIBRATION_SLICE=a/3, dumps concatenated):
 *   d1s1: 61/67/81/65/84 · 0.2516/0.2139/0.1550 · n 218 (the record)
 *   d1s3: 61/67/81/65/84 · 0.2514/0.2145/0.1553 · n 218 — ZERO exclusive
 *     sign flips vs d1s1 on all 218 positions: at depth 1, seed-averaging
 *     is pure cost. The record keeps s1 as the fast-scan spec.
 *   d2s1: 56/64/79/63/81 · 0.2536/0.2216/0.1558 · n 214
 *   d2s3: 56/66/81/63/85 · 0.2532/0.2186/0.1535 · n 214 — s3 recovers the
 *     depth-2 deficit mid/late/doubles (doubles 85 = best ever measured)
 *     but NOT early (56, structural −5 vs d1). DISCRIMINATOR VERDICT: the
 *     d2s1 collapse was mostly single-seed selection noise (the child
 *     equilibria select over noisy values; averaging 3 seeds washes it
 *     out); the early remainder is depth-structural (restricted-Nash
 *     opponent model in open positions) and no sample count fixes it.
 *   AUTO CANDIDATES on the identical triple join (n 214):
 *     2-way d1 + mcts@ff≥0.40:            59/66/84/66/83 · late 0.1386
 *     3-way + d2s3 doubles below ff 0.40: 59/68/84/66/85 · late 0.1397
 *   The 3-way weakly dominates (mid +2, doubles +2, nothing down) but its
 *   doubles edge rides on 1–2 positions — the expanded corpus decides
 *   between them before the auto mode is built. App default stays d2s3
 *   until the user rules on these numbers.
 *
 * CORPUS TRANCHE 3 + EXPANDED-BED RECORDS 2026-08-11 (65 replays: marathon
 * quarantined, +32 sampled at ≥1500 OU / ≥1400 VGC / ≥1480 DOU, ≥7 turns,
 * finished; n 417, ZERO reconstruction drops on d1/mcts — the corpus
 * reconstructs cleanly at last). FORFEIT AUDIT: 33/65 replays end by
 * forfeit — forfeits are KEPT (conceding a lost position is the ladder's
 * resignation; the label is correct by rule, and the old record was built
 * on ~50% forfeits too). gen9doublesou-2663100395 registered as a
 * reconstruction-integrity suspect (engine reads ENDED +1.00 for the side
 * that then forfeited — fantasy board or rage-quit; probe candidate).
 * NEW RECORDS on the expanded bed (full sets):
 *   d1s1: 55/58/77/62/69 · brier 0.2549/0.2418/0.1801 · n 417
 *   mcts: 55/60/77/64/66 · brier 0.2547/0.2404/0.1678 · n 417 — now BEATS
 *     d1 on mid (+2) and singles (+2) out-of-sample; doubles −3 keeps the
 *     starvation diagnosis; late brier −0.012 stays the headline.
 *   d2s3: 54/59/77/62/69 · brier 0.2560/0.2419/0.1766 · n 415 (the two
 *     Transform-Mew drops) — statistically indistinguishable from d1s1 on
 *     sign; late-doubles 88% niche persists.
 *   AUTO (2-way d1 + mcts@ff≥0.40) counterfactual: 55/58/79/62/69 · late
 *     brier 0.1696 — late +2 over d1, doubles preserved, brier within
 *     0.002 of pure mcts: GATE PASSED. The 3-way (d2s3 doubles early)
 *     REJECTED out-of-sample: its old-bed edge (mid +2, doubles +2)
 *     collapsed to mixed noise — bed-luck caught by the expanded corpus.
 *   Per-band K (ff≥0.4, n 94): matrix 1.57/brier 0.1963 vs mcts
 *     1.73/0.1812 — per-mode late K re-confirmed, waits for a fit round.
 * OUT-OF-SAMPLE HONESTY: the old-tranche positions still read 69% overall
 * while the fresh tranche reads 57% — the standing records were partly
 * bed-tuned by months of gated adoption against a fixed 218-position set.
 * Pooled K fell 1.92→1.42: the app's winprob mapping is overconfident on
 * fresh games (registered for the next eval-fit round). Cross-corpus
 * comparisons of old records to these lines are invalid; the expanded bed
 * is the baseline from here on.
 *
 * MCTS HINT-ORDERED EXPANSION + PROGRESSIVE WIDENING 2026-08-11: pick()
 * no longer forces every unvisited option through a real visit first (the
 * doubles 16×16 root ate its 600 iterations in that sweep). Nodes order
 * options by the restriction's own static hints (optionHints — the same
 * machinery, zero sim advances) and only the top wideningWindow(count,
 * visits) = min(count, 4 + visits/8) unvisited options may open, best
 * hint first — the window reaches every option asymptotically, so
 * converged trees lose nothing. PAIRED GATE vs the pre-widening dump
 * (n 417, full join): 54/61/79/63/69 vs 55/60/77/64/66 · brier
 * 0.2555/0.2378/0.1646 vs 0.2547/0.2404/0.1678 — DOUBLES +3 (the
 * starvation gap to the matrix closed), late +2, mid +1, mid AND late
 * brier better; early/singles −1 inside the gate. The deep singles reads
 * held (2658671254 t20 0.756→0.761, 2658668443 t22 still right); the
 * 2660826377 t8 probe cell stayed ~0 — the doubles gain is broad, not one
 * position. AUTO with the widened tree (recomputed counterfactual —
 * bit-exact equivalence makes it the app line): 55/58/81/63/69 · late
 * brier 0.1686, late +2 / singles +1 over the shipped auto record with
 * nothing down. NEW AUTO RECORD.
 *
 * TOURNAMENT STRATUM + STRATIFIED RECORDS 2026-08-11 (tranche 4: 32
 * smogtours games — SV OU officials SPL/OST/WCoP + OSDT doubles — every id
 * EXCLUDED from fit-corpus-manifest.json so the fitted weights never grade
 * their own training data; REPLAY_TRANCHES structure + the
 * EVAL_CALIBRATION_TRANCHE lever; dumps carry the tranche tag and
 * scripts/paired-calibration.mjs reports stratified):
 *   ladder+draft (n 415): d1 54/58/77/62/68 · mcts 53/61/79/63/69 (late
 *     brier 0.1648) · AUTO 54/58/81/63/69 (late brier 0.1689) — auto keeps
 *     the best late-sign line on the stratum app users actually load.
 *   tournament (n 208):   d1 51/58/68/60/56 (K 0.87!) · d2s3 52/58/69/60/58
 *     · mcts 54/62/69/60/64 — the DUCT tree beats the matrix EVERYWHERE
 *     against experts (doubles +8) and auto's matrix-early premise
 *     inverts. Winner labels validated 32/32 — no name-mismatch artifact.
 *   full bed (n 623):     mcts 53/61/76/62/67 · auto 53/58/77/62/64 — pure
 *     MCTS ties-or-beats auto once expert games enter the bed.
 * READING: the label-noise hypothesis was WRONG in direction. Tournament
 * labels are CLEAN but the games are HARDER: equal-skill experts flatten
 * the advantage→win mapping (pooled K 1.42→0.87 across strata — the losing
 * expert finds the defensive resource), so static-eval advantages convert
 * less. The fresh-ladder 57% vs old-ladder 69% split mixes overfit decay
 * AND game-difficulty composition — not label corruption. MCTS's edge
 * GROWS with opponent quality (experts play closer to the forced lines the
 * tree assumes — the Foul Play architecture bet, confirmed by stratum).
 * The 3-way hybrid stays dead on clean labels (tournament doubles: d2s3 58
 * vs mcts 64). DEFAULT-LINE QUESTION now has three data-backed candidates:
 * d2s3 (status quo — weakest on every stratum measured), auto (best
 * ladder late-sign), pure MCTS (best tournament + full-bed mid/doubles/
 * brier) — user decision, still deferred.
 *
 * TOURNAMENT TRANCHE 4b 2026-08-11 (+32 games, same sources deeper —
 * merged tournament stratum 64 games / 409 positions; d1 + mcts measured,
 * d2s3 skipped as dominated):
 *   tournament-0811  d1 51/58/68/60/56 K 0.87 · mcts 54/62/69/60/64
 *   tournament-0811b d1 58/72/82/71/70 K 2.46 · mcts 62/69/82/70/74
 *   MERGED (n 409):  d1 54/65/75/65/63 K 1.47 · mcts 58/65/76/65/69
 *   GRAND BED (826): d1 54/61/76/63/66 · mcts 56/63/78/64/69 ·
 *     brier mcts 0.2497/0.2305/0.1787 — best line measured; auto
 *     54/62/78/64/67 · 0.2514/0.2339/0.1803.
 * TWO LESSONS. (1) SUB-TRANCHE VARIANCE: the same tournament population
 * swings ±5–10 points per bucket between 32-game samples (4a read "expert
 * games are harder", 4b reads EASIER than ladder; merged K 1.47 ≈ ladder's
 * 1.42) — the 4a-only "experts flatten the mapping" claim is SOFTENED to
 * composition-sensitive; stratum-level claims need n ≥ ~400. (2) What
 * survives in BOTH sub-tranches and the merge: the widened DUCT tree beats
 * d1 on tournament early (+3/+4) and doubles (+8/+4), and on the grand bed
 * pure MCTS beats d1 in EVERY bucket and beats auto on early/mid/doubles
 * and all Briers, tying late — the user's "MCTS is winning" reading holds
 * with tight numbers. Auto's remaining niche: ladder-stratum late sign
 * (81 vs 79). FEATURE TRADE for the default decision: verification,
 * sensitivity probes, and the think-deeper depth ladder are MATRIX-side
 * features — a pure-MCTS line forgoes them everywhere, auto keeps them on
 * early turns. Default still d2s3, decision with the user.
 *
 * AUTO THRESHOLD RETUNE + DEFAULT FLIP 2026-08-11: offline grid over the
 * grand-bed dumps (14 thresholds × 4 strata, plus a gametype split):
 *   t=0.00 (pure mcts) 65.6% · brier 0.2192 · t=0.20/0.25 65.6 · 0.2197/
 *   0.2200 · t=1/3 65.3 · t=0.40 (old) 64.9 · 0.2215 · t=1.01 (pure d1)
 *   64.0 · 0.2231. Thresholds quantize to faint counts — for 12 bodies
 *   0.25 = "from the 3rd faint", 0.40 = "from the 5th".
 * ADOPTED 0.25: on the 0.00–0.25 plateau (grand +0.7 sign / −0.0015 brier
 * vs 0.40), ladder-robust (65.7 vs 64.7; mid +3.3, doubles +2.5, late
 * 80.9→80.1 = one position), and it keeps the matrix side — verification,
 * sensitivity, depth ladder — through the opening, which pure MCTS (t=0)
 * would surrender for 0.0008 brier. Gametype-split thresholds REJECTED
 * (+0.1 for another fitted conditional — the 3-way lesson). Live
 * confirmation at 0.25 (ladder-dou-0804 tranche): 50/50 positions
 * bit-exact vs the ff-selected parents, 24 mcts-routed.
 * DEFAULT LINE = AUTO (DEFAULT_PREFS.mode; stored user prefs win): d2s3 is
 * dominated on every stratum measured, pure MCTS forgoes the matrix-side
 * features everywhere; auto at 0.25 is the measured line 54/62/78/64/68-
 * grade on the grand bed with the feature set intact through the opening.
 * Registered follow-up: verification for MCTS lines (lift verifyFlagged's
 * matrix guard — flags re-evaluate as matrix pairs regardless of line
 * engine), then revisit pure-MCTS-as-default.
 *
 * VERIFICATION FOR MCTS LINES 2026-08-11 (the follow-up's first leg —
 * app-side only, no line change): flag adjudication and the think-deeper
 * ladder are now ENGINE-INDEPENDENT.
 * - verifyFlagged's matrix guard is gone (verificationDeepSettings): an
 *   MCTS-line flag re-adjudicates as matrix pairs at depth 2 — the same
 *   tier the d1 matrix line gets. Sound because the verdict statistic
 *   (bestDeep − playedDeep vs the threshold) is internal to the deep pass,
 *   and pair valuation under mcts settings already runs as matrix
 *   subsearches (playedOutcomeSettings). Sensitivity probes lift the same
 *   guard — the acquit statistic compares probe EVs only with each other.
 * - Think-deeper on an MCTS turn crosses into the matrix ladder at depth 2
 *   (samples ride the prefs → d2s3 by default), then depth 3 via the
 *   existing rungs. New ESCALATION-KEEP rule in supersedesStored /
 *   needsSettingsUpgrade: a matrix result of depth ≥ 2 outranks the
 *   d1s1-grade mcts tier and survives later sweeps (auto or explicit mcts
 *   target) — without it the next sweep would trample the button's product.
 * - Stored mcts entries carry verified: null from the guard era and do not
 *   retro-verify (backfill triggers on undefined only) — accepted, no
 *   cache-version bump; a re-run through the button or a cleared store
 *   verifies fresh.
 * - Feature asymmetry is now down to root pivot pairs (matrix-only).
 *   Registered follow-up: revisit pure-MCTS-as-default with the user —
 *   the feature argument for auto has thinned to pivot pairs + early
 *   compute cost vs grand-bed mcts 56/63/78/64/69 over auto 54/62/78/64/67.
 *
 * DISPLAY-K REFIT 2026-08-11 (the registered "per-mode late K" fit round —
 * EVAL_CALIBRATION_SOURCE=fit): TRAIN on a 1/20 manifest slice of the fit
 * corpus (107 games; 668 d1 / 629 mcts positions — the mcts chunks lost 39
 * to load-sensitive reconstruction retries, the marathon family, so fits
 * use the 629 joined pairs), GRADE out-of-sample on the standing grand-bed
 * dumps (n 826/827).
 * FITTED (search root scores, wp-units): d1 constant K=1.75 (phase k0=1.85
 * k1=−0.32) · mcts K=1.81 (k0=1.94 k1=−0.41) · routed composite (t=0.25)
 * K=1.87 · per gametype singles ≈1.4 / doubles ≈3 on BOTH engines.
 * GRADED (brier on the calibration bed): linear display 0.2275 → shared
 * constant-K 0.2207 (late 0.2180→0.1972) · per-mode adds 0.0002 · the
 * phase term adds nothing (k1 fits negative, no OOS gain) · the GAMETYPE
 * SPLIT LOSES (doubles 0.2167 vs pooled 0.2068 — fit-corpus doubles K≈3
 * is composition-specific and does not transfer; the 3-way lesson again).
 * VERDICT: per-mode-late-K is ANSWERED — real but worth 0.0002, not a
 * second mapping. The finding that matters: the LINEAR display is
 * overconfident out-of-sample everywhere (worst late); one shared constant
 * display-K ≈ 1.85 is the honest map, robust across engines and strata,
 * and every fancier variant ties or loses. Adoption decision with the
 * user (semantics: winPercent becomes sigmoid(K·s), exact ±1 ended evals
 * keep 100/0, deltas stay wp-unit-linear).
 * Fresh-evidence engine check on the same fit pairs (a THIRD corpus,
 * never used for engine comparisons): d1 54/61/79 · mcts 55/64/79 · auto
 * 54/62/79 by phase; ALL 65/66/65 — mcts ties-or-beats d1 in every bucket
 * here too.
 *
 * DISPLAY-K ADOPTED + PURE-MCTS REVISIT SETTLED 2026-08-11 (user):
 * - winPercent = sigmoid(DISPLAY_K·s), DISPLAY_K = 1.85 (winprob.ts).
 *   Exact ±1 — an ENDED evaluation, nothing else reaches it — stays a
 *   literal 100/0; winDeltaText, regret, and the verdict bands stay
 *   wp-unit-linear. One function covers panel, graph, matrix view,
 *   report, and summary; report accuracy loss is now priced in the same
 *   honest probability space the user sees. NO cache bump (scores are
 *   unchanged — display-only). Two summary pins updated to the calibrated
 *   strings; the winPercent pin now states the two-stage contract (leaf
 *   sigmoid calibrates leaves, display sigmoid calibrates the aggregate).
 * - DEFAULT LINE STAYS AUTO @ 0.25 (the registered revisit, user
 *   decision): three corpora agree mcts ties-or-beats d1 everywhere, but
 *   auto sits within ~1 sign point at lower compute and keeps root pivot
 *   pairs exactly in the pivot-heavy opening. REGISTERED revisit trigger:
 *   pivot pairs for MCTS roots (expandPivotPairs exists, not applied to
 *   the tree's root enumeration yet).
 *
 * SET-BELIEF ROUND 2026-08-11 (the early both-wrong mass):
 * Candidate isolation on the grand bed (joined n=826): both engines wrong
 * on 261 (31.6%), early 104/259 (40.2%); 47 early CONFIDENT both-wrong
 * (min |s| ≥ 0.25), clustering within games (2658664071 t2/7/12) — the
 * persistent-team-misread signature.
 * DISCOVERY: the harness built teams WITHOUT the Smogon usage/set fills
 * the app always waits for (buildTeamsFromReplay got observations +
 * speedOrders only) — every standing record priced less-informed teams
 * than the app line actually sees.
 * EXPERIMENT A (EVAL_CALIBRATION_SMOGON=1; fills disk-pinned in
 * .smogon-cache/ via smogon-fetch-cache.ts so paired runs see identical
 * data): full-universe d1 paired run (joined n=821) —
 *   early 54.2→54.6 (35 flips, 18 toward / 17 away — coin-flip) ·
 *   mid 61.4→62.8 · late 76.8 flat · singles 63.4→62.2 (noise-level) ·
 *   DOUBLES 66.0→71.0 (+5.0, mean|Δs| 0.179 — spreads/items genuinely
 *   price the doubles matchup grid) · ALL 64.2→64.8.
 *   SUSPECTS: 1/47 fixed. Information does NOT own the early mass.
 * B-LITE (movement of the survivors under full information): mean |Δs|
 * 0.090 against ≥0.25 confidence, mean movement toward zero +0.019 (not
 * digging out), 28/47 move <0.08 — the suspects are SET-INSENSITIVE.
 * CONCLUSIONS: (1) belief averaging over plausible sets cannot flip what
 * full information does not move — the full perturbation harness is NOT
 * justified; the early both-wrong mass belongs to the static eval's
 * matchup pricing (or to genuine upsets), and the next lever there is a
 * feature/weight round, not an information round. (2) The mcts side of A
 * skipped: the suspects are both-engine-wrong positions sharing the same
 * leaves — the readout is engine-independent. (3) STANDING RECORDS
 * UNDERRATE THE APP LINE ON DOUBLES by ~5 sign points; adopting SMOGON=1
 * as the standard corpus rig (records re-baseline) is REGISTERED as an
 * open decision, not taken.
 *
 * ESCALATION-LANDING HOTFIX 2026-08-11 (user report: "Think deeper about
 * this position doesn't work"): the escalation-keep rule protected a
 * stored matrix-d2 result from MCTS-target sweeps but never let it LAND —
 * supersedesStored rejected the think-deeper click's own d2s3 pass on a
 * stored-mcts turn (matrix is not the late turn's configured engine →
 * sweep skipped the turn → the button silently did nothing). The rule is
 * now bidirectional: incoming matrix depth ≥ 2 supersedes a stored mcts
 * result unconditionally. The unit matrix pins both directions, and the
 * auto e2e now CLICKS the button and requires the 'depth 2 · 3 samples'
 * badge — the presence-only assertion is what let this ship.
 *
 * EARLY-MASS FEATURE DIAGNOSIS 2026-08-11 (R1 of the "go ahead" round):
 * - Phase-restricted implied-weight fits from the fit samples cache
 *   (12,636 positions, offline): the matchup term's outcome signal GROWS
 *   with ff (singles implied 123 early → 305 late vs hand 120; doubles
 *   108 → 200) — the hand weight is early-correct and late-light. Rare
 *   features (tailwind singles, sweep) swing wildly per phase = SE noise.
 * - EVAL_CALIBRATION_FEATURES=1 (g-vector in dump rows, fit-spec
 *   construction) + suspect-vs-control diagnosis (35 early-singles
 *   confident both-wrong vs 52 confident-correct): the profiles are
 *   IDENTICAL — bodies dominates 34/35 suspects AND 48/52 controls
 *   (~0.37 toward the pick in both), matchup contributes ±0.04 noise in
 *   both. Confident-wrong looks exactly like confident-right: the early
 *   mass is MATERIAL LEADS THAT DIDN'T CONVERT — no feature signature.
 * - VERDICT: no weight change pursued. A phase-scaled matchup weight
 *   cannot touch a bodies-driven error mass, and set information already
 *   proved inert (T3). The early both-wrong mass is structural beyond the
 *   current feature basis; registered directions: win-condition/structure
 *   representation, or accepting early irreducibility (the two-stage K
 *   already prices the confidence honestly). Late-side matchup scaling
 *   (the real signal growth) is REGISTERED as a future fit-round
 *   experiment via an interaction term (matchup × ff) with bootstrap SEs.
 * - Side product: feat-d1.jsonl (n 783, ended-skip active) is the first
 *   artifact-free d1 bed; the 11 remaining exact-±1 rows are genuine
 *   all-lines-end endgames (the ~44 skipped were the artifact family).
 *
 * PREMATURE-END ARTIFACTS 2026-08-11 (user report follow-through — "weird
 * losing position" while branching the draft game at t57): the per-target
 * reconstruction path (branch entry + THIS harness) replays raw protocol
 * and can cascade into a fake wipe when the choice replay diverges: at
 * gen9draft-2058494320 t56+ the sim KO'd p1's active where the real game
 * did not, the real protocol had no forced-switch answer, and the greedy
 * fallback fed five bench mons into the kill zone → |win| → the harness
 * scored the ENDED battle ±1.00 with the real winner's sign. 55/827
 * grand-bed d1 rows (46 mcts, 42 fills-d1) are exact ±1 — an upper bound
 * on the family (some may be genuine all-lines-end endgames);
 * DETERMINISTIC per target turn (2× reproduced), NOT the timing-flaky
 * drop family. The capture path (app sweeps, eval-fit) heals per turn via
 * snapshot corrections and already skips ended captures — only this
 * harness scored them. FIX: a sampled turn is always before the real end,
 * so ended ⇒ artifact ⇒ SKIP (loud log; specimen verified: t56/t65
 * skipped, rest samples). Standing records carry the inflation in their
 * late buckets — the fills re-baseline will supersede them on the clean
 * rig. App-side the branch entry already shows the divergence notice for
 * this state (README behavior confirmed by the ended check at branch
 * open); an e2e pin on a real-replay fixture is a registered follow-up.
 *
 * MCTS EQUILIBRIUM RANKING, HYBRID SCORE 2026-08-11 (R2 — the t58
 * specimen's fix): rankings now come from the SAME equilibrium solve the
 * matrix mode runs, over TREE-INFORMED cells — a cell's value is the mean
 * of every leaf backed through it (a child's marginals sum to its
 * pass-through reward; its creation-time static covers the expansion
 * pass) blended with ONE static-prior visit; unexpanded cells fall back
 * to the root static; the four-tree merge pools per-cell reward totals.
 * Visit counts allocate search effort — they are no longer the verdict:
 * under hint-ordered widening a hint-anchored move could stay
 * most-visited while the tree's own values refuted it (draft t58: Knock
 * Off ranked first into a Rest loop with the punisher misnamed → now
 * tied with → Kyurem, punisher = Rest). Every root option is ranked
 * (visit starvation no longer hides rows); punishers come from the
 * matrix column; ev semantics are engine-independent.
 * FULL SCORE DELEGATION MEASURED AND REJECTED: paired a-slice (n 389,
 * every stratum) 65.3→64.3 sign (flips 2 toward / 6 away), brier flat
 * 0.2120/0.2122 — the equilibrium dilutes the tree's concentrated visit
 * information across thin static cells. HYBRID adopted: the SCORE keeps
 * the visit-mean formulation — BIT-PARITY 20/20 vs the standing dump on
 * the draft tranche, so the standing mcts records remain the line's
 * record — while the rankings carry the solve. New pins: ev ≡ matrix-mix
 * ev identity, merge cell pooling, hybrid score formula (single tree +
 * merged), alongside the standing determinism pin. Harness timeout
 * 40→60 min (a half-corpus mcts slice with per-result solves crossed 40
 * by minutes; the b-slice retry under afternoon machine load crossed 60
 * — the a-slice decided the gate, recorded honestly).
 *
 * RE-BASELINE ON THE CLEAN FILLS RIG 2026-08-11 (R3 — NEW STANDING
 * RECORDS; SMOGON=1 + ended-skip is the corpus standard from here): full
 * universe, final engine (R2 hybrid — mcts scores bit-identical to the
 * visit-mean line), d1 halves + mcts quarters, auto derived on the 794
 * joined pairs at t=0.25.
 *   d1   n799: 54.6/63.8/79.4 · singles 62.9 · doubles 72.0 · ALL 65.7 ·
 *     K 1.88 · brier(ff) 0.2435/0.2024/0.1620
 *   mcts n794: 53.5/62.0/79.1 · singles 62.0 · doubles 70.5 · ALL 64.6 ·
 *     K 1.84 · brier(ff) 0.2392/0.2025/0.1759
 *   auto n794: 55.0/63.1/79.5 · singles 62.9 · doubles 71.8 · ALL 65.6 ·
 *     K 1.80 · brier(ff) 0.2424/0.2010/0.1761
 *   strata (d1): draft 35 (n20 — tiny, nickname-heavy) · ladder-0811
 *     55.4 · ladder-dou 76.0 · ladder-ou-0802 66.4 · tournament-0811
 *     65.5 · tournament-0811b 75.6
 * STORY CORRECTION: on the honest rig the "mcts beats d1 everywhere"
 * reading DOES NOT SURVIVE — d1 ties-or-beats mcts overall (65.7 vs
 * 64.6) and on doubles (72.0 vs 70.5). The old edge was measured without
 * the fills (which feed the static cells d1 leans on) and with ±1
 * artifacts padding the late buckets of both engines. AUTO stays the
 * default on fresh grounds: best-or-tied early (55.0) and late (79.5),
 * ties d1 overall, keeps the full matrix feature set early. Pooled K
 * 1.80–1.88 brackets the adopted DISPLAY_K 1.85 — the display
 * calibration re-validates on clean data. NEW-RIG records are NOT
 * comparable to the pre-fills bed (the rig change is the point); the old
 * numbers above stand as history.
 *
 * MATCHUP×FF INTERACTION FIT 2026-08-11 (the registered follow-up to the
 * implied-weight growth 123→305 singles / 108→200 doubles): joint fit on
 * the fit bed (12,636 samples, cluster bootstrap by game B=200) with ff
 * main effect + matchup·ffc + bodies·ffc (bodies interaction = the
 * uniform-sharpening control). BOTH slopes are positive and individually
 * significant (singles matchup×ff CI [1075, 2645], bodies×ff [717,
 * 1113]) — the game sharpens as bodies fall, which the adopted phase-K
 * k0+k1·ff already models on the probability side. The matchup-SPECIFIC
 * tilt is NOT established: slopeM·baseB − slopeB·baseM CI [−80k, +696k]
 * singles / [−478k, +920k] doubles, both straddling 0 (the late/early
 * implied-ratio CI is division-unstable and also includes 1). HONEST
 * NEGATIVE — no ff-dependent matchup weight; the raw growth decomposes
 * into K-territory plus a tilt below the bootstrap's resolution.
 *
 * STARVED-SUPPORT VERIFICATION 2026-08-11 (user report: branching the
 * draft game after t55 with Draco Meteor made the auto-opponent switch
 * Mienshao INTO the nuke and keep sacking — "like it's actually
 * searching for the worst move"; auto-reply = merged perSide[0]): a root
 * cell fixes ONE chance outcome per tree at creation, so pooled visit
 * counts measure subtree exploration, not independent transition samples
 * (at most four, ever). At the healed t56 the same cell's per-tree means
 * ran −0.38/+0.37/−0.34/−0.37 ([Ice Beam × Draco Meteor] — one tree
 * rode a missed 90% Draco Meteor through its whole subtree); the merged
 * equilibrium chased the phantom: p2 Draco ev 0.445 vs matrix 0.208, the
 * healthy-Mienshao sack second by 0.003, matrix's clear best (Talonflame
 * −0.425, gap 0.11) ranked last-but-one. The OLD visit-order ranking had
 * the sack FIRST outright (542 visits) — not an R2 regression; R2 only
 * changed which artifact surfaces. FIX (worker-client final merge only):
 * support cells (mix ≥ 5%, top-3 rows/cols, punisher cells) that are
 * starved (<8 pooled visits), thin (<3 expanding trees), or in per-tree
 * DISAGREEMENT (mean spread > 0.15) are re-priced by the matrix-grade
 * multi-seed cell sampler (≤12 cells × 3 seeds, one worker round,
 * degrade-to-unverified on failure) and REPLACE the pooled value before
 * the solve. Scores stay summed-marginal visit means — records
 * untouched. Specimen verified: sack drops to LAST with Draco Meteor
 * named as punisher, Shadow Ball back over Draco for p2 (0.551/0.322,
 * matrix 0.535/0.208); t57 sane. Residual honest gap: verified cells are
 * static-sampler means, so matrix's depth-2 Talonflame read (−0.425) is
 * not recovered — the top pack is flat but sack-free. Single-tree
 * results (harness path) stay unverified: score-only grading. Pins:
 * eval-search "starved support cells" (mechanism ×4) +
 * eval-mcts-verification (end-to-end t56).
 *
 * WIN-CONDITION STRUCTURE DIAGNOSIS 2026-08-11 (T2 of the registered
 * round — the early confident both-wrong mass): sweep is IDENTICALLY
 * ZERO and coverage ≈0.01 abs on all 87 early singles positions (35
 * suspects + 52 confident-correct controls) — the existing structural
 * terms have no early support at all. Probe-computed candidates the
 * basis lacks (engine 1v1 semantics): answer THINNESS (opp mons with ≤1
 * favorable answer — coverage fires only at zero), unbreakable WALLS
 * (healer no answer 2HKOs — the Rest-loop archetype), SPEED structure
 * (mons faster than the whole picked side), own/opp/asymmetry variants —
 * 11 statistics, permutation-tested: ALL NULL (|d| ≤ 0.38, p ≥ 0.099,
 * most ≥ 0.24; the largest effect points the WRONG way — suspects'
 * opponents hold marginally FEWER answers, "material leads that didn't
 * convert" restated). With the R1 feature diagnosis and the set-belief
 * negative, the early mass now has NO signature in any static structure
 * examined — the residual is dynamics (sequencing, tempo, which body
 * actually gets traded), not eval-basis. CONSEQUENCE: stop mining the
 * static basis for this mass; the next lever, if any, is search/
 * planning-side.
 *
 * SWEEP V2 + EFFECTIVE SPEED ROUND 2026-08-24 (improvement round 9 — the
 * registered round-8 follow-up "sharpen the sweep definition"; design doc
 * 2026-08-17, commits 22d02c7/02e29e4/b226ca7/cf73e84 + this record):
 * METHOD, two phases. PHASE A (runtime, cache v35): a new effective-speed
 *    model (speed.ts — stages, paralysis gen-dependent with Quick Feet,
 *    Tailwind, Choice Scarf, Iron Ball, Unburden as ability+empty-slot,
 *    weather/terrain doublers) plus movesFirst (priority rule, then
 *    effective speed, inverted under Trick Room, exact tie never "first")
 *    becomes the STANDARD speed source at all three eval speed sites: the
 *    matchup pair tie-break, the beatsPair/sweep tie-break, and the Trick
 *    Room sign (averageSpeed without the TR inversion — it measures
 *    structural slowness). PHASE B (fit-only): the v1 sweep feature
 *    splits into four exclusive cells per flipped pair — acts-first ×
 *    in-boosted-KO-range (fastKo/fastChip/slowKo/slowChip, sum = v1
 *    value, all weight 0) — so each CV training fold prices the speed and
 *    cleanup context itself instead of hand-guessed factors.
 *    PRE-REGISTERED hierarchy on the round-8 CV harness (game-clustered
 *    5-fold, 20 seeds, singles decides, criterion per branch: mean OOF
 *    logloss Δ < 0 AND wins ≥ 16/20 AND mean OOF brier ≤ base):
 *    1. REPLACEMENT M1 cells-only beats M0 boosts-only, 2. else ADDITIVE
 *    M2 beats M0, 3. else status quo.
 * PHASE A MEASURED (calibration vs the round-7 record, n 806 identical,
 *    composition 260/289/257): phases 54/65/82 → 55/63/82 (early +1pp,
 *    mid −2pp ≈ 6 positions, late =), briers 0.2592/0.2252/0.1448 →
 *    0.2589/0.2288/0.1473 (early −0.0003, mid +0.0036, late +0.0025 —
 *    outside the ±0.0007 band recorded for score-INVARIANT rounds; this
 *    round moves real scores), buckets 60/58/71/90 → 59/60/70/90,
 *    doubles 72% =, wall 22.7m. Feedback drift ZERO across three
 *    bit-identical runs — every truth pin ok, every gap pin unchanged,
 *    golden 655336 exact (27/27), no re-pins. USER-ACCEPTED at the gate:
 *    the eval is mechanically truer (a Scarfer wins the tie-break it
 *    wins on the field, an Iron Ball flips the TR mirror — both pinned
 *    as regression tests), the mid cost is ~6 positions on a 9-game
 *    bench. Kept.
 * PHASE B RESULT — STATUS QUO HOLDS, the v2 answer equals the v1 answer:
 *    recapture identical (12,828 samples / 2,111 games), M1 cells-only
 *    loses EVERY seed in EVERY tranche (singles meanΔ +0.004094, 0/20,
 *    brier worse; ALL +0.005060, DOUBLES +0.010641, GEN9 +0.006121 — all
 *    0/20), M2 additive sits on M0 (singles +0.000383, 2/20, brier
 *    worse). Cell betas are collinearity noise (singles implied: fastKo
 *    −204.5±145.2, fastChip +83.8±153.8, slowKo +31.8±176.0, slowChip
 *    −387.8±208.8 — the pure speed-sweep cell prices NEGATIVE); boosts
 *    stays rock-stable at 39.2±7.3. Eighth boost-family attempt, second
 *    held-out design, same answer: flat boosts is the better outcome
 *    carrier. Cells stay weight 0 (captured for future fits), no cache
 *    bump beyond v35, no adoption gates. CONSEQUENCE: the sweep-feature
 *    question is CLOSED — v1 and v2 both carry nothing beyond flat
 *    boosts; any future re-ask needs a genuinely different information
 *    source (temporal/sequence signal, not another recombination of the
 *    flip mass).
 *
 * BOOSTS↔SWEEP CV ROUND 2026-08-17 (improvement round 8 — the registered
 * round-3 agenda item "boosts↔sweep disentanglement, the fit itself"):
 * METHOD: round 3 left the question stuck on coefficient SEs — the
 *    additive fit prices sweep NEGATIVE (collinearity correction,
 *    −111.5±64.0) and the no-boosts basis reads +97.8±67.2, ~1.5 SE.
 *    Under collinearity coefficient SEs structurally cannot decide which
 *    regressor carries the outcome signal, and the fifth boost attempt
 *    showed in-corpus significance failing held-out. So the round asked
 *    the model-comparison question instead: game-clustered 5-fold CV,
 *    20 fold seeds, three bases via column masks (M0 boosts-only/sweep
 *    masked, M1 sweep-only/boosts masked, M2 additive record-only),
 *    out-of-fold logloss decides, decision tranche SINGLES-ONLY.
 *    PRE-REGISTERED criterion: adopt M1 only if singles mean OOF
 *    logloss(M1) < M0 AND M1 < M0 in ≥16/20 seeds AND mean OOF
 *    brier(M1) ≤ M0. Ties to status quo.
 * CORPUS: manifest-pinned recapture (2,122/2,127 replays — 5 upstream
 *    404s), 12,828 samples / 2,111 games (R3: 12,798/2,111). Fresh full
 *    fits replicate round 3: ALL sweep −88.9 (bootstrap −99.6±61.8),
 *    ALL-NO-BOOSTS sweep +109.8 (+103.6±65.4, coverage inflating to
 *    ~262 alongside), SINGLES boosts 39.1±7.3.
 * RESULT — STATUS QUO HOLDS, and not narrowly: M1 loses EVERY seed in
 *    EVERY tranche. Singles: M0 logloss 0.61088/brier 0.21224 vs M1
 *    0.61469/0.21391, meanΔ(M1−M0) +0.003801, wins 0/20, brierOk false
 *    (ALL +0.004909, DOUBLES +0.008698, GEN9 +0.005723 — all 0/20).
 *    M2 additive sits on M0 everywhere (singles 0.61097): sweep carries
 *    NOTHING out-of-sample that flat boosts don't already carry, neither
 *    as replacement nor on top. Seventh boost-family attempt, first with
 *    a held-out design — the flat boost term is not a collinearity
 *    artifact; it is the better outcome carrier. sweep stays weight 0
 *    (runtime-inert), no cache bump, no calibration/feedback gates
 *    needed (zero runtime change). FOLLOW-UP (not this round): sharpen
 *    the sweep DEFINITION (v2 — e.g. speed-order and cleanup-context
 *    aware) before ever re-asking; the current definition is answered.
 *
 * MCTS ROOT BLEND ROUND 2026-08-17 (improvement round 7 — the registered
 * round-6 follow-up; commits 2caf79c/df7efbd/f04464a + this record):
 * DESIGN (cache v34): the round-6 odds grounding reaches MCTS-mode
 *    results on all three channels. NARRATIVE: runMcts computes
 *    koOddsForOptions once at the live root and toResult stamps ranked
 *    rows by choice string (rows are ranked — index alignment is gone);
 *    trees ship the arrays on MctsTreeStats.koOdds so mergeMctsTrees
 *    attaches them sim-free (merge purity kept — same duplication
 *    rationale as orchestrator.ts). VALUE: each tree scans the root grid
 *    with planCellEvents (analytic only, no sim advances) and ships
 *    boundaryCells; starvedSupportCells treats a boundary cell as
 *    chance-suspect regardless of visit statistics — K fixed per-tree
 *    outcomes cannot represent an accuracy×killFraction split, so four
 *    trees that all drew the hit side of an 80% kill range look rich,
 *    unanimous, converged, and wrong — and boundary cells bypass the
 *    endedCells exclusion (a game-ending kill range is ended in its
 *    drawn class precisely because the pool cannot see the other one);
 *    the blending verify sampler (blendRoot since round 6) re-prices
 *    them analytically. INVENTORY: verified-cell KoOddsMismatch
 *    diagnostics survive the merge as koDiagnostics, sorted (i, j) —
 *    the pooled executor returns chunks in completion order. Blend
 *    payloads stay dropped: MCTS has no deepening, reblendValue has no
 *    call site. Score/interval remain hybrid-invariant; the sync
 *    mctsSearch path skips the scan (no verify round to feed).
 * MEASURED (runs ×3, all result channels bit-identical; wall ~11m):
 *    non-MCTS turns byte-identical to the round-6 baseline (alignment,
 *    notices, eval-gap channels, both round6-gate t8 pins). GOLDEN
 *    655336 HEALED: the three user-rejected artifacts (extra misplay
 *    t23/t24 + read t24, KNOWN DRIFT since 2026-08-15) vanish — the
 *    report matches the golden exactly again; healed by the boundary
 *    verify at MCTS roots, not by boosts↔sweep. 649664 t23 attribution
 *    p1-read → chance: the re-priced root dissolves the read framing
 *    (regret ~0.0003, both sides reasonable) — closer to the expert,
 *    who rejected the gamble framing outright ("the only winning play,
 *    not a gamble"); rows carry the arithmetic he asked for (Scald
 *    kf 47.3% vs Hydro Pump acc 80%). Odds PROSE fires only in read/
 *    mistake bands — t23 is bandless, the sentence has no seat there.
 *    koMismatchByReplay 47–206 (was 36–141): MCTS turns now report;
 *    the probe-chase weight threshold note stands.
 * CALIBRATION GATE PASSED (mode=auto vs the round-6 record): n 806
 *    identical, phases 54/65/82, briers 0.2592/0.2252/0.1448 and
 *    buckets 60/58/71/90 identical to the digit (the score line is
 *    hybrid-invariant by design — the round moves rankings, attribution
 *    and narrative, never scores), doubles 72%, wall 26.7m vs 26.3m —
 *    the boundary scan is free at bench scale.
 * RE-PIN (user-approved): 649664 t23 observed none/p1-read →
 *    none/chance (essence records the mechanism); 655336 essence gains
 *    the HEALED note — the golden file itself is untouched (the diff
 *    closed to zero, nothing to refresh).
 *
 * EXPECTATION-GROUNDING ROUND 2026-08-16 (improvement round 6 — the
 * Erwartungs-Grundierung item spun out of round 4's agenda rename; commits
 * d9372f4/399f6aa/f0125d8/d77e289/316ce76/7a26c93/1323a3b + this record):
 * DESIGN (cache v33): binary boundary events (KO-range rolls, accuracy)
 *    price at ANALYTIC probabilities instead of seed frequencies at root
 *    matrix cells — singles, matrix mode only; sub-searches, MCTS, and
 *    doubles byte-identical. ko-odds.ts computes one-turn odds via a
 *    sim-exact @smogon/calc bridge fed the battle's own reconstructed
 *    stats: killFraction = crit-weighted share of the 16 damage rolls
 *    ≥ current HP, × accuracy after stage/weather modifiers; status moves
 *    with imperfect accuracy yield accuracy-only events; everything
 *    unpriceable (multi-hit, charge, counter/sucker families, self-KO,
 *    accuracy items/abilities, gen ≤ 2) fails closed to the seed average.
 *    cell-blend.ts plans a cell's events (guards: protect family,
 *    action-prevention statuses, sash/Sturdy/Disguise, hazard/pivot
 *    defenders), classifies each seed child's outcome from its advance
 *    log (any deviation from the kill-truncation occurrence model —
 *    flinch, |cant|, ambiguous faints — falls back to the plain seed
 *    average), folds class weights in observed actor order (the first
 *    mover's kill truncates the second event), and prices the cell as
 *    analytically weighted class means. Missing classes are chased with
 *    11 fixed probe seeds under a 16-draw budget; a class never found
 *    renormalizes the found weights and surfaces as a koDiagnostics
 *    entry — values are never invented. Deepening re-blends through the
 *    first-seed child's class (reblendValue — one deepened branch cannot
 *    erase the mixture); both engine paths share the semantics (the
 *    local executor blends evalCells, the orchestrator re-blends with
 *    the same pure helper). Ranked root options carry koOdds (accuracy ×
 *    killFraction vs the standing opposing active), cache-borne; the
 *    narrative quotes them ("kills ~43% of the time", "an 80% roll to
 *    connect", "a 90% roll into a ~43% kill range") in the mistake/
 *    inaccuracy/read clauses, the report's seeds sentence, and a panel
 *    suffix. streaks.ts adds the NARRATIVE half: milestone-throttled
 *    multi-turn cumulation (secondary fishing with Serene Grace/Shield
 *    Dust/Covert Cloak priced in, flinch gated on outspeeding; crit
 *    accumulation vs boosted walls) — render-time only, grading never
 *    sees it. The contract in one line: the search prices what the next
 *    roll is worth; the report narrates what many rolls mean.
 * MEASURED (runs ×3 bit-identical incl. a DUMP run, ~12m): ZERO item
 *    drift vs the round-5 baseline — truths, gaps, notices, alignment,
 *    eval-gap channels all identical; wall +4–8% (probe draws). Odds
 *    language fires where matrix mode runs: 649664 t8 "an 85% roll into
 *    a ~53% kill range" (pinned), 648453 t14/t15, 562428 t11, 655336
 *    t13; streaks fire in the 573756 stall (t8/t118 "burn fishing
 *    compounds to ~83%", t8 pinned). 649664 t23 itself flips to MCTS at
 *    t13 under auto mode — the anchor keeps its round-4 none/p1-read
 *    verdict but the odds sentence waits on an MCTS-root blend (NEW
 *    AGENDA). koMismatchByReplay 36–141 — NOT single digits: the dump
 *    audit shows (a) tail classes ≤ 0.15 weight the fixed probes
 *    structurally miss (first-roll bias — seeds 21..64 nearly always
 *    hit), and (b) chip-death cells (burn/poison kills in-window) where
 *    every child classifies hit-kill and the missing hit-nokill mass is
 *    large — renormalization equals the OBSERVED truth in both shapes;
 *    no calc-vs-sim bridge failures. A probe-chase weight threshold is
 *    noted as a future refinement, deliberately not built mid-round.
 * CALIBRATION GATE PASSED (mode=auto vs the round-4 record): n 806
 *    identical, phases 54/65/82 (early −1pp ≈ 1–3 positions), briers
 *    0.2592/0.2252/0.1448 (max +0.0004, inside the recorded ±0.0007
 *    noise band; late identical to the 4th decimal), buckets 60/58/71/90,
 *    doubles 72%, wall 26.3m vs 26.7m — the probe draws are free at
 *    bench scale.
 * RE-PIN (user-approved): TWO new round6-gate truth items — 649664 t8
 *    summaryIncludes ['an 85% roll into a ~53% kill range'] and 573756
 *    t8 ['burn fishing compounds to ~83%'] (both verbatim-stable across
 *    the three runs); the 649664 t23 essence notes the matrix-only
 *    scope. One regression re-pin during implementation: draft T50's
 *    top label coarsened to either wall (crit-tail cells around the
 *    Slowking column re-priced a ~0.001 tie; the Heatran column carries
 *    no boundary event). Golden 655336 untouched.
 *
 * NARRATIVE ROUND 2026-08-16 (improvement round 5 — agenda item ⑥;
 * commits cd5ffa5/5f75a08/6c36965/c2140f9/4aa639a/a8f64d9 + this record):
 * DESIGN (render-time only — NO cache bump, grading/tiers/attribution
 *    untouched): four signals computed in analyzeTurn over the cached
 *    results and spoken by summary.ts/report.ts, all failing closed on
 *    missing data. (1) BREADTH: viableCount = options within an
 *    inaccuracy of best; a shift turn with ≥4 viable options per side
 *    reads "a genuinely open turn rather than a drift … hinged on
 *    out-predicting the opponent" (562428 t10 renders the expert's own
 *    numbers, 9 of 9 / 11 of 13). (2) CONDITIONAL: when the side's own
 *    equilibrium mix leans a DIFFERENT choice than the argmax-EV pick
 *    (weight ≥ 0.5), the recommendation carries its condition — the
 *    opponent replies with the largest own-value split in the solved
 *    matrix ("B only if you expect X; Z covers Y"). (3) NULL-MOVE GUARD
 *    (null-moves.ts, type-chart-driven and conservative — status
 *    immunities as a gen-aware table since the dex damageTaken chart
 *    carries no status keys; Thunder Wave's missing ignoreImmunity;
 *    attacker abilities SUPPRESS verdicts): a mechanically null best
 *    swaps its display to a co-optimal alternative within TIE_EPSILON
 *    or carries the enabling-condition caveat; fires in the corpus on
 *    573756 Toxic→Toxapex and 562428 Toxic/Earthquake→Corviknight
 *    (where "pays against the rest of the team" is exactly right — the
 *    value lies on the expected switch-in). (4) FORCED MIX: a ≥0.85
 *    equilibrium SWITCH is said in prose ("all but commits X to
 *    switching to Y (92%) — which is what happened / came instead"),
 *    deduped when the conditional already names it. Harness: TurnClaim
 *    gains summaryIncludes narrative pins (rendered via summarizeTurn
 *    with the replay's player names; missing names mismatch loudly).
 * MEASURED (runs ×3 bit-identical, 9.8m): ZERO drift in every machine
 *    channel vs the round-4 baseline — results, notices, evalErrors,
 *    alignment all identical — as designed for a narrative-only round.
 *    NO calibration gate: nothing the calibration bed prices changed,
 *    and the zero-drift runs prove it. Signal inventory over the dumps:
 *    open-turn ×3 (562428 t10, 653785 t15, 655336 t6), conditional ×7,
 *    bestNull ×6 (rendered only where a recommendation speaks — tier-
 *    less turns keep it silent by design), forcedMix ~50 (~30 in the
 *    573756 regenerator stall loop; per-turn display keeps it honest).
 * RE-PIN (user-approved): 562428 t10 observed gains the narrative pin
 *    summaryIncludes ['open turn'] — the breadth half of the desired is
 *    delivered; the remaining half is an actual read RECOMMENDATION
 *    (opponent-model territory). 653785 t19 essence notes the general
 *    guard landed (the Will-O-Wisp half of its desired is delivered).
 *    Golden 655336 untouched.
 *
 * HAX-ALIGNMENT ROUND 2026-08-15 (improvement round 4 — agenda item
 * Hax-Alignment; commits 5824b5b/428f44b/63951ea/3b0d0e6/f524611 + this
 * record):
 * DESIGN (per-turn seed search, cache v32): at every turn boundary the
 *    reconstruction serializes a checkpoint, trials the block's protocol
 *    choices under a pinned 16-seed list (trialAdvanceLog fork; forced
 *    switches answered from protocol species), scores emitted events
 *    against the block (ended > faint-set > soft counts over misses/
 *    crits/secondaries/hitcounts/cants/confusion/move-counts + 0/1
 *    order), and battle.resetRNG's the argmin candidate (ties keep the
 *    earlier seed; candidate-0 fast path; reseed EVERY turn so turns'
 *    RNG consumption decouples). Scripted PRNG rejected (fragile @pkmn
 *    internals coupling); backstop deliberately NOT built — measure
 *    first (user decision).
 * MEASURED (runs ×3 bit-identical; stable results, alignment summaries,
 *    notices): 653785 REGAINED its 2 endgame turns (the round-2 phantom
 *    seed-crit heals; perfect 20/25). Premature-end residual: 1 block of
 *    270 (648453 keeps "35 of 39", ended-mismatch 1 — no candidate seed
 *    avoids it; WATCH, no backstop agenda at this rate). Quotas
 *    (actual-scored): gen6 80/110 perfect turns (655336 27/27, 649664
 *    21/23, 653785 20/25, 648453 12/35), gen8 14/160 (573756 9/138 soft
 *    275, 562428 5/22 — long stall games carry nearly all soft
 *    residual; faint residuals single-digit everywhere). Trial-vs-
 *    actual gap 1 turn of 270 — the fork faithfully predicts the live
 *    battle. Feedback wall time 17.3m → 10.2m despite the search.
 * CALIBRATION GATE PASSED (paired worktree vs c1c794a, mode=auto,
 *    junctioned caches): n 783 → 806 (late 238 → 257 — exactly the
 *    positions premature ends used to cut), phases 54/66/82 → 55/65/82,
 *    briers 0.2566/0.2258/0.1513 → 0.2588/0.2251/0.1447 (late −0.0066;
 *    early +0.0022 under the +23-position composition shift), buckets
 *    61/58/69/89 → 61/58/71/90, doubles 70% → 72%. Calibration wall
 *    +5.5m (the search's cost lives here).
 * RE-PIN (user-approved): 649664 t23 gap observed mistake/p1-decision →
 *    none/p1-read — the aligned seeds sample the t23 root differently
 *    and the round-3-diagnosed false mistake (KO-roll sampling
 *    confidence) dissolves; the gap stays open on the desired side.
 *    Golden 655336 untouched (27/27 perfect). AGENDA RENAME: "analytic
 *    KO grounding" (C. below) generalizes to ERWARTUNGS-GRUNDIERUNG —
 *    probability-weighted analytic folding for future-turn expectation
 *    (freeze fishing, Serene-Grace chains, crits vs boosted walls);
 *    value vs narrative as separate consumers; own round.
 *
 * HORIZON-FAMILY ROUND 2026-08-15 (improvement round 3 over the corpus —
 * agenda item ④; commits 06de5e8/4b1c489/6791ca9 + this record):
 * A. FEED PATHWAY (06de5e8): a third sack shape in detectSacks — a mon
 *    active since turn start (neither switched nor dragged in) fainting
 *    above the low-HP threshold is a stay-and-die CANDIDATE (`stayed`).
 *    The verdict layer honors it only when the played line's outcome was
 *    priced certain (ev − floor ≤ FEED_CERTAINTY_EPSILON 0.02) AND the
 *    best own expectation inside the payoff window clears the safe
 *    guarantee by the read margin. markRisk's sacrifice short-circuit is
 *    what dissolves the structural block (a deliberate feed IS "getting
 *    punished"); blunder-band regrets are never excused. 573756 t68
 *    re-pinned (USER-APPROVED): mistake/p2-decision → inaccuracy/quiet
 *    with the feed named in the summary — toward the expert.
 * B1. STRANDED-BENCH PRICING (4b1c489, cache v31): a living BENCHED mon
 *    whose hp fraction ≤ its own side's hazardEntryFraction, on a side
 *    with no living removal carrier, prices at alive × strandedAlive
 *    (0.5) with no hp share and leaves the hazard victim term (no double
 *    charge); Boots/Magic Guard/bench-Levitate/typed immunities inherit
 *    from the shared entry-fraction term (all pinned); actives never
 *    touched. CALIBRATION GATE PASSED: 54/62/79 (n 260/285/238), buckets
 *    57/56/71/87, briers 0.2559/0.2304/0.1586 — no phase down beyond
 *    noise vs the recorded pre-round numbers, buckets monotone within
 *    noise. 653785 t19 re-pinned (USER-APPROVED): inaccuracy → none (the
 *    stranded-Charizard position reprices; the engine's pick is now Hex,
 *    not the mechanically-null Will-O-Wisp). Side effect: 573756 t137
 *    (unpinned) mistake → none.
 * B2. SWEEP WEIGHT — NOT ADOPTED (sixth boost-family attempt, recaptured
 *    fit under v31 features, 12,798 samples / 2,111 games): implied
 *    −101.4, cluster bootstrap −111.5 ± 64.0 — SIGNIFICANT BUT NEGATIVE;
 *    the ALL-NO-BOOSTS variant reads +103.1 (97.8 ± 67.2). The sweep and
 *    boosts columns are collinear (both measure standing boosts); with
 *    both present the fit uses sweep as a negative correction. sweep
 *    stays 0. NEW AGENDA: boosts↔sweep disentanglement — fit the
 *    boost-flipped wincon as a REPLACEMENT for flat stages, gated as
 *    usual.
 * T20 KNIFE-EDGE (6791ca9): B1's repricing moved 648453 t20's safe floor
 *    by +0.0033 and flipped the pinned paid-off read (payoff 0.1006 →
 *    0.0972 vs margin 0.1). RISK_PAYOFF_EPSILON 0.02: a payoff within
 *    the epsilon under the margin keeps the paid-off credit — asymmetric
 *    by design (the feed gate and the clearly-failed exit stay strict;
 *    the tolerance widens praise, never excuses). Truth pin green again.
 * MEASUREMENT (runs 1+2 bit-identical at 4b1c489; re-run after 6791ca9;
 *    confirmation run on the re-pinned corpus): all four truths OK
 *    (655336 keeps its accepted KNOWN-DRIFT lines), eval gaps 0
 *    everywhere. 655336: ④ SOFTENED the curve (post-DD t24 0.289 →
 *    0.376, toward the expert) but the t23/t24 verdict artifacts persist
 *    — stranded pricing does not fire there and sweep was not adoptable;
 *    golden deliberately NOT refreshed (the artifact lines stay
 *    user-rejected).
 * C. 649664 t23 DIAGNOSED (probe, deleted): KO-ROLL SAMPLING CONFIDENCE.
 *    At the t23 root (Keldeo 191/323 vs Medicham 245/261) Scald's
 *    sampled damage rolls kill on 5/5 SEARCH_SEEDS (true odds ~43%) so
 *    the engine prices Scald as a certain kill (ev = floor ≈ 0.99),
 *    while Hydro Pump misses on 2/5 seeds (true 20%) and a miss dies to
 *    High Jump Kick — so the actually-winning play (80% × ~100% kill,
 *    and the real click OHKO'd) grades as a 0.82-regret mistake. Binary
 *    events (KO rolls, accuracy) price at sampled frequencies, not true
 *    probabilities. NEW AGENDA: analytic KO grounding at the root
 *    (damage-range fraction × accuracy folded into cell values/floors
 *    where the immediate question is a KO); overlaps hax alignment but
 *    targets pricing, not reconstruction.
 * D. GLOBAL BEFORE/AFTER vs 712de0e (last push; paired worktree runs,
 *    junctioned caches, equal n 783): the whole 21-commit line is
 *    CALIBRATION-NEUTRAL on the 24-game corpus (54/62/79 both sides;
 *    briers within 0.0007; buckets within one position). Fit-corpus
 *    hand-weight briers improve slightly everywhere, most late-game
 *    (singles 0.1753→0.1730, doubles 0.1645→0.1602, const-K; sample sets
 *    12,636→12,798 — directional, not paired). The line's gains are
 *    verdict-level, which 712de0e has no harness to measure.
 *
 * LOCK-AND-HP-TYPING ROUND 2026-08-15 (improvement round 2 over the
 * corpus; commits 626a4d4/c63d681 + this record): ③ corrected actives
 * regain PROTOCOL-PROVEN choice locks — the correction's choicelock
 * deletion stays (tricked-scarf defense) but a re-stamp from the replay
 * text follows, BEFORE the request refresh so the disable pass bakes it
 * in: exactly one distinct committed move since last real entry, choice
 * item, item undisturbed, move in the set; a GUESSED choice item further
 * needs the damage record not to contradict it (x1.5 vs x1.2 type-boost
 * bluff vs unboosted bands, 0.02 HP-bar slack; ambiguity never blocks).
 * Cache v29. Pinned on the real 649664: Keldeo @ Specs at the t24
 * boundary offers exactly `move hydropump`. ⑤ typeless Hidden Power
 * resolves via effectiveness evidence (super/resisted/immune/neutral
 * markers per typeless hit) filtered against the defender typing, then
 * usage ranking — 648453/653785 ran IV-default HP Dark for real HP Ice
 * (653785 t15 super on Landorus REFUTES Dark outright). Display shows
 * the resolved variant; the sim keeps request id `hiddenpower` for typed
 * sets (pinned — protocol choices and played matching depend on it); the
 * damage fitters (spread inference, corroboration) calc typeless
 * observations AS the resolved variant (Dark-fitted spreads made the sim
 * overkill 653785's Dragonite). Cache v30. MEASUREMENT (2 runs,
 * bit-identical): all truths OK, eval gaps stay 0, 655336 KNOWN DRIFT
 * unchanged; 649664 t23 verdict unchanged (the lock lands on the t24
 * follow-up; the t23 grading needs horizon pricing — ④); 653785 t19
 * re-pinned none → inaccuracy (USER-APPROVED — corrected Ice rolls
 * reprice t20-23) and its endgame loses 2 reconstructed turns to a
 * seeded sim CRIT the real game did not have. NEW AGENDA (user): hax
 * alignment for reconstructions — per-turn seed search or scripted PRNG
 * so sim crits/rolls/misses reproduce the protocol's outcomes; a sim-side
 * kill the real game disproves ends the replay early and no boundary
 * correction can resurrect it.
 *
 * SILENT-EVAL-GAPS ROUND 2026-08-15 (improvement round 1 over the corpus
 * below; commits a370c61/a1daacd/e231df8/45d1ff4 + this record): all 53
 * silent turn-eval losses are gone. ① Choice tokens now come from the
 * request move id ("Return 102" display built `return102`, the sim
 * rejected it — 48 turns across the four gen6 games) and guessed
 * Frustration sets assume 0 happiness (sim default 255 priced BP 1);
 * cache v27. ② Eval-layer failures are recorded per turn (evalErrors),
 * the ⚠ notice appends count + first reason, turn view/tooltip name it,
 * harness + drift report carry it — a gap now explains itself. ⑦ The five
 * gen8-573756 gaps were CONCEALED TRAPPING: the sim marks a Magnet-Pull-
 * trapped Steel `trapped: 'hidden'` and deliberately keeps the request
 * silent while the switch validation rejects; legalChoices offered the
 * bench anyway — both option paths now consult the live trapped field
 * (liveDisabled's sibling rule); cache v28; 573756 evaluates 139/139.
 * MEASUREMENT (bit-repeatable, 9.8m): t13-648453 mistake and t19-653785
 * blunder verdicts EVAPORATED once their silently lost neighbor turns
 * evaluate — both toward the expert (user re-pinned observed to
 * quiet/none). 655336 gained misplay t23/t24 + read t24 on previously
 * silent Lopunny turns — USER-REJECTED as engine artifacts and kept as
 * KNOWN DRIFT against the old golden: t23 is a 25-HP Lando sac that
 * Helmet-chips Mega-Lopunny to 38/271 behind SR+Spikes (it died ON
 * re-entry at t25 — the real game proves the sac), t24 DD is the sweep
 * play (engine: DD ev 0.004 vs Claw 0.503; score 0.512 -> 0.289 after the
 * FREE DD, then 0.957 as the sweep plays out — the boost is only priced
 * once it happens). Mechanics ACQUITTED by pins (eval-mechanics.spec.ts):
 * Intimidate/DD/Regenerator/Helmet all correct through the searched
 * advance; benched-below-entry effHp-0 works (+0.44). The two real causes
 * feed agenda item ④: (a) ACTIVE mons carry no re-entry death — effHp 0
 * exists only for the bench, so a 38/271 active behind hazards reads as a
 * working piece; (b) the sweep feature (boost-flipped 1v1s) sits at
 * weight 0, leaving 12 points/stage against a whole body's worth of
 * kill-now. The t24 +0.52 "read payoff" was the same artifact (engine
 * priced the played (DD, Slowbro) pair at -0.016).
 *
 * EXPERT-FEEDBACK CORPUS ROUND 2026-08-14: an experienced player reviewed
 * the analysis on 0.5.1 across six public smogtours replays (gen8ou/
 * gen6ou); the distilled essence is a versioned corpus (e2e-feedback/
 * corpus.ts — 4 truths, 5 gaps) graded by `npm run test:feedback`: the
 * REAL app swept per replay in a browser, hermetic (replay + data.pkmn.cc
 * pins), bit-identical across runs, WARN-ONLY (drift = report material in
 * docs/reports/, reds = harness breakage only). Pinned state: 4x OK, 5x
 * GAP open. Gate-1 correction: the praised SoulWind game-breaking play is
 * the t75 double switch into Kyurem (expert counted t76; the read banks on
 * 75 — user-confirmed). Dossiers (user-approved, local docs/superpowers/
 * feedback-round/): t68 Weavile sac = grading machinery (punished-exit
 * blocks the payoff window for exactly the deliberate feed it should
 * excuse; floor==ev==-0.42 is the feed signature; payoff +0.44 in-window);
 * t10 = narrative (breadth 9/9 and 11/13 near-best is IN the matrix,
 * 'shift' hides it; expert's Heatran-flips claim NOT confirmed, priced
 * co-optimal); t13 = data (typeless Hidden Power runs as HP Dark, real
 * read was HP Ice) + narrative (no-switch-ins-left never surfaced); t23 =
 * data (Specs guessed right but the reconstruction LOSES the choice-lock
 * volatile — choiceCount 4 instead of 1; with the lock the verdict
 * evaporates, exactly the expert's point); t19 = HORIZON (Charizard
 * 71/297 behind double rocks megas ON 19 — un-Mega'd re-entry costs ~148,
 * it can never return, yet the equilibrium expects the switch 91.6%; and
 * Mega Flare Blitz takes Cofagrigus 40%->7%, so the played Weavile feed
 * is coherent piece preservation the depth-2 verdict cannot price —
 * blunder CONTESTED) + data (one-move Chari) + narrative (WoW named
 * "better" by argmax-ev while the engine's own mix plays Hex 89%; the
 * switch-conditional is never stated). Mega bookkeeping verified clean.
 * CROSS-CUTTING: the registered Return bug below is fully diagnosed —
 * forward-model builds choice tokens from the request's DISPLAY NAME
 * ("Return 102" -> return102) instead of its id, silently killing ~48
 * turn evals across the four gen6 games (every one fields a Return
 * Lopunny) and breaking old-gen branching; Frustration same family. And
 * eval-layer failures have NO notice (coverageNotice counts acquisition
 * only — 653785 lost 16/26 turns silently). Improvement agenda (approved,
 * by leverage): return102 choice-id fix · eval-gap notice · choice-lock
 * preservation · horizon family (deliberate-feed + hazard re-entry
 * pricing, t68+t19) · Hidden-Power typing · narrative pack (breadth,
 * conditionals, equilibrium-aware naming) · gen8 gap probe (573756 has 5
 * unexplained). The 35-min record-run wedge did not reproduce
 * hermetically (2x bit-identical clean runs); the stall detector bounds
 * any recurrence at 6 minutes with ERROR rows.
 *
 * REGISTERED BUG — OLD-GEN RETURN BRANCHING FAILURE 2026-08-14, RESOLVED
 * 2026-08-15 (a370c61): branching on smogtours-gen6ou-653785 turn 19
 * failed with `p1 "move return102": Can't move: Your Lopunny doesn't
 * have a move matching return102`. Actual cause was subtler than the
 * suspected wrong-generation canonicalization: the REQUEST displays
 * happiness moves with their computed base power ("Return 102") while
 * the entry's id stays `return`, and forward-model built choice tokens
 * from the display name. Fixed by using the request move id at both
 * option paths (Frustration same family, plus the 0-happiness set
 * assumption); pinned in eval-forward-model.spec.ts ("happiness-move
 * choice tokens").
 *
 * THINK-DEEPER UNHIDDEN — HEALED SINGLE-TURN ACQUIRE 2026-08-13: the
 * registered fix is in. makeReplayAcquire now reconstructs with the same
 * per-turn capturePositions snapshot corrections the sweep uses (arrival
 * snapshot unchanged), so the cascade zone arrives LIVE — pinned on the
 * draft fixture at t56 in sweep-acquire-guard ("the HEALED single-turn
 * acquire arrives live..."), the exact turn the unhealed run dies on.
 * reconstructionReached stays as the loud-failure backstop for replays
 * healing cannot save (it now throws the divergence message instead of
 * evaluating an ended battle as ±1). Button restored to both faces
 * (think-deeper on analyzed turns, first-analysis on gaps), both e2e
 * click-throughs restored (d1→d2 escalation + monotone merge; the
 * MCTS→matrix depth-2 LAND on the GPL auto line), the hide-pins removed.
 * The two REGISTERED BUG entries below are CLOSED by this change.
 *
 * EMPTY GAME GRAPH ON THE BUILD — MINIFIED CLASS NAMES 2026-08-12 (the
 * user's actual report, isolated by "works on dev but not on build"):
 * @pkmn/sim's state serializer encodes every object reference as
 * `[${obj.constructor.name}:id]` (sim/state.mjs:348) and rebuilds classes
 * from those names on deserialize. Minification renames Pokemon → "t", so
 * a serialized position round-tripped into objects that were no longer
 * Pokemon/Side instances and the first method call threw — inside the
 * eval workers, 20× `e?.getMoveRequestData is not a function` per sweep,
 * each swallowed by the per-turn catch as a silent gap. EVERY turn failed,
 * so the graph came out empty while dev (unminified) looked perfect. The
 * engine, the harness, and all 522 regression tests run unminified and
 * could never see it; the e2e suite drove the dev server for the same
 * reason. FIX: keepNames on BOTH bundles (build + worker are configured
 * separately, and the two must agree on class names because the main
 * thread serializes what the worker deserializes). GUARD: npm run
 * test:build — a production-build Playwright suite that drives the
 * minified bundle and fails if any typed worker error appears or the graph
 * stays empty (verified by flipping keepNames off: the suite fails).
 * LESSON: dev-only e2e cannot certify a bundle-sensitive engine.
 *
 * EMPTY GAME GRAPH — PHANTOM FINAL TURN 2026-08-12 (user report: "the
 * Game Graph is empty when clicking on Analyze Game"): the same
 * premature-end family, one layer further out. makeSweepAcquireAll
 * stored the reconstruction's FINAL battle as positions[turns-1] with no
 * check that the replay ever reached that turn, and
 * validateBranchRuntime deliberately returns null for an ended battle
 * (branching into a finished line is legal and explained). So a diverged
 * run that cascaded into an early end was stored as the last turn,
 * evaluated as a decided ±1.00, and drew EXACTLY ONE point at the
 * bottom-right corner — every other turn a silent gap, with the panel
 * showing "Re-analyze" as if the line were real (hasGraph = "some score
 * is non-null"). EvalGraph only strokes runs of ≥2 points, so one point
 * renders as an empty box with a dot: the reported screenshot.
 * DIAGNOSIS PATH: clean-state browser runs of BOTH the 68-turn draft
 * (fast scan filled all 68) and the 10-turn VGC replay (full line,
 * report, accuracies) were healthy, so the defect is not in the sweep
 * loop — the shape (one isolated final point at ±1) is what identified
 * the acquisition. FIX: reconstructionReached(runtime, turn) — live
 * battle standing at or past the turn, not timed out, not ended (a
 * sampled turn always lies BEFORE the real end; the harness applies the
 * same invariant) — gates the store, and the single-turn acquire gets it
 * too. That closes the mechanism behind the hidden think-deeper button:
 * an unhealed single-shot arrival at a diverged endgame turn IS an ended
 * battle, which is why the position read 100%. The sweep now records how
 * much of the game the reconstruction covered and the panel states it,
 * so a short line explains itself instead of reading as a broken app.
 * Pins: sweep-acquire-guard.spec (predicate table + the real unhealed
 * draft run, where validate passes and the guard rejects).
 *
 * REGISTERED BUG — THINK-DEEPER ON UNHEALED ACQUIRE 2026-08-11 (user
 * report: "Think deeper breaks the turn and reduces the percentage to
 * 100%", draft replay t56): the whole-game sweep acquires positions via
 * capturePositions with per-turn snapshot healing (makeSweepAcquireAll),
 * but the SINGLE-turn acquire (makeReplayAcquire — used by think-deeper's
 * analyzeTurnNow, single-turn Evaluate, and gap-turn "Analyze this
 * position") reconstructs single-shot WITHOUT healing. In the diverging
 * endgame zone that is exactly the premature-end cascade: the unhealed
 * battle arrives ENDED, evaluates ±1, the bar snaps to a literal 100%,
 * and perSide empties — "breaks the turn". MITIGATION (this change): the
 * think-deeper face of the button is HIDDEN on analyzed turns (EvalPanel;
 * e2e pins the hide in both former click tests); gap-turn first analysis
 * stays available and shares the risk in the same zone. FIX ON RECORD:
 * route the single-turn acquire through the healed capturePositions path
 * (or a shared healed-reconstruction helper) and add the app-side
 * ended-skip guard (a sampled turn is always before the real end — an
 * ended arrival is always an artifact: surface, don't evaluate). The
 * escalation machinery (thinkDeeperTarget ladder, supersedesStored,
 * verificationDeepSettings) is UNCHANGED and stays pinned in eval-graph;
 * un-hide once the acquire is healed, restoring the click-through e2e
 * assertions this change relaxed.
 *
 * DIVERGENCE-NOTICE E2E RESOLUTION 2026-08-11 (T3): scouting the draft
 * replay under the APP path (fill-less like the e2e env, per-turn
 * snapshot healing) shows arrivals t56–67 ALL LIVE and only t68 (the
 * real end) ended — where Branch Here is already DISABLED ("The battle
 * is already over at the end position"). The premature-end family is
 * fully defused app-side: healing silences the cascade zone the
 * unhealed harness replay died in, the end-guard blocks the ended
 * arrival, so the ended/wedged notice is defense-in-depth, not a
 * reachable state on this fixture. E2E pin (app.spec "branch
 * divergence"): t56 branches with NO notice on the REAL draft replay
 * (per-test route — the suite's shared fixture is a 4-turn synthetic)
 * and t68 shows the disabled guard with its title. The notice variants
 * keep their code path for replays healing cannot save.
 *
 * AUTO MODE SHIPPED 2026-08-11 (EVAL_CALIBRATION_MODE=auto; app mode
 * 'auto'): per-position dispatch on faintedFraction ≥ AUTO_MCTS_FAINTED_
 * FRACTION (0.4; the constant lives in types.ts so the UI shares it
 * without importing the sim). BIT-EXACT GATE PASSED: all 417 auto
 * positions equal their ff-selected parent's score exactly and the
 * aggregate equals the offline counterfactual — 55/58/79/62/69 · late
 * brier 0.1696. The app line and the measured counterfactual are the same
 * object. Auto is a COMPLETE engine spec (d1s1 matrix below the threshold
 * — the measured-best line; depth/samples prefs configure the explicit
 * matrix modes only). Stored results always carry the concrete engine;
 * supersedes/upgrade resolve auto per turn via the recorded fainted
 * fraction and fail closed across modes when it is unknown.
 *
 * DIRECTIONAL SPEED EXCLUSIONS 2026-08-10: observations now drop only when
 * the modifier could EXPLAIN the observed order — a speed-raising factor
 * (Tailwind, +spe stages, paradox boosters) on the FIRST mover, or a
 * speed-lowering factor (paralysis, −spe stages) on the SECOND. The kept
 * directions are IMPLIED constraints (outrunning a Tailwind-doubled foe
 * outruns its base speed a fortiori; a paralyzed mon moving first won at a
 * quarter speed). Priority stays bilateral (cross-bracket order is not a
 * race); Trick Room and same-turn entries stay bilateral. Gate vs the v24
 * record: buckets IDENTICAL 61/67/80/65/84 (n identical), brier mid
 * 0.2145→0.2139 and late 0.1586→0.1585, early flat — sharper spreads,
 * no sign moved. STANDING RECORD d1: 61/67/80/65/84, brier
 * 0.2513/0.2139/0.1585, n 216.
 *
 * MID-CHARGE RELEASES 2026-08-10 (cache v24): a locked request entry
 * (mid-charge Phantom Force, rampages) carries no target data; the LIVE
 * sim auto-targets a bare release, but State.serializeBattle drops
 * activeRequest entirely and the ROUND-TRIPPED sim demands a target again
 * ("Phantom Force needs a target") — and every eval advance runs on a
 * round-trip, so those candidate cells were guaranteed rejects. The
 * builder now falls back to the DEX target type for target-less request
 * entries: foe-targeting releases enumerate live foe slots, random-target
 * rampages (Outrage) stay bare. Gate vs 61/67/80/65/83 n214: t6/t8 sample
 * cleanly, late n 69→71, doubles 83→84, late brier 0.1617→0.1586, no
 * bucket down (early brier +0.0004 = K refit over the larger n). NEW
 * STANDING RECORD d1: 61/67/80/65/84, brier 0.2513/0.2145/0.1586, n 216.
 *
 * T35 RESOLUTION 2026-08-10 (healthy-body sack framing, analysis side):
 * The redundancy probe answered the design gate. T35 = the WINNER switches
 * a 46%-HP Salazzle into Knock Off: score 0.6623 (83%) before, 0.4131
 * (71%) after; with the body DELETED from the T35 state p1 still scores
 * 0.4436 (72%) — the body was surplus headroom, the sack does not endanger
 * the verdict, yet the played row lost 0.23 (tier "mistake"). The dip
 * itself is REAL by the eval's own after-measurement (0.66 → 0.41), so an
 * eval-side bodies discount would have to deny a value difference the
 * engine consistently measures — the boost-saga shape the earlier T35
 * probe warned about. ADOPTED instead: detectSacks recognizes the healthy
 * switched-in-and-fainted feed (entry HP from the switch line, drags
 * excluded) and analyzeTurn honors it ONLY while the sacker's engine score
 * stays ≥ HEALTHY_SACK_FLOOR (0.4 — the |score| 0.4–0.7 bucket wins 77%)
 * both BEFORE and AFTER, failing closed without an after-score.
 * Expectation-based on both gates, zero eval change, sweep untouched
 * (calibration never runs analyzeTurn — no gate needed). GPL T35 pins the
 * framing end-to-end.
 *
 * BENCH-DRIFT PROFILE 2026-08-10 (closing the registered 0.3→0.9s item):
 * EVAL_BENCH across the round's commits — 53ff967 (round start), c472c10
 * (robustness), c9c7c64 (2b-lite), effd2f5 (pivots), HEAD — shows d1s1
 * FLAT at 1.0s everywhere, forks/sec 527–606 (run noise), deserialize
 * 1.0–1.1 ms (deserializeRepaired's pad walk is free next to the parse).
 * The d2 line wobbles 1.1–1.8s between runs of the SAME commit —
 * expansion-budget noise, not drift. The registered 0.3→0.9 was a sweep
 * WALLCLOCK observation: two identical calibration runs today took 4.2
 * and 4.9 minutes (±17% machine noise on bit-identical work), and the
 * sweep's per-position quotient also absorbs fetch, reconstruction, and
 * the round's build-side additions (speed solver, coherence). No search
 * regression exists to fix; re-open only with a per-stage profile that
 * isolates a ≥25% single cause.
 */
/**
 * Corpus strata: outcome-label quality differs by source (a tournament
 * player resigns lost positions and plays won ones out; a mid-ladder
 * player can throw either), so records report stratified. The tranche tag
 * rides in the dump for offline grouping.
 */
interface ReplayTranche { tranche: string; ids: string[] }

const REPLAY_TRANCHES: ReplayTranche[] = [
  {
    tranche: 'draft',
    ids: [
      'gen9draft-2058494320',
      'gen9draft-2298735122',
      'gen3customgame-2115579570',
    ],
  },
  {
    // High-ladder gen9ou games (≥1500 Elo, sampled 2026-08-02) — stronger play
    // gives a cleaner sign-accuracy signal than random-ladder blunder-fests.
    tranche: 'ladder-ou-0802',
    ids: [
      'gen9ou-2658678742',
  'gen9ou-2658675391',
  'gen9ou-2658676184',
  'gen9ou-2658675932',
  // QUARANTINED 2026-08-11: 'gen9ou-2658670791' — 120+-turn marathon whose
  // choice-replay reconstruction drops a load/timing-dependent subset of
  // positions (3/5/5 across same-day runs, same turns, different errors;
  // semantic determinism of cold reconstruction proven by probe). The
  // varying drop set makes the n line wobble between runs — exactly what
  // paired gates must not absorb.
  'gen9ou-2658671385',
  'gen9ou-2658663776',
  'gen9ou-2658672151',
  'gen9ou-2658671254',
  'gen9ou-2658669868',
  'gen9ou-2658668443',
  'gen9ou-2658665571',
  'gen9ou-2658664943',
  'gen9ou-2658663604',
  'gen9ou-2658664071',
  'gen9ou-2658660641',
  'gen9ou-2658661171',
  'gen9ou-2658662321',
  'gen9ou-2658661545',
  'gen9ou-2658659909',
  'gen9ou-2658658993',
    ],
  },
  {
    // Doubles/VGC (sampled 2026-08-04, rating ≥1400 VGC / ≥1480 DOU, ≥7 turns) —
    // the doubles scoring path was previously uncalibrated entirely.
    tranche: 'ladder-dou-0804',
    ids: [
  'gen9vgc2026regi-2630677822',
  'gen9vgc2026regi-2630452654',
  'gen9vgc2026regi-2630461565',
  'gen9vgc2026regi-2630685175',
  'gen9doublesou-2660818097',
  'gen9doublesou-2660809089',
  'gen9doublesou-2660826377',
  'gen9doublesou-2660813469',
  'gen9doublesou-2660802611',
  'gen9doublesou-2660822493',
    ],
  },
  {
    // Tranche 3 (sampled 2026-08-11 via search.json, rating ≥1500 OU / ≥1400
    // VGC / ≥1480 DOU, verified finished with ≥7 turns) — doubles the corpus
    // so paired gates can see <2% effects. RECENCY sample: whatever high-rated
    // players uploaded that morning — the "what app users actually load"
    // stratum, with the label noise that implies.
    tranche: 'ladder-0811',
    ids: [
  'gen9ou-2663115898',
  'gen9ou-2663115494',
  'gen9ou-2663114473',
  'gen9ou-2663113106',
  'gen9ou-2663114316',
  'gen9ou-2663113816',
  'gen9ou-2663113568',
  'gen9ou-2663113084',
  'gen9ou-2663112821',
  'gen9ou-2663110678',
  'gen9ou-2663110373',
  'gen9ou-2663112349',
  'gen9ou-2663108645',
  'gen9ou-2663110845',
  'gen9ou-2663110408',
  'gen9ou-2663110121',
  'gen9ou-2663109511',
  'gen9ou-2663108252',
  'gen9ou-2663108091',
  'gen9ou-2663107495',
  'gen9vgc2026regi-2630181744',
  'gen9vgc2026regi-2630110359',
  'gen9vgc2026regi-2629783504',
  'gen9vgc2026regi-2629760324',
  'gen9vgc2026regi-2629731825',
  'gen9vgc2026regi-2629703929',
  'gen9doublesou-2663102863',
  'gen9doublesou-2663102669',
  'gen9doublesou-2663100569',
  'gen9doublesou-2663100395',
  'gen9doublesou-2663095770',
  'gen9doublesou-2663093831',
    ],
  },
  {
    // Tranche 4 (sampled 2026-08-11): Smogon TOURNAMENT games — SV OU
    // officials (SPL/OST/WCoP, thread 3718664) and OSDT gen9doublesou
    // (3778554), newest pages first. Cleanest outcome labels on the board:
    // tournament players resign lost positions and convert won ones. Every
    // id is EXCLUDED from fit-corpus-manifest.json — those games trained
    // the winprob K and feature weights, so they may never grade the
    // calibration (train/test separation).
    tranche: 'tournament-0811',
    ids: [
      'smogtours-gen9ou-749601',
      'smogtours-gen9ou-749351',
      'smogtours-gen9ou-750267',
      'smogtours-gen9ou-749895',
      'smogtours-gen9ou-749739',
      'smogtours-gen9ou-749754',
      'smogtours-gen9ou-749828',
      'smogtours-gen9ou-751451',
      'smogtours-gen9ou-751543',
      'smogtours-gen9ou-751340',
      'smogtours-gen9ou-751436',
      'smogtours-gen9ou-751283',
      'smogtours-gen9ou-751505',
      'smogtours-gen9ou-751382',
      'smogtours-gen9ou-751443',
      'smogtours-gen9ou-751476',
      'smogtours-gen9ou-751341',
      'smogtours-gen9ou-751244',
      'smogtours-gen9ou-751512',
      'smogtours-gen9ou-750953',
      'smogtours-gen9doublesou-938276',
      'smogtours-gen9doublesou-938281',
      'smogtours-gen9doublesou-937926',
      'smogtours-gen9doublesou-937928',
      'smogtours-gen9doublesou-937931',
      'smogtours-gen9doublesou-938638',
      'smogtours-gen9doublesou-938640',
      'smogtours-gen9doublesou-938644',
      'smogtours-gen9doublesou-939625',
      'smogtours-gen9doublesou-939635',
      'smogtours-gen9doublesou-941638',
      'smogtours-gen9doublesou-941650',
    ],
  },
  {
    // Tranche 4b (sampled 2026-08-11, same sources deeper — SV OU officials
    // + OSDT; winner labels validated at sampling time): grows the
    // tournament stratum to ~64 games so its per-bucket numbers tighten.
    // Manifest-excluded like 4a. Separate tag so the tranche lever can run
    // it alone; analyses merge every tournament-* tag into one stratum.
    tranche: 'tournament-0811b',
    ids: [
      'smogtours-gen9ou-751207',
      'smogtours-gen9ou-750540',
      'smogtours-gen9ou-751536',
      'smogtours-gen9ou-751533',
      'smogtours-gen9ou-751407',
      'smogtours-gen9ou-751170',
      'smogtours-gen9ou-751466',
      'smogtours-gen9ou-752324',
      'smogtours-gen9ou-752839',
      'smogtours-gen9ou-752549',
      'smogtours-gen9ou-752005',
      'smogtours-gen9ou-752624',
      'smogtours-gen9ou-752755',
      'smogtours-gen9ou-752781',
      'smogtours-gen9ou-752301',
      'smogtours-gen9ou-751881',
      'smogtours-gen9ou-752058',
      'smogtours-gen9ou-752068',
      'smogtours-gen9ou-752733',
      'smogtours-gen9ou-752702',
      'smogtours-gen9doublesou-912045',
      'smogtours-gen9doublesou-912047',
      'smogtours-gen9doublesou-912883',
      'smogtours-gen9doublesou-912884',
      'smogtours-gen9doublesou-913990',
      'smogtours-gen9doublesou-913993',
      'smogtours-gen9doublesou-914406',
      'smogtours-gen9doublesou-914408',
      'smogtours-gen9doublesou-913994',
      'smogtours-gen9doublesou-913996',
      'smogtours-gen9doublesou-914621',
      'smogtours-gen9doublesou-914633',
    ],
  },
];

const REPLAY_IDS = REPLAY_TRANCHES.flatMap(group => group.ids);
const TRANCHE_OF = new Map(REPLAY_TRANCHES.flatMap(group =>
  group.ids.map(id => [id, group.tranche] as const)));

interface Sample {
  /** Replay id + sampled turn — the pairing key across engine runs. */
  id: string;
  turn: number;
  /** Corpus stratum (label-quality tier) — rides into the dump. */
  tranche: string;
  phase: 'early' | 'mid' | 'late';
  gameType: 'singles' | 'doubles';
  score: number;
  /** Fainted bodies / total bodies at the sampled position. */
  faintedFraction: number;
  p1Won: boolean;
  /**
   * EVAL_CALIBRATION_FEATURES=1: the static eval's scaled feature vector
   * (fit-spec g construction, FEATURE_WEIGHTS key order) — for offline
   * suspect-vs-control feature diagnosis. Observational only.
   */
  g?: number[];
}

test.describe('eval calibration against real replays', () => {
  test.skip(!process.env.EVAL_CALIBRATION, 'set EVAL_CALIBRATION=1 to run the calibration sweep');

  test('score sign tracks the actual winner', async () => {
    // 60 min: a half-corpus mcts slice with per-result equilibrium solves
    // crossed the old 40-min budget by minutes (2026-08-11).
    test.setTimeout(3_600_000);
    const samples: Sample[] = [];
    const sampleCount = Math.max(1, parseInt(process.env.EVAL_CALIBRATION_SAMPLES ?? '1', 10) || 1);
    // EVAL_CALIBRATION_SOURCE=fit swaps the replay universe to the
    // manifest-pinned weight-fitting corpus, read from the build script's
    // disk cache (no network). FIT-SIDE DUMPS ONLY: those games trained the
    // winprob K and the feature weights, so their numbers must never be
    // quoted as calibration records — hence the dump-path guard, and the
    // tranche labels (fit-tournament / fit-ladder) keep provenance loud.
    // The two universes never mix ids.
    const fitSource = process.env.EVAL_CALIBRATION_SOURCE === 'fit';
    if (fitSource && !process.env.EVAL_CALIBRATION_DUMP) {
      throw new Error('EVAL_CALIBRATION_SOURCE=fit produces fit-side dumps only — set EVAL_CALIBRATION_DUMP');
    }
    const fs = fitSource ? await import('node:fs') : null;
    const fitEntries = fs
      ? (JSON.parse(fs.readFileSync('regression/fixtures/fit-corpus-manifest.json', 'utf-8')) as {
          replays: { id: string; source: 'tournament' | 'ladder' }[];
        }).replays
      : [];
    const universeIds = fitSource ? fitEntries.map(entry => entry.id) : REPLAY_IDS;
    const trancheOf = fitSource
      ? new Map(fitEntries.map(entry => [entry.id, `fit-${entry.source}`]))
      : TRANCHE_OF;
    // Tranche filter first, then the slice indexes over the filtered list —
    // a new stratum runs alone and its dump concatenates with the standing
    // full-corpus dumps (determinism keeps the old positions valid).
    const trancheFilter = process.env.EVAL_CALIBRATION_TRANCHE;
    const trancheIds = trancheFilter
      ? universeIds.filter(id => trancheOf.get(id) === trancheFilter)
      : universeIds;
    const slice = process.env.EVAL_CALIBRATION_SLICE?.match(/^(\d+)\/(\d+)$/);
    const replayIds = slice
      ? trancheIds.filter((_, index) => index % parseInt(slice[2], 10) === parseInt(slice[1], 10))
      : trancheIds;

    // EVAL_CALIBRATION_SMOGON=1: the standing corpus numbers price teams
    // built from protocol + inference alone, while the APP always waits
    // for the Smogon usage/set fills before evaluating. This lever closes
    // that information gap so the delta can be measured (T3 experiment A).
    const smogonFills = process.env.EVAL_CALIBRATION_SMOGON === '1';
    const smogonFetcher = smogonFills ? diskCachedSmogonFetcher() : undefined;
    type ReplayJson = { id: string; log: string; players: string[]; formatid?: string };
    for (const id of replayIds) {
      let replay: ReplayJson;
      if (fs) {
        // Disk-cached fit replay (node scripts/build-fit-corpus.mjs).
        const cachePath = `.fit-corpus/${id}.json`;
        if (!fs.existsSync(cachePath)) {
          console.log(`skipping ${id}: no fit cache`);
          continue;
        }
        replay = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as ReplayJson;
      } else {
        const response = await fetch(`https://replay.pokemonshowdown.com/${id}.json`);
        if (!response.ok) {
          console.log(`skipping ${id}: HTTP ${response.status}`);
          continue;
        }
        replay = await response.json() as ReplayJson;
      }
      const winnerName = replay.log.match(/^\|win\|(.+)$/m)?.[1]?.trim();
      if (!winnerName) {
        console.log(`skipping ${id}: no winner line`);
        continue;
      }
      const p1Won = winnerName === replay.players[0];
      const gameType: Sample['gameType'] = /\|gametype\|doubles/.test(replay.log) ? 'doubles' : 'singles';
      // Observations drive spread inference — same path the app takes.
      const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
      let { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
      if (p1Team.length === 0 || p2Team.length === 0) {
        console.log(`skipping ${id}: could not build teams`);
        continue;
      }
      if (smogonFetcher) {
        // Rebuild with the fills, mirroring the app hooks: usage stats by
        // the replay's format id, set assumptions for the known species.
        const species = [...new Set([...p1Team, ...p2Team].map(set => set.species))];
        const usageStats = await fetchSmogonUsageStats(replay.formatid ?? id, { fetcher: smogonFetcher });
        const setAssumptions = await fetchSmogonSetAssumptions({ formatId: replay.formatid ?? id, species, fetcher: smogonFetcher });
        ({ p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders, usageStats, setAssumptions }));
        if (p1Team.length === 0 || p2Team.length === 0) {
          console.log(`skipping ${id}: could not build teams with fills`);
          continue;
        }
      }
      const maxTurn = snapshots.length;
      const step = Math.max(1, Math.ceil(maxTurn / 8));

      for (let turn = 2; turn < maxTurn; turn += step) {
        try {
          const runtime = await reconstructBranchRuntime({
            format: getBranchSimulatorFormat(replay),
            p1Team, p2Team,
            replayLog: replay.log,
            targetTurn: turn,
            snapshot: snapshots[Math.min(turn - 1, snapshots.length - 1)],
          });
          const battle = runtime.battleStream.battle;
          if (!battle) continue;
          if (battle.ended) {
            // A sampled turn is always BEFORE the real game's end (the loop
            // stops short of maxTurn), so an ended reconstruction is always
            // a divergence artifact: the choice replay cascaded a side into
            // a wipe the real game never had (gen9draft-2058494320 t56+ —
            // five greedy forced switches fed into a kill zone). Scoring it
            // would hand the record a free ±1.00 with the real winner's
            // sign; 55/827 grand-bed d1 rows carried exactly that.
            console.log(`${id} turn ${turn}: reconstruction ended prematurely — skipped`);
            continue;
          }
          // EVAL_CALIBRATION_FEATURES=1: capture the static eval's scaled
          // feature vector (identical construction to eval-fit's g) so the
          // offline suspect diagnosis can compare feature profiles.
          let g: number[] | undefined;
          if (process.env.EVAL_CALIBRATION_FEATURES === '1') {
            const featureCache = createMatchupCache();
            const features = evalFeatures(battle, featureCache);
            const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
            const scaleOverNorm = EVAL_WEIGHTS.scale / (teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp));
            g = (Object.keys(FEATURE_WEIGHTS) as (keyof EvalFeatures)[]).map(key => features[key] * scaleOverNorm);
          }
          const serialized = JSON.stringify(State.serializeBattle(battle));
          // EVAL_CALIBRATION_DEPTH separates the two levers: does more
          // search fix a phase, or is the static eval itself miscalibrated?
          // EVAL_CALIBRATION_MODE=mcts runs the DUCT tree instead — the
          // matrix path is gated every round; MCTS earns numbers here too.
          // (Dispatch mirrors eval-worker: searchPosition IGNORES mode.)
          const depth = process.env.EVAL_CALIBRATION_DEPTH === '2' ? 2 : 1;
          const faintedFraction = battleFaintedFraction(battle);
          // EVAL_CALIBRATION_MODE=auto mirrors the app's sweep dispatch
          // exactly: matrix below the threshold, the DUCT tree at or above.
          const mode = process.env.EVAL_CALIBRATION_MODE;
          const useMcts = mode === 'mcts' ||
            (mode === 'auto' && faintedFraction >= AUTO_MCTS_FAINTED_FRACTION);
          const runSearch = useMcts ? mctsSearch : searchPosition;
          const { score } = runSearch(serialized, {
            depth, samples: sampleCount, tera: false,
            sleepClause: formatEnforcesSleepClause(getBranchSimulatorFormat(replay)),
          });
          if (Number.isNaN(score)) {
            // A NaN would silently poison every aggregate — surface it loudly.
            console.log(`NaN score: ${id} turn ${turn}`);
            continue;
          }
          const fraction = turn / maxTurn;
          samples.push({
            id,
            turn,
            tranche: trancheOf.get(id) ?? 'unknown',
            phase: fraction < 1 / 3 ? 'early' : fraction < 2 / 3 ? 'mid' : 'late',
            gameType,
            score,
            faintedFraction,
            p1Won,
            ...(g ? { g } : {}),
          });
        } catch (error) {
          console.log(`${id} turn ${turn}: ${error instanceof Error ? error.message : error}`);
        }
      }
      console.log(`${id}: sampled (winner: ${winnerName})`);
    }

    for (const phase of ['early', 'mid', 'late'] as const) {
      const inPhase = samples.filter(sample => sample.phase === phase);
      if (inPhase.length === 0) continue;
      const correct = inPhase.filter(sample => (sample.score > 0) === sample.p1Won).length;
      const meanAbs = inPhase.reduce((sum, sample) => sum + Math.abs(sample.score), 0) / inPhase.length;
      console.log(
        `${phase}: n=${inPhase.length} sign-accuracy=${(100 * correct / inPhase.length).toFixed(0)}% ` +
        `mean|score|=${meanAbs.toFixed(2)}`,
      );
    }

    // Per-gametype accuracy: the doubles scoring path has its own candidate
    // restriction and combined-choice space — it must be measured separately.
    for (const gameType of ['singles', 'doubles'] as const) {
      const inType = samples.filter(sample => sample.gameType === gameType);
      if (inType.length === 0) continue;
      const correct = inType.filter(sample => (sample.score > 0) === sample.p1Won).length;
      console.log(
        `${gameType}: n=${inType.length} sign-accuracy=${(100 * correct / inType.length).toFixed(0)}%`,
      );
    }

    // Logistic fit of P(p1 wins | score) = 1/(1+exp(−K·score)) via the shared
    // helper. The pooled K feeds src/lib/eval/winprob.ts (pinned by hand after
    // each fit worth adopting).
    const asOutcome = (s: Sample) => ({ score: s.score, faintedFraction: s.faintedFraction, won: s.p1Won });
    const fitK = (subset: Sample[]): number => fitConstantK(subset.map(asOutcome));
    console.log(
      `winprob K: pooled=${fitK(samples).toFixed(2)} ` +
      `singles=${fitK(samples.filter(sample => sample.gameType === 'singles')).toFixed(2)} ` +
      `doubles=${fitK(samples.filter(sample => sample.gameType === 'doubles')).toFixed(2)}`,
    );

    // Brier per phase bucket under the pooled constant K — the calibration
    // evidence sign accuracy cannot see (it is invariant under monotone maps).
    const pooledK = fitConstantK(samples.map(asOutcome));
    for (const phase of ['early', 'mid', 'late'] as const) {
      const subset = samples.filter(s => s.phase === phase).map(asOutcome);
      if (subset.length === 0) continue;
      console.log(`${phase} brier=${brierScore(subset, pooledK).toFixed(4)}`);
    }

    // Calibration by confidence: within a |score| bucket, how often does the
    // favored side actually win? Well-calibrated means accuracy grows with
    // magnitude (informs the tanh scale, not just the sign).
    const buckets: [number, number][] = [[0, 0.2], [0.2, 0.4], [0.4, 0.7], [0.7, 1.01]];
    for (const [lo, hi] of buckets) {
      const inBucket = samples.filter(sample => Math.abs(sample.score) >= lo && Math.abs(sample.score) < hi);
      if (inBucket.length === 0) continue;
      const correct = inBucket.filter(sample => (sample.score > 0) === sample.p1Won).length;
      console.log(
        `|score| ${lo.toFixed(1)}–${hi > 1 ? '1.0' : hi.toFixed(1)}: n=${inBucket.length} ` +
        `favored-side-wins=${(100 * correct / inBucket.length).toFixed(0)}%`,
      );
    }
    // Per-position dump for offline paired analysis (engine-vs-engine joins,
    // hybrid counterfactuals). Purely observational — never changes the run.
    if (process.env.EVAL_CALIBRATION_DUMP) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        process.env.EVAL_CALIBRATION_DUMP,
        samples.map(sample => JSON.stringify(sample)).join('\n') + '\n',
      );
      console.log(`dumped ${samples.length} samples to ${process.env.EVAL_CALIBRATION_DUMP}`);
    }
    expect(samples.length).toBeGreaterThan(0);
  });
});
