import { afterAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPARE_JOB, REPO_URL, WORKFLOW_NAME, buildRunCommit, compareVerdict, deleteArgs, findReuse, jobTimes, pickRun, pushRefspec, runFolder,
} from '../../scripts/feedback-ci.mjs';

/**
 * Round 89 (feedback runs in GitHub Actions): scripts/feedback-ci.mjs pushes one feedback/<name> branch per run by the
 * repository's URL (the user's okay of 20.11.2026 covers these pushes and deletes and nothing else). The specs pin what it
 * pushes and deletes, that the run commit adds exactly .feedback-run.json without touching the repository's index, working tree
 * or branches, which run it takes for its own, and how it reads the compare job.
 */

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'feedback-ci-'));
  made.push(root);
  git(root, 'init', '-q');
  for (const [key, value] of [['user.name', 'test'], ['user.email', 'test@example.org'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) {
    git(root, 'config', key, value);
  }
  writeFileSync(join(root, 'app.ts'), 'export const app = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'measured');
  return root;
}

describe('what the script pushes and deletes', () => {
  test('one branch feedback/<name>, by the repository URL, deleted only while it holds the run commit', () => {
    const sha = 'a'.repeat(40);
    expect(pushRefspec(sha, 'r89-try')).toBe(`${sha}:refs/heads/feedback/r89-try`);
    expect(deleteArgs(sha, 'r89-try')).toEqual([
      'push', `--force-with-lease=refs/heads/feedback/r89-try:${sha}`, REPO_URL, ':refs/heads/feedback/r89-try',
    ]);
    expect(REPO_URL).toBe('https://github.com/FullLifeGames/PSDashboard.git');
    const source = readFileSync(fileURLToPath(new URL('../../scripts/feedback-ci.mjs', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/'--force'|--tags|refs\/tags/);
    expect(source).toContain("git(ROOT, ['push', REPO_URL, pushRefspec(sha, config.name)]");
  });
});

describe('the run commit', () => {
  test('adds exactly .feedback-run.json on the measured commit and leaves index, tree and branches alone', () => {
    const root = repo();
    const measured = git(root, 'rev-parse', 'HEAD');
    const branches = git(root, 'branch', '--list');
    const run = buildRunCommit(root, measured, { name: 'r89-try', runs: 3 });
    expect(git(root, 'rev-parse', `${run}^`)).toBe(measured);
    expect(git(root, 'diff', '--name-status', measured, run)).toBe('A\t.feedback-run.json');
    expect(JSON.parse(git(root, 'show', `${run}:.feedback-run.json`))).toEqual({ name: 'r89-try', runs: 3 });
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(git(root, 'branch', '--list')).toBe(branches);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(measured);
  });
});

describe('which run is ours', () => {
  test('the Feedback workflow on the pushed commit, matched by name since GitHub resolves a file name on the default branch only', () => {
    const sha = 'c'.repeat(40);
    const runs = [{ headSha: sha, workflowName: 'Tests', databaseId: 1 }, { headSha: sha, workflowName: 'Feedback', databaseId: 7 }];
    expect(pickRun(runs, sha)?.databaseId).toBe(7);
    expect(pickRun([{ headSha: 'e'.repeat(40), workflowName: 'Feedback', databaseId: 8 }], sha)).toBeNull();
    const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/feedback.yml', import.meta.url)), 'utf8');
    expect(workflow).toMatch(new RegExp(`^name: ${WORKFLOW_NAME}\\r?$`, 'm'));
    expect(workflow).toContain(`name: ${COMPARE_JOB}`);
  });

  test('the compare job gives the verdict and the jobs give their wall minutes', () => {
    const jobs = [
      { name: 'Run 1', conclusion: 'success', status: 'completed', startedAt: '2026-11-20T10:00:00Z', completedAt: '2026-11-20T10:30:30Z' },
      { name: COMPARE_JOB, conclusion: 'failure', status: 'completed', startedAt: '2026-11-20T10:31:00Z', completedAt: '2026-11-20T10:31:15Z' },
    ];
    expect(compareVerdict(jobs)).toBe('failure');
    expect(compareVerdict(jobs.slice(0, 1))).toBeNull();
    expect(jobTimes(jobs)).toEqual(['Run 1: success in 30.5 min', `${COMPARE_JOB}: failure in 0.3 min`]);
  });
});

describe('--reuse', () => {
  test('finds a downloaded successful run of the same commit and run count, nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'feedback-reuse-'));
    made.push(root);
    const calibration = join(root, '.calibration');
    const record = (name: string, body: object) => {
      mkdirSync(runFolder(root, name), { recursive: true });
      writeFileSync(join(runFolder(root, name), 'ci.json'), JSON.stringify(body));
    };
    record('a', { measuredCommit: 'm1', runs: 3, conclusion: 'success' });
    record('b', { measuredCommit: 'm1', runs: 2, conclusion: 'success' });
    record('c', { measuredCommit: 'm2', runs: 3, conclusion: 'success' });
    record('d', { measuredCommit: 'm3', runs: 3, conclusion: 'failure' });
    mkdirSync(join(calibration, 'bank-run'), { recursive: true });
    expect(findReuse(calibration, 'm1', { name: 'x', runs: 3 })).toBe(runFolder(root, 'a'));
    expect(findReuse(calibration, 'm1', { name: 'x', runs: 4 })).toBeNull();
    expect(findReuse(calibration, 'm3', { name: 'x', runs: 3 })).toBeNull();
    expect(findReuse(join(root, 'none'), 'm1', { name: 'x', runs: 3 })).toBeNull();
  });
});
