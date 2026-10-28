import { afterAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRunCommit, collectRun, deleteArgs, findReuse, findRunByTarget, gitText, pickRun, pushRefspec, runSettings, secretFindings,
  waitForRun,
} from '../../scripts/bank-ci.mjs';
import { BANK_TRANCHES, validateRunConfig } from '../../scripts/bank-run-config.mjs';

/**
 * Round 71 (bank in GitHub Actions): scripts/bank-ci.mjs pushes one bank/<name> branch per run (the user's standing
 * okay of 13.10. covers these and nothing else). The specs pin what it pushes and deletes, that the run commit adds
 * exactly .bank-run.json without touching the repository's index, working tree or branches, the secret check before
 * a push, and the reuse of a downloaded run.
 */

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const config = validateRunConfig({ name: 'r71-test', jobs: 2, slicesPerJob: 2, env: { EVAL_CALIBRATION_FRACTION: '0.25' } }, BANK_TRANCHES);

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'bank-ci-'));
  made.push(root);
  git(root, 'init', '-q');
  for (const [key, value] of [['user.name', 'test'], ['user.email', 'test@example.org'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) {
    git(root, 'config', key, value);
  }
  put(root, 'src/app.ts', 'export const app = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'measured');
  return root;
}

describe('what bank-ci.mjs pushes and deletes', () => {
  test('one branch by an explicit refspec, and a delete that only removes the branch while it holds the run commit', () => {
    const sha = 'a'.repeat(40);
    expect(pushRefspec(sha, 'r71-test')).toBe(`${sha}:refs/heads/bank/r71-test`);
    expect(deleteArgs(sha, 'r71-test')).toEqual(['push', `--force-with-lease=refs/heads/bank/r71-test:${sha}`, 'origin', ':refs/heads/bank/r71-test']);
    expect(deleteArgs(sha, 'r71-test')).not.toContain('--force');
  });

  test('the run commit adds exactly .bank-run.json on top of the measured commit and leaves the repository as it was', () => {
    const root = repo();
    put(root, 'src/app.ts', 'export const app = 2; // not committed\n');
    const head = git(root, 'rev-parse', 'HEAD');
    const indexBefore = readFileSync(join(root, '.git', 'index'));
    const branchesBefore = git(root, 'branch', '--list');
    const sha = buildRunCommit(root, head, config);
    expect(git(root, 'rev-parse', `${sha}^`)).toBe(head);
    expect(git(root, 'diff', '--name-status', head, sha)).toBe('A\t.bank-run.json');
    const written = JSON.parse(git(root, 'show', `${sha}:.bank-run.json`));
    expect(validateRunConfig(written, BANK_TRANCHES)).toEqual(config);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(join(root, '.git', 'index')).equals(indexBefore)).toBe(true);
    expect(git(root, 'branch', '--list')).toBe(branchesBefore);
    expect(readFileSync(join(root, 'src', 'app.ts'), 'utf8')).toContain('not committed');
  });
});

describe('finding the run of a pushed commit', () => {
  test('by commit and the workflow\'s name, since GitHub resolves bank.yml by file name only on the default branch', () => {
    const sha = 'd'.repeat(40);
    const runs = [{ headSha: sha, workflowName: 'Tests', databaseId: 1 }, { headSha: sha, workflowName: 'Bank', databaseId: 7 }];
    expect(pickRun(runs, sha)).toMatchObject({ databaseId: 7 });
    expect(pickRun([{ headSha: 'e'.repeat(40), workflowName: 'Bank', databaseId: 8 }], sha)).toBeNull();
    const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/bank.yml', import.meta.url)), 'utf8');
    expect(workflow).toMatch(/^name: Bank\r?$/m);
  });
});

describe('the secret check before a push', () => {
  // Round 77: the diff of the round against v1 grew past 1 MB, Node's default output limit of execFileSync, and the
  // check died with "spawnSync git ENOBUFS" before any push.
  test('reads a git output larger than 1 MB', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const text = gitText(root, ['show', 'HEAD:test/e2e-feedback/fixtures/smogon/_stats_gen9ou.json.json']);
    expect(text.length).toBeGreaterThan(1024 * 1024);
  });

  test.each([
    ['A\t.env', ''],
    ['A\tconfig/.env.production', ''],
    ['A\tkeys/id_ed25519', ''],
    ['A\tcerts/server.pem', ''],
    ['', `+++ b/src/x.ts\n+const token = 'ghp_${'x'.repeat(36)}';`],
    ['', `+++ b/src/x.ts\n+const token = 'github_pat_${'A1_'.repeat(10)}';`],
    ['', `+++ b/.npmrc\n+//registry.npmjs.org/:_authToken=npm_${'y'.repeat(36)}`],
    // Built from two parts, so this file holds no key marker of its own for the check to find.
    ['', `+++ b/deploy/key.txt\n+-----BEGIN ${'OPENSSH PRIVATE'} KEY-----`],
  ])('refuses %j %j', (nameStatus, patch) => {
    expect(secretFindings(nameStatus, patch).length).toBeGreaterThan(0);
  });

  test('passes ordinary changes, a deleted key file and a removed token line', () => {
    expect(secretFindings('M\tsrc/app.ts\nD\told/.env\nA\tdocs/pem-format.md', `+++ b/src/app.ts\n+const app = 2;\n-const token = 'ghp_${'x'.repeat(36)}';`)).toEqual([]);
  });
});

