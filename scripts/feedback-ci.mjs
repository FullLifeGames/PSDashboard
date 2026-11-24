// Runs the feedback corpus in GitHub Actions on a run commit that adds only .feedback-run.json; refuses a dirty tree.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRun, gitText, secretFindings, waitForRun } from './bank-ci.mjs';
import { ARTIFACT_PREFIX, CONFIG_FILE, compareRuns, validateRunConfig } from './feedback-run-config.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The repository by URL: a push never depends on a remote's name (AGENTS.md). */
export const REPO_URL = 'https://github.com/FullLifeGames/PSDashboard.git';
/** `name:` of feedback.yml; GitHub resolves a file name only on the default branch. */
export const WORKFLOW_NAME = 'Feedback';
export const COMPARE_JOB = 'Compare the runs';
const PUBLIC_BASE = 'origin/master';
const CI_RECORD = 'ci.json';
const git = gitText;

export const pushRefspec = (sha, name) => `${sha}:refs/heads/feedback/${name}`;

/** The git arguments that delete feedback/<name> only while it still points at the run commit. */
export const deleteArgs = (sha, name) => ['push', `--force-with-lease=refs/heads/feedback/${name}:${sha}`, REPO_URL, `:refs/heads/feedback/${name}`];

export const runFolder = (root, name) => join(root, '.calibration', `feedback-${name}`);

