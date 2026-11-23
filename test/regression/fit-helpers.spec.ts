import { test, expect, describe } from 'vitest';
import {
  assignFolds,
  atKScore,
  bootstrapPhaseK,
  bootstrapWeightsAtK,
  brierScore,
  crossValidate,
  crossValidateAtK,
  fitConstantK,
  fitLogistic,
  fitPhaseK,
  fitWeightsAtK,
  layoutOf,
  logLossScore,
  maskColumns,
  phaseBucket,
  probOf,
  refitAtKReport,
  supportOf,
  type AtKSample,
  type CvSample,
} from './fit-helpers';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  asScore,
  bandLines,
  bankVerdict,
  brier,
  compareSamples,
  fitConstantK as fitConstantKJs,
  load,
  mergeDumps,
  ownKBands,
  pairedBands,
  sortSamples,
  summarize,
  takeFieldArgs,
} from '../../scripts/calibration-lib.mjs';



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

  // Round 65: the pre-registered holds (the two sign-unsure weights and the boost weights of variant E) are a report option.
  test('a held weight keeps its start in the fit, the bands and the proposal', () => {
    const samples = corpus([1.6, 0.6, 1, 0], [1.6, 1.2, 2.5, 0], 600, 5);
    const names = ['bodies', 'boosts', 'tailwind', 'sweep'];
    const report = refitAtKReport(samples, names, [1, 1, 1, 0], [1, 0.5, 2, 0], K,
      { seeds: 2, folds: 5, draws: 5, minGames: 20, hold: { shared: ['boosts'], doubles: ['tailwind'] } });
    const weight = (table: string, name: string) => report.weights.find(entry => entry.table === table && entry.name === name)!;
    expect(weight('shared', 'boosts')).toMatchObject({ free: false, fit: 1, se: 0 });
    expect(weight('doubles', 'tailwind')).toMatchObject({ free: false, fit: 2, se: 0 });
    expect(weight('doubles', 'boosts').free).toBe(true);
    expect(weight('shared', 'bodies').free).toBe(true);
    expect(report.proposed.singles.boosts).toBe(1);
    expect(report.proposed.doubles.tailwind).toBe(2);
  });

  test('a doubles hold on a weight the doubles table shares with singles is an error', () => {
    const samples = corpus([1.6, 0.6, 1, 0], [1.6, 1.2, 2.5, 0], 100, 5);
    const names = ['bodies', 'boosts', 'tailwind', 'sweep'];
    expect(() => refitAtKReport(samples, names, [1, 1, 1, 0], [1, 0.5, 2, 0], K,
      { seeds: 1, folds: 5, draws: 1, minGames: 20, hold: { doubles: ['bodies'] } })).toThrow(/no doubles override/);
  });
});

const FIXTURE = fileURLToPath(new URL('./fixtures/calibration-summary-fixture.jsonl', import.meta.url));

interface Sample {
  id: string;
  turn: number;
  phase: 'early' | 'mid' | 'late';
  gameType: 'singles' | 'doubles';
  score: number;
  faintedFraction: number;
  p1Won: boolean;
}

const SORTED_ORDER = [
  'gen9ou-1#4', 'gen9ou-1#7', 'gen9ou-1#11', 'gen9ou-2#3', 'gen9ou-2#9', 'gen9ou-2#14',
  'gen9vgc-1#2', 'gen9vgc-1#5', 'gen9vgc-1#9', 'gen9vgc-2#3', 'gen9vgc-2#6', 'gen9vgc-2#10',
];

