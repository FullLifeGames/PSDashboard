import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Round 87 (release 1.1.0, user gate "2a"): every job names its runner image by version. `ubuntu-latest` moves on
 * GitHub's schedule (to Ubuntu 26 from 19.10.2026), so a release could build on another system than the run before it
 * with no change in this repository; bank.yml named `ubuntu-24.04` since round 76 for the same reason (ADR 0018).
 */
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

/**
 * Round 90 (F8, user 23.11.2026): each Vitest project runs once among the required jobs of test.yml. "Node suites" runs app, ui and
 * replay-core; the engine project runs in its two jobs, speed layer forced off and forced on, and nowhere else (the default speed mode
 * reads the same levers as forced on and only falls back quietly where forced on throws, so a third run read nothing new). The jobs'
 * commands carry no game type.
 */
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