describe('the reuse of a downloaded CI run', () => {
  test('a complete run of the same measured commit and settings is found; other settings or an incomplete run are not', () => {
    const calibration = mkdtempSync(join(tmpdir(), 'bank-ci-reuse-'));
    made.push(calibration);
    const measured = 'b'.repeat(40);
    const write = (name: string, settings: unknown, complete: boolean) => {
      put(calibration, `${name}/ci.json`, JSON.stringify({ measuredCommit: measured, settings }));
      put(calibration, `${name}/run.json`, JSON.stringify({ complete }));
    };
    write('r71-a', runSettings(config), true);
    expect(findReuse(calibration, measured, config)).toBe(join(calibration, 'r71-a'));
    expect(findReuse(calibration, 'c'.repeat(40), config)).toBeNull();
    const other = validateRunConfig({ name: 'r71-test', jobs: 2, slicesPerJob: 2 }, BANK_TRANCHES);
    expect(findReuse(calibration, measured, other)).toBeNull();
    rmSync(join(calibration, 'r71-a'), { recursive: true });
    write('r71-b', runSettings(config), false);
    expect(findReuse(calibration, measured, config)).toBeNull();
  });
});
describe('waiting for the CI run', () => {
  // Round 72: gh run watch also ends on an API error (HTTP 504 on run 39262005491), and the script read the run as over
  // while it ran; the run's own status decides now.
  const scripted = (watches: (Error | null)[], views: (Error | { status: string; conclusion?: string })[]) => {
    const calls = { watch: 0, view: 0 };
    const watch = () => {
      const step = watches[Math.min(calls.watch++, watches.length - 1)];
      if (step) throw step;
    };
    const view = () => {
      const step = views[Math.min(calls.view++, views.length - 1)];
      if (step instanceof Error) throw step;
      return step;
    };
    return { watch, view, wait: async () => undefined, calls };
  };

  test('a watch that ends on an API error waits on until the run is completed', async () => {
    const run = scripted([new Error('HTTP 504'), null], [{ status: 'in_progress' }, { status: 'completed', conclusion: 'success' }]);
    expect(await waitForRun(1, run)).toBe('success');
    expect(run.calls.watch).toBe(2);
  });

  test('a failed run reads as failure, and a status that cannot be read is asked again', async () => {
    expect(await waitForRun(1, scripted([new Error('exit 1')], [{ status: 'completed', conclusion: 'failure' }]))).toBe('failure');
    const run = scripted([null], [new Error('HTTP 502'), { status: 'completed', conclusion: 'success' }]);
    expect(await waitForRun(1, run)).toBe('success');
    expect(run.calls.view).toBe(2);
  });

  test('gives up as unknown after its attempts', async () => {
    expect(await waitForRun(1, { ...scripted([null], [{ status: 'in_progress' }]), attempts: 3 })).toBe('unknown');
  });
});

