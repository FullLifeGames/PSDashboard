// .bank-run.json of a bank/<name> branch (round 71, bank in GitHub Actions).
//
// The bank workflow (.github/workflows/bank.yml) treats the file as untrusted input. This script validates it against
// an allowlist and starts scripts/run-calibration.mjs itself, without a shell, so no value of the file reaches a shell
// line of the workflow; the workflow passes only the job index of its matrix.
//
//   node scripts/bank-run-config.mjs check          validate; print the plan; write jobs (a JSON list of job indices)
//                                                  and name to $GITHUB_OUTPUT when the variable is set
//   node scripts/bank-run-config.mjs job <index>    run the job's slices into .calibration/job-<index>
//   node scripts/bank-run-config.mjs merge <dir>    merge the job folders <dir>/job-* into .calibration/<name>
//
// The file: { "name": "r71-bank-1", "jobs": 16, "slicesPerJob": 4, "env": { "EVAL_CALIBRATION_SOURCE": "holdout",
// "EVAL_CALIBRATION_TRANCHE": "holdout-vgc" } }. jobs and slicesPerJob default to 16 and 4 (user gate 13.10., 2a);
// job k runs slices k*slicesPerJob to k*slicesPerJob + slicesPerJob - 1 of jobs*slicesPerJob.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFraction } from './calibration-fingerprint.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CONFIG_FILE = '.bank-run.json';
const HOLDOUT_MANIFEST = 'test/regression/fixtures/fit-holdout-manifest.json';

/** The bank's own tranches (REPLAY_TRANCHES in test/regression/eval-calibration.spec.ts; test/regression/bank-run-config.spec.ts compares the two). */
export const BANK_TRANCHES = ['draft', 'ladder-0811', 'ladder-dou-0804', 'ladder-ou-0802', 'tournament-0811', 'tournament-0811b'];
/** The fit corpus's tranches (test/regression/bank-universe.ts, fit-<source>). */
export const FIT_TRANCHES = ['fit-ladder', 'fit-tournament'];

const NAME = /^[a-z0-9-]{1,40}$/;
const ENV_KEY = /^EVAL_CALIBRATION_[A-Z_]{1,40}$/;
const ENV_VALUE = /^[A-Za-z0-9._/-]{1,100}$/;
/** Keys the runner sets itself, or that write files to a path of the file's choosing. */
const FORBIDDEN_KEYS = new Set(['EVAL_CALIBRATION', 'EVAL_CALIBRATION_SLICE', 'EVAL_CALIBRATION_DUMP', 'EVAL_CALIBRATION_POSITIONS']);
const MAX_ENV_KEYS = 20;
const ALLOWED_KEYS = new Set(['name', 'jobs', 'slicesPerJob', 'env']);

/** The holdout tranches: holdout-<family> for every family of the holdout manifest. */
export function holdoutTranches(root = ROOT) {
  const { sets } = JSON.parse(readFileSync(join(root, HOLDOUT_MANIFEST), 'utf8'));
  return [...new Set(sets.map(set => `holdout-${set.family}`))].sort();
}

const integerIn = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;

/**
 * The validated run: { name, jobs, slicesPerJob, slices, env }. Throws with every problem found; `tranches` lists the
 * tranche names EVAL_CALIBRATION_TRANCHE may take.
 */
