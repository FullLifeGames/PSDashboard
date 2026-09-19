import { test, expect, describe } from 'vitest';
import {
  assignFolds, bootstrapPhaseK, brierScore, crossValidate, fitConstantK, fitLogistic, fitPhaseK,
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

  // Round 48: the phase fit used to stop after 500 fixed gradient steps, a fifth of the way along its slow
  // direction (the k1 column carries a tenth of k0's curvature). Every K pin read an intermediate state.
  test('the phase fit runs to the maximum: the gradient vanishes and long gradient descent agrees', () => {
    const samples = synth(1.0, 3.0);
    const { k0, k1 } = fitPhaseK(samples);
    const gradient = (a: number, b: number) => {
      let g0 = 0;
      let g1 = 0;
      for (const s of samples) {
        const err = probOf(s, a, b) - (s.won ? 1 : 0);
        g0 += err * s.score / samples.length;
        g1 += err * s.score * s.faintedFraction / samples.length;
      }
      return [g0, g1];
    };
    expect(Math.hypot(...gradient(k0, k1))).toBeLessThan(1e-8);
    let a = 1.5;
    let b = 0;
    for (let iter = 0; iter < 200000; iter++) {
      const [g0, g1] = gradient(a, b);
      a -= g0;
      b -= g1;
    }
    expect(k0).toBeCloseTo(a, 4);
    expect(k1).toBeCloseTo(b, 4);
  });

  test('a large sample gives its known (k0, k1) back', () => {
    const { k0, k1 } = fitPhaseK(synth(1.8, 3.5, 20000));
    expect(Math.abs(k0 - 1.8)).toBeLessThan(0.15);
    expect(Math.abs(k1 - 3.5)).toBeLessThan(0.15);
  });

  test('the phase fit stays finite where the data carry no slope or no limit', () => {
    // One phase only: no curvature along k1, the slope stays where it started.
    const flat = synth(2.0, 0).map(s => ({ ...s, faintedFraction: 0 }));
    const onePhase = fitPhaseK(flat);
    expect(onePhase.k1).toBe(0);
    expect(onePhase.k0).toBeCloseTo(fitConstantK(flat), 3);
    // Perfectly separable outcomes push K up without bound: the fit stops finite.
    const separable = synth(2.0, 1.0).map(s => ({ ...s, won: s.score > 0 }));
    const { k0, k1 } = fitPhaseK(separable);
    expect(Number.isFinite(k0) && Number.isFinite(k1)).toBe(true);
  });

  test('the bootstrap over games brackets the phase fit and reproduces from its seed', () => {
    const samples = synth(1.5, 2.5, 1200).map((sample, i) => ({ ...sample, game: `g${i % 150}` }));
    const point = fitPhaseK(samples);
    const spread = bootstrapPhaseK(samples, 60, 3);
    expect(bootstrapPhaseK(samples, 60, 3)).toEqual(spread);
    expect(spread.k0.se).toBeGreaterThan(0);
    expect(spread.k0.lo).toBeLessThan(point.k0);
    expect(spread.k0.hi).toBeGreaterThan(point.k0);
    expect(spread.k1.lo).toBeLessThan(point.k1);
    expect(spread.k1.hi).toBeGreaterThan(point.k1);
    expect(spread.at.map(entry => entry.ff)).toEqual([0, 1 / 3, 2 / 3]);
    expect(spread.at[1].k).toBeCloseTo(point.k0 + point.k1 / 3, 12);
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
