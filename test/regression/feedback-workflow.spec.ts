import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEEDBACK_CENSUS_REPLAYS, FEEDBACK_REPLAYS } from '../e2e-feedback/corpus';
import {
  ARTIFACT_PREFIX, DRIFT_JSON, DRIFT_MARKDOWN, DUMP_FILE, LOG_FILE, compareRuns, normalizeDrift, validateRunConfig,
} from '../../scripts/feedback-run-config.mjs';

/**
 * Round 89 (feedback runs in GitHub Actions, user 20.11.2026): the properties of .github/workflows/feedback.yml, read from
 * the file's text, in the manner of bank-workflow.spec.ts: only a push to feedback/** (or a run by hand) starts it, the
 * token reads the repository and nothing else, every action is GitHub's own and pinned to a commit, one exact Node version, no
 * checkout keeps credentials, and no shell line holds an expression. It also holds the compare step's file list to what the
 * harness writes, and the run settings to those of `npm run test:feedback`.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('.github/workflows/feedback.yml');
const lines = workflow.split('\n').filter(line => !line.trimStart().startsWith('#'));
const body = lines.join('\n');

describe('the feedback workflow', () => {
  test('only a push to a feedback/ branch or a run by hand starts it', () => {
    const on = /^on:\n((?: .*\n)+)/m.exec(body)?.[1] ?? '';
    expect(on).toBe("  push:\n    branches: ['feedback/**']\n  workflow_dispatch:\n");
    for (const trigger of ['pull_request', 'pull_request_target', 'workflow_run', 'schedule', 'issue_comment']) {
      expect(body).not.toContain(`${trigger}:`);
    }
  });

  test('the token can read the repository and nothing else, and no job holds a secret', () => {
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

  test('every job runs on ubuntu-24.04 and sets up the Node version of bank.yml', () => {
    const runners = [...workflow.matchAll(/^\s+runs-on:\s*(\S+)/gm)].map(match => match[1]);
    expect(runners).toHaveLength(3);
    expect(new Set(runners)).toEqual(new Set(['ubuntu-24.04']));
    const versions = [...workflow.matchAll(/^\s+node-version: (.+)$/gm)].map(match => match[1].trim());
    expect(versions).toHaveLength(3);
    const bank = [...read('.github/workflows/bank.yml').matchAll(/^\s+node-version: (.+)$/gm)].map(match => match[1].trim());
    expect(new Set([...versions, ...bank]).size).toBe(1);
    expect(versions[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('every checkout keeps no credentials', () => {
    const checkouts = [...workflow.matchAll(/uses: actions\/checkout@[0-9a-f]{40}.*\n((?:\s+with:\n(?:\s{10}.*\n)+)?)/g)];
    expect(checkouts).toHaveLength(3);
    for (const [, withBlock] of checkouts) expect(withBlock).toContain('persist-credentials: false');
  });

  test('no shell line holds an expression', () => {
    const runs = lines.filter(line => /^\s+(- )?run:/.test(line));
    expect(runs.length).toBeGreaterThan(0);
    for (const line of runs) {
      expect(line).not.toContain('${{');
      expect(line).not.toMatch(/run:\s*[|>]/);
    }
  });

  test('a run is `npm run test:feedback` with the dump on, one worker and no trace, and its dumps leave as an artifact per run index', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts['test:feedback']).toBe('node ./scripts/run-e2e.mjs --dev-port 5176 -c playwright.feedback.config.ts');
    expect(body).toContain('npm run test:feedback 2>&1 | tee docs/reports/feedback.log');
    expect(body).toMatch(/shell: bash\n\s+run: mkdir -p docs\/reports/);
    expect(body).toMatch(/FEEDBACK_DUMP: '1'/);
    const config = read('playwright.feedback.config.ts');
    expect(config).toMatch(/workers: 1,/);
    expect(config).toMatch(/retries: 0,/);
    expect(config).not.toMatch(/trace:/);
    expect(body).toContain(`name: ${ARTIFACT_PREFIX}\${{ matrix.index }}`);
    expect(body).toContain('path: docs/reports');
    expect(body).toContain('run: node scripts/feedback-run-config.mjs compare .feedback/runs');
    expect(body).toContain(`pattern: ${ARTIFACT_PREFIX}*`);
    expect(body).toMatch(/concurrency:\n\s+group: feedback-\$\{\{ github\.ref \}\}\n\s+cancel-in-progress: false/);
  });

  test('the runs share no fixture download: the harness reads tracked fixtures only', () => {
    expect(body).not.toMatch(/bank-data|\.smogon-cache|\.fit-corpus/);
    const hermetic = read('test/e2e-feedback/hermetic.ts');
    expect(hermetic).toMatch(/FIXTURES/);
    expect(hermetic).not.toMatch(/smogon-cache|fit-corpus/);
  });
});

describe('the compare step reads what the harness writes', () => {
  const harness = read('test/e2e-feedback/feedback-drift.spec.ts');

  test('the harness writes the dump, the drift report and the log folder the artifact and the compare read', () => {
    expect(harness).toContain("const REPORT_DIR = join(__dirname, '..', '..', 'docs', 'reports');");
    expect(harness).toContain('writeFileSync(join(REPORT_DIR, `feedback-full-${replayId}.json`)');
    expect(harness).toContain(`writeFileSync(join(REPORT_DIR, '${DRIFT_MARKDOWN}')`);
    expect(harness).toContain(`writeFileSync(join(REPORT_DIR, '${DRIFT_JSON}')`);
    expect(body).toContain(`docs/reports/${LOG_FILE}`);
  });

  test('every replay of the corpus and the census gives a dump name the compare takes, 12 in all', () => {
    const replays = [...FEEDBACK_REPLAYS, ...FEEDBACK_CENSUS_REPLAYS];
    expect(replays).toHaveLength(12);
    expect(new Set(replays).size).toBe(12);
    for (const id of replays) expect(`feedback-full-${id}.json`).toMatch(DUMP_FILE);
    expect(DUMP_FILE.test(DRIFT_JSON)).toBe(false);
    expect(DUMP_FILE.test(LOG_FILE)).toBe(false);
  });

  test('the drift report carries a date and the wall times, and the Markdown names them on the lines the compare drops', () => {
    const report = read('test/e2e-feedback/report.ts');
    expect(report).toContain('`- Commit: ${meta.commit} · ${meta.date}`');
    expect(report).toContain('`- Wall time: ');
    expect(harness).toMatch(/date: new Date\(\)\.toISOString\(\)/);
    expect(harness).toMatch(/wallTimes,/);
  });
});

describe('compareRuns', () => {
  const dump = (text: string) => ['feedback-full-a-1.json', text] as const;
  const drift = (date: string, wall: number) => JSON.stringify({ meta: { commit: 'abc', date, wallTimes: { 'a-1': wall }, settingsLine: 's' }, rows: [1] });
  const markdown = (date: string, wall: number) => `# Report\n- Commit: abc · ${date}\n- Settings: s\n- Wall time: a-1 ${wall}s\nrow\n`;
  const run = (text: string, date: string, wall: number) => new Map<string, string>([
    dump(text), [DRIFT_JSON, drift(date, wall)], [DRIFT_MARKDOWN, markdown(date, wall)], [LOG_FILE, `log ${wall}`],
  ]);

  test('equal dumps, and drift files that differ only in date and wall time, pass', () => {
    const result = compareRuns(new Map([[1, run('x', '2026-11-20T10', 40)], [2, run('x', '2026-11-20T11', 55)], [3, run('x', '2026-11-20T12', 61)]]));
    expect(result).toEqual({ dumps: 1, problems: [] });
  });

  test('one differing byte in one dump names the file and the run', () => {
    const result = compareRuns(new Map([[1, run('x', 'd', 1)], [2, run('x', 'd', 1)], [3, run('y', 'd', 1)]]));
    expect(result.problems).toEqual(['differs: feedback-full-a-1.json (run 1 against run 3)']);
  });

  test('a dump that one run lacks, and a dump that only another run holds, are named', () => {
    const lacking = run('x', 'd', 1);
    lacking.delete('feedback-full-a-1.json');
    lacking.set('feedback-full-b-2.json', 'z');
    const result = compareRuns(new Map([[1, run('x', 'd', 1)], [2, lacking]]));
    expect(result.problems).toEqual(['missing in run 2: feedback-full-a-1.json', 'extra in run 2: feedback-full-b-2.json']);
  });

  test('a changed row of the drift report is a difference, a changed wall time is not', () => {
    const other = run('x', 'd', 1);
    other.set(DRIFT_JSON, drift('d', 1).replace('[1]', '[2]'));
    const result = compareRuns(new Map([[1, run('x', 'd', 1)], [2, other]]));
    expect(result.problems).toEqual([`differs: ${DRIFT_JSON} beyond its date and wall times (run 1 against run 2)`]);
  });

  test('a first run without dumps fails; an empty set fails', () => {
    expect(compareRuns(new Map([[1, new Map([[DRIFT_JSON, '{}']])]])).problems).toEqual(['run 1 holds no dump']);
    expect(compareRuns(new Map()).problems).toEqual(['no run folders']);
  });

  test('normalizeDrift drops the date and wall times of the JSON and the two lines of the Markdown', () => {
    expect(normalizeDrift(DRIFT_JSON, drift('d1', 1))).toBe(normalizeDrift(DRIFT_JSON, drift('d2', 2)));
    expect(normalizeDrift(DRIFT_MARKDOWN, markdown('d1', 1))).toBe('# Report\n- Settings: s\nrow\n');
  });
});

describe('.feedback-run.json', () => {
  test('takes a name and 1 to 5 runs, three by default', () => {
    expect(validateRunConfig({ name: 'r89-try' })).toEqual({ name: 'r89-try', runs: 3 });
    expect(validateRunConfig({ name: 'r89-try', runs: 5 })).toEqual({ name: 'r89-try', runs: 5 });
  });

  test('refuses a bad name, a bad count and an unknown key, naming every problem', () => {
    expect(() => validateRunConfig({ name: 'Bad Name', runs: 6, env: {} })).toThrow(/unknown key "env".*name must be.*runs must be/);
    expect(() => validateRunConfig({ name: 'x', runs: 0 })).toThrow(/runs must be/);
    expect(() => validateRunConfig([])).toThrow(/one JSON object/);
  });
});
