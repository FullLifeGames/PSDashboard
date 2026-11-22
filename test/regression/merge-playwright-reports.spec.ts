import { describe, expect, test } from 'vitest';
import { describeMerged, mergeReports, testsOf } from '../../scripts/merge-playwright-reports.mjs';

/**
 * Round 90 (E6, #222): the aggregate job "Browser flows" merges the JSON reports of its three parts with
 * scripts/merge-playwright-reports.mjs and prints each part's wall time, the slowest files and tests and every test that did not pass.
 */

type Spec = { file: string; line: number; title: string; tests: { status: string; results: { duration: number }[] }[] };
const spec = (file: string, line: number, title: string, status: string, ...durations: number[]): Spec => ({
  file, line, title, tests: [{ status, results: durations.map(duration => ({ duration })) }],
});
const report = (wallMs: number, workers: number, stats: Record<string, number>, suites: object[]) => ({
  config: { workers }, stats: { startTime: 'x', duration: wallMs, expected: 0, unexpected: 0, flaky: 0, skipped: 0, ...stats }, suites,
});

const one = report(100_000, 2, { expected: 2, flaky: 1 }, [
  { title: 'a.spec.ts', file: 'a.spec.ts', specs: [spec('a.spec.ts', 5, 'first', 'expected', 12_000)], suites: [
    { title: 'inner', file: 'a.spec.ts', specs: [spec('a.spec.ts', 9, 'second', 'flaky', 4_000, 6_000)] },
  ] },
  { title: 'b.spec.ts', file: 'b.spec.ts', specs: [spec('b.spec.ts', 3, 'third', 'expected', 2_000)] },
]);
const two = report(250_000, 2, { expected: 1, unexpected: 1, skipped: 1 }, [
  { title: 'c.spec.ts', file: 'c.spec.ts', specs: [spec('c.spec.ts', 7, 'fourth', 'unexpected', 90_000), spec('c.spec.ts', 20, 'fifth', 'skipped'), spec('c.spec.ts', 30, 'sixth', 'expected', 1_000)] },
]);
const merged = mergeReports([{ label: '1', report: one }, { label: '2', report: two }]);

describe('the merged report of the browser parts', () => {
  test('a test carries its describe path and the seconds of all its attempts', () => {
    const tests = testsOf(one);
    expect(tests.map(test => [test.file, test.line, test.title, test.ms, test.status])).toEqual([
      ['a.spec.ts', 5, 'first', 12_000, 'expected'],
      ['a.spec.ts', 9, 'inner > second', 10_000, 'flaky'],
      ['b.spec.ts', 3, 'third', 2_000, 'expected'],
    ]);
  });

  test('the counts add up, the workers add up and every part keeps its wall time', () => {
    expect(merged.stats).toEqual({ expected: 3, unexpected: 1, flaky: 1, skipped: 1, duration: 350_000 });
    expect(merged.parts).toEqual([
      { part: '1', wallMs: 100_000, workers: 2, tests: 3 },
      { part: '2', wallMs: 250_000, workers: 2, tests: 3 },
    ]);
    expect(testsOf(merged)).toHaveLength(6);
  });

  test('the text names the slowest part, the slowest file and every test that did not pass', () => {
    const text = describeMerged(merged);
    expect(text).toContain('3 spec files, 6 tests, 115 s summed over 2 parts');
    expect(text).toMatch(/250\.0 s {2}the slowest part/);
    expect(text).toMatch(/350\.0 s {2}all parts added up/);
    expect(text).toMatch(/91\.0 s {2}c\.spec\.ts/);
    expect(text).toMatch(/unexpected {1}c\.spec\.ts:7 {2}fourth/);
    expect(text).toMatch(/flaky {6}a\.spec\.ts:9 {2}inner > second/);
    expect(text.split('Tests that did not pass')[1]).not.toContain('fifth');
  });

  test('a green merge has no list of tests that did not pass', () => {
    const green = describeMerged(mergeReports([{ label: '1', report: report(1000, 2, { expected: 1 }, [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [spec('a.spec.ts', 1, 'x', 'expected', 500)] }]) }]));
    expect(green).not.toContain('Tests that did not pass');
  });
});
