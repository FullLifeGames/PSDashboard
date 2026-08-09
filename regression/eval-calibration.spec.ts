import { test, expect } from '@playwright/test';
import { State } from '@pkmn/sim';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { reconstructBranchRuntime } from '../src/lib/branch-engine';
import { getBranchSimulatorFormat } from '../src/lib/replay-format';
import { parseReplayLogWithObservations } from '../src/lib/protocol-parser';
import { battleFaintedFraction, searchPosition } from '../src/lib/eval/search';
import { brierScore, fitConstantK } from './fit-helpers';

/**
 * Informational calibration run against real finished replays: does the
 * score's sign predict the actual winner, and how does confidence grow over
 * the game? Not a CI gate — network + ~3 minutes of reconstruction.
 * Run: EVAL_CALIBRATION=1 npx playwright test -c playwright.regression.config.ts eval-calibration
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
 */
const REPLAY_IDS = [
  'gen9draft-2058494320',
  'gen9draft-2298735122',
  'gen3customgame-2115579570',
  // High-ladder gen9ou games (≥1500 Elo, sampled 2026-08-02) — stronger play
  // gives a cleaner sign-accuracy signal than random-ladder blunder-fests.
  'gen9ou-2658678742',
  'gen9ou-2658675391',
  'gen9ou-2658676184',
  'gen9ou-2658675932',
  'gen9ou-2658670791',
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
  // Doubles/VGC (sampled 2026-08-04, rating ≥1400 VGC / ≥1480 DOU, ≥7 turns) —
  // the doubles scoring path was previously uncalibrated entirely.
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
];

interface Sample {
  phase: 'early' | 'mid' | 'late';
  gameType: 'singles' | 'doubles';
  score: number;
  /** Fainted bodies / total bodies at the sampled position. */
  faintedFraction: number;
  p1Won: boolean;
}

test.describe('eval calibration against real replays', () => {
  test.skip(!process.env.EVAL_CALIBRATION, 'set EVAL_CALIBRATION=1 to run the calibration sweep');

  test('score sign tracks the actual winner', async () => {
    test.setTimeout(2_400_000);
    const samples: Sample[] = [];

    for (const id of REPLAY_IDS) {
      const response = await fetch(`https://replay.pokemonshowdown.com/${id}.json`);
      if (!response.ok) {
        console.log(`skipping ${id}: HTTP ${response.status}`);
        continue;
      }
      const replay = await response.json() as { id: string; log: string; players: string[] };
      const winnerName = replay.log.match(/^\|win\|(.+)$/m)?.[1]?.trim();
      if (!winnerName) {
        console.log(`skipping ${id}: no winner line`);
        continue;
      }
      const p1Won = winnerName === replay.players[0];
      const gameType: Sample['gameType'] = /\|gametype\|doubles/.test(replay.log) ? 'doubles' : 'singles';
      // Observations drive spread inference — same path the app takes.
      const { snapshots, observations } = parseReplayLogWithObservations(replay.log);
      const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations });
      if (p1Team.length === 0 || p2Team.length === 0) {
        console.log(`skipping ${id}: could not build teams`);
        continue;
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
          const serialized = JSON.stringify(State.serializeBattle(battle));
          // EVAL_CALIBRATION_DEPTH separates the two levers: does more
          // search fix a phase, or is the static eval itself miscalibrated?
          const depth = process.env.EVAL_CALIBRATION_DEPTH === '2' ? 2 : 1;
          const { score } = searchPosition(serialized, { depth, samples: 1, tera: false });
          if (Number.isNaN(score)) {
            // A NaN would silently poison every aggregate — surface it loudly.
            console.log(`NaN score: ${id} turn ${turn}`);
            continue;
          }
          const fraction = turn / maxTurn;
          samples.push({
            phase: fraction < 1 / 3 ? 'early' : fraction < 2 / 3 ? 'mid' : 'late',
            gameType,
            score,
            faintedFraction: battleFaintedFraction(battle),
            p1Won,
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
    expect(samples.length).toBeGreaterThan(0);
  });
});
