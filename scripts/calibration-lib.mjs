// Shared aggregation over calibration dumps (EVAL_CALIBRATION_DUMP JSONL,
// one sample per line: id, turn, tranche, phase, gameType, score,
// faintedFraction, p1Won, since round 32 decided: the root's decided-sweep
// side or null, and since round 50 decidedHeld: that side where the finished
// score holds the sweep). Three consumers: the harness itself prints the
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
  // Round 50: the decided sweep's named side, over every sweep and over the
  // sweeps the bar holds (heldDecided); older dumps carry no held field.
  const namedShare = key => {
    const named = samples.filter(sample => sample[key]);
    const won = named.filter(sample => (sample[key] === 'p1') === sample.p1Won).length;
    return `n=${named.length} named-side-wins=${(100 * won / Math.max(1, named.length)).toFixed(1)}%`;
  };
  if (samples.some(sample => sample.decided)) {
    const held = samples.some(sample => sample.decidedHeld !== undefined) ? ` | held by the bar: ${namedShare('decidedHeld')}` : '';
    lines.push(`decided: ${namedShare('decided')}${held}`);
  }
  return lines;
}

/** The PRNG of regression/fit-helpers.ts, so a band reproduces from its seed. */
export function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAND_VIEWS = [
  ['full', () => true],
  ['hq', s => s.quality === 'hq'],
  ['luck-adjusted', s => !s.luckAgainstFavored],
];
// Pooled rows first: a verdict reads them, the phase cells below are warnings only.
const BAND_CELLS = [
  ...['all', 'singles', 'doubles'].map(gameType => [gameType, 'all']),
  ...['all', 'singles', 'doubles'].flatMap(gameType => ['early', 'mid', 'late'].map(phase => [gameType, phase])),
];

/** One row: the paired mean and its band from resampling REPLAYS (a replay's positions share one outcome). */
function bandRow(cell, { draws, seed, level }) {
  const byGame = new Map();
  for (const pair of cell) {
    const game = byGame.get(pair.id) ?? { sum: 0, n: 0 };
    game.sum += pair.delta;
    game.n += 1;
    byGame.set(pair.id, game);
  }
  const games = [...byGame.values()];
  const bp = value => value * 10000;
  const mean = cell.reduce((sum, pair) => sum + pair.delta, 0) / cell.length;
  const random = mulberry32(seed);
  const means = [];
  for (let draw = 0; draw < draws; draw++) {
    let sum = 0;
    let n = 0;
    for (let pick = 0; pick < games.length; pick++) {
      const game = games[Math.floor(random() * games.length)];
      sum += game.sum;
      n += game.n;
    }
    means.push(sum / n);
  }
  means.sort((x, y) => x - y);
  const tail = (1 - level) / 2;
  const lo = means[Math.floor(tail * draws)];
  const hi = means[Math.ceil((1 - tail) * draws) - 1];
  const center = means.reduce((sum, value) => sum + value, 0) / draws;
  const se = Math.sqrt(means.reduce((sum, value) => sum + (value - center) ** 2, 0) / draws);
  const moved = cell.some(pair => pair.delta !== 0);
  const reading = !moved ? 'unmoved' : hi < 0 ? 'B better' : lo > 0 ? 'B worse' : 'unresolved';
  return {
    n: cell.length, games: games.length, meanBp: bp(mean), loBp: bp(lo), hiBp: bp(hi), seBp: bp(se),
    pBetter: means.filter(value => value < 0).length / draws, reading,
  };
}

/**
 * The verdict table with error bars (round 48): paired Brier deltas B minus A
 * under ONE fixed K (the A side's pooled fit), per view, game type and phase,
 * each with a band from a paired bootstrap over replays. Every row seeds its
 * own generator, so a row's numbers do not depend on which other rows exist.
 */
export function pairedBands(a, b, { draws = 2000, seed = 20260919, level = 0.9 } = {}) {
  const key = s => `${s.id}#${s.turn}`;
  const bByKey = new Map(b.map(s => [key(s), s]));
  const k = fitConstantK(a.map(s => ({ score: s.score, won: s.p1Won })));
  const squared = (s, score) => (sigmoid(k * score) - (s.p1Won ? 1 : 0)) ** 2;
  const pairs = a.filter(s => bByKey.has(key(s)))
    .map(s => ({ id: s.id, sample: s, delta: squared(s, bByKey.get(key(s)).score) - squared(s, s.score) }));
  const views = BAND_VIEWS.filter(([view]) => view !== 'hq' || pairs.some(pair => pair.sample.quality === 'hq'));
  const rows = [];
  for (const [view, keep] of views) {
    for (const [gameType, phase] of BAND_CELLS) {
      const cell = pairs.filter(({ sample }) => keep(sample) &&
        (gameType === 'all' || sample.gameType === gameType) && (phase === 'all' || sample.phase === phase));
      if (cell.length > 0) rows.push({ view, gameType, phase, ...bandRow(cell, { draws, seed, level }) });
    }
  }
  return { k, joined: pairs.length, draws, level, rows };
}

/** A shift this small is no harm even where its band clears zero: few moved positions resolve a single basis point (round 49, user gate). */
export const HARM_MIN_BP = 5;

/** What the table says as a verdict: pooled rows decide, phase cells only warn, and harm needs size. */
export function bankVerdict(result) {
  const worse = row => row.reading === 'B worse';
  const sized = row => row.meanBp >= HARM_MIN_BP;
  return {
    gain: result.rows.filter(row => row.phase === 'all' && row.reading === 'B better'),
    harm: result.rows.filter(row => row.phase === 'all' && worse(row) && sized(row)),
    warnings: result.rows.filter(row => row.phase !== 'all' && worse(row) && sized(row)),
    notes: result.rows.filter(row => worse(row) && !sized(row)),
  };
}

/** The printed verdict table; the last line is the verdict sentence. */
export function bandLines(result) {
  const signed = value => {
    const rounded = Math.round(value);
    return `${rounded >= 0 ? '+' : ''}${rounded === 0 ? 0 : rounded}`;
  };
  const lines = [
    `=== verdict table with bands (joined n=${result.joined}, fixed K ${result.k.toFixed(2)} from A; bp, negative = B better; ` +
    `${Math.round(result.level * 100)} % band over replays, ${result.draws} draws) ===`,
  ];
  let view = null;
  for (const row of result.rows) {
    if (row.view !== view) {
      view = row.view;
      lines.push(` ${view}:`);
    }
    lines.push(
      `   ${row.gameType.padEnd(8)} ${row.phase.padEnd(6)} ${signed(row.meanBp).padStart(5)} ` +
      `[${signed(row.loBp)}, ${signed(row.hiBp)}]  se ${row.seBp.toFixed(0)}  n=${row.n}/${row.games}g  ` +
      `P(B better)=${(100 * row.pBetter).toFixed(0)}%  ${row.reading}`);
  }
  const verdict = bankVerdict(result);
  const names = rows => rows
    .map(row => `${row.view} ${row.gameType}${row.phase === 'all' ? '' : ` ${row.phase}`} (${signed(row.meanBp)})`).join(', ');
  lines.push(
    `bank verdict: ${verdict.gain.length > 0 ? `gain on ${names(verdict.gain)}` : 'no gain resolved'}; ` +
    `${verdict.harm.length > 0 ? `HARM on ${names(verdict.harm)}` : 'no harm'}; ` +
    `${verdict.warnings.length > 0 ? `warnings: ${names(verdict.warnings)}` : 'no warnings'}` +
    `${verdict.notes.length > 0 ? `; resolved under ${HARM_MIN_BP} bp: ${names(verdict.notes)}` : ''}`);
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
