// The spec-count ratchet (AGENTS.md "What earns a test", rule 5): the number of spec files per test project only falls,
// or grows with a named new module.
//
//   node scripts/spec-counts.mjs          check: exit 1 when a project holds more spec files than spec-count-ratchet.json
//
// `node scripts/update-lint-ratchet.mjs` writes the baseline from the tree and lowers it after a cut; it refuses to raise a count
// unless `--allow-raise` names a new module (a new source module, a new sweep or a new browser flow; the pull request says which).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SPEC_COUNT_FILE = path.join(ROOT, 'spec-count-ratchet.json');

/** The folder of each test project: the four Vitest projects of vitest.config.ts, then the three Playwright suites. */
export const SPEC_PROJECTS = {
  app: 'test/regression',
  'replay-core': 'packages/replay-core/test',
  'eval-engine': 'packages/eval-engine/test',
  ui: 'test/ui',
  e2e: 'test/e2e',
  'e2e-feedback': 'test/e2e-feedback',
  'e2e-build': 'test/e2e-build',
};

function specFiles(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += specFiles(path.join(dir, entry.name));
    else if (/\.spec\.tsx?$/.test(entry.name)) count++;
  }
  return count;
}

/** Spec files per project under `root`. */
export function countSpecs(root = ROOT) {
  return Object.fromEntries(Object.entries(SPEC_PROJECTS).map(([project, dir]) => [project, specFiles(path.join(root, dir))]));
}

/** The counts of the baseline file (empty when the file is missing). */
export function currentBaseline(file = SPEC_COUNT_FILE) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** The projects whose count is above the baseline; a project the baseline lacks counts from zero. */
export function compareCounts(baseline, counts) {
  return Object.entries(counts)
    .map(([project, count]) => ({ project, baseline: baseline[project] ?? 0, count }))
    .filter(entry => entry.count > entry.baseline);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const over = compareCounts(currentBaseline(), countSpecs());
  if (over.length > 0) {
    for (const { project, baseline, count } of over) console.error(`spec files in ${project}: ${count}, baseline ${baseline}`);
    console.error('A spec file needs a new source module, a new sweep or a new browser flow (AGENTS.md, "What earns a test").');
    console.error('Otherwise put the rows into the spec of their module. For a named new module: node scripts/update-lint-ratchet.mjs --allow-raise');
    process.exit(1);
  }
  console.log('spec-count ratchet: no project above its baseline');
}
