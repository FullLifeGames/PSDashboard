import { test } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { reconstructBranchRuntime } from '../src/lib/branch-engine';
import { getBranchSimulatorFormat } from '../src/lib/replay-format';
import { parseReplayLogWithObservations } from '../src/lib/protocol-parser';
import {
  createMatchupCache, evalFeatures, evaluatePosition, EVAL_WEIGHTS, FEATURE_WEIGHTS,
  type EvalFeatures,
} from '../src/lib/eval/eval-function';

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
const FEATURE_KEYS = Object.keys(FEATURE_WEIGHTS) as (keyof EvalFeatures)[];

interface FitSample {
  game: string;
  source: 'tournament' | 'ladder';
  gameType: 'singles' | 'doubles';
  /** Features scaled by scale/normalizer — the tanh argument's addends. */
  g: number[];
  score: number;
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

function fitWinprobK(samples: FitSample[]): number {
  let k = 1.5;
  for (let iter = 0; iter < 500; iter++) {
    let grad = 0;
    for (const sample of samples) {
      const p = sigmoid(k * sample.score);
      grad += (p - (sample.p1Won ? 1 : 0)) * sample.score / samples.length;
    }
    k -= 1.0 * grad;
  }
  return k;
}

test.describe('eval weight fitting (EVAL_FIT=1)', () => {
  test('fit feature weights on the pinned corpus and report', async () => {
    test.skip(!process.env.EVAL_FIT, 'weight fitting is opt-in: EVAL_FIT=1');
    test.skip(!existsSync(MANIFEST_PATH), 'run node scripts/build-fit-corpus.mjs first');
    test.setTimeout(3_600_000);

    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
      replays: { id: string; format: string; source: 'tournament' | 'ladder' }[];
    };
    const samples: FitSample[] = [];

    for (const entry of manifest.replays) {
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
              samples.push({ game: entry.id, source: entry.source, gameType, g, score, p1Won });
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

    report('ALL', samples);
    report('TOURNAMENT-ONLY', samples.filter(sample => sample.source === 'tournament'));
    report('LADDER-ONLY', samples.filter(sample => sample.source === 'ladder'));

    // Cluster bootstrap by GAME for the full fit's standard errors.
    const gameList = [...games];
    const byGame = new Map<string, FitSample[]>();
    for (const sample of samples) byGame.set(sample.game, [...(byGame.get(sample.game) ?? []), sample]);
    const rng = mulberry32(42);
    const draws: number[][] = [];
    for (let b = 0; b < 100; b++) {
      const resample: FitSample[] = [];
      for (let i = 0; i < gameList.length; i++) {
        const pick = gameList[Math.floor(rng() * gameList.length)];
        resample.push(...(byGame.get(pick) ?? []));
      }
      draws.push(impliedWeights(fitLogistic(resample)));
    }
    console.log('\nbootstrap SE (implied weights):');
    FEATURE_KEYS.forEach((key, j) => {
      const values = draws.map(draw => draw[j]).filter(value => Number.isFinite(value));
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const se = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
      console.log(`  ${key}: mean=${mean.toFixed(1)} se=${se.toFixed(1)}`);
    });

    // Win-probability curve refit on the larger corpus.
    for (const gameType of ['singles', 'doubles'] as const) {
      const subset = samples.filter(sample => sample.gameType === gameType);
      if (subset.length < 50) continue;
      console.log(`winprob K refit ${gameType}: ${fitWinprobK(subset).toFixed(2)} (n=${subset.length})`);
    }
  });
});
