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
  test('the workflows are the four the repository runs', () => {
    expect(workflows).toEqual(['bank.yml', 'pages.yml', 'release.yml', 'test.yml']);
  });

  test.each(workflows)('%s: every runs-on names ubuntu-24.04', name => {
    const runners = readFileSync(`${DIR}${name}`, 'utf8').split(/\r?\n/)
      .map(line => line.match(/^\s+runs-on:\s*(\S+)/)?.[1]).filter((runner): runner is string => runner !== undefined);
    expect(runners.length).toBeGreaterThan(0);
    expect(runners.filter(runner => runner !== 'ubuntu-24.04')).toEqual([]);
  });
});
