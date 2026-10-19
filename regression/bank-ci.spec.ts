import { afterAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildRunCommit, deleteArgs, findReuse, pushRefspec, runSettings, secretFindings } from '../scripts/bank-ci.mjs';
import { BANK_TRANCHES, validateRunConfig } from '../scripts/bank-run-config.mjs';

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

describe('the secret check before a push', () => {
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
