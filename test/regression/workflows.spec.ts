import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEEDBACK_CENSUS_REPLAYS, FEEDBACK_REPLAYS } from '../e2e-feedback/corpus';
import {
  ARTIFACT_PREFIX,
  DRIFT_JSON,
  DRIFT_MARKDOWN,
  DUMP_FILE,
  LOG_FILE,
  compareRuns,
  normalizeDrift,
  validateRunConfig,
} from '../../scripts/feedback-run-config.mjs';
import { dirname, join, resolve, relative } from 'node:path';

// A Windows checkout under core.autocrlf holds the YAML with CRLF: the specs read it with LF.
const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/bank.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
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
    // `node-version: 24` resolved v24.21.0 and v24.22.0 on two runner images in one run; the merge refused the jobs.
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
    const pages = readFileSync(fileURLToPath(new URL('../../.github/workflows/pages.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
    expect(pages).toMatch(/ {2}build:\n(?: {4}.*\n)*? {4}if: \$\{\{ \(github\.event_name != 'release' \|\| !startsWith\(github\.event\.release\.tag_name, 'bank-data-'\)\) && .* \}\}\n/);
  });

  test('the data is checked before it is unpacked, and the run commit comes from the pushed branch only', () => {
    expect(body).toContain('run: node scripts/bank-data-pack.mjs --fetch --file .bank-data/bank-data.tar.gz');
    expect(body).toContain("key: bank-data-${{ hashFiles('test/regression/fixtures/bank-data.json') }}");
    expect(body).not.toMatch(/\bref:/);
    expect(body).toMatch(/concurrency:\n\s+group: bank-\$\{\{ github\.ref \}\}\n\s+cancel-in-progress: false/);
  });
});

describe('feedback-workflow', () => {
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
});

