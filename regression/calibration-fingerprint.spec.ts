import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quickFraction } from './bank-universe';
import {
  FINGERPRINT_PATHS, canonicalJson, computeFingerprint, decideReuse, fingerprintRecord, hashDirectory, leverEnv, parseFraction,
  quickTierLines, runFraction,
} from '../scripts/calibration-fingerprint.mjs';

/**
 * Round 70 (bank tooling): the fingerprint of a bank run and the reuse of a finished base. A fingerprint
 * names everything that decides the rows (the git tree ids of the tracked inputs at HEAD, the content of
 * the two caches, the lever env, the Node version). Every run writes it into run.json; with a clean tree
 * `run-calibration.mjs --reuse` prints the folder of a finished run that carries the same one instead of
 * running again. The specs build small git repositories in temporary folders and run the runner against a
 * stand-in for the slices; no bank runs.
 */

const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const made: string[] = [];
let template = '';

const sh = (cwd: string, command: string, ...args: string[]) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (root: string, ...args: string[]) => sh(root, 'git', ...args);
const put = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const commit = (root: string) => {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'step');
};
/** The file a test edits for an input path: the path itself for a root file, file.txt inside a folder. */
const fileOf = (path: string) => (path.includes('.') ? path : `${path}/file.txt`);

beforeAll(() => {
  template = mkdtempSync(join(tmpdir(), 'fingerprint-template-'));
  made.push(template);
  git(template, 'init', '-q');
  for (const [key, value] of [['user.name', 'test'], ['user.email', 'test@example.org'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) {
    git(template, 'config', key, value);
  }
  put(template, '.gitignore', 'node_modules/\n.smogon-cache/\n.fit-corpus/\n.calibration/\ncalls.log\n');
  for (const path of FINGERPRINT_PATHS) put(template, fileOf(path), `${path} one\n`);
  put(template, 'docs/note.md', 'note one\n');
  put(template, 'node_modules/.package-lock.json', '{"packages":{}}\n');
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

/** A fresh checkout of the template: same files, same history, its own folder. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'fingerprint-'));
  made.push(root);
  cpSync(template, root, { recursive: true });
  return root;
}

const fp = (root: string, extra: Record<string, unknown> = {}) =>
  computeFingerprint({ root, env: { EVAL_CALIBRATION_MODE: 'auto' }, ambient: {}, ...extra });

describe('fingerprint of a run', () => {
  test('the tracked inputs include the folders and files the bank reads', () => {
    expect(FINGERPRINT_PATHS).toEqual(expect.arrayContaining(['packages', 'src', 'regression', 'scripts', 'package-lock.json']));
  });

  test('the same inputs give the same value, in another checkout of the same content too', () => {
    const first = fp(repo());
    const second = fp(repo());
    expect(first.value).toMatch(/^[0-9a-f]{64}$/);
    expect(first.dirty).toBe(false);
    expect(first.dirtyPaths).toEqual([]);
    expect(first.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(second.value).toBe(first.value);
    expect(canonicalJson(second.inputs)).toBe(canonicalJson(first.inputs));
  });

  test.each(FINGERPRINT_PATHS)('a committed change under %s changes the value', path => {
    const root = repo();
    const before = fp(template).value;
    put(root, fileOf(path), `${path} two\n`);
    commit(root);
    const after = fp(root);
    expect(after.dirty).toBe(false);
    expect(after.value).not.toBe(before);
  });

  test('a committed change outside the inputs, and a commit that changes nothing, keep the value', () => {
    const root = repo();
    const before = fp(root).value;
    put(root, 'docs/note.md', 'note two\n');
    put(root, 'README.md', 'readme\n');
    commit(root);
    commit(root);
    expect(fp(root).value).toBe(before);
  });

  test('an uncommitted edit, a staged edit, a removed file or an untracked file under an input marks the tree dirty and names it', () => {
    const edited = repo();
    put(edited, 'docs/note.md', 'note two\n');
    expect(fp(edited).dirty).toBe(false);
    put(edited, 'src/file.txt', 'src two\n');
    expect(fp(edited)).toMatchObject({ dirty: true, dirtyPaths: ['src/file.txt'] });

    const staged = repo();
    put(staged, 'packages/file.txt', 'packages two\n');
    git(staged, 'add', '-A');
    expect(fp(staged)).toMatchObject({ dirty: true, dirtyPaths: ['packages/file.txt'] });

    const removed = repo();
    rmSync(join(removed, 'scripts/file.txt'));
    expect(fp(removed)).toMatchObject({ dirty: true, dirtyPaths: ['scripts/file.txt'] });

    const untracked = repo();
    put(untracked, 'regression/new.spec.ts', 'export {};\n');
    put(untracked, 'package.json.bak', 'stray\n');
    expect(fp(untracked)).toMatchObject({ dirty: true, dirtyPaths: ['regression/new.spec.ts'] });
    // The value still names HEAD's inputs; the dirty flag is what keeps the run from serving as a base.
    expect(fp(untracked).value).toBe(fp(template).value);
  });

  test('git that cannot read the inputs gives no value and a dirty flag', () => {
    const bare = mkdtempSync(join(tmpdir(), 'fingerprint-bare-'));
    made.push(bare);
    expect(fp(bare)).toMatchObject({ value: null, dirty: true, inputs: null, problem: expect.stringMatching(/git/i) });
  });

  test('env keys change the value; ambient levers count, other ambient variables and the runner-owned keys do not', () => {
    const root = repo();
    const base = fp(root).value;
    expect(fp(root, { env: { EVAL_CALIBRATION_MODE: 'mcts' } }).value).not.toBe(base);
    expect(fp(root, { env: { EVAL_CALIBRATION_MODE: 'auto', EVAL_CALIBRATION_FRACTION: '0.25' } }).value).not.toBe(base);
    expect(fp(root, { env: { EVAL_CALIBRATION_MODE: 'auto', ANY_KEY_OF_THE_RUN: '1' } }).value).not.toBe(base);
    expect(fp(root, { ambient: { EVAL_SIM_FAST: '0' } }).value).not.toBe(base);
    expect(fp(root, { ambient: { NODE_OPTIONS: '--stack-size=2000' } }).value).not.toBe(base);
    expect(fp(root, { ambient: { PATH: '/bin', USERNAME: 'someone', FOO: 'bar' } }).value).toBe(base);
    expect(fp(root, { ambient: { EVAL_CALIBRATION_SLICE: '1/4', EVAL_CALIBRATION_DUMP: 'x.jsonl' } }).value).toBe(base);
    expect(fp(root, { env: { EVAL_CALIBRATION_MODE: 'auto', EVAL_CALIBRATION_SLICE: '3/6' } }).value).toBe(base);
    // The order of the keys does not matter.
    expect(fp(root, { env: { B_KEY: '1', A_KEY: '2' } }).value).toBe(fp(root, { env: { A_KEY: '2', B_KEY: '1' } }).value);
  });

  test('leverEnv lets the run override the ambient value and sorts its keys', () => {
    expect(leverEnv(
      { EVAL_SIM_FAST: '0', EVAL_CALIBRATION_MODE: 'mcts', CALIB_POS_PROBE: '1', PATH: 'x', EVAL_CALIBRATION_DUMP: 'a' },
      { EVAL_CALIBRATION_MODE: 'auto', EVAL_CALIBRATION: '1', EVAL_CALIBRATION_SLICE: '0/4' },
    )).toEqual({ CALIB_POS_PROBE: '1', EVAL_CALIBRATION: '1', EVAL_CALIBRATION_MODE: 'auto', EVAL_SIM_FAST: '0' });
    expect(Object.keys(leverEnv({ EVAL_B: '1', EVAL_A: '2' }, {}))).toEqual(['EVAL_A', 'EVAL_B']);
  });

  test('a cache file changes the value: other content of the same size, a new file, a removed file', () => {
    const base = fp(repo()).value;
    const sameSize = repo();
    put(sameSize, '.smogon-cache/sets.json', '{"status":404}\n');
    expect(readFileSync(join(sameSize, '.smogon-cache/sets.json')).length).toBe(readFileSync(join(template, '.smogon-cache/sets.json')).length);
    expect(fp(sameSize).value).not.toBe(base);
    const added = repo();
    put(added, '.fit-corpus/2.json', '{"id":"2"}\n');
    expect(fp(added).value).not.toBe(base);
    const removed = repo();
    rmSync(join(removed, '.fit-corpus/1.json'));
    expect(fp(removed).value).not.toBe(base);
    const nested = repo();
    put(nested, '.fit-corpus/sub/3.json', '{}\n');
    expect(fp(nested).value).not.toBe(base);
    // The caches are ignored by git: editing them leaves the tree clean.
    expect(fp(sameSize).dirty).toBe(false);
  });

  test('a stray temp file of a sibling process and a touched modification time keep the value', () => {
    const root = repo();
    const base = fp(root).value;
    put(root, '.smogon-cache/sets.json.1234.tmp', 'half');
    utimesSync(join(root, '.smogon-cache/sets.json'), new Date(2020, 1, 1), new Date(2020, 1, 1));
    expect(fp(root).value).toBe(base);
  });

  test('the installed dependency tree and the Node version count', () => {
    const root = repo();
    const base = fp(root).value;
    put(root, 'node_modules/.package-lock.json', '{"packages":{"node_modules/@pkmn/sim":{"version":"0.10.12"}}}\n');
    expect(fp(root).value).not.toBe(base);
    rmSync(join(root, 'node_modules/.package-lock.json'));
    expect(fp(root).value).not.toBe(base);
    const node = { version: 'v99.0.0', platform: process.platform, arch: process.arch };
    expect(fp(repo(), { node }).value).not.toBe(base);
    expect(fp(repo(), { node: { version: process.version, platform: process.platform, arch: process.arch } }).value).toBe(base);
  });

  test('the slice count counts: no pair of runs has shown that the rows ignore it', () => {
    const root = repo();
    const four = fp(root, { slices: 4 }).value;
    expect(fp(root, { slices: 4 }).value).toBe(four);
    expect(fp(root, { slices: 6 }).value).not.toBe(four);
    expect(fp(root).value).not.toBe(four);
  });

  test('hashDirectory reads names, contents and nesting in code unit order, and a missing folder as null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fingerprint-dir-'));
    made.push(dir);
    expect(hashDirectory(join(dir, 'absent'))).toBeNull();
    expect(hashDirectory(dir)).toMatchObject({ files: 0, bytes: 0 });
    put(dir, 'b.json', 'bb');
    put(dir, 'a.json', 'a');
    put(dir, 'sub/c.json', 'ccc');
    const first = hashDirectory(dir);
    expect(first).toMatchObject({ files: 3, bytes: 6 });
    put(dir, 'a.json', 'b');
    put(dir, 'b.json', 'ab');
    expect(hashDirectory(dir)?.sha256).not.toBe(first?.sha256);
    put(dir, 'a.json', 'a');
    put(dir, 'b.json', 'bb');
    expect(hashDirectory(dir)).toEqual(first);
  });

  test('canonicalJson sorts the keys of nested objects and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });
});

describe('fraction of a run', () => {
  const cases = [undefined, '', ' ', '1', '1.0', '0.25', ' 0.5 ', '5e-1', '.5', '0', '-0.5', '1.5', '2', 'abc', '25%', 'NaN', 'Infinity'];

  test('parseFraction reads an unset or empty value as the whole universe and refuses what is no share', () => {
    expect(parseFraction(undefined)).toBe(1);
    expect(parseFraction('')).toBe(1);
    expect(parseFraction('0.25')).toBe(0.25);
    for (const value of ['0', '-0.5', '1.5', 'abc', '25%', 'NaN', 'Infinity']) {
      expect(() => parseFraction(value), value).toThrow(/EVAL_CALIBRATION_FRACTION/);
    }
  });

  test('the script and the harness read every value the same way', () => {
    for (const value of cases) {
      const script = (() => { try { return parseFraction(value); } catch { return 'throws'; } })();
      const harness = (() => { try { return quickFraction(value); } catch { return 'throws'; } })();
      expect(script, String(value)).toBe(harness);
    }
  });

  test('runFraction reads the fraction a run recorded, else its env, else the whole universe', () => {
    expect(runFraction({ fraction: 0.25 })).toBe(0.25);
    expect(runFraction({ env: { EVAL_CALIBRATION_FRACTION: '0.5' } })).toBe(0.5);
    expect(runFraction({ env: { EVAL_CALIBRATION_MODE: 'auto' } })).toBe(1);
    expect(runFraction({})).toBe(1);
    expect(runFraction({ env: { EVAL_CALIBRATION_FRACTION: 'junk' } })).toBeNull();
  });
});

const ROWS = Array.from({ length: 3 }, (_, turn) => JSON.stringify({ id: 'gen9ou-1', turn: turn + 2, score: 0.1, p1Won: true })).join('\n') + '\n';

/** A folder under .calibration/ the way run-calibration.mjs leaves it, with `over` laid on top of run.json. */
function finishedRun(root: string, name: string, record: unknown, over: Record<string, unknown> = {}, rows = ROWS) {
  put(root, `.calibration/${name}/merged.jsonl`, rows);
  put(root, `.calibration/${name}/summary.txt`, 'early: n=3\n');
  put(root, `.calibration/${name}/run.json`, JSON.stringify({
    commit: 'abc1234', startedAt: '2026-10-13T10:00:00.000Z', finishedAt: '2026-10-13T10:20:00.000Z', slices: 4, env: {},
    samples: 3, results: [{ index: 0, code: 0, seconds: 10 }], fraction: 1, complete: true, httpSkips: 0,
    mergedSha256: createHash('sha256').update(rows).digest('hex'), fingerprint: record, ...over,
  }));
  return join(root, '.calibration', name);
}

describe('reuse of a finished run', () => {
  const settled = (root: string, extra: Record<string, unknown> = {}) => {
    const now = fp(root, extra);
    return { now, record: fingerprintRecord(now, now) };
  };

  test('a finished run with the same fingerprint is the base; the newest of several wins', () => {
    const root = repo();
    const { now, record } = settled(root);
    const older = finishedRun(root, 'older', record, { finishedAt: '2026-10-12T10:00:00.000Z' });
    const newer = finishedRun(root, 'newer', record, { finishedAt: '2026-10-13T11:00:00.000Z' });
    expect(older).not.toBe(newer);
    const decision = decideReuse({ fingerprint: now, calibrationDir: join(root, '.calibration') });
    expect(decision).toMatchObject({ action: 'reuse', dir: newer, matches: 2 });
  });

  test('a dirty tree never reuses, even with a matching run', () => {
    const root = repo();
    const { record } = settled(root);
    finishedRun(root, 'base', record);
    put(root, 'src/file.txt', 'edited\n');
    const dirty = fp(root);
    expect(dirty.value).toBe(settled(template).now.value);
    expect(decideReuse({ fingerprint: dirty, calibrationDir: join(root, '.calibration') })).toMatchObject({ action: 'run', reason: 'dirty' });
  });

  test('git that cannot answer gives no reuse', () => {
    const bare = mkdtempSync(join(tmpdir(), 'fingerprint-bare-'));
    made.push(bare);
    expect(decideReuse({ fingerprint: fp(bare), calibrationDir: join(bare, '.calibration') })).toMatchObject({ action: 'run', reason: 'unavailable' });
  });

  test('a run that is dirty, unstable, unfinished, failed, short of rows or without a fingerprint is no base', () => {
    const root = repo();
    const { now, record } = settled(root);
    finishedRun(root, 'dirty', { ...record, dirty: true });
    finishedRun(root, 'unstable', { ...record, stable: false });
    finishedRun(root, 'incomplete', record, { complete: false });
    finishedRun(root, 'failed', record, { results: [{ index: 0, code: 1, seconds: 10 }] });
    finishedRun(root, 'no-end', record, { finishedAt: undefined });
    finishedRun(root, 'no-samples', record, { samples: 0 });
    finishedRun(root, 'short', record, { samples: 4 });
    finishedRun(root, 'old-format', undefined);
    finishedRun(root, 'other-value', { ...record, value: 'f'.repeat(64) });
    put(root, '.calibration/empty/readme.txt', 'no run.json here\n');
    put(root, '.calibration/garbled/run.json', '{ not json');
    const decision = decideReuse({ fingerprint: now, calibrationDir: join(root, '.calibration') });
    expect(decision).toMatchObject({ action: 'run', reason: 'no-match' });
  });

  test('a run whose merged dump or summary went missing, or whose dump changed, is no base', () => {
    const root = repo();
    const { now, record } = settled(root);
    const dir = finishedRun(root, 'hollow', record);
    const calibrationDir = join(root, '.calibration');
    rmSync(join(dir, 'summary.txt'));
    expect(decideReuse({ fingerprint: now, calibrationDir })).toMatchObject({ action: 'run', reason: 'no-match' });
    put(root, '.calibration/hollow/summary.txt', 'back\n');
    expect(decideReuse({ fingerprint: now, calibrationDir })).toMatchObject({ action: 'reuse' });
    // Same row count, other bytes: a re-run into the folder that has not written its run.json yet.
    put(root, '.calibration/hollow/merged.jsonl', ROWS.replace('0.1', '0.2'));
    expect(decideReuse({ fingerprint: now, calibrationDir })).toMatchObject({ action: 'run', reason: 'no-match' });
    put(root, '.calibration/hollow/merged.jsonl', ROWS);
    expect(decideReuse({ fingerprint: now, calibrationDir })).toMatchObject({ action: 'reuse' });
    rmSync(join(dir, 'merged.jsonl'));
    expect(decideReuse({ fingerprint: now, calibrationDir })).toMatchObject({ action: 'run', reason: 'no-match' });
  });

  test('a run that lost replays to HTTP errors is no base', () => {
    const root = repo();
    const { now, record } = settled(root);
    finishedRun(root, 'lossy', record, { httpSkips: 2, complete: false });
    expect(decideReuse({ fingerprint: now, calibrationDir: join(root, '.calibration') })).toMatchObject({ action: 'run', reason: 'no-match' });
  });

  test('without a match the decision names what differs from the closest finished run', () => {
    const root = repo();
    const base = settled(root);
    finishedRun(root, 'base', base.record);
    const far = settled(root, { env: { EVAL_CALIBRATION_MODE: 'mcts' }, node: { version: 'v1.0.0', platform: 'x', arch: 'y' } });
    finishedRun(root, 'far', far.record);
    const quick = settled(root, { env: { EVAL_CALIBRATION_MODE: 'auto', EVAL_CALIBRATION_FRACTION: '0.25' } });
    const decision = decideReuse({ fingerprint: quick.now, calibrationDir: join(root, '.calibration') });
    expect(decision).toMatchObject({ action: 'run', reason: 'no-match', nearest: { differs: [expect.stringContaining('EVAL_CALIBRATION_FRACTION')] } });
    expect(decision.nearest?.dir).toBe(join(root, '.calibration', 'base'));
    expect(decision.nearest?.differs).toHaveLength(1);

    put(root, 'src/file.txt', 'src two\n');
    commit(root);
    const moved = settled(root);
    const sourceDecision = decideReuse({ fingerprint: moved.now, calibrationDir: join(root, '.calibration') });
    expect(sourceDecision.nearest?.differs).toEqual(['src']);
  });

  test('no fingerprinted run at all says so', () => {
    const root = repo();
    finishedRun(root, 'before-the-tool', undefined);
    const decision = decideReuse({ fingerprint: fp(root), calibrationDir: join(root, '.calibration') });
    expect(decision).toMatchObject({ action: 'run', reason: 'no-match' });
    expect(decision.nearest).toBeUndefined();
  });

  test('the record keeps a settled run reusable, lets the Smogon cache grow, and refuses a tree that moved', () => {
    const root = repo();
    const start = fp(root);
    expect(fingerprintRecord(start, start)).toMatchObject({ value: start.value, dirty: false, stable: true, smogonCacheGrew: false });

    put(root, '.smogon-cache/new.json', '{"status":404}\n');
    const grown = fingerprintRecord(start, fp(root));
    expect(grown).toMatchObject({ dirty: false, stable: true, smogonCacheGrew: true, startValue: start.value });
    expect(grown.value).toBe(fp(root).value);
    expect(grown.value).not.toBe(start.value);

    put(root, '.fit-corpus/2.json', '{}\n');
    expect(fingerprintRecord(start, fp(root))).toMatchObject({ stable: false });

    const edited = repo();
    const before = fp(edited);
    put(edited, 'src/file.txt', 'edited during the run\n');
    expect(fingerprintRecord(before, fp(edited))).toMatchObject({ dirty: true, dirtyPaths: ['src/file.txt'] });

    const bare = mkdtempSync(join(tmpdir(), 'fingerprint-bare-'));
    made.push(bare);
    expect(fingerprintRecord(fp(bare), fp(bare))).toMatchObject({ value: null, dirty: true, stable: false });
  });
});

describe('quick tier in the paired header', () => {
  function pair(a: number | undefined, b: number | undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'fingerprint-pair-'));
    made.push(dir);
    for (const [name, fraction] of [['a', a], ['b', b]] as const) {
      put(dir, `${name}/merged.jsonl`, ROWS);
      if (fraction !== undefined) put(dir, `${name}/run.json`, JSON.stringify({ fraction, env: {} }));
    }
    return { aPath: join(dir, 'a', 'merged.jsonl'), bPath: join(dir, 'b', 'merged.jsonl') };
  }
  const counts = { aRows: 837, pairs: 209, replays: 52 };

  test('a quick side names its fraction, the pairing count and its share of the base', () => {
    const lines = quickTierLines({ ...pair(1, 0.25), ...counts });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "quick tier: A ran the full universe, B ran EVAL_CALIBRATION_FRACTION=0.25. They pair on the 209 positions of 52 replays that both dumps hold, 25.0 % of A's 837.");
    expect(lines[1]).toContain('fixes K from all 837 positions of A');
    expect(lines[1]).toContain('the own K table fits K on the 209 pairs');
    expect(lines[2]).toContain('screens a change');
  });

  test('two full runs, or dumps without a run.json, print nothing extra', () => {
    expect(quickTierLines({ ...pair(1, 1), ...counts })).toEqual([]);
    expect(quickTierLines({ ...pair(undefined, undefined), ...counts })).toEqual([]);
    expect(quickTierLines({ ...pair(1, undefined), ...counts })).toEqual([]);
  });

  test('a quick run in the A slot tells the reader to put the full run first', () => {
    const lines = quickTierLines({ ...pair(0.25, 1), aRows: 209, pairs: 209, replays: 52 });
    expect(lines[0]).toContain('A ran EVAL_CALIBRATION_FRACTION=0.25, B ran the full universe');
    expect(lines[1]).toContain('put the full run first');
  });

  test('a side without a run.json is named when the other side ran quick, and joined dumps read every run.json', () => {
    expect(quickTierLines({ ...pair(undefined, 0.5), ...counts })[0]).toContain('A has no run.json next to its dump');
    const first = pair(1, 0.25);
    const second = pair(1, 0.5);
    const joined = quickTierLines({ aPath: `${first.aPath},${second.aPath}`, bPath: `${first.bPath},${second.bPath}`, ...counts });
    expect(joined[0]).toContain('B ran EVAL_CALIBRATION_FRACTION=0.25 and 0.5');
  });
});

describe('run-calibration.mjs against a stand-in for the slices', () => {
  // The stand-in takes the place of vitest: it writes the dump of its slice and counts its calls, so the runner's own
  // work (fingerprint, reuse, merge, run.json) runs for real and no bank starts.
  const STAND_IN = `
import { appendFileSync, writeFileSync } from 'node:fs';
const slice = process.env.EVAL_CALIBRATION_SLICE;
const index = Number(slice.split('/')[0]);
appendFileSync(new URL('../../calls.log', import.meta.url), slice + ' fraction=' + (process.env.EVAL_CALIBRATION_FRACTION ?? '') + '\\n');
if (process.env.STAND_IN_HTTP_SKIP) console.log('skipping gen9ou-' + index + ': HTTP 503');
const rows = [2, 3].map(turn => ({ id: 'gen9ou-' + index, turn, tranche: 'ladder', phase: 'early', gameType: 'singles', score: 0.2 + index / 10, faintedFraction: 0, p1Won: true }));
writeFileSync(process.env.EVAL_CALIBRATION_DUMP, rows.map(row => JSON.stringify(row)).join('\\n') + '\\n');
console.log('stand-in done');
`;
  const lever = /^(EVAL|CALIB)_/;
  const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !lever.test(key)));

  function standInRoot(): string {
    const root = repo();
    for (const name of ['run-calibration.mjs', 'calibration-lib.mjs', 'calibration-fingerprint.mjs', 'calibration-jobs.mjs']) copyFileSync(join(SCRIPTS, name), join(root, 'scripts', name));
    put(root, 'node_modules/vitest/vitest.mjs', STAND_IN);
    commit(root);
    return root;
  }
  const cli = (root: string, ...args: string[]) =>
    spawnSync(process.execPath, [join(root, 'scripts', 'run-calibration.mjs'), ...args], { cwd: root, encoding: 'utf8', env: cleanEnv() });
  const calls = (root: string) => (existsSync(join(root, 'calls.log')) ? readFileSync(join(root, 'calls.log'), 'utf8').split(/\r?\n/).filter(Boolean).length : 0);
  const recordOf = (root: string, name: string) => JSON.parse(readFileSync(join(root, '.calibration', name, 'run.json'), 'utf8'));
  const lastLine = (text: string) => text.trim().split(/\r?\n/).at(-1) ?? '';
  /** The folder a run printed and the folder a test expects, compared by their real paths (a temp folder may have two spellings). */
  const printed = (text: string) => realpathSync.native(lastLine(text));
  const folder = (root: string, name: string) => realpathSync.native(join(root, '.calibration', name));

  test('a run writes its fingerprint, fraction and completeness into run.json', () => {
    const root = standInRoot();
    const result = cli(root, '--slices', '2', '--out', '.calibration/first');
    expect(result.status, result.stderr).toBe(0);
    expect(calls(root)).toBe(2);
    const record = recordOf(root, 'first');
    expect(record).toMatchObject({ samples: 4, slices: 2, fraction: 1, complete: true, fingerprint: { dirty: false, stable: true, smogonCacheGrew: false } });
    expect(record.fingerprint.value).toMatch(/^[0-9a-f]{64}$/);
    expect(record.fingerprint.inputs.env).toMatchObject({ EVAL_CALIBRATION: '1', EVAL_CALIBRATION_MODE: 'auto', EVAL_CALIBRATION_SMOGON: '1' });
    expect(record.env).toEqual({ EVAL_CALIBRATION_MODE: 'auto', EVAL_CALIBRATION_SMOGON: '1' });
    expect(result.stdout).toMatch(/fingerprint [0-9a-f]{12} \(clean tree at/);
    expect(result.stdout).toMatch(/fingerprint [0-9a-f]{12} recorded in run\.json; --reuse finds this run/);
    // The recorded hash is the hash of the merged dump on disk.
    const merged = readFileSync(join(root, '.calibration', 'first', 'merged.jsonl'));
    expect(record).toMatchObject({ httpSkips: 0, mergedSha256: createHash('sha256').update(merged).digest('hex') });
  });

  test('a replay lost to an HTTP error shows in run.json and keeps the run from serving as a base', () => {
    const root = standInRoot();
    const result = cli(root, '--slices', '2', '--out', '.calibration/lossy', '--env', 'STAND_IN_HTTP_SKIP=1');
    expect(result.status, result.stderr).toBe(0);
    expect(recordOf(root, 'lossy')).toMatchObject({ httpSkips: 2, complete: false, samples: 4 });
    expect(result.stdout).toMatch(/slice 0: ok, \d+s \(1 replay\(s\) skipped on HTTP errors\)/);
    expect(result.stdout).toMatch(/cannot serve as a base \(replays skipped on HTTP errors\)/);
    const dry = cli(root, '--reuse', '--dry-run', '--env', 'STAND_IN_HTTP_SKIP=1');
    expect(dry.status, dry.stdout).toBe(3);
  });

  test('--reuse prints the folder of a finished run with the same fingerprint and starts nothing', () => {
    const root = standInRoot();
    expect(cli(root, '--slices', '2', '--out', '.calibration/first').status).toBe(0);
    const again = cli(root, '--reuse', '--slices', '2', '--out', '.calibration/second');
    expect(again.status, again.stderr).toBe(0);
    expect(printed(again.stdout)).toBe(folder(root, 'first'));
    expect(again.stdout).toMatch(/reuse: .*first.* carries fingerprint [0-9a-f]{12}/);
    expect(calls(root)).toBe(2);
    expect(existsSync(join(root, '.calibration', 'second'))).toBe(false);
    // Another slice count is another run: no pair of runs has shown that the rows ignore it.
    const other = cli(root, '--reuse', '--dry-run', '--slices', '3');
    expect(other.status, other.stderr).toBe(3);
    expect(other.stdout).toMatch(/differs in slices \(3 here, 2 there\)/);
  });

  test('--reuse runs as before when the env, the tree or the fraction differs', () => {
    const root = standInRoot();
    expect(cli(root, '--slices', '2', '--out', '.calibration/first').status).toBe(0);

    const quick = cli(root, '--reuse', '--slices', '2', '--out', '.calibration/quick', '--env', 'EVAL_CALIBRATION_FRACTION=0.25');
    expect(quick.status, quick.stderr).toBe(0);
    expect(calls(root)).toBe(4);
    expect(quick.stdout).toMatch(/reuse: none.*differs in.*EVAL_CALIBRATION_FRACTION/);
    expect(quick.stdout).toMatch(/quick tier: EVAL_CALIBRATION_FRACTION=0\.25/);
    expect(recordOf(root, 'quick')).toMatchObject({ fraction: 0.25, complete: true });
    expect(readFileSync(join(root, 'calls.log'), 'utf8')).toContain('fraction=0.25');

    // The quick run is a base for the same fraction only.
    const quickAgain = cli(root, '--reuse', '--slices', '2', '--env', 'EVAL_CALIBRATION_FRACTION=0.25');
    expect(printed(quickAgain.stdout)).toBe(folder(root, 'quick'));

    put(root, 'src/file.txt', 'edited\n');
    const dirty = cli(root, '--reuse', '--slices', '2', '--out', '.calibration/dirty');
    expect(dirty.status, dirty.stderr).toBe(0);
    expect(calls(root)).toBe(6);
    expect(dirty.stdout).toMatch(/reuse: skipped.*uncommitted.*src\/file\.txt/);
    expect(recordOf(root, 'dirty').fingerprint).toMatchObject({ dirty: true, dirtyPaths: ['src/file.txt'] });
    expect(dirty.stdout).toMatch(/cannot serve as a base/);
  });

  test('a run from a dirty tree never serves as a base, even after the edit is undone', () => {
    const root = standInRoot();
    put(root, 'src/file.txt', 'edited\n');
    expect(cli(root, '--slices', '2', '--out', '.calibration/dirty').status).toBe(0);
    put(root, 'src/file.txt', 'src one\n');
    expect(fp(root).dirty).toBe(false);
    const dry = cli(root, '--reuse', '--dry-run');
    expect(dry.status, dry.stdout).toBe(3);
    expect(dry.stdout).toMatch(/reuse: none/);
    const clean = cli(root, '--reuse', '--slices', '2', '--out', '.calibration/clean');
    expect(clean.status, clean.stderr).toBe(0);
    expect(calls(root)).toBe(4);
    expect(recordOf(root, 'clean').fingerprint.dirty).toBe(false);
    // Now the clean run is the base.
    expect(printed(cli(root, '--reuse', '--dry-run', '--slices', '2').stdout)).toBe(folder(root, 'clean'));
  });

  test('--dry-run decides and prints without starting a run: exit 3 when a run would start, 0 with the folder otherwise', () => {
    const root = standInRoot();
    const none = cli(root, '--reuse', '--dry-run', '--slices', '2');
    expect(none.status, none.stderr).toBe(3);
    expect(none.stdout).toMatch(/no finished run under \.calibration carries fingerprint [0-9a-f]{12}/);
    expect(calls(root)).toBe(0);
    expect(existsSync(join(root, '.calibration'))).toBe(false);

    expect(cli(root, '--slices', '2', '--out', '.calibration/base').status).toBe(0);
    const found = cli(root, '--reuse', '--dry-run', '--slices', '2');
    expect(found.status, found.stderr).toBe(0);
    expect(printed(found.stdout)).toBe(folder(root, 'base'));

    const plain = cli(root, '--dry-run', '--slices', '2');
    expect(plain.status, plain.stderr).toBe(0);
    expect(plain.stdout).toMatch(/fingerprint [0-9a-f]{12}/);
    expect(plain.stdout).toMatch(/dry run: 2 slice\(s\) would start/);
    expect(calls(root)).toBe(2);
  });

  test('a fraction outside (0, 1] stops before any slice starts', () => {
    const root = standInRoot();
    for (const value of ['0', '2', 'abc']) {
      const result = cli(root, '--slices', '2', '--env', `EVAL_CALIBRATION_FRACTION=${value}`);
      expect(result.status, value).toBe(2);
      expect(result.stderr).toMatch(/EVAL_CALIBRATION_FRACTION/);
    }
    expect(calls(root)).toBe(0);
    expect(existsSync(join(root, '.calibration'))).toBe(false);
  });
});
