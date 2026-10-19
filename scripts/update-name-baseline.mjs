// Round 72 (T236): rewrites the baselines of the name ratchet (scripts/name-baseline.json). A baseline only shrinks: the script
// drops the pairs that left the code and refuses, with exit 1 and the list, when the code holds a pair the baseline lacks.
// Model: scripts/update-lint-ratchet.mjs.
//
// Usage: node scripts/update-name-baseline.mjs [--allow-raise] [--dry-run]
//   --allow-raise  take pairs the baseline lacks (the integrator reads them with --dry-run first, after a merge)
//   --dry-run      print the difference and write nothing
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { censusOf, loadUniverse, ROOT } from './name-census.mjs';

export const NAME_BASELINE = path.join(ROOT, 'scripts', 'name-baseline.json');

const pairsOf = files => new Set(Object.entries(files).flatMap(([file, ids]) => ids.map(id => `${file}: ${id}`)));

/** The pairs only the code has (`added`) and only the baseline has (`removed`), both sorted. */
export function diffNames(baselineFiles, codeFiles) {
  const before = pairsOf(baselineFiles);
  const after = pairsOf(codeFiles);
  return {
    added: [...after].filter(pair => !before.has(pair)).sort(),
    removed: [...before].filter(pair => !after.has(pair)).sort(),
  };
}

export const serialize = baseline => `${JSON.stringify(baseline, null, 2)}\n`;

function main() {
  const allowRaise = process.argv.includes('--allow-raise');
  const dryRun = process.argv.includes('--dry-run');
  const current = JSON.parse(readFileSync(NAME_BASELINE, 'utf8')).files;
  const code = censusOf(ROOT, loadUniverse());
  const { added, removed } = diffNames(current, code);
  console.log(`name baseline: ${pairsOf(current).size} pairs, code ${pairsOf(code).size}; ${added.length} new, ${removed.length} gone`);
  for (const pair of removed) console.log(`  - ${pair}`);
  for (const pair of added) console.log(`  + ${pair}`);
  if (added.length && !allowRaise) {
    console.error('The code holds Dex name literals the baseline lacks. Derive them from the Dex or hold the list with a spec; '
      + 'a reviewed exception takes eslint-disable-next-line names/no-new-dex-name -- reason. --allow-raise takes them into the baseline.');
    process.exitCode = 1;
    return;
  }
  if (dryRun) return;
  writeFileSync(NAME_BASELINE, serialize({ files: code }));
  console.log('wrote scripts/name-baseline.json');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
