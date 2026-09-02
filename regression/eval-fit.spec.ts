import { test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildTeamsFromReplay } from '../packages/replay-core/src/team-builder';
import { reconstructBranchRuntime } from '../src/lib/branch-engine';
import { getBranchSimulatorFormat } from '../packages/replay-core/src/replay-format';
import { parseReplayLogWithObservations } from '../packages/replay-core/src/protocol-parser';
import {
  createMatchupCache, evalFeatures, evaluatePosition, EVAL_WEIGHTS, FEATURE_WEIGHTS,
  type EvalFeatures,
} from '../src/lib/eval/eval-function';
import { battleFaintedFraction } from '../src/lib/eval/search';
import { brierScore, crossValidate, fitConstantK, fitLogistic, fitPhaseK, logLossScore, mulberry32, phaseBucket } from './fit-helpers';

/**
 * Weight-fitting harness (WP 7): fits the static eval's linear feature
 * weights by logistic regression on the manifest-pinned corpus (positions →
 * game outcomes), clustered by game. REPORTS ONLY — adopting a fitted weight
 * means editing EVAL_WEIGHTS by hand and passing the calibration gate.
 *
 * Corpus: node scripts/build-fit-corpus.mjs (manifest committed, logs cached
 * in .fit-corpus/). Run: EVAL_FIT=1 npx playwright test -c
 * playwright.regression.config.ts eval-fit
 *
 * Effective sample size is the number of GAMES (positions share their game's
 * outcome label) — hence the cluster bootstrap for standard errors and the
 * tournament-vs-ladder comparison (tournament outcomes carry cleaner labels).
 *
 * Instrumented run 2026-08-09 (schema 2: faintedFraction + genClass;
 * 5,985 positions / 1,100 games):
 * - K(phase) fit, P = sigmoid((k0 + k1·ff)·score):
 *     singles constant K=2.61 · phase k0=2.28 k1=1.49
 *       early brier 0.2470→0.2451 · mid 0.1802→0.1799 · late 0.1661→0.1634
 *     doubles constant K=3.15 · phase k0=2.98 k1=0.88
 *       early brier 0.2264→0.2259 · mid 0.1764→0.1764 · late 0.1655→0.1644
 *   Phase-K beats constant-K on the early bucket in BOTH gametypes and
 *   regresses nowhere → ADOPTED (winprob.ts, cache v11). The k1 direction
 *   (confidence grows as bodies drop) is exactly the measured early
 *   overconfidence the round targets.
 * - Gen-class tranches (is the singles weakness a corpus artifact?):
 *     matchup implied GEN9-ONLY 145.6±68.0 vs OLDGEN-ONLY 37.3 (pooled
 *     88.8±48.3, hand 120): matchup carries far more outcome signal in gen9;
 *     the oldgen-heavy singles tranche drags the pooled fit down. Within
 *     ~1.5 SE of pooled → no weight change; RECORDED as the follow-up
 *     trigger for a gen9-singles corpus expansion (out of scope this round).
 * - Tranche sanity: tailwind never occurs in the singles corpus (0.0±0.0);
 *   oldgen trick room is noise (−345±242). The per-gametype weight split
 *   (2026-08-08) stays justified; no doubles-weight update from this run
 *   (doubles implied values match the adopted 27/68/87 within noise).
 *
 * Corpus expanded 2026-08-09 to 2,127 replays (gen9-singles follow-up:
 * SV OU archive + UWC threads + gen9ru cap raise; gen9 singles ~840
 * games). Findings and the fifth boost rejection are recorded in the
 * eval-calibration header — that run supersedes the tranche notes above
 * where they conflict (the gen9-vs-oldgen matchup gap was tranche noise).
 */

const MANIFEST_PATH = 'regression/fixtures/fit-corpus-manifest.json';
const CACHE_DIR = '.fit-corpus';
/**
 * Captured samples are cached so fit-side iterations skip the hour-long
 * reconstruction pass. The stamp covers the feature keys, every weight
 * value, and the manifest's replay list — a change to any of them
 * invalidates automatically. Feature DEFINITION changes (same keys, same
 * weights) still require deleting the file by hand.
 */
const SAMPLES_CACHE = join(CACHE_DIR, 'samples-cache.json');
const FEATURE_KEYS = Object.keys(FEATURE_WEIGHTS) as (keyof EvalFeatures)[];
const cacheStamp = (manifest: { replays: { id: string }[] }) => JSON.stringify({
  schema: 2, // FitSample gained faintedFraction/genClass — bump forces one recapture
  featureKeys: FEATURE_KEYS,
  weights: { EVAL_WEIGHTS, FEATURE_WEIGHTS },
  manifestIds: manifest.replays.map(entry => entry.id),
});