/** Measured tree plus .feedback-run.json, built in a throwaway index so the repository's own index stays untouched. */
export function buildRunCommit(root, measured, config) {
  const text = `${JSON.stringify({ name: config.name, runs: config.runs }, null, 2)}\n`;
  const blob = git(root, ['hash-object', '-w', '--stdin'], { input: text }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'feedback-ci-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
    git(root, ['read-tree', measured], { env });
    git(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${CONFIG_FILE}`], { env });
    const tree = git(root, ['write-tree'], { env }).trim();
    return git(root, ['commit-tree', tree, '-p', measured, '-m', `Feedback run ${config.name}: ${config.runs} run(s)`]).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function findReuse(calibrationDir, measured, config) {
  if (!existsSync(calibrationDir)) return null;
  for (const entry of readdirSync(calibrationDir).sort().reverse()) {
    if (!entry.startsWith('feedback-')) continue;
    try {
      const record = JSON.parse(readFileSync(join(calibrationDir, entry, CI_RECORD), 'utf8'));
      if (record.measuredCommit === measured && record.runs === config.runs && record.conclusion === 'success') return join(calibrationDir, entry);
    } catch {
      // Not a downloaded feedback run.
    }
  }
  return null;
}

export function pickRun(runs, sha) {
  return runs.find(entry => entry.headSha === sha && entry.workflowName === WORKFLOW_NAME) ?? null;
}

export function compareVerdict(jobs) {
  return jobs.find(job => job.name === COMPARE_JOB)?.conclusion ?? null;
}

export function jobTimes(jobs) {
  return jobs.map(job => {
    const started = Date.parse(job.startedAt ?? '');
    const completed = Date.parse(job.completedAt ?? '');
    const minutes = Number.isNaN(started) || Number.isNaN(completed) ? 'n/a' : `${Math.round((completed - started) / 6000) / 10} min`;
    return `${job.name}: ${job.conclusion ?? job.status} in ${minutes}`;
  });
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { name: null, commit: 'HEAD', runs: 3, reuse: false, dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    if (arg === '--name') options.name = next();
    else if (arg === '--commit') options.commit = next();
    else if (arg === '--runs') options.runs = Number(next());
    else if (arg === '--reuse') options.reuse = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else fail(`unknown argument ${arg}`);
  }
  return options;
}

const gh = args => execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const pause = ms => new Promise(done => setTimeout(done, ms));

async function runOf(sha, name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const runs = JSON.parse(gh(['run', 'list', '--branch', `feedback/${name}`, '--json', 'databaseId,headSha,url,workflowName', '--limit', '10']));
    const run = pickRun(runs, sha);
    if (run) return run;
    await pause(5000);
  }
  throw new Error(`no run of the ${WORKFLOW_NAME} workflow for ${sha} after five minutes`);
}

const waitDeps = () => ({
  watch: runId => execFileSync('gh', ['run', 'watch', String(runId), '--exit-status', '--interval', '30'], { cwd: ROOT, stdio: 'inherit', timeout: 3 * 60 * 1000 }),
  view: runId => JSON.parse(gh(['run', 'view', String(runId), '--json', 'status,conclusion,jobs'])),
});

function downloadRuns(runId, config) {
  const out = runFolder(ROOT, config.name);
  const got = [];
  for (let index = 1; index <= config.runs; index++) {
    try {
      execFileSync('gh', ['run', 'download', String(runId), '--name', `${ARTIFACT_PREFIX}${index}`, '--dir', join(out, `run${index}`)], { cwd: ROOT, stdio: 'inherit' });
      got.push(index);
    } catch {
      console.error(`run ${index}: no artifact to download`);
    }
  }
  return got;
}

function readDownloaded(out, got) {
  const folders = new Map();
  for (const index of got) {
    const files = new Map();
    for (const file of readdirSync(join(out, `run${index}`))) files.set(file, readFileSync(join(out, `run${index}`, file), 'utf8'));
    folders.set(index, files);
  }
  return folders;
}

function recordRun(run, config, measured, sha, conclusion, got) {
  const out = runFolder(ROOT, config.name);
  mkdirSync(out, { recursive: true });
  const view = JSON.parse(gh(['run', 'view', String(run.databaseId), '--json', 'jobs']));
  const verdict = compareVerdict(view.jobs);
  console.log(`\n${run.url}`);
  for (const line of jobTimes(view.jobs)) console.log(`  ${line}`);
  console.log(`compare job: ${verdict ?? 'not run'}`);
  const local = compareRuns(readDownloaded(out, got));
  console.log(local.problems.length === 0
    ? `local compare: ${local.dumps} dump(s) byte-identical in ${got.length} downloaded run(s)`
    : `local compare of ${got.length} downloaded run(s):\n  ${local.problems.join('\n  ')}`);
  writeFileSync(join(out, CI_RECORD), `${JSON.stringify({
    measuredCommit: measured, runCommit: sha, runId: run.databaseId, runUrl: run.url, conclusion, compare: verdict,
    runs: config.runs, downloaded: got, downloadedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  console.log(out);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let config;
  try {
    config = validateRunConfig({ name: options.name, runs: options.runs });
  } catch (error) {
    fail(error.message);
  }
  if (git(ROOT, ['status', '--porcelain']).trim() !== '') fail('refused: the working tree is dirty; commit or stash first (the run measures a commit)');
  const measured = git(ROOT, ['rev-parse', '--verify', `${options.commit}^{commit}`]).trim();
  const calibrationDir = join(ROOT, '.calibration');
  if (options.reuse) {
    const found = findReuse(calibrationDir, measured, config);
    if (found) {
      console.log(`reuse: ${found} holds a CI run of ${measured.slice(0, 7)} with ${config.runs} run(s); nothing starts`);
      console.log(found);
      return;
    }
    console.log(`reuse: no downloaded CI run of ${measured.slice(0, 7)} with ${config.runs} run(s)`);
  }
  if (existsSync(runFolder(ROOT, config.name))) fail(`refused: .calibration/feedback-${config.name} exists already; pick another name`);
  git(ROOT, ['fetch', '--quiet', 'origin', 'master']);
  const base = git(ROOT, ['merge-base', PUBLIC_BASE, measured]).trim();
  const findings = secretFindings(git(ROOT, ['diff', '--name-status', base, measured]), git(ROOT, ['diff', base, measured]));
  if (findings.length > 0) fail(`refused: the diff against ${PUBLIC_BASE} holds what looks like a secret: ${findings.join('; ')}`);
  if (git(ROOT, ['ls-remote', '--heads', REPO_URL, `refs/heads/feedback/${config.name}`]).trim() !== '') {
    fail(`refused: the repository already has feedback/${config.name}; pick another name`);
  }
  const sha = buildRunCommit(ROOT, measured, config);
  console.log(`run commit ${sha.slice(0, 12)} on ${measured.slice(0, 12)}: ${config.runs} whole feedback run(s)`);
  if (options.dryRun) {
    console.log(`dry run: would push ${pushRefspec(sha, config.name)}`);
    return;
  }
  git(ROOT, ['push', REPO_URL, pushRefspec(sha, config.name)], { stdio: 'inherit' });
  let run = null;
  let got = [];
  const conclusion = await collectRun({
    wait: async () => {
      run = await runOf(sha, config.name);
      console.log(`watching ${run.url}`);
      return waitForRun(run.databaseId, waitDeps());
    },
    download: () => {
      got = downloadRuns(run.databaseId, config);
    },
    record: conclusion => recordRun(run, config, measured, sha, conclusion, got),
    cleanup: () => git(ROOT, deleteArgs(sha, config.name), { stdio: 'inherit' }),
  });
  if (conclusion !== 'success') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
