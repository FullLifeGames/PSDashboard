import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Round 71 (bank in GitHub Actions, user 13.10.: "let's be secure here though"): the security properties of
 * .github/workflows/bank.yml, read from the file's text. Only a push to bank/** starts it, the token is read-only and
 * no job widens it or reads a secret, every action is GitHub's own and pinned to a commit, no checkout keeps
 * credentials, and no shell line holds an expression (the job index reaches the shell through env).
 */

// A Windows checkout under core.autocrlf holds the YAML with CRLF: the specs read it with LF (round 72 merge).
const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/bank.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const lines = workflow.split(/\r?\n/).filter(line => !line.trimStart().startsWith('#'));
const body = lines.join('\n');

describe('the bank workflow', () => {
  test('only a push to a bank/ branch starts it', () => {
    const on = /^on:\n((?: .*\n)+)/m.exec(body)?.[1] ?? '';
    expect(on).toBe("  push:\n    branches: ['bank/**']\n");
    for (const trigger of ['pull_request', 'pull_request_target', 'workflow_run', 'workflow_dispatch', 'schedule', 'issue_comment']) {
      expect(body).not.toContain(`${trigger}:`);
    }
  });

  test('the token can read the repository and nothing else, and no job holds a secret', () => {
    // The block holds one line and ends at the blank line before the next key.
    expect(body).toMatch(/^permissions:\n {2}contents: read\n\n/m);
    expect(body.match(/permissions:/g)).toHaveLength(1);
    expect(body).not.toMatch(/secrets\./);
    expect(body).not.toMatch(/GITHUB_TOKEN|github\.token/);
  });

  test('every action is GitHub\'s own and pinned to a commit with its tag beside it', () => {
    const uses = lines.filter(line => /^\s+(- )?uses:/.test(line)).map(line => line.trim().replace(/^- /, ''));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/^uses: actions\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });

  test('every job sets up one exact Node version, so the jobs of a run share a fingerprint', () => {
    // Round 72: with `node-version: 24`, runners of two images resolved v24.21.0 and v24.22.0 in one run, and the merge
    // refused the jobs (they differ in fingerprint). The bases of round 72 ran on v24.21.0.
    const versions = [...workflow.matchAll(/^\s+node-version: (.+)$/gm)].map(match => match[1].trim());
    expect(versions.length).toBe(3);
    for (const version of versions) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(new Set(versions).size).toBe(1);
  });

  test('every checkout keeps no credentials', () => {
    const checkouts = [...workflow.matchAll(/uses: actions\/checkout@[0-9a-f]{40}.*\n((?:\s+with:\n(?:\s{10}.*\n)+)?)/g)];
    expect(checkouts.length).toBe(3);
    for (const [, withBlock] of checkouts) expect(withBlock).toContain('persist-credentials: false');
  });

  test('no shell line holds an expression; the job index arrives through env', () => {
    const runs = lines.filter(line => /^\s+(- )?run:/.test(line));
    expect(runs.length).toBeGreaterThan(0);
    for (const line of runs) {
      expect(line).not.toContain('${{');
      expect(line).not.toMatch(/run:\s*[|>]/);
    }
    expect(body).toContain('run: node scripts/bank-run-config.mjs job "$JOB"');
    expect(body).toMatch(/env:\n\s+JOB: \$\{\{ matrix\.job \}\}/);
  });

  test('the site build skips a data release of the bank, whose tag may not deploy to github-pages', () => {
    const pages = readFileSync(fileURLToPath(new URL('../.github/workflows/pages.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
    expect(pages).toMatch(/ {2}build:\n(?: {4}.*\n)*? {4}if: \$\{\{ github\.event_name != 'release' \|\| !startsWith\(github\.event\.release\.tag_name, 'bank-data-'\) \}\}\n/);
  });

  test('the data is checked before it is unpacked, and the run commit comes from the pushed branch only', () => {
    expect(body).toContain('run: node scripts/bank-data-pack.mjs --fetch --file .bank-data/bank-data.tar.gz');
    expect(body).toContain("key: bank-data-${{ hashFiles('regression/fixtures/bank-data.json') }}");
    expect(body).not.toMatch(/\bref:/);
    expect(body).toMatch(/concurrency:\n\s+group: bank-\$\{\{ github\.ref \}\}\n\s+cancel-in-progress: false/);
  });
});
