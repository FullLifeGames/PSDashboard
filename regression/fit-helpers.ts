/**
 * Shared probabilistic-scoring helpers for the fit (EVAL_FIT) and
 * calibration (EVAL_CALIBRATION) harnesses. One logistic model everywhere:
 * P(p1 wins) = sigmoid((k0 + k1·faintedFraction) · score). k1 = 0 recovers
 * the constant-K model the app shipped with.
 */
export interface OutcomeSample { score: number; faintedFraction: number; won: boolean }

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export const probOf = (s: OutcomeSample, k0: number, k1: number): number =>
  sigmoid((k0 + k1 * s.faintedFraction) * s.score);

export function brierScore(samples: OutcomeSample[], k0: number, k1 = 0): number {
  return samples.reduce((sum, s) => sum + (probOf(s, k0, k1) - (s.won ? 1 : 0)) ** 2, 0) / samples.length;
}

export function logLossScore(samples: OutcomeSample[], k0: number, k1 = 0): number {
  return samples.reduce((sum, s) => {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, probOf(s, k0, k1)));
    return sum - (s.won ? Math.log(p) : Math.log(1 - p));
  }, 0) / samples.length;
}

/**
 * 500-iteration GD — replaces the two inline fitters (eval-fit, eval-calibration).
 * One parameter, so the fixed step count does reach the maximum (checked in
 * round 47 on the bank and six of its subsets: K equal to four decimals against
 * Newton, 0.0 bp Brier apart). scripts/calibration-lib.mjs carries a copy that
 * must stay equal to the last bit.
 */
export function fitConstantK(samples: OutcomeSample[]): number {
  let k = 1.5;
  for (let iter = 0; iter < 500; iter++) {
    let grad = 0;
    for (const s of samples) grad += (probOf(s, k, 0) - (s.won ? 1 : 0)) * s.score / samples.length;
    k -= 1.0 * grad;
  }
  return k;
}

/**
 * Newton on the log-likelihood, run to a standstill (round 48). The 500 fixed
 * gradient steps this replaces stopped a fifth of the way along the slow
 * direction: the k1 column carries a tenth of k0's curvature (condition
 * number 34 to 41 on the fit corpus, about 8800 steps needed), so every K pin
 * up to round 47 read an intermediate state (singles 2.51/1.18 where the
 * maximum is 1.86/3.73). The damping keeps a one-phase sample at k1 = 0, the
 * step cap and the halving keep separable outcomes finite.
 */
export function fitPhaseK(samples: OutcomeSample[]): { k0: number; k1: number } {
  let k0 = 1.5;
  let k1 = 0;
  let loss = logLossScore(samples, k0, k1);
  for (let iter = 0; iter < 100; iter++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (const s of samples) {
      const p = probOf(s, k0, k1);
      const err = p - (s.won ? 1 : 0);
      const curvature = p * (1 - p) * s.score * s.score;
      g0 += err * s.score;
      g1 += err * s.score * s.faintedFraction;
      h00 += curvature;
      h01 += curvature * s.faintedFraction;
      h11 += curvature * s.faintedFraction * s.faintedFraction;
    }
    const damping = 1e-9 * (h00 + h11) + 1e-12;
    const det = (h00 + damping) * (h11 + damping) - h01 * h01;
    let d0 = ((h11 + damping) * g0 - h01 * g1) / det;
    let d1 = ((h00 + damping) * g1 - h01 * g0) / det;
    const shrink = Math.min(1, 10 / Math.hypot(d0, d1));
    d0 *= shrink;
    d1 *= shrink;
    let next = logLossScore(samples, k0 - d0, k1 - d1);
    for (let halving = 0; halving < 30 && next > loss; halving++) {
      d0 /= 2;
      d1 /= 2;
      next = logLossScore(samples, k0 - d0, k1 - d1);
    }
    k0 -= d0;
    k1 -= d1;
    loss = next;
    if (Math.hypot(d0, d1) < 1e-10) break;
  }
  return { k0, k1 };
}

export interface PhaseKSpread {
  k0: { se: number; lo: number; hi: number };
  k1: { se: number; lo: number; hi: number };
  /** K at faintedFraction 0, 1/3 and 2/3: k0 and k1 trade off against each other, the K they imply is the steadier reading. */
  at: { ff: number; k: number; lo: number; hi: number }[];
}

