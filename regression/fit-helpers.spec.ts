import { test, expect, describe } from 'vitest';
import {
  assignFolds, atKScore, bootstrapPhaseK, bootstrapWeightsAtK, brierScore, crossValidate, crossValidateAtK, fitConstantK,
  fitLogistic, fitPhaseK, fitWeightsAtK, layoutOf, logLossScore, maskColumns, phaseBucket, probOf, refitAtKReport, supportOf,
  type AtKSample, type CvSample,
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

/**
 * Round 64 (T127): the static's weights fitted in today's model form at the
 * fixed K of winprob.ts, P = sigmoid(K(game type, phase) · tanh(Σ w·g)), one
 * weight per column shared by both game types, a doubles override where the
 * doubles table differs, the columns at 0 in both tables held.
 */
describe('weights at a fixed K (round 64, T127)', () => {
  const K = { singles: { k0: 2.28, k1: 1.49 }, doubles: { k0: 2.98, k1: 0.88 } };
  // Columns: 0 bodies-like, 1 boosts-like and 2 tailwind-like (both overridden in doubles), 3 a sweep cell at 0.
  const hand = layoutOf([1, 1, 1, 0], [1, 0.5, 2, 0]);

  /** Games alternate singles and doubles, four positions each; singles never see column 2. */
  function corpus(singles: number[], doubles: number[], games: number, seed: number): AtKSample[] {
    const { layout } = layoutOf(singles, doubles);
    const theta = [...singles, ...layout.overrides.map(j => doubles[j])];
    let state = seed;
    const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
    const samples: AtKSample[] = [];
    for (let game = 0; game < games; game++) {
      const isDoubles = game % 2 === 1;
      for (let position = 0; position < 4; position++) {
        const g = [rand() - 0.5, rand() - 0.5, isDoubles ? rand() - 0.5 : 0, rand() - 0.5].map(value => value * 1.2);
        const sample: AtKSample = { g, won: false, doubles: isDoubles, faintedFraction: position / 6, game: `g${game}` };
        const k = isDoubles ? K.doubles : K.singles;
        const p = 1 / (1 + Math.exp(-(k.k0 + k.k1 * sample.faintedFraction) * atKScore(sample, theta, layout)));
        sample.won = rand() < p;
        samples.push(sample);
      }
    }
    return samples;
  }

  test('the layout reads the doubles overrides and the held columns from the two tables', () => {
    expect(hand.layout.overrides).toEqual([1, 2]);
    expect([...hand.layout.held]).toEqual([3]);
    expect(hand.start).toEqual([1, 1, 1, 0, 0.5, 2]);
    // A doubles sample reads its overrides, a singles sample the shared weights.
    const sample: AtKSample = { g: [0.1, 0.2, 0.3, 0.4], won: true, doubles: true, faintedFraction: 0, game: 'g' };
    expect(atKScore(sample, hand.start, hand.layout)).toBeCloseTo(Math.tanh(0.1 + 0.5 * 0.2 + 2 * 0.3), 12);
    expect(atKScore({ ...sample, doubles: false }, hand.start, hand.layout)).toBeCloseTo(Math.tanh(0.1 + 0.2 + 0.3), 12);
  });

  test('the fit gives known weights back; a column without data and a held column keep their start', () => {
    const samples = corpus([1.6, 0.6, 1, 0], [1.6, 1.2, 2.5, 0], 3000, 11);
    const free = supportOf(samples, hand.layout, 20);
    // The shared tailwind-like weight scores only singles, which never see the column.
    expect(free).toEqual([true, true, false, false, true, true]);
    const fit = fitWeightsAtK(samples, hand.start, hand.layout, K, free);
    expect(fit[0]).toBeCloseTo(1.6, 0);
    expect(Math.abs(fit[0] - 1.6)).toBeLessThan(0.15);
    expect(Math.abs(fit[1] - 0.6)).toBeLessThan(0.15);
    expect(Math.abs(fit[4] - 1.2)).toBeLessThan(0.15);
    expect(Math.abs(fit[5] - 2.5)).toBeLessThan(0.25);
    expect(fit[2]).toBe(1);
    expect(fit[3]).toBe(0);
  });

  test('out of fold the refit beats weights the data were not drawn from in every seed, and not the true ones', () => {
    const truth = layoutOf([1.6, 0.6, 1, 0], [1.6, 1.2, 2.5, 0]);
    const samples = corpus([1.6, 0.6, 1, 0], [1.6, 1.2, 2.5, 0], 600, 5);
    const free = supportOf(samples, hand.layout, 20);
    for (const seed of [1, 2, 3]) {
      const fromHand = crossValidateAtK(samples, 5, seed, hand.start, hand.layout, K, free);
      expect(fromHand.fit.logLoss).toBeLessThan(fromHand.hand.logLoss);
      expect(fromHand.fit.singles.n + fromHand.fit.doubles.n).toBe(samples.length);
      const fromTruth = crossValidateAtK(samples, 5, seed, truth.start, truth.layout, K, free);
      expect(fromTruth.fit.logLoss).toBeGreaterThan(fromTruth.hand.logLoss - 0.002);
    }
  });

  test('the bootstrap over games brackets the fit, a fixed weight has no spread, and the seed reproduces it', () => {
    const samples = corpus([1.6, 0.6, 1, 0], [1.6, 1.2, 2.5, 0], 400, 3);
    const free = supportOf(samples, hand.layout, 20);
    const fit = fitWeightsAtK(samples, hand.start, hand.layout, K, free);
    const spread = bootstrapWeightsAtK(samples, 40, 9, hand.start, hand.layout, K, free);
    for (const [index, band] of spread.entries()) {
      if (!free[index]) { expect(band.se).toBe(0); continue; }
      expect(band.lo).toBeLessThanOrEqual(fit[index]);
      expect(band.hi).toBeGreaterThanOrEqual(fit[index]);
      expect(band.se).toBeGreaterThan(0);
    }
    expect(bootstrapWeightsAtK(samples, 40, 9, hand.start, hand.layout, K, free)).toEqual(spread);
  });

  test('the report proposes both tables from the refit and adopts only by the pre-registered rule', () => {
    const samples = corpus([1.6, 0.6, 1, 0], [1.6, 1.2, 2.5, 0], 600, 5);
    const names = ['bodies', 'boosts', 'tailwind', 'sweep'];
    const report = refitAtKReport(samples, names, [1, 1, 1, 0], [1, 0.5, 2, 0], K, { seeds: 3, folds: 5, draws: 10, minGames: 20 });
    expect(report.weights.map(weight => `${weight.table}:${weight.name}:${weight.free}`))
      .toEqual(['shared:bodies:true', 'shared:boosts:true', 'shared:tailwind:false', 'shared:sweep:false', 'doubles:boosts:true', 'doubles:tailwind:true']);
    expect(report.proposed.singles.tailwind).toBe(1);
    expect(report.proposed.doubles.bodies).toBe(report.proposed.singles.bodies);
    expect(report.proposed.doubles.boosts).toBe(report.weights[4].fit);
    expect(report.summary.pooled.logLossWins).toBe(3);
    expect(report.verdict.adopt).toBe(report.summary.pooled.meanBrierDelta <= 0);
    // From the true weights the refit cannot win every seed, and the rule keeps them.
    const kept = refitAtKReport(samples, names, [1.6, 0.6, 1, 0], [1.6, 1.2, 2.5, 0], K, { seeds: 3, folds: 5, draws: 10, minGames: 20 });
    expect(kept.verdict.adopt).toBe(false);
  });
});

