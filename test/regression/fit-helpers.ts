/** One model everywhere: P(p1 wins) = sigmoid((k0 + k1·faintedFraction) · score); k1 = 0 is the constant-K model. */
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

/** scripts/calibration-lib.mjs carries a copy of this fit that must stay equal to the last bit. */
export function fitConstantK(samples: OutcomeSample[]): number {
  let k = 1.5;
  for (let iter = 0; iter < 500; iter++) {
    let grad = 0;
    for (const s of samples) grad += (probOf(s, k, 0) - (s.won ? 1 : 0)) * s.score / samples.length;
    k -= 1.0 * grad;
  }
  return k;
}

/** Run to a standstill: fixed gradient steps stop a fifth of the way along the slow direction. */
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
  /** K at faintedFraction 0, 1/3 and 2/3: k0 and k1 trade off, so the K they imply is the steadier reading. */
  at: { ff: number; k: number; lo: number; hi: number }[];
}

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

export function assignFolds(games: string[], k: number, seed: number): Map<string, number> {
  const order = [...games].sort();
  const rng = mulberry32(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return new Map(order.map((game, index) => [game, index % k]));
}

/** A constant-zero column keeps beta 0 through the sigma||1 guard. */
export function maskColumns(g: number[], drop: ReadonlySet<number>): number[] {
  return drop.size === 0 ? g : g.map((value, j) => (drop.has(j) ? 0 : value));
}

/** Scores out-of-fold with the TRAIN standardization: mu and sigma never leak from the test fold. */
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

export interface PhaseK { k0: number; k1: number }
export interface GameTypeK { singles: PhaseK; doubles: PhaseK }

export interface AtKSample { g: number[]; won: boolean; doubles: boolean; faintedFraction: number; game: string }

/** Parameters: the shared weights in column order, then the doubles overrides; columns at 0 in both tables are held. */
export interface WeightLayout { columns: number; overrides: number[]; held: ReadonlySet<number> }

export function layoutOf(singles: number[], doubles: number[]): { layout: WeightLayout; start: number[] } {
  const overrides = singles.flatMap((weight, j) => (doubles[j] !== weight ? [j] : []));
  const held = new Set(singles.flatMap((weight, j) => (weight === 0 && doubles[j] === 0 ? [j] : [])));
  return { layout: { columns: singles.length, overrides, held }, start: [...singles, ...overrides.map(j => doubles[j])] };
}

function columnParams(layout: WeightLayout): { singles: number[]; doubles: number[] } {
  const singles = Array.from({ length: layout.columns }, (_, j) => j);
  const doubles = singles.map(j => {
    const override = layout.overrides.indexOf(j);
    return override >= 0 ? layout.columns + override : j;
  });
  return { singles, doubles };
}

const tanhArgument = (g: number[], theta: number[], params: number[]): number => {
  let sum = 0;
  for (let j = 0; j < g.length; j++) sum += theta[params[j]] * g[j];
  return sum;
};

export function atKScore(sample: AtKSample, theta: number[], layout: WeightLayout): number {
  const params = columnParams(layout);
  return Math.tanh(tanhArgument(sample.g, theta, sample.doubles ? params.doubles : params.singles));
}

const kOf = (sample: AtKSample, k: GameTypeK): number => {
  const phase = sample.doubles ? k.doubles : k.singles;
  return phase.k0 + phase.k1 * sample.faintedFraction;
};

export function supportOf(samples: AtKSample[], layout: WeightLayout, minGames: number): boolean[] {
  const params = columnParams(layout);
  const games = Array.from({ length: layout.columns + layout.overrides.length }, () => new Set<string>());
  for (const sample of samples) {
    const map = sample.doubles ? params.doubles : params.singles;
    sample.g.forEach((value, j) => { if (value !== 0) games[map[j]].add(sample.game); });
  }
  return games.map((seen, m) => !layout.held.has(m < layout.columns ? m : layout.overrides[m - layout.columns]) && seen.size >= minGames);
}

interface AtKPass { loss: number; grad: number[]; hess: number[][] }

function atKPass(samples: AtKSample[], theta: number[], layout: WeightLayout, k: GameTypeK, free: number[]): AtKPass {
  const params = columnParams(layout);
  const slot = new Map(free.map((m, i) => [m, i]));
  const grad = free.map(() => 0);
  const hess = free.map(() => free.map(() => 0));
  const x = free.map(() => 0);
  let loss = 0;
  for (const sample of samples) {
    const map = sample.doubles ? params.doubles : params.singles;
    const s = Math.tanh(tanhArgument(sample.g, theta, map));
    const kk = kOf(sample, k);
    const p = 1 / (1 + Math.exp(-kk * s));
    const clamped = Math.min(1 - 1e-6, Math.max(1e-6, p));
    loss -= sample.won ? Math.log(clamped) : Math.log(1 - clamped);
    x.fill(0);
    const slope = kk * (1 - s * s);
    sample.g.forEach((value, j) => { const i = slot.get(map[j]); if (i !== undefined) x[i] += slope * value; });
    const err = p - (sample.won ? 1 : 0);
    const curvature = p * (1 - p);
    for (let a = 0; a < x.length; a++) {
      grad[a] += err * x[a];
      for (let b = 0; b < x.length; b++) hess[a][b] += curvature * x[a] * x[b];
    }
  }
  return { loss, grad, hess };
}

const atKLoss = (samples: AtKSample[], theta: number[], layout: WeightLayout, k: GameTypeK): number =>
  atKPass(samples, theta, layout, k, []).loss;

function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      for (let c = col; c <= n; c++) a[row][c] -= factor * a[col][c];
    }
  }
  const d = Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let c = row + 1; c < n; c++) sum -= a[row][c] * d[c];
    d[row] = sum / a[row][row];
  }
  return d;
}

