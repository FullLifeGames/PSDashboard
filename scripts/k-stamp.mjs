// The K table a capture runs under, as the stamp the root-scale report reads (round 74, T163).
//
//   node scripts/k-stamp.mjs [out-file]     print the stamp, or write it to out-file
//
// EVAL_FIT_ROOT_K=<stamp file> names the leaf K per rule set and game type that a capture with search ran under
// (regression/fit-families.ts parseKTable, rootScaleReports); the report stops when it is not today's table. The
// stamp comes from the code that resolves the leaf's K (winprobK in packages/eval-engine/src/winprob.ts), so a
// capture's stamp is made at the capture's commit and never typed. regression/k-stamp.spec.ts holds the two together.
import { writeFileSync } from 'node:fs';
import { winprobK } from '../packages/eval-engine/src/winprob.ts';

const stamp = Object.fromEntries(['standard', 'vgc', 'champions'].map(ruleset => [
  ruleset, { singles: winprobK(false, ruleset), doubles: winprobK(true, ruleset) },
]));
const text = `${JSON.stringify(stamp, null, 2)}\n`;
const out = process.argv[2];
if (out) writeFileSync(out, text);
else process.stdout.write(text);
