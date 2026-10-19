// Round 72 (T236): rewrites the baselines of the name ratchet (scripts/name-baseline.json) and of the twin detector
// (scripts/twin-baseline.json). A baseline only shrinks: the script drops the pairs that left the code (a twin group that lost
// a file keeps the others, a group down to one file goes) and refuses, with exit 1 and the list, when the code holds a pair the
// baseline lacks. Model: scripts/update-lint-ratchet.mjs.
//
// Usage: node scripts/update-name-baseline.mjs [--allow-raise] [--dry-run]
//   --allow-raise  take pairs the baseline lacks (the integrator reads them with --dry-run first, after a merge)
//   --dry-run      print the difference and write nothing
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { censusOf, loadUniverse, ROOT } from './name-census.mjs';
import { newTwins, TWIN_BASELINE, twinsOf } from './twin-lists.mjs';

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

/** The twin pairs "<list>: <file>" only the code has and only the baseline has, from the groups of both. */
export function diffTwins(baselineGroups, codeGroups) {
  const pairs = groups => new Set(Object.entries(groups).flatMap(([key, files]) => files.map(file => `${key}: ${file}`)));
  const before = pairs(baselineGroups);
  const after = pairs(codeGroups);
  return {
    added: [...after].filter(pair => !before.has(pair)).sort(),
    removed: [...before].filter(pair => !after.has(pair)).sort(),
  };
}

function main() {
  const allowRaise = process.argv.includes('--allow-raise');
  const dryRun = process.argv.includes('--dry-run');
  const names = JSON.parse(readFileSync(NAME_BASELINE, 'utf8')).files;
  const code = censusOf(ROOT, loadUniverse());
  const nameDiff = diffNames(names, code);
  const twins = JSON.parse(readFileSync(TWIN_BASELINE, 'utf8')).groups;
  const twinCode = twinsOf(ROOT);
  const twinDiff = diffTwins(twins, twinCode);
  console.log(`name baseline: ${pairsOf(names).size} pairs, code ${pairsOf(code).size}; ${nameDiff.added.length} new, ${nameDiff.removed.length} gone`);
  console.log(`twin baseline: ${diffTwins({}, twins).added.length} pairs, code ${diffTwins({}, twinCode).added.length}; ${twinDiff.added.length} new, ${twinDiff.removed.length} gone`);
  for (const pair of nameDiff.removed) console.log(`  - name ${pair}`);
  for (const pair of nameDiff.added) console.log(`  + name ${pair}`);
  for (const pair of twinDiff.removed) console.log(`  - twin ${pair}`);
  for (const pair of twinDiff.added) console.log(`  + twin ${pair}`);
  if ((nameDiff.added.length || twinDiff.added.length) && !allowRaise) {
    console.error('The code holds Dex name literals or identical lists the baselines lack. Derive them from the Dex or hold them with a spec; '
      + 'a reviewed name takes eslint-disable-next-line names/no-new-dex-name -- reason, a deliberate list copy takes "// twin-ok: <spec>". '
      + '--allow-raise takes them into the baselines.');
    for (const message of newTwins(ROOT, { groups: twins })) console.error(message);
    process.exitCode = 1;
    return;
  }
  if (dryRun) return;
  writeFileSync(NAME_BASELINE, serialize({ files: code }));
  writeFileSync(TWIN_BASELINE, serialize({ groups: twinCode }));
  console.log('wrote scripts/name-baseline.json and scripts/twin-baseline.json');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