export function fitWeightsAtK(samples: AtKSample[], start: number[], layout: WeightLayout, k: GameTypeK, free: boolean[]): number[] {
  const theta = [...start];
  const moving = free.flatMap((isFree, m) => (isFree ? [m] : []));
  if (moving.length === 0 || samples.length === 0) return theta;
  let pass = atKPass(samples, theta, layout, k, moving);
  for (let iter = 0; iter < 100; iter++) {
    const trace = pass.hess.reduce((sum, row, i) => sum + row[i], 0);
    const damped = pass.hess.map((row, i) => row.map((value, j) => value + (i === j ? 1e-9 * trace + 1e-12 : 0)));
    let step = solve(damped, pass.grad);
    const shrink = Math.min(1, 10 / Math.hypot(...step));
    step = step.map(value => value * shrink);
    const moved = (scale: number) => theta.map((value, m) => { const i = moving.indexOf(m); return i < 0 ? value : value - scale * step[i]; });
    let scale = 1;
    let next = atKLoss(samples, moved(scale), layout, k);
    for (let halving = 0; halving < 30 && next > pass.loss; halving++) next = atKLoss(samples, moved(scale /= 2), layout, k);
    if (next > pass.loss) break;
    moved(scale).forEach((value, m) => { theta[m] = value; });
    if (Math.hypot(...step) * scale < 1e-10) break;
    pass = atKPass(samples, theta, layout, k, moving);
  }
  return theta;
}

export interface AtKCell { logLoss: number; brier: number; n: number }
export interface AtKScores extends AtKCell { singles: AtKCell; doubles: AtKCell }

