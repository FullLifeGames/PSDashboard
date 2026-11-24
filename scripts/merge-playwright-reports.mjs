// The JSON reports of the three "Browser flows" parts, merged and read.
//
//   node scripts/merge-playwright-reports.mjs [--out <merged.json>] <report.json>...
//
// Playwright's JSON reporter writes one file per run; each part of the Browser flows job writes its own. This script
// sums their stats, prints each part's wall time (the reporter's `stats.duration`), the slowest spec files and tests
// and every test that did not pass, and writes the merged report when `--out` is given. The part number comes from a
// `part-<n>` in the report's path (the artifact folders of the aggregate job), else from the order of the arguments.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Every test of a report: file, line, title path, its summed duration over all attempts, and its status. */
export function testsOf(report) {
  const tests = [];
  const walk = (suite, titles) => {
    const path = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        tests.push({
          file: spec.file,
          line: spec.line,
          title: [...path, spec.title].join(' > '),
          ms: test.results.reduce((sum, result) => sum + result.duration, 0),
          status: test.status,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, path);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return tests;
}

/** One report from several: suites side by side, the counts of `stats` summed, the part walls kept in `parts`. */
export function mergeReports(reports) {
  const stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0, duration: 0 };
  for (const { report } of reports) {
    for (const key of Object.keys(stats)) stats[key] += report.stats?.[key] ?? 0;
  }
  return {
    config: { workers: reports.reduce((sum, { report }) => sum + (report.config?.workers ?? 0), 0) },
    stats,
    parts: reports.map(({ label, report }) => ({ part: label, wallMs: report.stats?.duration ?? 0, workers: report.config?.workers ?? 0, tests: testsOf(report).length })),
    suites: reports.flatMap(({ report }) => report.suites ?? []),
  };
}

const seconds = ms => (ms / 1000).toFixed(1).padStart(7);

/** The text the aggregate job prints. */
export function describeMerged(merged) {
  const tests = testsOf(merged);
  const perFile = new Map();
  for (const test of tests) perFile.set(test.file, (perFile.get(test.file) ?? 0) + test.ms);
  const files = [...perFile].sort((a, b) => b[1] - a[1]);
  const lines = [];
  lines.push(`${files.length} spec files, ${tests.length} tests, ${(files.reduce((sum, row) => sum + row[1], 0) / 1000).toFixed(0)} s summed over ${merged.parts.length} parts`);
  lines.push(`passed ${merged.stats.expected}, failed ${merged.stats.unexpected}, flaky ${merged.stats.flaky}, skipped ${merged.stats.skipped}`);
  lines.push('');
  lines.push('Wall time of each part (the Playwright run, without setup)');
  for (const part of merged.parts) lines.push(`${seconds(part.wallMs)} s  part ${part.part}, ${part.tests} tests, ${part.workers} workers`);
  lines.push(`${seconds(Math.max(0, ...merged.parts.map(part => part.wallMs)))} s  the slowest part`);
  lines.push(`${seconds(merged.parts.reduce((sum, part) => sum + part.wallMs, 0))} s  all parts added up`);
  lines.push('');
  lines.push('The 15 slowest spec files');
  for (const [file, ms] of files.slice(0, 15)) lines.push(`${seconds(ms)} s  ${file}`);
  lines.push('');
  lines.push('The 20 slowest tests');
  for (const test of [...tests].sort((a, b) => b.ms - a.ms).slice(0, 20)) lines.push(`${seconds(test.ms)} s  ${test.status.padEnd(10)} ${test.file}:${test.line}  ${test.title}`);
  const notPassed = tests.filter(test => test.status !== 'expected' && test.status !== 'skipped');
  if (notPassed.length > 0) {
    lines.push('');
    lines.push('Tests that did not pass');
    for (const test of notPassed) lines.push(`${test.status.padEnd(10)} ${test.file}:${test.line}  ${test.title}`);
  }
  return lines.join('\n');
}

function main(argv) {
  const files = [];
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') { out = argv[i + 1]; i += 1; } else files.push(argv[i]);
  }
  if (files.length === 0) throw new Error('usage: merge-playwright-reports.mjs [--out merged.json] <report.json>...');
  const reports = files.map((file, index) => ({
    label: /part-(\d+)/.exec(file)?.[1] ?? String(index + 1),
    report: JSON.parse(readFileSync(file, 'utf8')),
  }));
  const merged = mergeReports(reports.sort((a, b) => Number(a.label) - Number(b.label)));
  if (out) writeFileSync(out, JSON.stringify(merged));
  console.log(describeMerged(merged));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