describe('calibration lib', () => {
  test('summarize prints the harness aggregate, line for line (counts checked by hand)', () => {
    const samples = sortSamples(load(FIXTURE) as Sample[]);
    expect(samples).toHaveLength(12);
    // Sign accuracy by hand: early 2/4, mid 3/4, late 4/4; singles 6/6, doubles 3/6;
    // |score| buckets 2/3, 2/2, 2/4, 3/3.
    expect(summarize(samples)).toEqual([
      'early: n=4 sign-accuracy=50% mean|score|=0.24',
      'mid: n=4 sign-accuracy=75% mean|score|=0.31',
      'late: n=4 sign-accuracy=100% mean|score|=0.81',
      'singles: n=6 sign-accuracy=100%',
      'doubles: n=6 sign-accuracy=50%',
      'winprob K: pooled=2.26 singles=11.45 doubles=0.77',
      'early brier=0.3017',
      'mid brier=0.2527',
      'late brier=0.0213',
      'luck-adjusted: n=12 excluded=0 brier early/mid/late=0.3017/0.2527/0.0213',
      '|score| 0.0–0.2: n=3 favored-side-wins=67%',
      '|score| 0.2–0.4: n=2 favored-side-wins=100%',
      '|score| 0.4–0.7: n=4 favored-side-wins=50%',
      '|score| 0.7–1.0: n=3 favored-side-wins=100%',
    ]);
  });

  test('the decided line reads like the harness line; a dump from before round 50 prints the raw share only', () => {
    const base = sortSamples(load(FIXTURE) as Sample[]);
    const winner = (sample: Sample) => (sample.p1Won ? 'p1' : 'p2');
    const loser = (sample: Sample) => (sample.p1Won ? 'p2' : 'p1');
    const older = base.map((sample, index) => ({ ...sample, decided: index < 3 ? winner(sample) : index === 3 ? loser(sample) : null }));
    const named = older.map((sample, index) => ({ ...sample, decidedHeld: index < 2 ? sample.decided : null }));
    expect(summarize(named).at(-1)).toBe('decided: n=4 named-side-wins=75.0% | held by the bar: n=2 named-side-wins=100.0%');
    expect(summarize(older).at(-1)).toBe('decided: n=4 named-side-wins=75.0%');
  });

  test('the fit and the Brier are the fit-helpers.ts numbers to the last bit', () => {
    const samples = sortSamples(load(FIXTURE) as Sample[]);
    const outcomes = samples.map(sample => ({ score: sample.score, faintedFraction: sample.faintedFraction, won: sample.p1Won }));
    const k = fitConstantK(outcomes);
    expect(fitConstantKJs(outcomes)).toBe(k);
    for (const phase of ['early', 'mid', 'late'] as const) {
      const subset = outcomes.filter((_, index) => samples[index].phase === phase);
      expect(brier(subset, k)).toBe(brierScore(subset, k));
    }
  });

  test('samples order by replay id in code units, then turn, and merged slices land in that order', () => {
    const samples = load(FIXTURE) as Sample[];
    expect(sortSamples(samples).map(sample => `${sample.id}#${sample.turn}`)).toEqual(SORTED_ORDER);
    // Code units, not locale collation: the hyphen sorts before every digit.
    expect(compareSamples({ id: 'a-1', turn: 1 }, { id: 'a1', turn: 1 })).toBeLessThan(0);
    expect(compareSamples({ id: 'x', turn: 12 }, { id: 'x', turn: 3 })).toBeGreaterThan(0);

    const dir = mkdtempSync(join(tmpdir(), 'calibration-lib-'));
    const slices = [0, 1, 2].map(slice => {
      const path = join(dir, `slice-${slice}.jsonl`);
      writeFileSync(path, samples.filter((_, index) => index % 3 === slice).map(sample => JSON.stringify(sample)).join('\n') + '\n');
      return path;
    });
    expect(mergeDumps(slices).map(sample => `${sample.id}#${sample.turn}`)).toEqual(SORTED_ORDER);
    expect(mergeDumps(slices)).toEqual(sortSamples(samples));
  });

  // Round 65 (D26): the doubles verdict reads the bank's dump together with the holdout's, one comma list per side.
  test('a comma list loads every dump in order, a single path loads one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'calibration-lib-'));
    const bank = join(dir, 'bank.jsonl');
    const holdout = join(dir, 'holdout.jsonl');
    writeFileSync(bank, `${JSON.stringify({ id: 'gen9ou-1', turn: 2 })}\n`);
    writeFileSync(holdout, `${JSON.stringify({ id: 'gen9doublesou-2', turn: 3 })}\n\n${JSON.stringify({ id: 'gen9vgc2026regi-3', turn: 4 })}\n`);
    const keys = (samples: { id: string; turn: number }[]) => samples.map(sample => `${sample.id}#${sample.turn}`);
    expect(keys(load(`${bank},${holdout}`))).toEqual(['gen9ou-1#2', 'gen9doublesou-2#3', 'gen9vgc2026regi-3#4']);
    expect(keys(load(holdout))).toEqual(['gen9doublesou-2#3', 'gen9vgc2026regi-3#4']);
  });

  // Round 67 (T114): one bank run pairs the root's solved game value against its score.
  test('a field flag reads another number as the score; a sample without it keeps its score', () => {
    const { argv, aField, bField } = takeFieldArgs(['a.jsonl', '--b-field', 'gameValue', 'b.jsonl', '--quality', 'hq']);
    expect(argv).toEqual(['a.jsonl', 'b.jsonl', '--quality', 'hq']);
    expect([aField, bField]).toEqual([null, 'gameValue']);
    expect(takeFieldArgs(['--a-field', 'gameValue', 'a.jsonl', 'b.jsonl'])).toEqual({ argv: ['a.jsonl', 'b.jsonl'], aField: 'gameValue', bField: null });
    const samples = [{ id: 'gen9ou-1', turn: 2, score: 0.4, gameValue: 0.9 }, { id: 'gen9ou-1', turn: 5, score: -0.2, gameValue: null }];
    expect(asScore(samples, 'gameValue').map(sample => sample.score)).toEqual([0.9, -0.2]);
    expect(asScore(samples, null)).toBe(samples);
    expect(() => takeFieldArgs(['a.jsonl', 'b.jsonl', '--b-field'])).toThrow('--b-field expects a field name');
  });
});