function atKScorer(layout: WeightLayout, k: GameTypeK) {
  const params = columnParams(layout);
  const cells = { all: { logLoss: 0, brier: 0, n: 0 }, singles: { logLoss: 0, brier: 0, n: 0 }, doubles: { logLoss: 0, brier: 0, n: 0 } };
  const add = (sample: AtKSample, theta: number[]) => {
    const s = Math.tanh(tanhArgument(sample.g, theta, sample.doubles ? params.doubles : params.singles));
    const p = Math.min(1 - 1e-6, Math.max(1e-6, 1 / (1 + Math.exp(-kOf(sample, k) * s))));
    const logLoss = sample.won ? -Math.log(p) : -Math.log(1 - p);
    const brier = (p - (sample.won ? 1 : 0)) ** 2;
    for (const cell of [cells.all, sample.doubles ? cells.doubles : cells.singles]) {
      cell.logLoss += logLoss;
      cell.brier += brier;
      cell.n += 1;
    }
  };
  const mean = (cell: AtKCell): AtKCell => ({ logLoss: cell.logLoss / (cell.n || 1), brier: cell.brier / (cell.n || 1), n: cell.n });
  const scores = (): AtKScores => ({ ...mean(cells.all), singles: mean(cells.singles), doubles: mean(cells.doubles) });
  return { add, scores };
}

export function scoreAtK(samples: AtKSample[], theta: number[], layout: WeightLayout, k: GameTypeK): AtKScores {
  const scorer = atKScorer(layout, k);
  for (const sample of samples) scorer.add(sample, theta);
  return scorer.scores();
}

export function crossValidateAtK(
  samples: AtKSample[], folds: number, seed: number, start: number[], layout: WeightLayout, k: GameTypeK, free: boolean[],
): { hand: AtKScores; fit: AtKScores } {
  const assignment = assignFolds([...new Set(samples.map(sample => sample.game))], folds, seed);
  const hand = atKScorer(layout, k);
  const fit = atKScorer(layout, k);
  for (let fold = 0; fold < folds; fold++) {
    const train = samples.filter(sample => assignment.get(sample.game) !== fold);
    const test = samples.filter(sample => assignment.get(sample.game) === fold);
    if (train.length === 0 || test.length === 0) continue;
    const theta = fitWeightsAtK(train, start, layout, k, free);
    for (const sample of test) {
      hand.add(sample, start);
      fit.add(sample, theta);
    }
  }
  return { hand: hand.scores(), fit: fit.scores() };
}

export interface WeightBand { mean: number; se: number; lo: number; hi: number }

export function bootstrapWeightsAtK(
  samples: AtKSample[], draws: number, seed: number, start: number[], layout: WeightLayout, k: GameTypeK, free: boolean[],
): WeightBand[] {
  const byGame = new Map<string, AtKSample[]>();
  for (const sample of samples) byGame.set(sample.game, [...(byGame.get(sample.game) ?? []), sample]);
  const games = [...byGame.keys()].sort();
  const rng = mulberry32(seed);
  const fits: number[][] = [];
  for (let draw = 0; draw < draws; draw++) {
    const resample: AtKSample[] = [];
    for (let pick = 0; pick < games.length; pick++) resample.push(...byGame.get(games[Math.floor(rng() * games.length)])!);
    fits.push(fitWeightsAtK(resample, start, layout, k, free));
  }
  return start.map((value, m) => {
    if (!free[m]) return { mean: value, se: 0, lo: value, hi: value };
    const values = fits.map(fit => fit[m]);
    const sorted = [...values].sort((x, y) => x - y);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const se = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
    return { mean, se, lo: sorted[Math.floor(0.05 * values.length)], hi: sorted[Math.ceil(0.95 * values.length) - 1] };
  });
}

export interface AtKReportOptions {
  seeds: number;
  folds: number;
  draws: number;
  minGames: number;
  hold?: { shared?: string[]; doubles?: string[] };
  only?: string[];
  /** Start weights by column in both tables; a replacement starts the new column at the old weight, the old at 0. */
  set?: Record<string, number>;
  /** The weights of the capture where they differ from today's tables; only the identity check starts from them. */
  captured?: Record<string, number>;
}