/** Game-clustered bootstrap of the phase fit: standard errors and 90 % bands (round 48). */
export function bootstrapPhaseK(
  samples: (OutcomeSample & { game: string })[], draws: number, seed: number,
): PhaseKSpread {
  const byGame = new Map<string, OutcomeSample[]>();
  for (const sample of samples) byGame.set(sample.game, [...(byGame.get(sample.game) ?? []), sample]);
  const games = [...byGame.keys()].sort();
  const rng = mulberry32(seed);
  const fits: { k0: number; k1: number }[] = [];
  for (let draw = 0; draw < draws; draw++) {
    const resample: OutcomeSample[] = [];
    for (let pick = 0; pick < games.length; pick++) resample.push(...byGame.get(games[Math.floor(rng() * games.length)])!);
    fits.push(fitPhaseK(resample));
  }
  const spread = (values: number[]) => {
    const sorted = [...values].sort((x, y) => x - y);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      se: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length),
      lo: sorted[Math.floor(0.05 * values.length)],
      hi: sorted[Math.ceil(0.95 * values.length) - 1],
    };
  };
  const point = fitPhaseK(samples);
  return {
    k0: spread(fits.map(fit => fit.k0)),
    k1: spread(fits.map(fit => fit.k1)),
    at: [0, 1 / 3, 2 / 3].map(ff => {
      const { lo, hi } = spread(fits.map(fit => fit.k0 + fit.k1 * ff));
      return { ff, k: point.k0 + point.k1 * ff, lo, hi };
    }),
  };
}

export const phaseBucket = (ff: number): 'early' | 'mid' | 'late' =>
  ff < 1 / 6 ? 'early' : ff < 1 / 2 ? 'mid' : 'late';

/** Deterministic PRNG shared by the fit bootstrap and the CV fold shuffle. */
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LogisticSample { g: number[]; won: boolean }
export interface CvSample extends LogisticSample { game: string }

/**
 * Logistic regression on standardized features; deterministic fixed-iteration GD.
 * The standardization keeps the problem well conditioned: on the 18 Sep capture
 * 500 steps, 5000 steps and Newton give the same implied weights to one decimal
 * (round 48 sighting, all / singles / doubles).
 */
export function fitLogistic(samples: LogisticSample[]): {
  beta: number[]; intercept: number; sigma: number[]; mu: number[];
} {
  const n = samples.length;
  const k = samples[0]?.g.length ?? 0;
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
      const err = p - (samples[i].won ? 1 : 0);
      for (let j = 0; j < k; j++) gradBeta[j] += err * z[i][j] / n;
      gradIntercept += err / n;
    }
    for (let j = 0; j < k; j++) beta[j] -= lr * gradBeta[j];
    intercept -= lr * gradIntercept;
  }
  return { beta, intercept, sigma, mu };
}

/**
 * Deterministic game-clustered fold assignment: sorted game list,
 * seeded Fisher-Yates, round-robin over k folds. Sorting first makes the
 * assignment independent of caller iteration order.
 */
export function assignFolds(games: string[], k: number, seed: number): Map<string, number> {
  const order = [...games].sort();
  const rng = mulberry32(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return new Map(order.map((game, index) => [game, index % k]));
}

/**
 * Zeroes the dropped columns — for the standardized logistic fit this is
 * equivalent to excluding the regressor (a constant-zero column keeps
 * beta 0 via the sigma||1 guard) while g-vector length and FEATURE_KEYS
 * indexing stay stable.
 */
export function maskColumns(g: number[], drop: ReadonlySet<number>): number[] {
  return drop.size === 0 ? g : g.map((value, j) => (drop.has(j) ? 0 : value));
}

/**
 * Game-clustered k-fold CV: fit on train folds, score out-of-fold with the
 * TRAIN standardization (mu/sigma never leak from test). Returns pooled
 * per-position mean logloss/brier over all test positions.
 */
export function crossValidate(
  samples: CvSample[], k: number, seed: number, drop: ReadonlySet<number>,
): { logLoss: number; brier: number } {
  const folds = assignFolds([...new Set(samples.map(sample => sample.game))], k, seed);
  let logLoss = 0;
  let brier = 0;
  let n = 0;
  for (let fold = 0; fold < k; fold++) {
    const train = samples.filter(sample => folds.get(sample.game) !== fold)
      .map(sample => ({ g: maskColumns(sample.g, drop), won: sample.won }));
    const test = samples.filter(sample => folds.get(sample.game) === fold);
    if (train.length === 0 || test.length === 0) continue;
    const fit = fitLogistic(train);
    for (const sample of test) {
      const g = maskColumns(sample.g, drop);
      const zSum = fit.intercept +
        g.reduce((sum, value, j) => sum + ((value - fit.mu[j]) / fit.sigma[j]) * fit.beta[j], 0);
      const p = Math.min(1 - 1e-6, Math.max(1e-6, sigmoid(zSum)));
      logLoss -= sample.won ? Math.log(p) : Math.log(1 - p);
      brier += (p - (sample.won ? 1 : 0)) ** 2;
      n += 1;
    }
  }
  return { logLoss: logLoss / n, brier: brier / n };
}