interface FitSample {
  game: string;
  source: 'tournament' | 'ladder';
  gameType: 'singles' | 'doubles';
  genClass: 'gen9' | 'old';
  /** Features scaled by scale/normalizer — the tanh argument's addends. */
  g: number[];
  score: number;
  /** Fainted bodies / total bodies at capture time — the phase covariate. */
  faintedFraction: number;
  p1Won: boolean;
}

/** Implied point-scale weights, normalized so `bodies` matches its hand weight. */
function impliedWeights(fit: { beta: number[]; sigma: number[] }): number[] {
  const perUnit = fit.beta.map((value, j) => value / fit.sigma[j]);
  const bodiesIndex = FEATURE_KEYS.indexOf('bodies');
  const reference = perUnit[bodiesIndex];
  const bodiesHand = FEATURE_WEIGHTS.bodies;
  return perUnit.map(value => (reference !== 0 ? (value / reference) * bodiesHand : NaN));
}

test.describe('eval weight fitting (EVAL_FIT=1)', () => {
  test('fit feature weights on the pinned corpus and report', async () => {
    test.skip(!process.env.EVAL_FIT, 'weight fitting is opt-in: EVAL_FIT=1');
    test.skip(!existsSync(MANIFEST_PATH), 'run node scripts/build-fit-corpus.mjs first');
    test.setTimeout(7_200_000);

    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
      replays: { id: string; format: string; source: 'tournament' | 'ladder' }[];
    };
    let samples: FitSample[] = [];

    if (existsSync(SAMPLES_CACHE)) {
      const cached = JSON.parse(readFileSync(SAMPLES_CACHE, 'utf-8')) as {
        stamp?: string; samples: FitSample[];
      };
      if (cached.stamp === cacheStamp(manifest)) {
        samples = cached.samples;
        console.log(`loaded ${samples.length} samples from ${SAMPLES_CACHE}`);
      }
    }

    const cacheHit = samples.length > 0;
    for (const entry of cacheHit ? [] : manifest.replays) {
      const cachePath = join(CACHE_DIR, `${entry.id}.json`);
      if (!existsSync(cachePath)) continue;
      try {
        const replay = JSON.parse(readFileSync(cachePath, 'utf-8')) as {
          id?: string; log: string; players?: string[]; format?: string; formatid?: string;
        };
        const winnerName = replay.log.match(/\|win\|(.+)/)?.[1]?.trim();
        const players = replay.players ?? [];
        if (!winnerName || players.length < 2) continue;
        const p1Won = winnerName === players[0];
        if (!p1Won && winnerName !== players[1]) continue;
        const gameType: FitSample['gameType'] = /\|gametype\|doubles/.test(replay.log) ? 'doubles' : 'singles';
        const genClass: FitSample['genClass'] = /^gen9/.test(replay.formatid ?? entry.format) ? 'gen9' : 'old';

        const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
        const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
        if (p1Team.length === 0 || p2Team.length === 0 || snapshots.length < 4) continue;

        const maxTurn = snapshots.length;
        const step = Math.max(1, Math.ceil(maxTurn / 8));
        const wanted = new Set<number>();
        for (let turn = 2; turn < maxTurn; turn += step) wanted.add(turn);

        // Single-pass capture: one reconstruction yields every sampled turn.
        await reconstructBranchRuntime({
          format: getBranchSimulatorFormat({ id: entry.id, format: replay.format ?? entry.format, formatid: replay.formatid, log: replay.log } as Parameters<typeof getBranchSimulatorFormat>[0]),
          p1Team, p2Team,
          replayLog: replay.log,
          targetTurn: maxTurn - 1,
          snapshot: snapshots[Math.min(maxTurn - 2, snapshots.length - 1)],
          capturePositions: {
            snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
            onPosition: (turn, battle) => {
              if (!wanted.has(turn) || battle.ended) return;
              const cache = createMatchupCache();
              const features = evalFeatures(battle, cache);
              const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
              const scaleOverNorm = EVAL_WEIGHTS.scale / (teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp));
              const g = FEATURE_KEYS.map(key => features[key] * scaleOverNorm);
              const score = evaluatePosition(battle, cache);
              if (Number.isNaN(score) || g.some(Number.isNaN)) return;
              samples.push({
                game: entry.id, source: entry.source, gameType, genClass, g, score,
                faintedFraction: battleFaintedFraction(battle), p1Won,
              });
            },
          },
        });
        console.log(`${entry.id}: ok`);
      } catch (error) {
        console.log(`${entry.id}: ${error instanceof Error ? error.message : error}`);
      }
    }

    const games = new Set(samples.map(sample => sample.game));
    console.log(`\nsamples=${samples.length} games=${games.size}`);
    if (samples.length < 100) {
      console.log('too few samples to fit — check the corpus cache');
      return;
    }
    if (!cacheHit) {
      writeFileSync(SAMPLES_CACHE, JSON.stringify({ stamp: cacheStamp(manifest), samples }));
      console.log(`cached samples to ${SAMPLES_CACHE}`);
    }

    const report = (label: string, subset: FitSample[]) => {
      if (subset.length < 50) {
        console.log(`${label}: too few samples (${subset.length})`);
        return;
      }
      const fit = fitLogistic(subset.map(s => ({ g: s.g, won: s.p1Won })));
      const implied = impliedWeights(fit);
      console.log(`\n${label} (n=${subset.length}, games=${new Set(subset.map(s => s.game)).size}):`);
      FEATURE_KEYS.forEach((key, j) => {
        console.log(`  ${key}: hand=${FEATURE_WEIGHTS[key]} implied=${implied[j]?.toFixed(1)}`);
      });
      return implied;
    };

    // Cluster bootstrap by GAME for a subset's implied-weight standard errors.
    const bootstrap = (label: string, subset: FitSample[]) => {
      const subsetGames = [...new Set(subset.map(sample => sample.game))];
      if (subsetGames.length < 20) {
        console.log(`bootstrap ${label}: too few games (${subsetGames.length})`);
        return;
      }
      const byGame = new Map<string, FitSample[]>();
      for (const sample of subset) byGame.set(sample.game, [...(byGame.get(sample.game) ?? []), sample]);
      const rng = mulberry32(42);
      const draws: number[][] = [];
      for (let b = 0; b < 100; b++) {
        const resample: FitSample[] = [];
        for (let i = 0; i < subsetGames.length; i++) {
          const pick = subsetGames[Math.floor(rng() * subsetGames.length)];
          resample.push(...(byGame.get(pick) ?? []));
        }
        draws.push(impliedWeights(fitLogistic(resample.map(s => ({ g: s.g, won: s.p1Won })))));
      }
      console.log(`\nbootstrap SE ${label} (implied weights, games=${subsetGames.length}):`);
      FEATURE_KEYS.forEach((key, j) => {
        const values = draws.map(draw => draw[j]).filter(value => Number.isFinite(value));
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const se = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
        console.log(`  ${key}: mean=${mean.toFixed(1)} se=${se.toFixed(1)}`);
      });
    };

    const singles = samples.filter(sample => sample.gameType === 'singles');
    const doubles = samples.filter(sample => sample.gameType === 'doubles');
    report('ALL', samples);
    report('TOURNAMENT-ONLY', samples.filter(sample => sample.source === 'tournament'));
    report('LADDER-ONLY', samples.filter(sample => sample.source === 'ladder'));
    // Per-gametype fits: the pooled fit is singles-dominated, so a weight it
    // favors can hurt doubles (seen in the 2026-08-08 adoption gate). These
    // ask whether the doubles data itself supports different weights.
    report('SINGLES-ONLY', singles);
    report('DOUBLES-ONLY', doubles);

    // Gen-class tranches answer: is the singles weakness a corpus artifact?
    report('GEN9-ONLY', samples.filter(s => s.genClass === 'gen9'));
    report('OLDGEN-ONLY', samples.filter(s => s.genClass === 'old'));

    // Sweep-vs-boosts variant: with the flat boosts column zeroed, does the
    // sweep feature absorb the boost signal on its own? (The adoption matrix
    // compares both variants — see the calibration header.)
    const boostsIndex = FEATURE_KEYS.indexOf('boosts' as keyof EvalFeatures);
    const noBoosts = samples.map(s => ({ ...s, g: s.g.map((value, j) => (j === boostsIndex ? 0 : value)) }));
    report('ALL-NO-BOOSTS', noBoosts);
    bootstrap('ALL-NO-BOOSTS', noBoosts);

    bootstrap('ALL', samples);
    bootstrap('SINGLES-ONLY', singles);
    bootstrap('DOUBLES-ONLY', doubles);
    bootstrap('GEN9-ONLY', samples.filter(s => s.genClass === 'gen9'));

    // Sweep v2 cells (round 9, design doc 2026-08-17): the round-8 CV showed
    // v1 carries nothing beyond flat boosts. v2 splits each flipped pair into
    // 2×2 cells (acts-first × in-KO-range); each training fold prices the
    // cells itself — no guessed factors. PRE-REGISTERED hierarchy, decision
    // tranche SINGLES-ONLY, criterion per branch: mean OOF logloss Δ < 0 AND
    // wins ≥ 16/20 seeds AND mean OOF brier ≤ base.
    //   1. REPLACEMENT: M1 (cells, no boosts) beats M0 (boosts, no cells).
    //   2. ADDITIVE: else M2 (both) beats M0.
    //   3. Otherwise STATUS QUO — cells stay weight 0.
    const cellKeys = ['sweepFastKo', 'sweepFastChip', 'sweepSlowKo', 'sweepSlowChip'] as const;
    const cellIndices = new Set(cellKeys.map(key => FEATURE_KEYS.indexOf(key)));
    const cvModels = [
      { name: 'M0 boosts-only', drop: cellIndices },
      { name: 'M1 cells-only', drop: new Set([boostsIndex]) },
      { name: 'M2 additive', drop: new Set<number>() },
    ];
    const cvSeeds = Array.from({ length: 20 }, (_, i) => i + 1);
    const cvTranche = (label: string, subset: FitSample[]) => {
      const gameCount = new Set(subset.map(s => s.game)).size;
      if (gameCount < 25) {
        console.log(`\ncv ${label}: too few games (${gameCount})`);
        return null;
      }
      const cvSamples = subset.map(s => ({ g: s.g, won: s.p1Won, game: s.game }));
      const runs = new Map(cvModels.map(model => [model.name,
        cvSeeds.map(seed => crossValidate(cvSamples, 5, seed, model.drop))]));
      console.log(`\ncv ${label} (n=${subset.length}, games=${gameCount}, k=5, seeds=${cvSeeds.length}):`);
      const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      for (const model of cvModels) {
        const modelRuns = runs.get(model.name)!;
        console.log(`  ${model.name}: logloss=${mean(modelRuns.map(r => r.logLoss)).toFixed(5)} ` +
          `brier=${mean(modelRuns.map(r => r.brier)).toFixed(5)}`);
      }
      const m0 = runs.get('M0 boosts-only')!;
      const versus = (name: string) => {
        const model = runs.get(name)!;
        const deltas = cvSeeds.map((_, i) => model[i].logLoss - m0[i].logLoss);
        const wins = deltas.filter(delta => delta < 0).length;
        const meanDelta = mean(deltas);
        const brierOk = mean(model.map(r => r.brier)) <= mean(m0.map(r => r.brier));
        console.log(`  Δlogloss(${name}−M0): mean=${meanDelta.toFixed(6)} · ` +
          `wins ${wins}/${cvSeeds.length} seeds · brier ≤ M0: ${brierOk}`);
        return { meanDelta, wins, brierOk };
      };
      return { m1: versus('M1 cells-only'), m2: versus('M2 additive') };
    };
    cvTranche('ALL', samples);
    const singlesCv = cvTranche('SINGLES-ONLY', singles);
    cvTranche('DOUBLES-ONLY', doubles);
    cvTranche('GEN9-ONLY', samples.filter(s => s.genClass === 'gen9'));
    if (singlesCv) {
      const passes = (r: { meanDelta: number; wins: number; brierOk: boolean }) =>
        r.meanDelta < 0 && r.wins >= 16 && r.brierOk;
      const verdict = passes(singlesCv.m1) ? 'REPLACEMENT CANDIDATE'
        : passes(singlesCv.m2) ? 'ADDITIVE CANDIDATE' : 'STATUS QUO HOLDS';
      console.log(`\nCV VERDICT (singles): ${verdict} ` +
        `(M1 meanΔ=${singlesCv.m1.meanDelta.toFixed(6)} wins=${singlesCv.m1.wins}/20 brierOk=${singlesCv.m1.brierOk} · ` +
        `M2 meanΔ=${singlesCv.m2.meanDelta.toFixed(6)} wins=${singlesCv.m2.wins}/20 brierOk=${singlesCv.m2.brierOk})`);
    }

    // Probabilistic scoring of the winprob mapping, per gametype and phase.
    for (const gameType of ['singles', 'doubles'] as const) {
      const subset = samples.filter(s => s.gameType === gameType)
        .map(s => ({ score: s.score, faintedFraction: s.faintedFraction, won: s.p1Won }));
      if (subset.length < 100) continue;
      const constant = fitConstantK(subset);
      const phase = fitPhaseK(subset);
      console.log(`\nwinprob ${gameType}: constant K=${constant.toFixed(2)} ` +
        `phase k0=${phase.k0.toFixed(2)} k1=${phase.k1.toFixed(2)} (n=${subset.length})`);
      for (const bucket of ['early', 'mid', 'late'] as const) {
        const inBucket = subset.filter(s => phaseBucket(s.faintedFraction) === bucket);
        if (inBucket.length < 30) continue;
        console.log(`  ${bucket} (n=${inBucket.length}): ` +
          `brier const=${brierScore(inBucket, constant).toFixed(4)} ` +
          `phase=${brierScore(inBucket, phase.k0, phase.k1).toFixed(4)} ` +
          `logloss const=${logLossScore(inBucket, constant).toFixed(4)} ` +
          `phase=${logLossScore(inBucket, phase.k0, phase.k1).toFixed(4)}`);
      }
    }
  });
});