const meanOf = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function cvSummary(cv: { hand: AtKScores; fit: AtKScores }[]) {
  const side = (pick: (scores: AtKScores) => AtKCell) => ({
    logLossWins: cv.filter(run => pick(run.fit).logLoss < pick(run.hand).logLoss).length,
    brierWins: cv.filter(run => pick(run.fit).brier < pick(run.hand).brier).length,
    meanLogLossDelta: meanOf(cv.map(run => pick(run.fit).logLoss - pick(run.hand).logLoss)),
    meanBrierDelta: meanOf(cv.map(run => pick(run.fit).brier - pick(run.hand).brier)),
  });
  return { pooled: side(scores => scores), singles: side(scores => scores.singles), doubles: side(scores => scores.doubles) };
}

export function refitAtKReport(
  samples: AtKSample[], names: string[], singles: number[], doubles: number[], k: GameTypeK, options: AtKReportOptions,
) {
  const column = (name: string) => {
    const index = names.indexOf(name);
    if (index < 0) throw new Error(`hold: no weight named ${name}`);
    return index;
  };
  for (const name of Object.keys(options.set ?? {})) column(name);
  const withSet = (table: number[]) => table.map((weight, j) => options.set?.[names[j]] ?? weight);
  const only = new Set((options.only ?? []).flatMap(name => {
    const matched = name.startsWith('*@') ? names.flatMap((full, j) => (full.endsWith(name.slice(1)) ? [j] : [])) : [column(name)];
    if (matched.length === 0) throw new Error(`only: no weight named ${name}`);
    return matched;
  }));
  const laid = layoutOf(withSet(singles), withSet(doubles));
  const { start } = laid;
  const layout = options.only ? { ...laid.layout, held: new Set([...laid.layout.held].filter(j => !only.has(j))) } : laid.layout;
  const free = supportOf(samples, layout, options.minGames);
  if (options.only) {
    free.forEach((_, m) => { if (!only.has(m < layout.columns ? m : layout.overrides[m - layout.columns])) free[m] = false; });
  }
  for (const name of options.hold?.shared ?? []) free[column(name)] = false;
  for (const name of options.hold?.doubles ?? []) {
    const override = layout.overrides.indexOf(column(name));
    if (override < 0) throw new Error(`hold: ${name} has no doubles override (the doubles table shares the singles weight)`);
    free[layout.columns + override] = false;
  }
  const fit = fitWeightsAtK(samples, start, layout, k, free);
  const bands = bootstrapWeightsAtK(samples, options.draws, 64, start, layout, k, free);
  const weights = start.map((hand, m) => {
    const column = m < layout.columns ? m : layout.overrides[m - layout.columns];
    const band = bands[m];
    const flagged = free[m] && ((hand !== 0 && Math.sign(fit[m]) !== Math.sign(hand)) || band.hi - band.lo > 2 * Math.abs(fit[m]));
    return { name: names[column], table: m < layout.columns ? 'shared' : 'doubles', hand, fit: fit[m], free: free[m], ...band, flagged };
  });
  const cv = Array.from({ length: options.seeds }, (_, i) => ({ seed: i + 1, ...crossValidateAtK(samples, options.folds, i + 1, start, layout, k, free) }));
  const summary = cvSummary(cv);
  const params = columnParams(layout);
  const adopt = summary.pooled.logLossWins === options.seeds && summary.pooled.meanBrierDelta <= 0;
  return {
    n: samples.length,
    games: new Set(samples.map(sample => sample.game)).size,
    singles: samples.filter(sample => !sample.doubles).length,
    doubles: samples.filter(sample => sample.doubles).length,
    options,
    weights,
    inSample: { hand: scoreAtK(samples, start, layout, k), fit: scoreAtK(samples, fit, layout, k) },
    cv,
    summary,
    verdict: { adopt, flagged: weights.filter(weight => weight.flagged).map(weight => `${weight.table}:${weight.name}`) },
    proposed: {
      singles: Object.fromEntries(names.map((name, j) => [name, fit[params.singles[j]]])),
      doubles: Object.fromEntries(names.map((name, j) => [name, fit[params.doubles[j]]])),
    },
  };
}