export function validateRunConfig(raw, tranches) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${CONFIG_FILE} must hold one JSON object`);
  for (const key of Object.keys(raw)) if (!ALLOWED_KEYS.has(key)) problems.push(`unknown key "${key}"`);
  const { name, jobs = 16, slicesPerJob = 4, env = {} } = raw;
  if (typeof name !== 'string' || !NAME.test(name)) problems.push('name must be 1 to 40 of a-z, 0-9 and -');
  if (!integerIn(jobs, 1, 16)) problems.push('jobs must be an integer from 1 to 16');
  if (!integerIn(slicesPerJob, 1, 4)) problems.push('slicesPerJob must be an integer from 1 to 4');
  if (!env || typeof env !== 'object' || Array.isArray(env)) problems.push('env must be an object of strings');
  const pairs = env && typeof env === 'object' && !Array.isArray(env) ? Object.entries(env) : [];
  if (pairs.length > MAX_ENV_KEYS) problems.push(`env takes at most ${MAX_ENV_KEYS} keys`);
  for (const [key, value] of pairs) {
    if (!ENV_KEY.test(key)) problems.push(`env key "${key}" is not an EVAL_CALIBRATION_* lever`);
    else if (FORBIDDEN_KEYS.has(key)) problems.push(`env key ${key} is set by the runner or writes files; leave it out`);
    if (typeof value !== 'string' || !ENV_VALUE.test(value)) {
      problems.push(`env value of ${key} must be 1 to 100 of A-Z, a-z, 0-9 and . _ / -`);
      continue;
    }
    if (key === 'EVAL_CALIBRATION_TRANCHE' && !tranches.includes(value)) problems.push(`unknown tranche ${value} (${tranches.join(', ')})`);
    if (key === 'EVAL_CALIBRATION_SOURCE' && !['holdout', 'fit'].includes(value)) problems.push(`unknown source ${value} (holdout or fit)`);
    if (key === 'EVAL_CALIBRATION_MODE' && !['auto', 'mcts', 'matrix'].includes(value)) problems.push(`unknown mode ${value} (auto, mcts or matrix)`);
    if (key === 'EVAL_CALIBRATION_FRACTION') {
      try {
        parseFraction(value);
      } catch (error) {
        problems.push(error.message);
      }
    }
  }
  if (problems.length > 0) throw new Error(`${CONFIG_FILE}: ${problems.join('; ')}`);
  return { name, jobs, slicesPerJob, slices: jobs * slicesPerJob, env: Object.fromEntries(pairs) };
}

/** The argument vector of run-calibration.mjs for job `index` of a validated run. */
export function jobArgs(config, index) {
  if (!integerIn(index, 0, config.jobs - 1)) throw new Error(`job index ${index} outside 0 to ${config.jobs - 1}`);
  const first = index * config.slicesPerJob;
  const envArgs = Object.entries(config.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  return ['--slices', String(config.slices), '--slice-range', `${first}..${first + config.slicesPerJob - 1}`, '--out', `.calibration/job-${index}`, ...envArgs];
}

/** The argument vector of run-calibration.mjs that merges the job folders under `dir`. */
export function mergeArgs(config, dir, folders) {
  return [...folders.flatMap(folder => ['--merge', join(dir, folder)]), '--out', `.calibration/${config.name}`];
}

function readConfig(root = ROOT) {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) throw new Error(`${CONFIG_FILE} is missing`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${CONFIG_FILE} is no valid JSON`);
  }
  return validateRunConfig(raw, [...BANK_TRANCHES, ...holdoutTranches(root), ...FIT_TRANCHES]);
}

function runner(args) {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'run-calibration.mjs'), ...args], { cwd: ROOT, stdio: 'inherit' });
  return result.status ?? 1;
}

function main(argv) {
  const [command, operand] = argv;
  const config = readConfig();
  if (command === 'check') {
    console.log(`run ${config.name}: ${config.jobs} job(s) of ${config.slicesPerJob} slice(s), ${config.slices} slices, env ${JSON.stringify(config.env)}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `jobs=${JSON.stringify(Array.from({ length: config.jobs }, (_, index) => index))}\nname=${config.name}\n`);
    }
    return 0;
  }
  if (command === 'job') return runner(jobArgs(config, Number(operand)));
  if (command === 'merge') {
    const dir = operand ?? '';
    const folders = existsSync(dir) ? readdirSync(dir).filter(entry => /^job-\d+$/.test(entry)).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))) : [];
    if (folders.length === 0) throw new Error(`no job-* folders under "${dir}"`);
    return runner(mergeArgs(config, dir, folders));
  }
  throw new Error('usage: node scripts/bank-run-config.mjs check | job <index> | merge <dir>');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
