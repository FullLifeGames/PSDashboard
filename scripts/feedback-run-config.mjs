// .feedback-run.json of a feedback/<name> branch.
//
// The feedback workflow (.github/workflows/feedback.yml) treats the file as untrusted input, as bank.yml does with
// .bank-run.json: this script validates it against an allowlist, and the workflow passes only the run index of its
// matrix to the shell.
//
//   node scripts/feedback-run-config.mjs check           validate; print the plan; write runs (a JSON list of run
//                                                        indices) and name to $GITHUB_OUTPUT when the variable is set
//   node scripts/feedback-run-config.mjs compare <dir>   compare the artifacts <dir>/feedback-run-<i> of every run
//
// The file: { "name": "r89-fbci-try", "runs": 3 }. A run is one whole `npm run test:feedback` with FEEDBACK_DUMP=1 on
// its own runner; the compare job asks whether all runs wrote the same bytes.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CONFIG_FILE = '.feedback-run.json';
export const DEFAULT_RUNS = 3;
export const MAX_RUNS = 5;
/** The folder a run's artifact unpacks into, under the compare job's download folder: feedback-run-<index>. */
export const ARTIFACT_PREFIX = 'feedback-run-';

const NAME = /^[a-z0-9-]{1,40}$/;
const ALLOWED_KEYS = new Set(['name', 'runs']);

/**
 * What the harness writes into docs/reports (test/e2e-feedback/feedback-drift.spec.ts) and the artifact keeps: one full
 * dump per replay (FEEDBACK_DUMP=1), the drift report as JSON and as Markdown, and the run's log.
 * test/regression/workflows.spec.ts holds these patterns to the harness's own file names.
 */
export const DUMP_FILE = /^feedback-full-[A-Za-z0-9._-]+\.json$/;
export const DRIFT_JSON = 'feedback-drift.json';
export const DRIFT_MARKDOWN = 'feedback-drift.md';
export const LOG_FILE = 'feedback.log';

/** The validated run: { name, runs }. Throws with every problem found. */
export function validateRunConfig(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${CONFIG_FILE} must hold one JSON object`);
  for (const key of Object.keys(raw)) if (!ALLOWED_KEYS.has(key)) problems.push(`unknown key "${key}"`);
  const { name, runs = DEFAULT_RUNS } = raw;
  if (typeof name !== 'string' || !NAME.test(name)) problems.push('name must be 1 to 40 of a-z, 0-9 and -');
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) problems.push(`runs must be an integer from 1 to ${MAX_RUNS}`);
  if (problems.length > 0) throw new Error(`${CONFIG_FILE}: ${problems.join('; ')}`);
  return { name, runs };
}

/**
 * The drift report minus what two runs of one engine may differ in: the date and the wall times (JSON), the line with
 * the commit and date and the line with the wall times (Markdown). The harness writes both on purpose
 * (test/e2e-feedback/report.ts), so a byte comparison of the report files would never hold.
 */
export function normalizeDrift(name, text) {
  if (name === DRIFT_JSON) {
    const report = JSON.parse(text);
    if (report.meta) {
      delete report.meta.date;
      delete report.meta.wallTimes;
    }
    return JSON.stringify(report);
  }
  return text.split(/\r?\n/).filter(line => !line.startsWith('- Commit:') && !line.startsWith('- Wall time:')).join('\n');
}

/**
 * Compares the runs: `folders` maps a run index to the files of its folder (name to text). Every dump of the first run
 * must exist in each other run with the same bytes, and no other run may hold a dump the first lacks; the two drift
 * files compare after normalizeDrift. Returns { dumps, problems }.
 */
export function compareRuns(folders) {
  const indices = [...folders.keys()].sort((a, b) => a - b);
  const problems = [];
  if (indices.length === 0) return { dumps: 0, problems: ['no run folders'] };
  const first = folders.get(indices[0]);
  const dumpNames = [...first.keys()].filter(name => DUMP_FILE.test(name)).sort();
  if (dumpNames.length === 0) problems.push(`run ${indices[0]} holds no dump`);
  for (const index of indices.slice(1)) {
    const other = folders.get(index);
    for (const name of dumpNames) {
      if (!other.has(name)) problems.push(`missing in run ${index}: ${name}`);
      else if (other.get(name) !== first.get(name)) problems.push(`differs: ${name} (run ${indices[0]} against run ${index})`);
    }
    for (const name of other.keys()) {
      if (DUMP_FILE.test(name) && !first.has(name)) problems.push(`extra in run ${index}: ${name}`);
    }
    for (const name of [DRIFT_JSON, DRIFT_MARKDOWN]) {
      if (first.has(name) !== other.has(name)) problems.push(`${name} exists in only one of run ${indices[0]} and run ${index}`);
      else if (first.has(name) && normalizeDrift(name, first.get(name)) !== normalizeDrift(name, other.get(name))) {
        problems.push(`differs: ${name} beyond its date and wall times (run ${indices[0]} against run ${index})`);
      }
    }
  }
  return { dumps: dumpNames.length, problems };
}

/** The run folders under `dir` (feedback-run-<index>), read into the maps compareRuns takes. */
export function readRunFolders(dir) {
  const folders = new Map();
  if (!existsSync(dir)) return folders;
  for (const entry of readdirSync(dir)) {
    const match = new RegExp(`^${ARTIFACT_PREFIX}(\\d+)$`).exec(entry);
    if (!match) continue;
    const files = new Map();
    for (const file of readdirSync(join(dir, entry))) files.set(file, readFileSync(join(dir, entry, file), 'utf8'));
    folders.set(Number(match[1]), files);
  }
  return folders;
}

function readConfig(root = ROOT) {
  const path = join(root, CONFIG_FILE);
  // A run started by hand (workflow_dispatch) has no file: three runs under a fixed name.
  if (!existsSync(path)) return { name: 'dispatch', runs: DEFAULT_RUNS };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${CONFIG_FILE} is no valid JSON`);
  }
  return validateRunConfig(raw);
}

function main(argv) {
  const [command, operand] = argv;
  if (command === 'check') {
    const config = readConfig();
    console.log(`run ${config.name}: ${config.runs} whole feedback run(s), one runner each`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `runs=${JSON.stringify(Array.from({ length: config.runs }, (_, index) => index + 1))}\nname=${config.name}\n`);
    }
    return 0;
  }
  if (command === 'compare') {
    const config = readConfig();
    const folders = readRunFolders(operand ?? '');
    const result = compareRuns(folders);
    if (folders.size !== config.runs) result.problems.unshift(`expected ${config.runs} run folder(s), found ${folders.size}`);
    if (result.problems.length > 0) {
      console.log(`the runs differ or are incomplete (${result.dumps} dump(s) in the first run):`);
      for (const problem of result.problems) console.log(`  ${problem}`);
      return 1;
    }
    console.log(`equal: ${result.dumps} dump(s) byte-identical in ${folders.size} run(s); the drift report equals beyond its date and wall times`);
    return 0;
  }
  throw new Error('usage: node scripts/feedback-run-config.mjs check | compare <dir>');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
