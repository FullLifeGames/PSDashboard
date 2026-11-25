// The protection rule for a test cut, on two coverage-final.json files of the same source.
// Lines follow istanbul's rule: a line counts once, covered when a statement that starts on it ran.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

const [, , beforePath, afterPath, root, flag] = process.argv;
if (!beforePath || !afterPath || !root) { console.error('usage: cov-compare.mjs <before> <after> <root> [--list]'); process.exit(3); }
const load = p => Object.fromEntries(Object.entries(JSON.parse(readFileSync(p, 'utf8'))).map(([k, v]) => [relative(root, v.path ?? k), v]));
const before = load(beforePath);
const after = load(afterPath);
const pkg = file => file.startsWith('packages/eval-engine/') ? 'eval-engine' : file.startsWith('packages/replay-core/') ? 'replay-core' : file.startsWith('src/') ? 'app src' : 'other';
const at = m => `${m.start.line}:${m.start.column}-${m.end.line}:${m.end.column}`;
const sum = {};
const lost = [];
let mapsDiffer = 0;
const tally = (p, side, kind, total, covered) => {
  sum[p] ??= {};
  sum[p][kind] ??= { before: [0, 0], after: [0, 0] };
  sum[p][kind][side][0] += covered;
  sum[p][kind][side][1] += total;
};
function count(file, cov, side) {
  const p = pkg(file);
  const s = Object.values(cov.s);
  tally(p, side, 'statements', s.length, s.filter(n => n > 0).length);
  const b = Object.values(cov.b).flat();
  tally(p, side, 'branches', b.length, b.filter(n => n > 0).length);
  const f = Object.values(cov.f);
  tally(p, side, 'functions', f.length, f.filter(n => n > 0).length);
  const lines = new Map();
  for (const [id, m] of Object.entries(cov.statementMap)) lines.set(m.start.line, Math.max(lines.get(m.start.line) ?? 0, cov.s[id]));
  tally(p, side, 'lines', lines.size, [...lines.values()].filter(n => n > 0).length);
}
for (const [file, b] of Object.entries(before)) {
  count(file, b, 'before');
  const a = after[file];
  if (!a) { lost.push(`${file}: whole file missing in the after run`); continue; }
  const keysB = Object.values(b.statementMap).map(at).join('|');
  const keysA = Object.values(a.statementMap).map(at).join('|');
  if (keysB !== keysA) { mapsDiffer += 1; console.log(`MAP DIFFERS ${file}`); continue; }
  for (const id of Object.keys(b.s)) if (b.s[id] > 0 && !(a.s[id] > 0)) lost.push(`${file}:${b.statementMap[id].start.line} statement`);
  for (const id of Object.keys(b.f)) if (b.f[id] > 0 && !(a.f[id] > 0)) lost.push(`${file}:${b.fnMap[id].loc.start.line} function ${b.fnMap[id].name}`);
  for (const id of Object.keys(b.b)) b.b[id].forEach((n, i) => { if (n > 0 && !(a.b[id]?.[i] > 0)) lost.push(`${file}:${b.branchMap[id].loc.start.line} branch ${b.branchMap[id].type} path ${i}`); });
}
for (const [file, a] of Object.entries(after)) count(file, a, 'after');
const pct = ([c, t]) => (t ? (100 * c / t).toFixed(2) : '-');
console.log('package\tkind\tbefore covered/total\tbefore %\tafter covered/total\tafter %');
for (const [p, kinds] of Object.entries(sum).sort()) for (const [k, v] of Object.entries(kinds)) {
  console.log(`${p}\t${k}\t${v.before.join('/')}\t${pct(v.before)}\t${v.after.join('/')}\t${pct(v.after)}`);
}
console.log(`lost items: ${lost.length}; files whose statement map differs: ${mapsDiffer}`);
if (flag === '--list' || lost.length <= 50) for (const line of lost) console.log(`LOST ${line}`);
process.exit(mapsDiffer > 0 ? 2 : lost.length > 0 ? 1 : 0);