describe('a finished run that GitHub holds open', () => {
  // Round 76 (T266): on 22.10.2026 the Champions OU holdout run of r74-k finished its 16 jobs and its merge, and GitHub kept the
  // run "in_progress" for about an hour. The run's jobs and its merged artifact decide, after a grace period.
  const JOBS = 4;
  const MERGE = 'Merge the jobs';
  type Job = { name: string; status: string; conclusion?: string };
  const done = (name: string, conclusion = 'success'): Job => ({ name, status: 'completed', conclusion });
  const allJobs = (overrides: Record<string, Job> = {}): Job[] => [
    done('Read the run'), ...Array.from({ length: JOBS }, (_, index) => done(`Job ${index}`)), done(MERGE),
  ].map(job => overrides[job.name] ?? job);

  /** A clock that only the waits move; every view and artifact list is the scripted answer at that time. */
  function held(stateAt: (seconds: number) => { status: string; conclusion?: string; jobs?: Job[] }, artifactsAt: (seconds: number) => string[]) {
    const clock = { ms: 0 };
    const calls = { views: 0, waits: 0 };
    return {
      clock, calls,
      watch: () => undefined,
      view: () => { calls.views++; return stateAt(clock.ms / 1000); },
      artifacts: () => artifactsAt(clock.ms / 1000),
      wait: async (ms: number) => { calls.waits++; clock.ms += ms; },
      now: () => clock.ms,
      expectedJobs: JOBS + 2,
      artifactName: 'run-r76-test',
      graceMs: 300_000,
    };
  }
  const merged = ['job-0', 'run-r76-test'];

  test('downloads after the grace period when every job is completed and the merged artifact is there', async () => {
    const run = held(() => ({ status: 'in_progress', jobs: allJobs() }), () => merged);
    expect(await waitForRun(1, run)).toBe('success');
    expect(run.clock.ms).toBeGreaterThanOrEqual(300_000);
    expect(run.clock.ms).toBeLessThan(300_000 + 60_000);
  });

  test('a failed slice job reads as a failure, and the run still comes back for its merged rows', async () => {
    const run = held(() => ({ status: 'in_progress', jobs: allJobs({ 'Job 2': done('Job 2', 'failure') }) }), () => merged);
    expect(await waitForRun(1, run)).toBe('failure');
  });

  test.each([
    ['a job still running', () => ({ status: 'in_progress', jobs: allJobs({ 'Job 1': { name: 'Job 1', status: 'in_progress' } }) }), () => merged],
    ['the merge job queued', () => ({ status: 'in_progress', jobs: allJobs({ [MERGE]: { name: MERGE, status: 'queued' } }) }), () => merged],
    ['the merge job missing', () => ({ status: 'in_progress', jobs: allJobs().filter(job => job.name !== MERGE) }), () => merged],
    ['jobs missing from the matrix', () => ({ status: 'in_progress', jobs: allJobs().slice(0, 3) }), () => merged],
    ['the merged artifact missing', () => ({ status: 'in_progress', jobs: allJobs() }), () => ['job-0']],
  ] as const)('%s: waits on and gives up as unknown', async (_label, state, artifacts) => {
    expect(await waitForRun(1, { ...held(state, artifacts), attempts: 40 })).toBe('unknown');
  });

  test('the grace period starts again when a job runs again, and the run\'s own conclusion wins once GitHub gives it', async () => {
    const rerun = held(seconds => (seconds >= 120 && seconds < 240
      ? { status: 'in_progress', jobs: allJobs({ 'Job 3': { name: 'Job 3', status: 'in_progress' } }) }
      : { status: 'in_progress', jobs: allJobs() }), () => merged);
    expect(await waitForRun(1, rerun)).toBe('success');
    // Finished at 0 s, interrupted from 120 s to 240 s, finished again from 240 s: released no earlier than 540 s.
    expect(rerun.clock.ms).toBeGreaterThanOrEqual(540_000);

    const closed = held(seconds => (seconds >= 60
      ? { status: 'completed', conclusion: 'cancelled', jobs: allJobs() }
      : { status: 'in_progress', jobs: allJobs() }), () => merged);
    expect(await waitForRun(1, closed)).toBe('cancelled');
    expect(closed.clock.ms).toBeLessThan(300_000);
  });

  test('an API error on the artifacts is asked again', async () => {
    const run = held(() => ({ status: 'in_progress', jobs: allJobs() }), () => merged);
    let failures = 2;
    const flaky = { ...run, artifacts: () => { if (failures-- > 0) throw new Error('HTTP 502'); return merged; } };
    expect(await waitForRun(1, flaky)).toBe('success');
  });
});

describe('resuming a run whose watcher ended', () => {
  const runs = [
    { databaseId: 11, headSha: 'a'.repeat(40), url: 'https://example.org/11', workflowName: 'Tests', headBranch: 'bank/r76-x' },
    { databaseId: 12, headSha: 'b'.repeat(40), url: 'https://example.org/12', workflowName: 'Bank', headBranch: 'bank/r76-x' },
  ];
  const ghAnswering = (log: string[]) => (args: string[]) => {
    log.push(args.join(' '));
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify(runs);
    if (args[0] === 'run' && args[1] === 'view') return JSON.stringify(runs.find(entry => String(entry.databaseId) === args[2]));
    throw new Error(`unexpected gh call ${args.join(' ')}`);
  };

  test('by name: the newest run of the Bank workflow on bank/<name>', () => {
    const log: string[] = [];
    expect(findRunByTarget('r76-x', ghAnswering(log))).toMatchObject({ databaseId: 12, name: 'r76-x' });
    expect(log[0]).toContain('--branch bank/r76-x');
  });

  test('by run id: the run and the name of its branch', () => {
    expect(findRunByTarget('12', ghAnswering([]))).toMatchObject({ databaseId: 12, name: 'r76-x', headSha: 'b'.repeat(40) });
  });

  test('a run of another workflow is refused, and so is a name without a run', () => {
    expect(() => findRunByTarget('11', ghAnswering([]))).toThrow(/Bank/);
    expect(() => findRunByTarget('nobody', () => '[]')).toThrow(/no run/);
  });

  test('collecting: the wait, the download, the record and then the branch delete, also when the wait ends in a failure', async () => {
    const order: string[] = [];
    const steps = (conclusion: string) => ({
      wait: async () => { order.push('wait'); return conclusion; },
      download: () => order.push('download'),
      record: (value: string) => order.push(`record ${value}`),
      cleanup: () => order.push('delete'),
    });
    expect(await collectRun(steps('success'))).toBe('success');
    expect(order).toEqual(['wait', 'download', 'record success', 'delete']);
    order.length = 0;
    expect(await collectRun(steps('failure'))).toBe('failure');
    expect(order).toEqual(['wait', 'download', 'record failure', 'delete']);
    order.length = 0;
    await expect(collectRun({ ...steps('success'), download: () => { throw new Error('no artifact'); } })).rejects.toThrow('no artifact');
    expect(order).toEqual(['wait', 'delete']);
  });
});
