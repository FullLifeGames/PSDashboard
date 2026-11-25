// The K table a capture runs under, as the stamp the root-scale report reads.
// Made from winprobK at the capture's commit, never typed: EVAL_FIT_ROOT_K names the stamp file.
import { writeFileSync } from 'node:fs';
import { winprobK } from '../packages/eval-engine/src/winprob.ts';

const stamp = Object.fromEntries(['standard', 'vgc', 'champions'].map(ruleset => [
  ruleset, { singles: winprobK(false, ruleset), doubles: winprobK(true, ruleset) },
]));
const text = `${JSON.stringify(stamp, null, 2)}\n`;
const out = process.argv[2];
if (out) writeFileSync(out, text);
else process.stdout.write(text);
