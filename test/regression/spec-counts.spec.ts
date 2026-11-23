import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareCounts, countSpecs, currentBaseline, SPEC_PROJECTS } from '../../scripts/spec-counts.mjs';

/**
 * The spec-count ratchet (round 90, rule "What earns a test" in AGENTS.md): the number of spec files per test project only
 * falls, or grows with a named new module. `spec-count-ratchet.json` holds the counts; `npm run lint` runs the check;
 * `node scripts/update-lint-ratchet.mjs` lowers the baseline after a cut, and `--allow-raise` raises it for a new module.
 * Game types do not enter: a count is a count of files.
 */
describe('compareCounts', () => {
  test('a project above its baseline is listed, a project at or below it is not', () => {
    expect(compareCounts({ app: 10, ui: 5 }, { app: 11, ui: 5 })).toEqual([{ project: 'app', baseline: 10, count: 11 }]);
    expect(compareCounts({ app: 10, ui: 5 }, { app: 9, ui: 5 })).toEqual([]);
  });

  test('a project without a baseline entry counts from zero', () => {
    expect(compareCounts({ app: 10 }, { app: 10, ui: 1 })).toEqual([{ project: 'ui', baseline: 0, count: 1 }]);
  });
});

describe('countSpecs', () => {
  test('counts .spec.ts and .spec.tsx files under each project folder and nothing else', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spec-counts-'));
    try {
      for (const file of ['test/ui/a.spec.tsx', 'test/ui/deep/b.spec.ts', 'test/ui/helper.ts', 'test/regression/c.spec.ts', 'test/regression/c.spec.ts.bak']) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), '');
      }
      const counts = countSpecs(root);
      expect(counts.ui).toBe(2);
      expect(counts.app).toBe(1);
      expect(counts['eval-engine']).toBe(0);
      expect(Object.keys(counts).sort()).toEqual(Object.keys(SPEC_PROJECTS).sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the repository', () => {
  test('no project holds more spec files than its baseline', () => {
    expect(compareCounts(currentBaseline(), countSpecs()), 'raise the baseline only for a new module: node scripts/update-lint-ratchet.mjs --allow-raise').toEqual([]);
  });
});
