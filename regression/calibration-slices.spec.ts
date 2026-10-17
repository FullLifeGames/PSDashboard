import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINGERPRINT_PATHS } from '../scripts/calibration-fingerprint.mjs';

/**
 * Round 71 (bank in GitHub Actions): a CI job runs a range of the slices (--slice-range a..b of --slices N) and
 * leaves its dumps with a job.json; --merge joins the jobs of one run into a run folder that reads like a local run
 * (merged.jsonl, summary.txt, run.json with the fingerprint). Slices are independent, so the merged rows equal a run
 * of all slices in one process. The specs run the runner in small git repositories against a stand-in for the
 * slices; no bank runs.
 */

const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const RUNNER = ['run-calibration.mjs', 'calibration-lib.mjs', 'calibration-fingerprint.mjs', 'calibration-jobs.mjs'];
const made: string[] = [];
let template = '';

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const commit = (root: string) => {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'step');
};

// The stand-in takes the place of vitest: it writes two rows for its slice and logs its call.
const STAND_IN = `
import { appendFileSync, writeFileSync } from 'node:fs';
const slice = process.env.EVAL_CALIBRATION_SLICE;
const index = Number(slice.split('/')[0]);
appendFileSync(new URL('../../calls.log', import.meta.url), slice + '\\n');
if (process.env.STAND_IN_FAIL === String(index)) process.exit(1);
const rows = [2, 3].map(turn => ({ id: 'gen9ou-' + index, turn, tranche: 'ladder', phase: 'early', gameType: 'singles', score: 0.2 + index / 10, faintedFraction: 0, p1Won: index % 2 === 0 }));
writeFileSync(process.env.EVAL_CALIBRATION_DUMP, rows.map(row => JSON.stringify(row)).join('\\n') + '\\n');
`;

beforeAll(() => {
  template = mkdtempSync(join(tmpdir(), 'slices-template-'));
  made.push(template);
  git(template, 'init', '-q');
  for (const [key, value] of [['user.name', 'test'], ['user.email', 'test@example.org'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) {
    git(template, 'config', key, value);
  }
  put(template, '.gitignore', 'node_modules/\n.smogon-cache/\n.fit-corpus/\n.calibration/\ncalls.log\n');
  for (const path of FINGERPRINT_PATHS) put(template, path.includes('.') ? path : `${path}/file.txt`, `${path} one\n`);
  for (const name of RUNNER) copyFileSync(join(SCRIPTS, name), join(template, 'scripts', name));
  put(template, 'node_modules/.package-lock.json', '{"packages":{}}\n');
  put(template, 'node_modules/vitest/vitest.mjs', STAND_IN);
  put(template, '.smogon-cache/sets.json', '{"status":200}\n');
  put(template, '.fit-corpus/1.json', '{"id":"1"}\n');
  commit(template);
});

afterAll(() => {
  for (const dir of made) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // A temporary folder that stays behind costs nothing.
    }
  }
});

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'slices-'));
  made.push(root);
  cpSync(template, root, { recursive: true });
  return root;
}
const lever = /^(EVAL|CALIB)_/;
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !lever.test(key)));
const cli = (root: string, ...args: string[]) =>
  spawnSync(process.execPath, [join(root, 'scripts', 'run-calibration.mjs'), ...args], { cwd: root, encoding: 'utf8', env: cleanEnv() });
const calls = (root: string) => (existsSync(join(root, 'calls.log')) ? readFileSync(join(root, 'calls.log'), 'utf8').split(/\r?\n/).filter(Boolean) : []);
const read = (root: string, run: string, file: string) => readFileSync(join(root, '.calibration', run, file), 'utf8');
const json = (root: string, run: string, file: string) => JSON.parse(read(root, run, file));

/** Runs the two jobs of a four-slice run the way CI does: slices 0 and 1, then 2 and 3, each into its own folder. */
function twoJobs(root: string, ...extra: string[]) {
  const first = cli(root, '--slices', '4', '--slice-range', '0..1', '--out', '.calibration/job-a', ...extra);
  const second = cli(root, '--slices', '4', '--slice-range', '2..3', '--out', '.calibration/job-b', ...extra);
  expect(first.status, first.stderr).toBe(0);
  expect(second.status, second.stderr).toBe(0);
}

