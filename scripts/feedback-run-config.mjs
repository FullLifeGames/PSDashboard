// Validates the .feedback-run.json of a feedback/<name> branch and compares the runs' artifacts.
// The file is untrusted input: the workflow passes only the run index of its matrix to the shell.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CONFIG_FILE = '.feedback-run.json';
export const DEFAULT_RUNS = 3;
export const MAX_RUNS = 5;
export const ARTIFACT_PREFIX = 'feedback-run-';

const NAME = /^[a-z0-9-]{1,40}$/;
const ALLOWED_KEYS = new Set(['name', 'runs']);

/** The files the harness writes into docs/reports (FEEDBACK_DUMP=1); workflows.spec.ts pins these patterns. */
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

/** The drift report minus date and wall times, which differ between two runs by design. */
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

/** `folders`: run index to its files (name to text); returns { dumps, problems }. */
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
