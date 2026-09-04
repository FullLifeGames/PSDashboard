// Shared aggregation over calibration dumps (EVAL_CALIBRATION_DUMP JSONL,
// one sample per line: id, turn, tranche, phase, gameType, score,
// faintedFraction, p1Won, and since round 32 decided: the root's
// decided-sweep side or null). Three consumers: the harness itself prints the
// same aggregate lines, scripts/run-calibration.mjs merges slice dumps and
// summarizes them, scripts/paired-calibration.mjs joins two dumps. The math
// replicates regression/fit-helpers.ts exactly (pooled constant-K logistic
// fit via 500-iteration gradient descent from 1.5, Brier under that K), and
// compareSamples is the summation order the harness sorts into before it
// aggregates, so a merged summary matches the single-process printout
// character for character.
import { readFileSync } from 'node:fs';

const sigmoid = z => 1 / (1 + Math.exp(-z));
const probOf = (s, k) => sigmoid(k * s.score);

/** Samples are `{ score, won }` here (the harness maps p1Won to won). */
export function fitConstantK(samples) {
  let k = 1.5;
  for (let iter = 0; iter < 500; iter++) {
    let grad = 0;
    for (const s of samples) grad += (probOf(s, k) - (s.won ? 1 : 0)) * s.score / samples.length;
    k -= 1.0 * grad;
  }
  return k;
}

export const brier = (samples, k) =>
  samples.reduce((sum, s) => sum + (probOf(s, k) - (s.won ? 1 : 0)) ** 2, 0) / samples.length;

/** Reads one JSONL dump; blank lines are skipped. */
export const load = path => readFileSync(path, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

export const right = s => (s.score > 0) === s.p1Won;

/** Code-unit order by replay id, then turn: the order the harness and the slice merge both sum in. */
export function compareSamples(a, b) {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.turn - b.turn;
}

export const sortSamples = samples => [...samples].sort(compareSamples);

/** Concatenates slice dumps into one sorted sample list. */
export function mergeDumps(paths) {
  const all = [];
  for (const path of paths) all.push(...load(path));
  return sortSamples(all);
}

/** The compact paired-analysis line: sign accuracy per phase and gametype, Brier per phase, sizes, K. */
export function record(samples, label) {
  const pct = subset => subset.length === 0 ? ' -' :
    (100 * subset.filter(right).length / subset.length).toFixed(0);
  const phases = ['early', 'mid', 'late'].map(p => samples.filter(s => s.phase === p));
  const types = ['singles', 'doubles'].map(t => samples.filter(s => s.gameType === t));
  const k = fitConstantK(samples.map(s => ({ score: s.score, won: s.p1Won })));
  const briers = phases.map(subset =>
    subset.length === 0 ? '-' : brier(subset.map(s => ({ score: s.score, won: s.p1Won })), k).toFixed(4));
  const cells = [...phases, ...types].map(pct).join('/');
  const ns = [...phases, ...types].map(s => s.length).join('/');
  console.log(`${label.padEnd(46)} ${cells}  brier ${briers.join('/')}  n ${ns} (total ${samples.length}, K ${k.toFixed(2)})`);
}

/**
 * The harness's printed aggregate, line for line (the block after the replay
 * loop in regression/eval-calibration.spec.ts): sign accuracy and mean
 * |score| per phase, sign accuracy per gametype, the fitted K per pool,
 * Brier per phase under the pooled K, and the confidence buckets.
 */
export function summarize(samples) {
  const lines = [];
  const asOutcome = s => ({ score: s.score, won: s.p1Won });
  for (const phase of ['early', 'mid', 'late']) {
    const inPhase = samples.filter(sample => sample.phase === phase);
    if (inPhase.length === 0) continue;
    const correct = inPhase.filter(right).length;
    const meanAbs = inPhase.reduce((sum, sample) => sum + Math.abs(sample.score), 0) / inPhase.length;
    lines.push(
      `${phase}: n=${inPhase.length} sign-accuracy=${(100 * correct / inPhase.length).toFixed(0)}% ` +
      `mean|score|=${meanAbs.toFixed(2)}`,
    );
  }
  for (const gameType of ['singles', 'doubles']) {
    const inType = samples.filter(sample => sample.gameType === gameType);
    if (inType.length === 0) continue;
    const correct = inType.filter(right).length;
    lines.push(`${gameType}: n=${inType.length} sign-accuracy=${(100 * correct / inType.length).toFixed(0)}%`);
  }
  const fitK = subset => fitConstantK(subset.map(asOutcome));
  lines.push(
    `winprob K: pooled=${fitK(samples).toFixed(2)} ` +
    `singles=${fitK(samples.filter(sample => sample.gameType === 'singles')).toFixed(2)} ` +
    `doubles=${fitK(samples.filter(sample => sample.gameType === 'doubles')).toFixed(2)}`,
  );
  const pooledK = fitConstantK(samples.map(asOutcome));
  for (const phase of ['early', 'mid', 'late']) {
    const subset = samples.filter(s => s.phase === phase).map(asOutcome);
    if (subset.length === 0) continue;
    lines.push(`${phase} brier=${brier(subset, pooledK).toFixed(4)}`);
  }
  const briers = subset => ['early', 'mid', 'late'].map(phase => {
    const inPhase = subset.filter(s => s.phase === phase).map(asOutcome);
    return inPhase.length === 0 ? '-' : brier(inPhase, pooledK).toFixed(4);
  }).join('/');
  const pct = subset => (100 * subset.filter(right).length / subset.length).toFixed(0);
  // Round 34: the hq tranche and the luck-adjusted view, same K as the full bank.
  const hq = samples.filter(s => s.quality === 'hq');
  if (hq.length > 0) lines.push(`hq: n=${hq.length} sign-accuracy=${pct(hq)}% brier early/mid/late=${briers(hq)}`);
  const clean = samples.filter(s => !s.luckAgainstFavored);
  lines.push(`luck-adjusted: n=${clean.length} excluded=${samples.length - clean.length} brier early/mid/late=${briers(clean)}`);
  const buckets = [[0, 0.2], [0.2, 0.4], [0.4, 0.7], [0.7, 1.01]];
  for (const [lo, hi] of buckets) {
    const inBucket = samples.filter(sample => Math.abs(sample.score) >= lo && Math.abs(sample.score) < hi);
    if (inBucket.length === 0) continue;
    const correct = inBucket.filter(right).length;
    lines.push(
      `|score| ${lo.toFixed(1)}–${hi > 1 ? '1.0' : hi.toFixed(1)}: n=${inBucket.length} ` +
      `favored-side-wins=${(100 * correct / inBucket.length).toFixed(0)}%`,
    );
  }
  return lines;
}

/** Samples of one quality tranche ('hq' or 'std'); dumps from before round 34 carry no quality and pass through untouched. */
export const filterQuality = (samples, quality) => quality ? samples.filter(s => s.quality === quality) : samples;

/** Pulls `--quality <hq|std>` out of an argv list. */
export function takeQualityArg(argv) {
  const index = argv.indexOf('--quality');
  if (index < 0) return { argv, quality: null };
  const quality = argv[index + 1];
  if (quality !== 'hq' && quality !== 'std') throw new Error('--quality expects hq or std');
  return { argv: [...argv.slice(0, index), ...argv.slice(index + 2)], quality };
}