describe('a CI job runs a range of the slices', () => {
  test('the job runs only its slices and leaves dumps and a job.json, no run.json', () => {
    const root = repo();
    const result = cli(root, '--slices', '4', '--slice-range', '2..3', '--out', '.calibration/job-b');
    expect(result.status, result.stderr).toBe(0);
    expect(calls(root)).toEqual(['2/4', '3/4']);
    expect(readdirSync(join(root, '.calibration', 'job-b')).sort()).toEqual(['job.json', 'slice-2.jsonl', 'slice-2.log', 'slice-3.jsonl', 'slice-3.log']);
    const job = json(root, 'job-b', 'job.json');
    expect(job).toMatchObject({ kind: 'job', slices: 4, sliceRange: [2, 3], fraction: 1, env: { EVAL_CALIBRATION_MODE: 'auto', EVAL_CALIBRATION_SMOGON: '1' } });
    expect(job.results.map((entry: { index: number; code: number }) => [entry.index, entry.code])).toEqual([[2, 0], [3, 0]]);
    expect(job.fingerprint.value).toMatch(/^[0-9a-f]{64}$/);
    expect(job.fingerprint).toMatchObject({ dirty: false, stable: true });
  });

  test('a range outside the slice count, a reversed range and a range with --reuse stop before any slice starts', () => {
    const root = repo();
    for (const args of [['--slice-range', '3..4'], ['--slice-range', '2..1'], ['--slice-range', 'two'], ['--slice-range', '0..1', '--reuse']]) {
      const result = cli(root, '--slices', '4', '--out', '.calibration/bad', ...args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stderr).toMatch(/--slice-range/);
    }
    expect(calls(root)).toEqual([]);
    expect(existsSync(join(root, '.calibration'))).toBe(false);
  });
});

describe('--merge joins the jobs of one run', () => {
  test('two jobs merged give the rows, the summary and the fingerprint of one run of all slices', () => {
    const root = repo();
    expect(cli(root, '--slices', '4', '--out', '.calibration/whole').status).toBe(0);
    twoJobs(root);
    const merged = cli(root, '--merge', '.calibration/job-a', '--merge', '.calibration/job-b', '--out', '.calibration/merged');
    expect(merged.status, merged.stderr).toBe(0);
    expect(read(root, 'merged', 'merged.jsonl')).toBe(read(root, 'whole', 'merged.jsonl'));
    expect(read(root, 'merged', 'summary.txt')).toBe(read(root, 'whole', 'summary.txt'));
    const whole = json(root, 'whole', 'run.json');
    const run = json(root, 'merged', 'run.json');
    expect(run).toMatchObject({ slices: 4, samples: 8, complete: true, httpSkips: 0, fraction: 1, mergedSha256: whole.mergedSha256, mergedFrom: ['job-a', 'job-b'] });
    expect(run.fingerprint).toMatchObject({ value: whole.fingerprint.value, dirty: false, stable: true });
    expect(run.results.map((entry: { index: number }) => entry.index)).toEqual([0, 1, 2, 3]);
    // The merged folder is a base like a local run: --reuse with the same inputs finds a run with this fingerprint.
    const reuse = cli(root, '--reuse', '--dry-run', '--slices', '4');
    expect(reuse.status, reuse.stdout).toBe(0);
  });

  test('a missing slice, a slice twice and jobs of different runs stop the merge', () => {
    const root = repo();
    twoJobs(root);
    const gap = cli(root, '--merge', '.calibration/job-a', '--out', '.calibration/gap');
    expect(gap.status).toBe(2);
    expect(gap.stderr).toMatch(/slices 2, 3 missing/);
    const twice = cli(root, '--merge', '.calibration/job-a', '--merge', '.calibration/job-a', '--merge', '.calibration/job-b', '--out', '.calibration/twice');
    expect(twice.status).toBe(2);
    expect(twice.stderr).toMatch(/slice 0 twice/);
    expect(cli(root, '--slices', '4', '--slice-range', '2..3', '--out', '.calibration/job-other', '--env', 'EVAL_CALIBRATION_DEPTH=2').status).toBe(0);
    const mixed = cli(root, '--merge', '.calibration/job-a', '--merge', '.calibration/job-other', '--out', '.calibration/mixed');
    expect(mixed.status).toBe(2);
    expect(mixed.stderr).toMatch(/different runs/);
    for (const name of ['gap', 'twice', 'mixed']) expect(existsSync(join(root, '.calibration', name))).toBe(false);
  });

  test('a red slice merges but leaves the run incomplete and the exit code non-zero', () => {
    const root = repo();
    const red = cli(root, '--slices', '4', '--slice-range', '0..1', '--out', '.calibration/job-a', '--env', 'STAND_IN_FAIL=1');
    expect(red.status).toBe(1);
    expect(cli(root, '--slices', '4', '--slice-range', '2..3', '--out', '.calibration/job-b', '--env', 'STAND_IN_FAIL=1').status).toBe(0);
    const merged = cli(root, '--merge', '.calibration/job-a', '--merge', '.calibration/job-b', '--out', '.calibration/merged');
    expect(merged.status).toBe(1);
    expect(json(root, 'merged', 'run.json')).toMatchObject({ complete: false, samples: 6 });
    expect(merged.stderr).toMatch(/1 slice\(s\) failed or left no dump/);
  });
});
