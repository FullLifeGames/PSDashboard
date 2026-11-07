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

/**
 * User gate 07.11.2026 ("1a 2a 3a"): after the release of 1.1.0 the work lands on master, and the root of GitHub Pages is the
 * nightly of master. A push that breaks the app must not reach the nightly while its tests still run: Pages builds a push of
 * master only after the Tests workflow passed on that very commit. A release and a dispatch keep their own triggers.
 */
describe('the nightly deploys a push of master only after its tests passed', () => {
  const on = /^on:\n((?:(?: {2}.*)?\n)+)/m.exec(pages)?.[1] ?? '';
  const build = jobOf(pages, 'build');

  test('a finished Tests run on master starts the build, and a push no longer does', () => {
    expect(on).toMatch(/^ {2}workflow_run:\n {4}workflows:\n {6}- Tests\n {4}types:\n {6}- completed\n {4}branches:\n {6}- master\n/m);
    expect(on).not.toMatch(/^ {2}push:/m);
    expect(on).toMatch(/^ {2}release:/m);
    expect(on).toMatch(/^ {2}workflow_dispatch:/m);
  });

  test('the build runs only for a Tests run of a push that succeeded', () => {
    const condition = /^ {4}if: \$\{\{ (.*) \}\}$/m.exec(build)?.[1] ?? '';
    expect(condition).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(condition).toContain("github.event.workflow_run.event == 'push'");
    expect(condition).toContain("github.event_name != 'workflow_run'");
    // the bank's data releases still build nothing
    expect(condition).toContain("startsWith(github.event.release.tag_name, 'bank-data-')");
  });

  test('the build checks out the commit the tests passed on', () => {
    expect(build).toMatch(/uses: actions\/checkout@v\d+\n {8}with:\n(?: {10}#.*\n)* {10}ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}\n/);
  });

  test('the Tests workflow that pages.yml names exists under that name and runs on pushes to master', () => {
    const tests = read('test.yml');
    expect(tests).toMatch(/^name: Tests$/m);
    expect(tests).toMatch(/^ {4}branches: \[master, main\]$/m);
  });
});
