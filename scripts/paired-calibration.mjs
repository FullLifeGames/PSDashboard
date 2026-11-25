// Paired engine-vs-engine analysis over EVAL_CALIBRATION_DUMP files.
// The math lives in scripts/calibration-lib.mjs, which replicates fit-helpers.ts so numbers match the printed sweep.
import {
  asScore, bandLines, filterQuality, load, ownKBands, pairedBands, record, right, takeFieldArgs, takeQualityArg,
} from './calibration-lib.mjs';
import { quickTierLines } from './calibration-fingerprint.mjs';

const key = s => `${s.id}#${s.turn}`;

const { argv: rest, aField, bField } = takeFieldArgs(process.argv.slice(2));
const { argv, quality } = takeQualityArg(rest);
const [aPath, bPath] = argv;
if (!aPath || !bPath) {
  console.error('usage: node scripts/paired-calibration.mjs <a.jsonl> <b.jsonl> [--quality hq|std] [--a-field <name>] [--b-field <name>]');
  process.exit(1);
}
const a = asScore(filterQuality(load(aPath), quality), aField);
const b = asScore(filterQuality(load(bPath), quality), bField);
const bByKey = new Map(b.map(s => [key(s), s]));
const joined = a
  .filter(s => bByKey.has(key(s)))
  .map(s => ({ a: s, b: bByKey.get(key(s)) }));

const header = `A(${aPath}) n=${a.length}  B(${bPath}) n=${b.length}  joined n=${joined.length}${quality ? ` (quality ${quality})` : ''}`;
const quickLines = quickTierLines({
  aPath, bPath, aRows: a.length, pairs: joined.length, replays: new Set(joined.map(pair => pair.a.id)).size,
});
console.log([header, ...quickLines].join('\n') + '\n');

console.log('=== full-set records (reproduce the printed numbers) ===');
record(a, 'A (full)');
record(b, 'B (full)');

console.log('\n=== joined-set records (identical positions) ===');
record(joined.map(p => p.a), 'A (joined)');
record(joined.map(p => p.b), 'B (joined)');

const trancheOf = pair => pair.a.tranche ?? pair.b.tranche ?? 'untagged';
const tranches = [...new Set(joined.map(trancheOf))];
if (tranches.length > 1 || tranches[0] !== 'untagged') {
  console.log('\n=== stratified records (joined, by corpus tranche) ===');
  for (const tranche of tranches) {
    const subset = joined.filter(pair => trancheOf(pair) === tranche);
    record(subset.map(pair => pair.a), `A ${tranche}`);
    record(subset.map(pair => pair.b), `B ${tranche}`);
  }
}

// Under --quality both sides are one tranche already, so the hq view would repeat the full one.
for (const bands of [pairedBands(a, b), ownKBands(a, b)]) {
  if (quality) bands.rows = bands.rows.filter(row => row.view !== 'hq');
  console.log('');
  for (const line of bandLines(bands)) console.log(line);
}

console.log('\n=== disagreement structure (joined) ===');
for (const phase of ['early', 'mid', 'late']) {
  for (const gameType of ['singles', 'doubles']) {
    const subset = joined.filter(p => p.a.phase === phase && p.a.gameType === gameType);
    if (subset.length === 0) continue;
    const aR = subset.filter(p => right(p.a) && !right(p.b)).length;
    const bR = subset.filter(p => !right(p.a) && right(p.b)).length;
    const both = subset.filter(p => !right(p.a) && !right(p.b)).length;
    const meanAbsA = subset.reduce((sum, p) => sum + Math.abs(p.a.score), 0) / subset.length;
    const meanAbsB = subset.reduce((sum, p) => sum + Math.abs(p.b.score), 0) / subset.length;
    console.log(
      `${phase.padEnd(5)} ${gameType.padEnd(7)} n=${String(subset.length).padStart(3)}  ` +
      `A-only-right=${aR}  B-only-right=${bR}  both-wrong=${both}  ` +
      `mean|s| A=${meanAbsA.toFixed(2)} B=${meanAbsB.toFixed(2)}`);
  }
}

console.log('\n=== counterfactual hybrids (joined set; A early, B when rule fires) ===');
const pickBy = decide => joined.map(p => (decide(p) ? p.b : p.a));
record(pickBy(p => p.a.phase === 'late'), 'oracle: B when phase=late');
record(pickBy(p => p.a.phase !== 'early'), 'oracle: B when phase!=early');
for (const threshold of [1 / 3, 0.4, 0.5, 0.6]) {
  record(
    pickBy(p => p.a.faintedFraction >= threshold),
    `live: B when faintedFraction>=${threshold.toFixed(2)}`);
}
for (const threshold of [0.4, 0.5]) {
  record(
    pickBy(p => p.a.gameType === 'singles' && p.a.faintedFraction >= threshold),
    `live: B when singles && ff>=${threshold.toFixed(2)}`);
}
for (const w of [0.25, 0.5, 0.75]) {
  const blended = joined.map(p => ({
    ...p.a,
    score: (1 - w) * p.a.score + w * p.b.score,
  }));
  record(blended, `blend: ${(1 - w).toFixed(2)}*A + ${w.toFixed(2)}*B`);
}

console.log('\n=== exclusive flips (joined; who is right where they disagree) ===');
for (const p of joined) {
  if (right(p.a) === right(p.b)) continue;
  console.log(
    `${p.a.id} t${p.a.turn} ${p.a.phase}/${p.a.gameType} ff=${p.a.faintedFraction.toFixed(2)} ` +
    `A=${p.a.score.toFixed(3)} B=${p.b.score.toFixed(3)} p1Won=${p.a.p1Won} → ${right(p.a) ? 'A' : 'B'} right`);
}

console.log('\n=== largest score disagreements (joined, top 12) ===');
const byGap = [...joined].sort((x, y) =>
  Math.abs(y.a.score - y.b.score) - Math.abs(x.a.score - x.b.score)).slice(0, 12);
for (const p of byGap) {
  console.log(
    `${p.a.id} t${p.a.turn} ${p.a.phase}/${p.a.gameType} ` +
    `A=${p.a.score.toFixed(3)} B=${p.b.score.toFixed(3)} p1Won=${p.a.p1Won} ` +
    `(A ${right(p.a) ? 'right' : 'WRONG'}, B ${right(p.b) ? 'right' : 'WRONG'})`);
}
