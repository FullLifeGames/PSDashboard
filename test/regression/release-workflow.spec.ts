import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Round 78 (user gate 29.10.2026, "3b"): a release that release.yml makes with the job's GITHUB_TOKEN starts no other
 * workflow, so pages.yml's `release: published` trigger never ran for v0.7.1 or v1.0.0. Their frozen copies under
 * /v<version>/ appeared only because the Pages run of the master push listed the release after release.yml had made it.
 * The release job starts the Pages build itself through workflow_dispatch, the one event its token may start, once the
 * release with its build zip exists.
 */

// A Windows checkout under core.autocrlf holds the YAML with CRLF: the specs read it with LF.
const read = (name: string) => readFileSync(fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const release = read('release.yml');
const pages = read('pages.yml');
/** The lines of one job: its key at two spaces, then every deeper or blank line up to the next key. */
const jobOf = (workflow: string, name: string) => new RegExp(`^ {2}${name}:\\n((?:(?: {4}.*)?\\n)+)`, 'm').exec(workflow)?.[1] ?? '';

describe('the release starts the Pages build of its frozen copy', () => {
  test('after the release is made, the release job dispatches pages.yml on the branch it released', () => {
    const job = jobOf(release, 'release');
    const create = job.indexOf('gh release create');
    const dispatch = job.indexOf('gh workflow run pages.yml --ref "$GITHUB_REF_NAME"');
    expect(create).toBeGreaterThan(0);
    expect(dispatch).toBeGreaterThan(create);
  });

  test('the token of the release job may write the release and start a workflow, and nothing more', () => {
    expect(jobOf(release, 'release')).toMatch(/^ {4}permissions:\n {6}contents: write\n {6}actions: write\n/m);
  });

  test('pages.yml takes a dispatch', () => {
    expect(pages).toMatch(/^ {2}workflow_dispatch:/m);
  });
});
