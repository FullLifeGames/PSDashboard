// The endgame truth table (round 34): per estimator, Brier and mean
// absolute error against the solver's exact value on the exactly solved
// positions, sign agreement, the coverage line (solved / capped / unpriced
// / loop / out of scope), and the decided reference (how many decided
// positions the solver puts at or beyond 0.8 for the decided side).
//   node scripts/endgame-truth-table.mjs <dump.jsonl> [<dump.jsonl> ...]
import { readFileSync } from 'node:fs';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: node scripts/endgame-truth-table.mjs <dump.jsonl> ...');
  process.exit(1);
}
const rows = paths.flatMap(path => readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)));
const prob = v => (v + 1) / 2;
const ESTIMATORS = ['static', 'staticB', 'd1', 'd2', 'd3', 'mcts'];
const DECIDED_WP = 0.8;

const inScope = rows.filter(r => r.scope);
const solved = inScope.filter(r => r.exact);
const count = flag => inScope.filter(r => !r.exact && r.flags.includes(flag)).length;
console.log('## Coverage\n');
console.log('| items | in scope | solved | capped | unpriced | loop | out of scope |');
console.log('|---|---|---|---|---|---|---|');
console.log(`| ${rows.length} | ${inScope.length} | ${solved.length} | ${count('capped')} | ${count('unpriced')} | ${count('loop')} | ${rows.length - inScope.length} |\n`);

const subsets = [
  ['all', solved],
  ['singles', solved.filter(r => r.gameType === 'singles')],
  ['doubles', solved.filter(r => r.gameType === 'doubles')],
  ['bank', solved.filter(r => r.source === 'bank')],
  ['synthetic', solved.filter(r => r.source === 'synthetic')],
];
for (const [label, subset] of subsets) {
  if (subset.length === 0) continue;
  console.log(`## Estimators against the exact value (${label}, n=${subset.length})\n`);
  console.log('| estimator | brier | mean abs error | sign hits |');
  console.log('|---|---|---|---|');
  for (const key of ESTIMATORS) {
    const brier = subset.reduce((s, r) => s + (prob(r.estimators[key]) - prob(r.value)) ** 2, 0) / subset.length;
    const mae = subset.reduce((s, r) => s + Math.abs(r.estimators[key] - r.value), 0) / subset.length;
    const hits = subset.filter(r => r.value === 0 || Math.sign(r.estimators[key]) === Math.sign(r.value)).length;
    console.log(`| ${key} | ${brier.toFixed(4)} | ${mae.toFixed(3)} | ${hits}/${subset.length} |`);
  }
  console.log('');
}

const decided = solved.filter(r => r.decided);
if (decided.length > 0) {
  const forSide = r => (r.decided === 'p1' ? r.value : -r.value);
  const beyond = decided.filter(r => forSide(r) >= DECIDED_WP).length;
  const against = decided.filter(r => forSide(r) < 0).length;
  console.log(`## Decided reference\n\n${decided.length} decided positions solved exactly: ${beyond} at or beyond ${DECIDED_WP} for the decided side, ${against} against it.\n`);
}

console.log('## Positions\n');
console.log('| name | type | exact | flags | value | static | staticB | d1 | d2 | d3 | mcts | states | depth | ms |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const e = r.estimators ?? {};
  const f = key => (e[key] === undefined ? '-' : e[key].toFixed(3));
  console.log(`| ${r.name} | ${r.gameType} | ${r.exact ? 'yes' : 'no'} | ${r.flags.join(',') || '-'} | ${r.scope ? r.value.toFixed(3) : '-'} | ${ESTIMATORS.map(f).join(' | ')} | ${r.states} | ${r.depth} | ${r.ms} |`);
}
