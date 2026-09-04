// Paired records on a subset of the joined positions:
//   node scripts/subset-calibration.mjs <a.jsonl> <b.jsonl> <field> [<field> ...]
// Joins on id#turn, keeps positions where ANY named field is truthy in A
// or in B (a field recorded on one side only still selects the subset),
// prints both sides' records plus the "favored side wins" rate (sign of
// the score against p1Won) per side. Round 33: lastPair and decided.
import { filterQuality, load, record, right, takeQualityArg } from './calibration-lib.mjs';

const { argv, quality } = takeQualityArg(process.argv.slice(2));
const [aPath, bPath, ...fields] = argv;
if (!aPath || !bPath || fields.length === 0) {
  console.error('usage: node scripts/subset-calibration.mjs <a.jsonl> <b.jsonl> <field...> [--quality hq|std]');
  process.exit(1);
}
const key = s => `${s.id}#${s.turn}`;
const b = new Map(filterQuality(load(bPath), quality).map(s => [key(s), s]));
const joined = filterQuality(load(aPath), quality)
  .filter(s => b.has(key(s)) && fields.some(f => s[f] || b.get(key(s))[f]))
  .map(s => ({ a: s, b: b.get(key(s)) }));
console.log(`subset ${fields.join('|')}: n=${joined.length}`);
record(joined.map(p => p.a), 'A (subset)');
record(joined.map(p => p.b), 'B (subset)');
for (const [label, pick] of [['A', p => p.a], ['B', p => p.b]]) {
  const wins = joined.filter(p => right(pick(p))).length;
  console.log(`${label}: favored side wins ${wins}/${joined.length} = ${(100 * wins / Math.max(1, joined.length)).toFixed(1)} %`);
}
for (const gameType of ['singles', 'doubles']) {
  const sub = joined.filter(p => p.a.gameType === gameType);
  if (sub.length === 0) continue;
  record(sub.map(p => p.a), `A ${gameType}`);
  record(sub.map(p => p.b), `B ${gameType}`);
}