const read = (name: string) => readFileSync(fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const release = read('release.yml');
const pages = read('pages.yml');
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

const DIR = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const workflows = readdirSync(DIR).filter(name => /\.ya?ml$/.test(name)).sort();

describe('the runner of every workflow job', () => {
  test('the workflows are the five the repository runs', () => {
    expect(workflows).toEqual(['bank.yml', 'feedback.yml', 'pages.yml', 'release.yml', 'test.yml']);
  });

  test.each(workflows)('%s: every runs-on names ubuntu-24.04', name => {
    const runners = readFileSync(`${DIR}${name}`, 'utf8').split(/\r?\n/)
      .map(line => line.match(/^\s+runs-on:\s*(\S+)/)?.[1]).filter((runner): runner is string => runner !== undefined);
    expect(runners.length).toBeGreaterThan(0);
    expect(runners.filter(runner => runner !== 'ubuntu-24.04')).toEqual([]);
  });
});

describe('the Vitest projects of test.yml', () => {
  const text = readFileSync(`${DIR}test.yml`, 'utf8');
  const projectsConfigured = [...readFileSync(fileURLToPath(new URL('../../vitest.config.ts', import.meta.url)), 'utf8').matchAll(/project\('([\w-]+)'/g)].map(match => match[1]).sort();
  const nodeJob = /^ {2}node:\r?\n[\s\S]*?(?=^ {2}\S)/m.exec(text)?.[0] ?? '';
  const engineJob = /^ {2}engine-speed-layer:\r?\n[\s\S]*?(?=^ {2}\S)/m.exec(text)?.[0] ?? '';

  test('vitest.config.ts holds the four projects the jobs name', () => {
    expect(projectsConfigured).toEqual(['app', 'eval-engine', 'replay-core', 'ui']);
  });

  test('Node suites runs app, ui and replay-core, and not the engine project', () => {
    const command = /run: (npx vitest run .*)$/m.exec(nodeJob)?.[1] ?? '';
    const projects = [...command.matchAll(/--project (\S+)/g)].map(match => match[1]).sort();
    expect(projects).toEqual(['app', 'replay-core', 'ui']);
  });

  test('the engine job runs the engine project with the speed layer forced off and forced on', () => {
    expect(engineJob).toContain('npx vitest run --project eval-engine');
    expect(engineJob).toMatch(/sim-fast: '0'/);
    expect(engineJob).toMatch(/sim-fast: '1'/);
    expect(engineJob).toContain('EVAL_SIM_FAST: ${{ matrix.sim-fast }}');
  });
});

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/test.yml'), 'utf8').split(/\r?\n/);
const SELF = 'test/regression/workflows.spec.ts';
const SWITCH = /\b(?:SWEEPS_FULL|sweepSelection|sweepMoves)\b|process\.env\.DICE_SWEEPS\b/;
const SPEC_DIRS = ['packages/eval-engine/test', 'packages/replay-core/test', 'test/regression'];
const DEFINITION = 'packages/eval-engine/test/dice-fixtures.ts';

const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

function jobLines(key: string): string[] {
  const start = WORKFLOW.findIndex(line => line === `  ${key}:`);
  if (start < 0) return [];
  const length = WORKFLOW.slice(start + 1).findIndex(line => /^ {2}\S/.test(line) && !line.startsWith('  #'));
  return WORKFLOW.slice(start, length < 0 ? undefined : start + 1 + length);
}

const files = SPEC_DIRS.flatMap(dir => readdirSync(join(ROOT, dir)).filter(name => name.endsWith('.ts')).map(name => `${dir}/${name}`));
const source = new Map(files.map(file => [file, withoutComments(readFileSync(join(ROOT, file), 'utf8'))]));
const isSpec = (file: string): boolean => file.endsWith('.spec.ts');
const reads = (file: string): boolean => file !== SELF && file !== DEFINITION && SWITCH.test(source.get(file) ?? '');

function switchExports(file: string): Set<string> {
  const chunks = (source.get(file) ?? '').split(/\n(?=(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s)/).map(text => ({
    text,
    name: /^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+(\w+)/.exec(text)?.[1],
    exported: /^export\s/.test(text),
  }));
  const tainted = new Set(chunks.filter(chunk => chunk.name && SWITCH.test(chunk.text)).map(chunk => chunk.name as string));
  for (let grew = true; grew;) {
    grew = false;
    for (const chunk of chunks) {
      if (!chunk.name || tainted.has(chunk.name)) continue;
      if ([...tainted].some(name => new RegExp(`\\b${name}\\b`).test(chunk.text))) { tainted.add(chunk.name); grew = true; }
    }
  }
  return new Set(chunks.filter(chunk => chunk.exported && chunk.name && tainted.has(chunk.name)).map(chunk => chunk.name as string));
}

const supportExports = new Map(files.filter(file => !isSpec(file) && file !== DEFINITION && reads(file)).map(file => [file, switchExports(file)]));

function namedImports(file: string): { from: string; names: string[] }[] {
  return [...(source.get(file) ?? '').matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(\.[^']*)'/g)].map(match => ({
    from: resolve(dirname(join(ROOT, file)), `${match[2]}.ts`).slice(ROOT.length),
    names: match[1].split(',').map(name => name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean),
  }));
}

const readers = files.filter(file => isSpec(file) && (reads(file) ||
  namedImports(file).some(({ from, names }) => names.some(name => supportExports.get(from)?.has(name))))).sort();

const dicePattern = /npx vitest run --project eval-engine (\S+)/.exec(jobLines('dice-sweeps').join('\n'))?.[1] ?? '';
const diceSpecs = files.filter(file => isSpec(file) && file.startsWith('packages/eval-engine/test/') && dicePattern !== '' && file.includes(dicePattern));

const otherLines = jobLines('full-sweeps');
const otherParts = otherLines.join('\n').split(/- part:/).slice(1).map(part => part.match(/[\w./-]+\.spec\.ts/g) ?? []);
const otherSpecs = otherParts.flat();

describe('the two CI jobs that run the specs with DICE_SWEEPS=full', () => {
  test('the dice job names a path pattern and the other job exists with three parts', () => {
    expect(dicePattern).toBe('packages/eval-engine/test/dice-');
    expect(otherParts).toHaveLength(3);
    expect(otherParts.every(part => part.length > 0)).toBe(true);
  });

  test('both jobs set DICE_SWEEPS to full', () => {
    expect(jobLines('dice-sweeps').join('\n')).toMatch(/DICE_SWEEPS:\s*full/);
    expect(otherLines.join('\n')).toMatch(/DICE_SWEEPS:\s*full/);
  });

  test('every spec that reads the switch runs in one of the two jobs', () => {
    const missing = readers.filter(file => !diceSpecs.includes(file) && !otherSpecs.includes(file));
    expect(missing, `these specs read the full-sweep switch and run in neither job; add them to a part of "Full sweeps, the other specs" in .github/workflows/test.yml`).toEqual([]);
  });

  test('every listed file exists, is a spec and reads the switch', () => {
    expect(otherSpecs.filter(file => !existsSync(join(ROOT, file))), 'listed files that no longer exist').toEqual([]);
    expect(otherSpecs.filter(file => !readers.includes(file)), 'listed specs that read no switch (they run full for nothing)').toEqual([]);
  });

  test('no spec runs in both jobs or twice in the second one', () => {
    expect(otherSpecs.filter(file => diceSpecs.includes(file)), 'in the dice job already').toEqual([]);
    expect(otherSpecs.filter((file, index) => otherSpecs.indexOf(file) !== index), 'listed twice').toEqual([]);
  });

  test('the reading finds the sweeps it is known to find', () => {
    // Guards the scan itself: if it stops finding these, an empty list would pass the rows above.
    expect(readers).toContain('packages/eval-engine/test/board-key-readers.spec.ts');
    expect(readers).toContain('packages/eval-engine/test/dice-logged-sweep.spec.ts');
    for (const part of ['sweep', 'crit-doubles-a', 'crit-doubles-b', 'crit-singles', 'secondary']) {
      expect(readers).toContain(part === 'sweep' ? 'packages/eval-engine/test/dice-logged-sweep.spec.ts' : `packages/eval-engine/test/dice-logged-${part}.spec.ts`);
    }
    for (const part of ['landed-hit-sweep', 'landed-hit-sweep-2', 'landed-hit-sweep-3', 'blocked-effects-sweep', 'blocked-effects-sweep-2']) {
      expect(readers).toContain(`packages/replay-core/test/${part}.spec.ts`);
    }
    expect(readers).not.toContain('test/regression/upgrade-checks-dice.spec.ts');
    expect(readers.length).toBeGreaterThan(50);
  });
});

describe('the job names that branch protection reads', () => {
  const names = WORKFLOW.map(line => /^ {4}name:\s*(.+)$/.exec(line)?.[1]).filter((name): name is string => name !== undefined);
  const sweepParts = 'Full sweeps, the other specs, part ${{ matrix.part }} of 3';
  const engineJobs = 'Engine suite, speed layer ${{ matrix.speed-layer }}';
  const liveJob = 'Live Showdown client, no required check';

  // GitHub matches a check by its whole name: a matrix job gives one context per entry, so the names stay.
  test('the jobs in parts and the required checks keep their names', () => {
    expect(names.filter(name => name === 'Browser flows, part ${{ matrix.part }} of 3')).toHaveLength(1);
    expect(names.filter(name => name !== 'Browser flows, part ${{ matrix.part }} of 3')).toEqual([
      'Node suites',
      engineJobs,
      'Dice sweeps, every move',
      sweepParts,
      'Browser flows',
      'Production build smoke',
      liveJob,
    ]);
  });

  test('the nine contexts branch protection must list', () => {
    const contexts = names.filter(name => !name.startsWith('Browser flows, part') && name !== liveJob).flatMap(name => {
      if (name === sweepParts) return [1, 2, 3].map(part => name.replace('${{ matrix.part }}', String(part)));
      if (name === engineJobs) return ['forced off', 'forced on'].map(layer => name.replace('${{ matrix.speed-layer }}', layer));
      return [name];
    });
    expect(contexts).toEqual([
      'Node suites',
      'Engine suite, speed layer forced off',
      'Engine suite, speed layer forced on',
      'Dice sweeps, every move',
      'Full sweeps, the other specs, part 1 of 3',
      'Full sweeps, the other specs, part 2 of 3',
      'Full sweeps, the other specs, part 3 of 3',
      'Browser flows',
      'Production build smoke',
    ]);
  });
});

describe('browser-flows-parts', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/test.yml'), 'utf8').split(/\r?\n/);
  const E2E = join(ROOT, 'test/e2e');

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
  const live = jobLines('showdown-client').join('\n');
  const liveFiles = live.match(/test\/e2e\/[\w./-]+/g) ?? [];

  describe('the three parts of the browser flows', () => {
    test('the job is a matrix of three parts with a name per part, each under 30 minutes', () => {
      expect(browser).toMatch(/^ {4}name: Browser flows, part \$\{\{ matrix\.part \}\} of 3$/m);
      expect([...browser.matchAll(/- part: (\d+)/g)].map(match => match[1])).toEqual(['1', '2', '3']);
      expect(parts.every(part => part.length > 0)).toBe(true);
      expect(Number(/^ {4}timeout-minutes: (\d+)$/m.exec(browser)?.[1])).toBeLessThanOrEqual(30);
      expect(browser).toMatch(/fail-fast: false/);
    });

    test('every spec file of test/e2e sits in exactly one part, or in the live job that no branch protection reads', () => {
      const all = [...listed, ...liveFiles];
      expect(files.length).toBeGreaterThan(40);
      expect(files.filter(file => !all.includes(file)), 'spec files that no job runs; add them to the part with the least seconds in .github/workflows/test.yml').toEqual([]);
      expect(all.filter((file, index) => all.indexOf(file) !== index), 'listed twice').toEqual([]);
      expect(all.filter(file => !files.includes(file)), 'listed files that are no spec file of test/e2e').toEqual([]);
    });

    test('the live comparison of Showdown\'s table runs in its own job, outside the required parts', () => {
      expect(liveFiles).toEqual(['test/e2e/teambuilder-table.spec.ts']);
      expect(listed).not.toContain('test/e2e/teambuilder-table.spec.ts');
      expect(live).toMatch(/^ {4}name: Live Showdown client, no required check$/m);
      expect(live).toMatch(/run: node scripts\/capture-showdown-client\.mjs --check$/m);
      expect(live).toMatch(/run: npm run test:e2e -- test\/e2e\/teambuilder-table\.spec\.ts$/m);
      expect(aggregate).not.toMatch(/showdown-client/);
      expect(Number(/^ {4}timeout-minutes: (\d+)$/m.exec(live)?.[1])).toBeLessThanOrEqual(30);
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
});
