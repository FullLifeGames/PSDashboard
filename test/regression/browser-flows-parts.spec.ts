import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Round 90 (E6, #222): test.yml runs the browser flows in three parts ("Browser flows, part N of 3", a matrix of the job `browser`)
 * and one last job, `browser-flows`, named "Browser flows" like the old single job, so branch protection keeps its required check.
 * This spec holds the lists to the folder: every spec file of test/e2e/ sits in exactly one part, a listed file exists, and each entry
 * (Playwright reads a positional argument as a regular expression on the file path) matches its own file and no other. It also holds
 * what makes the last job a gate: it needs the parts, runs whatever they did, and fails unless their result is "success".
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/test.yml'), 'utf8').split(/\r?\n/);
const E2E = join(ROOT, 'test/e2e');

/** The lines of one job of test.yml: from its key at two spaces of indent to the next key at the same indent. */
function jobLines(key: string): string[] {
  const start = WORKFLOW.findIndex(line => line === `  ${key}:`);
  if (start < 0) return [];
  const length = WORKFLOW.slice(start + 1).findIndex(line => /^ {2}\S/.test(line) && !line.startsWith('  #'));
  return WORKFLOW.slice(start, length < 0 ? undefined : start + 1 + length);
}

/** Playwright's default testMatch: `**\/*.@(spec|test).?(c|m)[jt]s?(x)`. */
const isSpecFile = (name: string): boolean => /\.(spec|test)\.[cm]?[jt]sx?$/.test(name);
function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? specFiles(join(dir, entry.name))
    : isSpecFile(entry.name) ? [relative(ROOT, join(dir, entry.name)).replaceAll('\\', '/')] : []);
}

const files = specFiles(E2E).sort();
const browser = jobLines('browser').join('\n');
const parts = browser.split(/- part:/).slice(1).map(part => part.match(/test\/e2e\/[\w./-]+/g) ?? []);
const listed = parts.flat();
const aggregate = jobLines('browser-flows').join('\n');

describe('the three parts of the browser flows', () => {
  test('the job is a matrix of three parts with a name per part, each under 30 minutes', () => {
    expect(browser).toMatch(/^ {4}name: Browser flows, part \$\{\{ matrix\.part \}\} of 3$/m);
    expect([...browser.matchAll(/- part: (\d+)/g)].map(match => match[1])).toEqual(['1', '2', '3']);
    expect(parts.every(part => part.length > 0)).toBe(true);
    expect(Number(/^ {4}timeout-minutes: (\d+)$/m.exec(browser)?.[1])).toBeLessThanOrEqual(30);
    expect(browser).toMatch(/fail-fast: false/);
  });

  test('every spec file of test/e2e sits in exactly one part', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.filter(file => !listed.includes(file)), 'spec files that no part runs; add them to the part with the least seconds in .github/workflows/test.yml').toEqual([]);
    expect(listed.filter((file, index) => listed.indexOf(file) !== index), 'listed twice').toEqual([]);
    expect(listed.filter(file => !files.includes(file)), 'listed files that are no spec file of test/e2e').toEqual([]);
  });

  test('each entry is a path filter that matches its own file and no other spec file', () => {
    for (const entry of listed) {
      const filter = new RegExp(entry);
      expect(files.filter(file => filter.test(join(ROOT, file))), entry).toEqual([entry]);
    }
  });

  test('the Playwright config reads the folder the lists cover', () => {
    expect(readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8')).toMatch(/testDir: '\.\/test\/e2e'/);
  });

  test('the parts hand the files to the run through SPECS and keep their own report and trace artifacts', () => {
    expect(browser).toMatch(/run: npm run test:e2e -- --reporter=dot,json \$SPECS/);
    expect(browser).toMatch(/SPECS: \$\{\{ matrix\.files \}\}/);
    expect(browser).toMatch(/name: playwright-report-part-\$\{\{ matrix\.part \}\}$/m);
    expect(browser).toMatch(/name: playwright-results-part-\$\{\{ matrix\.part \}\}$/m);
  });
});

describe('the job "Browser flows" that branch protection requires', () => {
  test('it keeps the old name and needs the parts', () => {
    expect(aggregate).toMatch(/^ {4}name: Browser flows$/m);
    expect(aggregate).toMatch(/^ {4}needs: browser$/m);
  });

  test('it runs whatever the parts did and fails unless their result is success', () => {
    expect(aggregate).toMatch(/^ {4}if: always\(\)$/m);
    expect(aggregate).toMatch(/PARTS: \$\{\{ needs\.browser\.result \}\}/);
    expect(aggregate).toMatch(/test "\$PARTS" = success/);
  });

  test('it merges the part reports and keeps the merged one under the old artifact name', () => {
    expect(aggregate).toMatch(/pattern: playwright-report-part-\*/);
    expect(aggregate).toMatch(/node scripts\/merge-playwright-reports\.mjs --out playwright-report\.json /);
    expect(aggregate).toMatch(/name: playwright-report$/m);
  });

  test('pages.yml and release.yml read the workflow, never a job of it', () => {
    for (const name of ['pages.yml', 'release.yml']) {
      expect(readFileSync(join(ROOT, '.github/workflows', name), 'utf8'), name).not.toMatch(/Browser flows|browser-flows/);
    }
  });
});
