// Runs a bank measurement in GitHub Actions (round 71, bank in GitHub Actions).
//
//   node scripts/bank-ci.mjs --name <name> [--commit <ref>] [--jobs 16] [--slices-per-job 4] [--env KEY=VALUE ...]
//                            [--tranche NAME] [--reuse] [--dry-run]
//   node scripts/bank-ci.mjs --resume <name|run id>
//
// The script builds a run commit on top of the measured commit that adds exactly one file, .bank-run.json (git
// commit-tree over a throwaway index, so the working tree, the index and every local branch stay as they are), pushes
// it as the one branch bank/<name> with an explicit refspec (never a tag, never --force, refused when the branch
// exists), waits for the workflow .github/workflows/bank.yml, downloads the merged run into .calibration/<name>/ and
// deletes the branch with --force-with-lease, so a branch that moved is never deleted. Before the push it reads the
// diff of the measured commit against origin/v1 and refuses files and lines that look like secrets. The user's
// standing okay of 13.10. ("6a") covers these pushes and deletes of bank/<name> branches and nothing else.
//
// --resume takes up a run whose watcher ended (the session closed, the machine slept): it finds the run by its name or run
// id, waits for it by the same rule, downloads it into .calibration/<name>/, records it and deletes its branch. A run whose
// jobs have all completed and whose merged artifact exists counts as over after a grace period, also while GitHub still
// calls it in_progress (round 76, T266).
//
// --reuse prints the folder of a downloaded CI run of the same measured commit and the same run settings and starts
// nothing. --dry-run builds and checks the run commit and stops before the push. CI measures only commits that carry
// this tooling (user 17.10., 1a). Data uploads are a separate command (scripts/bank-data-pack.mjs --upload).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANK_TRANCHES, CONFIG_FILE, FIT_TRANCHES, holdoutTranches, validateRunConfig } from './bank-run-config.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The workflow's display name (`name:` of .github/workflows/bank.yml). GitHub resolves a workflow file name only on
 * the default branch, where bank.yml need not exist, so the run is found by branch, commit and this name. */
const WORKFLOW_NAME = 'Bank';
const PUBLIC_BASE = 'origin/v1';
const CI_RECORD = 'ci.json';

/** Added files whose names look like keys or credentials. */
const SECRET_FILE = /(^|\/)(\.env(\.[^/]*)?|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*\.(pem|p12|pfx|key))$/;
/** Added lines that look like a token or a private key. */
const SECRET_LINE = /ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/**
 * What in a diff looks like a secret: `nameStatus` is `git diff --name-status` output, `patch` the `git diff` text.
 * Returns one finding per file or line, empty when nothing looks like a secret.
 */
export function secretFindings(nameStatus, patch) {
  const findings = [];
  for (const line of nameStatus.split(/\r?\n/)) {
    const [status, ...paths] = line.split('\t');
    const path = paths.at(-1);
    if (path && /^[AMRC]/.test(status ?? '') && SECRET_FILE.test(path)) findings.push(`file ${path}`);
  }
  let file = null;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('+') && SECRET_LINE.test(line)) findings.push(`a line in ${file ?? 'the diff'} that looks like a token or key`);
  }
  return findings;
}

/** The refspec of the push: exactly the run commit onto the one branch bank/<name>. */
export const pushRefspec = (sha, name) => `${sha}:refs/heads/bank/${name}`;

/** The git arguments that delete bank/<name> only while it still points at the run commit. */
export const deleteArgs = (sha, name) => ['push', `--force-with-lease=refs/heads/bank/${name}:${sha}`, 'origin', `:refs/heads/bank/${name}`];

/** The run settings that decide a CI run's rows: everything of the validated run but its name. */
export const runSettings = config => ({ jobs: config.jobs, slicesPerJob: config.slicesPerJob, env: config.env });

/**
 * A git command's output. The secret check reads the whole diff against v1, which outgrew Node's default output
 * limit of 1 MB in round 77 ("spawnSync git ENOBUFS"), so the limit is 256 MB.
 */
export const gitText = (root, args, options = {}) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...options,
});
const git = gitText;

/**
 * The run commit: the measured commit's tree plus .bank-run.json, its parent the measured commit. Built in a
 * throwaway index (GIT_INDEX_FILE), so the repository's own index and working tree stay untouched.
 */
