import { test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { reconstructBranchRuntime } from '../src/lib/branch-engine';
import { getBranchSimulatorFormat } from '../src/lib/replay-format';
import { parseReplayLogWithObservations } from '../src/lib/protocol-parser';
import {
  createMatchupCache, evalFeatures, evaluatePosition, EVAL_WEIGHTS, FEATURE_WEIGHTS,
  type EvalFeatures,
} from '../src/lib/eval/eval-function';
import { battleFaintedFraction } from '../src/lib/eval/search';
import { brierScore, fitConstantK, fitPhaseK, logLossScore, phaseBucket } from './fit-helpers';

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

/** Deterministic PRNG for the cluster bootstrap. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Logistic regression on standardized features; deterministic fixed-iteration GD. */
function fitLogistic(samples: FitSample[]): { beta: number[]; intercept: number; sigma: number[]; mu: number[] } {
  const n = samples.length;
  const k = FEATURE_KEYS.length;
  const mu = Array(k).fill(0);
  const sigma = Array(k).fill(0);
  for (const sample of samples) for (let j = 0; j < k; j++) mu[j] += sample.g[j] / n;
  for (const sample of samples) for (let j = 0; j < k; j++) sigma[j] += (sample.g[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < k; j++) sigma[j] = Math.sqrt(sigma[j]) || 1;

  const z = samples.map(sample => sample.g.map((value, j) => (value - mu[j]) / sigma[j]));
  const beta = Array(k).fill(0);
  let intercept = 0;
  const lr = 0.5;
  for (let iter = 0; iter < 500; iter++) {
    const gradBeta = Array(k).fill(0);
    let gradIntercept = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(intercept + z[i].reduce((sum, value, j) => sum + value * beta[j], 0));
      const err = p - (samples[i].p1Won ? 1 : 0);
      for (let j = 0; j < k; j++) gradBeta[j] += err * z[i][j] / n;
      gradIntercept += err / n;
    }
    for (let j = 0; j < k; j++) beta[j] -= lr * gradBeta[j];
    intercept -= lr * gradIntercept;
  }
  return { beta, intercept, sigma, mu };
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
    test.setTimeout(3_600_000);

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

        const { snapshots, observations } = parseReplayLogWithObservations(replay.log);
        const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations });
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
      const fit = fitLogistic(subset);
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
        draws.push(impliedWeights(fitLogistic(resample)));
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

    bootstrap('ALL', samples);
    bootstrap('SINGLES-ONLY', singles);
    bootstrap('DOUBLES-ONLY', doubles);
    bootstrap('GEN9-ONLY', samples.filter(s => s.genClass === 'gen9'));

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