/**
 * Round 48: a paired verdict carries its error bar. One replay yields up to
 * eight positions with ONE outcome, so the bootstrap resamples replays, not
 * positions, and a row reads as a verdict only when its band clears zero.
 */
describe('paired bands (round 48)', () => {
  interface BankSample extends Sample { quality: 'hq' | 'std'; luckAgainstFavored: boolean }
  interface BandRow {
    view: string; gameType: string; phase: string; n: number; games: number;
    meanBp: number; loBp: number; hiBp: number; seBp: number; pBetter: number; reading: string;
  }

  // 30 replays of four positions: every third replay doubles, every second hq, every fifth luck-flagged.
  const bank = (): BankSample[] => {
    let seed = 11;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const samples: BankSample[] = [];
    for (let game = 0; game < 30; game++) {
      const p1Won = rand() < 0.5;
      (['early', 'mid', 'late', 'late'] as const).forEach((phase, index) => {
        const lean = (p1Won ? 1 : -1) * (0.1 + 0.2 * index);
        samples.push({
          id: `game-${String(game).padStart(2, '0')}`, turn: 3 + 4 * index, phase,
          gameType: game % 3 === 0 ? 'doubles' : 'singles',
          score: Math.max(-0.95, Math.min(0.95, lean + (rand() - 0.5) * 0.8)),
          faintedFraction: index / 4, p1Won,
          quality: game % 2 === 0 ? 'hq' : 'std', luckAgainstFavored: game % 5 === 0,
        });
      });
    }
    return samples;
  };
  const against = (sample: BankSample, by: number): BankSample =>
    ({ ...sample, score: Math.max(-0.99, Math.min(0.99, sample.score + (sample.p1Won ? -by : by))) });
  const rowOf = (rows: BandRow[], view: string, gameType: string, phase: string): BandRow =>
    rows.find(row => row.view === view && row.gameType === gameType && row.phase === phase)!;

  test('a dump against itself reads unmoved on every row, band [0, 0]', () => {
    const result = pairedBands(bank(), bank());
    expect(result.joined).toBe(120);
    expect(result.rows.map((row: BandRow) => row.view)).toEqual(expect.arrayContaining(['full', 'hq', 'luck-adjusted']));
    for (const row of result.rows as BandRow[]) {
      expect(Math.abs(row.meanBp) + Math.abs(row.loBp) + Math.abs(row.hiBp)).toBe(0);
      expect(row.reading).toBe('unmoved');
    }
    const lines = bandLines(result);
    expect(lines[0]).toContain('joined n=120');
    expect(lines[1]).toBe(' full:');
    // Pooled rows come first: all phases, then per game type.
    expect(lines[2]).toBe('   all      all       +0 [+0, +0]  se 0  n=120/30g  P(B better)=0%  unmoved');
    expect(lines[3].startsWith('   singles  all ')).toBe(true);
    expect(lines.at(-1)).toBe('bank verdict: no gain resolved; no harm; no warnings');
  });

  test('a constructed offset lies inside its band, under the fixed K of the A side', () => {
    const a = bank();
    const b = a.map(sample => against(sample, 0.3));
    const result = pairedBands(a, b);
    const outcomes = (samples: BankSample[]) => samples.map(sample => ({ score: sample.score, won: sample.p1Won }));
    expect(result.k).toBe(fitConstantKJs(outcomes(a)));
    const pooled = rowOf(result.rows, 'full', 'all', 'all');
    expect(pooled.meanBp).toBeCloseTo((brier(outcomes(b), result.k) - brier(outcomes(a), result.k)) * 10000, 6);
    expect(pooled.loBp).toBeLessThanOrEqual(pooled.meanBp);
    expect(pooled.hiBp).toBeGreaterThanOrEqual(pooled.meanBp);
    expect(pooled.loBp).toBeGreaterThan(0);
    expect(pooled.reading).toBe('B worse');
    expect(pooled.pBetter).toBe(0);
    const verdict = bankVerdict(result);
    expect(verdict.gain).toHaveLength(0);
    expect(verdict.harm.map((row: BandRow) => `${row.view} ${row.gameType}`)).toContain('full singles');
    // The mirror image reads as a gain.
    const mirrored = pairedBands(b, a);
    expect(rowOf(mirrored.rows, 'full', 'all', 'all').reading).toBe('B better');
    expect(bankVerdict(mirrored).gain.length).toBeGreaterThan(0);
    expect(bandLines(mirrored).at(-1)).toContain('bank verdict: gain on full all');
  });

  test('one replay moving all of its positions is no verdict: the band resamples replays', () => {
    const a = bank();
    const b = a.map(sample => (sample.id === 'game-05' ? against(sample, 0.6) : sample));
    const result = pairedBands(a, b);
    const pooled = rowOf(result.rows, 'full', 'all', 'all');
    expect([pooled.n, pooled.games]).toEqual([120, 30]);
    expect(pooled.meanBp).toBeGreaterThan(0);
    // A third of the draws leave the one moved replay out, so the low end stays at zero.
    expect(pooled.loBp).toBe(0);
    expect(pooled.reading).toBe('unresolved');
    expect([rowOf(result.rows, 'full', 'singles', 'all').games, rowOf(result.rows, 'full', 'doubles', 'all').games]).toEqual([20, 10]);
    expect(rowOf(result.rows, 'hq', 'all', 'all').games).toBe(15);
    expect(rowOf(result.rows, 'luck-adjusted', 'all', 'all').games).toBe(24);
    expect(rowOf(result.rows, 'full', 'doubles', 'all').reading).toBe('unmoved');
  });

  // Round 49: a fix that moved 38 of 833 positions read +1 bp [+0, +2], resolved and irrelevant.
  test('harm and warnings need size: a resolved shift under 5 bp is a note', () => {
    const a = bank();
    const small = pairedBands(a, a.map(sample => against(sample, 0.0001)));
    const pooled = rowOf(small.rows, 'full', 'all', 'all');
    expect(pooled.reading).toBe('B worse');
    expect(pooled.meanBp).toBeLessThan(5);
    const verdict = bankVerdict(small);
    expect([verdict.harm.length, verdict.warnings.length]).toEqual([0, 0]);
    expect(verdict.notes.map((row: BandRow) => `${row.view} ${row.gameType} ${row.phase}`)).toContain('full all all');
    const line = bandLines(small).at(-1);
    expect(line).toContain('no harm');
    expect(line).toContain('resolved under 5 bp: full all (+');
    // The offset of the earlier test is far above the floor and stays harm.
    expect(bankVerdict(pairedBands(a, a.map(sample => against(sample, 0.3)))).notes).toHaveLength(0);
  });

  /**
   * Round 62 (D25): under one fixed K the bank pays for scale. A root that
   * reads doubles early flatter and late steeper wins on the bank without a
   * single better decision (doubles −35 bp from rescaling alone). The second
   * table gives each side its own K per game type and phase, so only a
   * better ordering of the positions reads as a gain.
   */
  describe('own K per phase (round 63, T52 step 1)', () => {
    const scaled = (samples: BankSample[], gameType: string, phase: string, by: number) =>
      samples.map(sample => (sample.gameType === gameType && sample.phase === phase ? { ...sample, score: sample.score * by } : sample));

    test('a dump against itself reads unmoved on every row', () => {
      const result = ownKBands(bank(), bank());
      expect(result.joined).toBe(120);
      expect(result.rows.length).toBe(pairedBands(bank(), bank()).rows.length);
      for (const row of result.rows as BandRow[]) {
        expect(Math.abs(row.meanBp) + Math.abs(row.loBp) + Math.abs(row.hiBp)).toBe(0);
        expect(row.reading).toBe('unmoved');
      }
    });

    test('a pure rescale of one cell is no gain and no harm, while the fixed K reads it', () => {
      const a = bank();
      const b = scaled(a, 'singles', 'early', 0.5);
      const fixed = rowOf(pairedBands(a, b).rows, 'full', 'singles', 'early');
      expect(Math.abs(fixed.meanBp)).toBeGreaterThan(1);
      const result = ownKBands(a, b);
      for (const row of result.rows as BandRow[]) {
        expect(Math.abs(row.meanBp)).toBeLessThan(0.001);
        expect(row.reading).not.toBe('B better');
        expect(row.reading).not.toBe('B worse');
      }
      expect(result.k.b.singles.early).toBeCloseTo(2 * result.k.a.singles.early, 6);
      expect(bandLines(result).at(-1)).toBe('bank verdict, own K per phase: no gain resolved; no harm; no warnings');
    });

    test('a better ordering survives its own K: scores toward the winner read as a gain, the mirror as harm', () => {
      const a = bank();
      const b = a.map(sample => against(sample, -0.3));
      const result = ownKBands(a, b);
      expect(rowOf(result.rows, 'full', 'all', 'all').reading).toBe('B better');
      expect(bankVerdict(result).gain.length).toBeGreaterThan(0);
      const mirrored = ownKBands(b, a);
      expect(rowOf(mirrored.rows, 'full', 'all', 'all').reading).toBe('B worse');
      expect(bandLines(mirrored).at(-1)).toContain('bank verdict, own K per phase: no gain resolved; HARM on full all');
    });

    test('each K is the maximum-likelihood fit of its game type and phase; a cell with every sign right stops at 50', () => {
      const a = bank();
      const result = ownKBands(a, a.map(sample => against(sample, 0.1)));
      const capped: string[] = [];
      for (const gameType of ['singles', 'doubles'] as const) {
        for (const phase of ['early', 'mid', 'late'] as const) {
          const k = result.k.a[gameType][phase];
          const cell = a.filter(sample => sample.gameType === gameType && sample.phase === phase);
          if (cell.every(sample => (sample.score > 0) === sample.p1Won)) {
            capped.push(`${gameType} ${phase}`);
            expect(k).toBe(50);
            continue;
          }
          const gradient = cell.reduce((sum, sample) =>
            sum + (1 / (1 + Math.exp(-k * sample.score)) - (sample.p1Won ? 1 : 0)) * sample.score, 0);
          expect(Math.abs(gradient)).toBeLessThan(1e-8);
        }
      }
      // The fixture leans its late positions hard: both late cells carry no wrong sign.
      expect(capped).toEqual(['singles late', 'doubles late']);
    });

    test('a score that runs against the outcomes earns no credit by flipping its sign: K stops at 0', () => {
      const a = bank();
      const flipped = a.map(sample => ({ ...sample, score: -sample.score }));
      const result = ownKBands(a, flipped, { draws: 50 });
      expect(result.k.b.singles.early).toBe(0);
      expect(rowOf(result.rows, 'full', 'all', 'all').reading).toBe('B worse');
    });

    test('the table names its K per side and cell, and its verdict line says which table it is', () => {
      const a = bank();
      const lines = bandLines(ownKBands(a, a.map(sample => against(sample, 0.1))));
      expect(lines[0]).toContain('own K per game type and phase, refit in every draw');
      expect(lines[1]).toMatch(/^ K A singles (\d+\.\d\d\/){2}\d+\.\d\d doubles (\d+\.\d\d\/){2}\d+\.\d\d \| K B singles /);
      expect(lines[2]).toBe(' full:');
      expect(lines.at(-1)!.startsWith('bank verdict, own K per phase: ')).toBe(true);
    });
  });

  test('the seed fixes the draws', () => {
    let seed = 5;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const a = bank();
    const b = a.map(sample => ({ ...sample, score: Math.max(-0.99, Math.min(0.99, sample.score + (rand() - 0.5) * 0.4)) }));
    const first = pairedBands(a, b, { seed: 7 });
    expect(pairedBands(a, b, { seed: 7 })).toEqual(first);
    const other = rowOf(pairedBands(a, b, { seed: 8 }).rows, 'full', 'all', 'all');
    const same = rowOf(first.rows, 'full', 'all', 'all');
    expect(other.meanBp).toBe(same.meanBp);
    expect([other.loBp, other.hiBp]).not.toEqual([same.loBp, same.hiBp]);
  });
});