export function buildRunCommit(root, measured, config) {
  const text = `${JSON.stringify({ name: config.name, jobs: config.jobs, slicesPerJob: config.slicesPerJob, env: config.env }, null, 2)}\n`;
  const blob = git(root, ['hash-object', '-w', '--stdin'], { input: text }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'bank-ci-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
    git(root, ['read-tree', measured], { env });
    git(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${CONFIG_FILE}`], { env });
    const tree = git(root, ['write-tree'], { env }).trim();
    return git(root, ['commit-tree', tree, '-p', measured, '-m', `Bank run ${config.name}: ${JSON.stringify(runSettings(config))}`]).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A downloaded CI run of the same measured commit and run settings, complete: its folder, or null. */
export function findReuse(calibrationDir, measured, config) {
  if (!existsSync(calibrationDir)) return null;
  const wanted = JSON.stringify(runSettings(config));
  for (const entry of readdirSync(calibrationDir).sort().reverse()) {
    try {
      const record = JSON.parse(readFileSync(join(calibrationDir, entry, CI_RECORD), 'utf8'));
      const run = JSON.parse(readFileSync(join(calibrationDir, entry, 'run.json'), 'utf8'));
      if (record.measuredCommit === measured && JSON.stringify(record.settings) === wanted && run.complete === true) return join(calibrationDir, entry);
    } catch {
      // Not a downloaded CI run.
    }
  }
  return null;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { name: null, commit: 'HEAD', jobs: 16, slicesPerJob: 4, env: {}, reuse: false, dryRun: false, resume: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    if (arg === '--name') options.name = next();
    else if (arg === '--commit') options.commit = next();
    else if (arg === '--jobs') options.jobs = Number(next());
    else if (arg === '--slices-per-job') options.slicesPerJob = Number(next());
    else if (arg === '--tranche') options.env.EVAL_CALIBRATION_TRANCHE = next();
    else if (arg === '--env') {
      const pair = next();
      const eq = pair.indexOf('=');
      if (eq <= 0) fail(`--env expects KEY=VALUE, got ${pair}`);
      options.env[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (arg === '--reuse') options.reuse = true;
    else if (arg === '--resume') options.resume = next();
    else if (arg === '--dry-run') options.dryRun = true;
    else fail(`unknown argument ${arg}`);
  }
  return options;
}

const gh = args => execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const pause = ms => new Promise(done => setTimeout(done, ms));

/** The workflow run of the pushed commit, once GitHub has created it. */
/** The bank workflow's run of `sha` among the runs `gh run list --json databaseId,headSha,url,workflowName` lists, or null. */
export function pickRun(runs, sha) {
  return runs.find(entry => entry.headSha === sha && entry.workflowName === WORKFLOW_NAME) ?? null;
}

/** The merge job of bank.yml (`name:` of the job `merge`); a run is over only when it has completed too. */
export const MERGE_JOB = 'Merge the jobs';
/** How long a run whose jobs are all completed and whose merged artifact exists may stay open before it counts as over. */
export const GRACE_MS = 5 * 60 * 1000;
/** The longest `gh run watch` blocks before the loop looks at the jobs again (a run GitHub holds open never ends it). */
const WATCH_MS = 3 * 60 * 1000;

/**
 * Round 76 (T266): whether the run's own jobs say it is over, whatever GitHub's status of the run says: every job of the run
 * (the config job, the slice jobs, the merge job) has completed and the merged artifact exists.
 */
export function runFinished(state, artifactNames, { expectedJobs, artifactName, mergeJob = MERGE_JOB }) {
  const jobs = state?.jobs ?? [];
  return jobs.length >= expectedJobs
    && jobs.every(job => job.status === 'completed')
    && jobs.some(job => job.name === mergeJob)
    && artifactNames.includes(artifactName);
}

/** The conclusion the jobs of a finished run add up to: skipped and neutral jobs do not count against it. */
const jobsConclusion = jobs => (jobs.every(job => ['success', 'skipped', 'neutral'].includes(job.conclusion)) ? 'success' : 'failure');

/**
 * The conclusion of a CI run once GitHub calls it completed. `gh run watch` ends with an error on a failed run and on an
 * API error alike (HTTP 504 on 19.10.2026: the script read run 39262005491 as over while it ran, found no artifact and
 * deleted its branch), so the run's own status decides, asked again until the run is completed.
 *
 * Round 76 (T266): GitHub also kept the run of r74-k open for about an hour after its 16 jobs and its merge had completed. With
 * `artifacts` (the names of the run's artifacts) a run whose jobs are all completed and whose merged artifact is there counts
 * as over once that has held for `graceMs`; a job that runs again starts the period anew, and the run's own conclusion wins
 * when GitHub gives it first. The conclusion then is the jobs': success only when none failed.
 */
export async function waitForRun(id, {
  watch, view, artifacts, wait = pause, now = Date.now, attempts = 240, graceMs = GRACE_MS, expectedJobs = 0, artifactName = '',
}) {
  let finishedSince = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      watch(id);
    } catch {
      // A failed run and a failed watch end here alike; the status below tells them apart.
    }
    let state = null;
    try {
      state = view(id);
    } catch {
      // The status could not be read (network or API error): ask again after the pause.
    }
    if (state?.status === 'completed') return state.conclusion || 'unknown';
    if (artifacts && state?.jobs) {
      let names = null;
      try {
        names = artifacts(id);
      } catch {
        // The artifact list could not be read: the period keeps running as it was.
      }
      if (names) {
        if (!runFinished(state, names, { expectedJobs, artifactName })) finishedSince = null;
        else {
          finishedSince ??= now();
          if (now() - finishedSince >= graceMs) return jobsConclusion(state.jobs);
        }
      }
    }
    await wait(30000);
  }
  return 'unknown';
}

/**
 * Round 76 (T266): the Bank run a name or a run id stands for, through `gh` (`ghText(args)` returns its output). A name is the
 * run's `bank/<name>` branch (the newest Bank run on it), a number is the run itself; its branch gives the name back.
 */
export function findRunByTarget(target, ghText) {
  const fields = 'databaseId,headSha,url,workflowName,headBranch';
  const byId = /^\d+$/.test(target);
  const found = byId
    ? JSON.parse(ghText(['run', 'view', target, '--json', fields]))
    : JSON.parse(ghText(['run', 'list', '--branch', `bank/${target}`, '--json', fields, '--limit', '20'])).find(entry => entry.workflowName === WORKFLOW_NAME);
  if (!found) throw new Error(`no run of the ${WORKFLOW_NAME} workflow on bank/${target}`);
  if (found.workflowName !== WORKFLOW_NAME) throw new Error(`run ${target} belongs to the ${found.workflowName} workflow, not to ${WORKFLOW_NAME}`);
  if (!found.headBranch?.startsWith('bank/')) throw new Error(`run ${target} ran on ${found.headBranch}, not on a bank/<name> branch`);
  return { databaseId: found.databaseId, headSha: found.headSha, url: found.url, name: found.headBranch.slice('bank/'.length) };
}

/**
 * The tail of every collection (a run just pushed and a run taken up again): wait for the run, download it, record it,
 * and delete the branch, also when the wait or the download fails. Returns the conclusion.
 */
export async function collectRun({ wait, download, record, cleanup }) {
  try {
    const conclusion = await wait();
    download();
    record(conclusion);
    return conclusion;
  } finally {
    cleanup();
  }
}

async function runOf(sha, name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const runs = JSON.parse(gh(['run', 'list', '--branch', `bank/${name}`, '--json', 'databaseId,headSha,url,workflowName', '--limit', '10']));
    const run = pickRun(runs, sha);
    if (run) return run;
    await pause(5000);
  }
  throw new Error(`no run of the ${WORKFLOW_NAME} workflow for ${sha} after five minutes`);
}

/** What waitForRun asks of GitHub: a watch that never blocks for long, the run's jobs, the run's artifact names. */
const waitDeps = (id, config) => ({
  watch: runId => execFileSync('gh', ['run', 'watch', String(runId), '--exit-status', '--interval', '30'], { cwd: ROOT, stdio: 'inherit', timeout: WATCH_MS }),
  view: runId => JSON.parse(gh(['run', 'view', String(runId), '--json', 'status,conclusion,jobs'])),
  artifacts: runId => JSON.parse(gh(['api', `repos/{owner}/{repo}/actions/runs/${runId}/artifacts?per_page=100`, '--jq', '[.artifacts[].name]'])),
  expectedJobs: config.jobs + 2,
  artifactName: `run-${config.name}`,
});

const downloadRun = (runId, name) => execFileSync('gh', ['run', 'download', String(runId), '--name', `run-${name}`, '--dir', join(ROOT, '.calibration', name)], { cwd: ROOT, stdio: 'inherit' });

/** ci.json of a downloaded run (what --reuse reads), and the run's summary on the console. */
function recordRun(run, config, measured, sha, conclusion) {
  const out = join(ROOT, '.calibration', config.name);
  writeFileSync(join(out, CI_RECORD), `${JSON.stringify({
    measuredCommit: measured, runCommit: sha, runId: run.databaseId, runUrl: run.url, conclusion, settings: runSettings(config),
    downloadedAt: new Date().toISOString(),
  }, null, 2)}
`);
  const summary = join(out, 'summary.txt');
  if (existsSync(summary)) console.log(readFileSync(summary, 'utf8'));
  console.log(out);
}

/**
 * Round 76 (T266): takes up a run whose watcher ended. The run commit still exists on origin as bank/<name> (the watcher
 * deletes the branch last), and its .bank-run.json gives the run's settings back; a branch that is gone leaves the run
 * commit to fetch by its sha, and a commit that cannot be fetched stops the resume with the reason.
 */
async function resume(target) {
  let run;
  try {
    run = findRunByTarget(target, args => gh(args));
  } catch (error) {
    fail(error.message);
  }
  const out = join(ROOT, '.calibration', run.name);
  if (existsSync(out)) fail(`refused: .calibration/${run.name} exists already`);
  const fetched = [['--quiet', 'origin', `refs/heads/bank/${run.name}`], ['--quiet', 'origin', run.headSha]].some(args => {
    try {
      git(ROOT, ['fetch', ...args]);
      return git(ROOT, ['rev-parse', '--verify', `${run.headSha}^{commit}`]).trim() === run.headSha;
    } catch {
      return false;
    }
  });
  if (!fetched) fail(`cannot read the run commit ${run.headSha.slice(0, 12)} of bank/${run.name}: neither the branch nor the commit can be fetched`);
  let config;
  try {
    config = validateRunConfig(JSON.parse(git(ROOT, ['show', `${run.headSha}:${CONFIG_FILE}`])), [...BANK_TRANCHES, ...holdoutTranches(ROOT), ...FIT_TRANCHES]);
  } catch (error) {
    fail(`the run commit holds no readable ${CONFIG_FILE}: ${error.message}`);
  }
  const measured = git(ROOT, ['rev-parse', `${run.headSha}^`]).trim();
  console.log(`resuming ${run.url} (bank/${run.name}, measured ${measured.slice(0, 12)})`);
  const conclusion = await collectRun({
    wait: () => waitForRun(run.databaseId, waitDeps(run.databaseId, config)),
    download: () => downloadRun(run.databaseId, run.name),
    record: value => recordRun(run, config, measured, run.headSha, value),
    cleanup: () => {
      if (git(ROOT, ['ls-remote', '--heads', 'origin', `refs/heads/bank/${run.name}`]).trim() === '') return;
      git(ROOT, deleteArgs(run.headSha, run.name), { stdio: 'inherit' });
    },
  });
  if (conclusion !== 'success') process.exitCode = 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.resume) return resume(options.resume);
  let config;
  try {
    config = validateRunConfig(
      { name: options.name, jobs: options.jobs, slicesPerJob: options.slicesPerJob, env: options.env },
      [...BANK_TRANCHES, ...holdoutTranches(ROOT), ...FIT_TRANCHES],
    );
  } catch (error) {
    fail(error.message);
  }
  const measured = git(ROOT, ['rev-parse', '--verify', `${options.commit}^{commit}`]).trim();
  const calibrationDir = join(ROOT, '.calibration');
  if (options.reuse) {
    const found = findReuse(calibrationDir, measured, config);
    if (found) {
      console.log(`reuse: ${found} holds a CI run of ${measured.slice(0, 7)} with these settings; nothing starts`);
      console.log(found);
      return;
    }
    console.log(`reuse: no downloaded CI run of ${measured.slice(0, 7)} with these settings`);
  }
  if (existsSync(join(calibrationDir, config.name))) fail(`refused: .calibration/${config.name} exists already; pick another name`);
  git(ROOT, ['fetch', '--quiet', 'origin', 'v1']);
  const base = git(ROOT, ['merge-base', PUBLIC_BASE, measured]).trim();
  const findings = secretFindings(git(ROOT, ['diff', '--name-status', base, measured]), git(ROOT, ['diff', base, measured]));
  if (findings.length > 0) fail(`refused: the diff against ${PUBLIC_BASE} holds what looks like a secret: ${findings.join('; ')}`);
  if (git(ROOT, ['ls-remote', '--heads', 'origin', `refs/heads/bank/${config.name}`]).trim() !== '') {
    fail(`refused: origin already has bank/${config.name}; pick another name`);
  }
  const sha = buildRunCommit(ROOT, measured, config);
  console.log(`run commit ${sha.slice(0, 12)} on ${measured.slice(0, 12)}: ${config.jobs} job(s) of ${config.slicesPerJob} slice(s), env ${JSON.stringify(config.env)}`);
  if (options.dryRun) {
    console.log(`dry run: would push ${pushRefspec(sha, config.name)}`);
    return;
  }
  git(ROOT, ['push', 'origin', pushRefspec(sha, config.name)], { stdio: 'inherit' });
  let run = null;
  const conclusion = await collectRun({
    wait: async () => {
      run = await runOf(sha, config.name);
      console.log(`watching ${run.url}`);
      return waitForRun(run.databaseId, waitDeps(run.databaseId, config));
    },
    download: () => downloadRun(run.databaseId, config.name),
    record: conclusion => recordRun(run, config, measured, sha, conclusion),
    cleanup: () => git(ROOT, deleteArgs(sha, config.name), { stdio: 'inherit' }),
  });
  if (conclusion !== 'success') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
