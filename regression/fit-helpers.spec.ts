import { test, expect } from '@playwright/test';
import { brierScore, fitConstantK, fitPhaseK, logLossScore, phaseBucket, probOf } from './fit-helpers';

test.describe('fit helpers', () => {
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
