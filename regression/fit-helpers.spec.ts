import { test, expect, describe } from 'vitest';
import {
  assignFolds, brierScore, crossValidate, fitConstantK, fitLogistic, fitPhaseK,
  logLossScore, maskColumns, phaseBucket, probOf, type CvSample,
} from './fit-helpers';

describe('fit helpers', () => {
  const synth = (k0: number, k1: number, n = 400) => {
    // Deterministic synthetic corpus: outcomes drawn by thresholding the
    // model probability against an LCG — recoverable ground truth.
    let seed = 42;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    return Array.from({ length: n }, (_, i) => {
      const score = (i % 21 - 10) / 10;
      const faintedFraction = (i % 7) / 6;
      const p = probOf({ score, faintedFraction, won: false }, k0, k1);
      return { score, faintedFraction, won: rand() < p };
    });
  };

  test('recovers a constant K from synthetic outcomes', () => {
    const k = fitConstantK(synth(2.5, 0));
    expect(k).toBeGreaterThan(1.8);
    expect(k).toBeLessThan(3.2);
  });

  test('recovers a phase slope and beats constant K on Brier', () => {
    const samples = synth(1.0, 3.0);
    const { k0, k1 } = fitPhaseK(samples);
    expect(k1).toBeGreaterThan(1.0); // slope direction recovered
    const constant = fitConstantK(samples);
    expect(brierScore(samples, k0, k1)).toBeLessThanOrEqual(brierScore(samples, constant) + 1e-9);
  });

  test('log-loss is finite even for extreme scores', () => {
    const samples = [{ score: 1, faintedFraction: 1, won: false }];
    expect(Number.isFinite(logLossScore(samples, 50, 50))).toBe(true);
  });

  test('phase buckets split at 1/6 and 1/2', () => {
    expect(phaseBucket(0)).toBe('early');
    expect(phaseBucket(0.2)).toBe('mid');
    expect(phaseBucket(0.6)).toBe('late');
  });
});

describe('cv helpers (round 8)', () => {
  const games = Array.from({ length: 23 }, (_, i) => `g${i}`);

  test('assignFolds is deterministic, complete, and balanced', () => {
    const a = assignFolds(games, 5, 7);
    const b = assignFolds(games, 5, 7);
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.size).toBe(23);
    const sizes = Array.from({ length: 5 }, (_, fold) =>
      [...a.values()].filter(value => value === fold).length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  test('assignFolds ignores input order and varies by seed', () => {
    const forward = assignFolds(games, 5, 1);
    const reversed = assignFolds([...games].reverse(), 5, 1);
    expect(new Map(forward)).toEqual(new Map(reversed));
    const other = assignFolds(games, 5, 2);
    expect([...forward.entries()]).not.toEqual([...other.entries()]);
  });

  test('maskColumns zeroes exactly the dropped indices', () => {
    expect(maskColumns([1, 2, 3], new Set([1]))).toEqual([1, 0, 3]);
    expect(maskColumns([1, 2, 3], new Set())).toEqual([1, 2, 3]);
  });

  test('fitLogistic weights the driving feature, not the noise column', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const samples = Array.from({ length: 500 }, (_, i) => {
      const x = (i % 21 - 10) / 10;
      return { g: [x, rand() - 0.5], won: rand() < 1 / (1 + Math.exp(-2.5 * x)) };
    });
    const fit = fitLogistic(samples);
    expect(fit.beta[0]).toBeGreaterThan(0.5);
    expect(Math.abs(fit.beta[1])).toBeLessThan(0.25);
  });

  test('cross-validation prefers the causal basis under collinearity', () => {
    // Kernversprechen der Runde: Outcome hängt nur an Spalte 0 (A);
    // Spalte 1 (B) = A + Rauschen. Die Basis MIT A (B maskiert) muss die
    // Basis NUR-B out-of-fold schlagen — Koeffizienten-SEs könnten das
    // unter Kollinearität nicht entscheiden, CV muss es.
    let seed = 42;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const samples: CvSample[] = [];
    for (let game = 0; game < 120; game++) {
      const a = (game % 11 - 5) / 5;
      const won = rand() < 1 / (1 + Math.exp(-3 * a));
      for (let position = 0; position < 3; position++) {
        samples.push({ game: `game${game}`, won, g: [a, a + (rand() - 0.5) * 1.5] });
      }
    }
    const withA = crossValidate(samples, 5, 3, new Set([1]));
    const withB = crossValidate(samples, 5, 3, new Set([0]));
    expect(withA.logLoss).toBeLessThan(withB.logLoss);
    expect(Number.isFinite(withB.brier)).toBe(true);
  });
});
