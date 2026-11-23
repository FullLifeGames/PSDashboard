import { afterAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTable } from '../../scripts/rows-compare.mjs';
import { countPerProject, listArgs, rowsOfList } from '../../scripts/rows-collect.mjs';

/**
 * The tools that prove a test cut (`npm run test:coverage`, scripts/cov-compare.mjs, rows-collect.mjs, rows-compare.mjs):
 * coverage may not lose a statement, a branch path or a function, and the rows by project and full name stay equal.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cov-tools-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (script: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
};
const write = (name: string, value: unknown) => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
};

const at = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 10 } });
type Hits = { s: number[]; f: number[]; b: number[][] };
/** One file of istanbul's coverage-final.json with three statements, one function and one if with two paths. */
const entry = (path: string, hits: Hits, lines = [1, 2, 3]) => ({
  path,
  statementMap: Object.fromEntries(lines.map((line, id) => [String(id), at(line)])),
  fnMap: { 0: { name: 'run', loc: at(1) } },
  branchMap: { 0: { type: 'if', loc: at(2) } },
  s: Object.fromEntries(hits.s.map((n, id) => [String(id), n])),
  f: { 0: hits.f[0] },
  b: { 0: hits.b[0] },
});
const full: Hits = { s: [1, 1, 1], f: [1], b: [[1, 1]] };
const report = (hits: Hits, lines?: number[]) => ({
  [`${ROOT}src/a.ts`]: entry(`${ROOT}src/a.ts`, full),
  [`${ROOT}packages/eval-engine/src/b.ts`]: entry(`${ROOT}packages/eval-engine/src/b.ts`, hits, lines),
});

describe('cov-compare', () => {
  const before = write('cov-before.json', report(full));
  const compare = (after: unknown) => run('cov-compare.mjs', before, write('cov-after.json', after), ROOT);

  test('two equal files, or an after run that covers more, exit 0 and print the package rows', () => {
    const same = compare(report(full));
    expect(same.code).toBe(0);
    expect(same.out).toMatch(/eval-engine\tstatements\t3\/3\t100\.00\t3\/3\t100\.00/);
    expect(same.out).toMatch(/app src\tbranches\t2\/2/);
    expect(compare(report({ s: [1, 1, 1], f: [2], b: [[5, 5]] })).code).toBe(0);
  });

  test('one lost statement exits 1 and names the file and the line', () => {
    const result = compare(report({ s: [1, 0, 1], f: [1], b: [[1, 1]] }));
    expect(result.code).toBe(1);
    expect(result.out).toContain('LOST packages/eval-engine/src/b.ts:2 statement');
    expect(result.out).toMatch(/lost items: 1;/);
  });

  test('a lost function, a lost branch path and a missing file each exit 1', () => {
    expect(compare(report({ s: [1, 1, 1], f: [0], b: [[1, 1]] })).out).toContain('function run');
    const branch = compare(report({ s: [1, 1, 1], f: [1], b: [[1, 0]] }));
    expect(branch.code).toBe(1);
    expect(branch.out).toContain('branch if path 1');
    const missing = compare({ [`${ROOT}src/a.ts`]: entry(`${ROOT}src/a.ts`, full) });
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('whole file missing in the after run');
  });

  test('statement maps that differ void the comparison with exit 2, and a missing argument exits 3', () => {
    const moved = compare(report(full, [1, 2, 4]));
    expect(moved.code).toBe(2);
    expect(moved.out).toContain('MAP DIFFERS packages/eval-engine/src/b.ts');
    expect(run('cov-compare.mjs', before).code).toBe(3);
  });
});

type Row = { name: string; file: string; projectName: string };
const row = (projectName: string, name: string, file = 'a.spec.ts'): Row => ({ projectName, name, file });
const listOf = (...rows: Row[]) => rows;

describe('rows-compare', () => {
  const before = listOf(row('app', 'x > one'), row('app', 'x > two'), row('ui', 'x > one', 'u.spec.tsx'));
  const compare = (after: Row[], table?: unknown, base: Row[] = before) => {
    const args = [write('rows-before.json', base), write('rows-after.json', after)];
    if (table) args.push('--map', write('rows-table.json', table));
    return run('rows-compare.mjs', ...args);
  };

  test('the same rows in other files, in any order, exit 0', () => {
    const result = compare(listOf(row('ui', 'x > one', 'moved.spec.tsx'), row('app', 'x > two', 'b.spec.ts'), row('app', 'x > one', 'b.spec.ts')));
    expect(result.code).toBe(0);
    expect(result.out).toContain('rows before 3, after 3, lost 0, gained 0');
  });

  test('a lost row exits 1 and names it with its old file', () => {
    const result = compare(listOf(row('app', 'x > one'), row('ui', 'x > one', 'u.spec.tsx')));
    expect(result.code).toBe(1);
    expect(result.out).toContain('LOST 1x app | x > two (was in a.spec.ts)');
  });

  test('a gained row and a row that moved to another project exit 1', () => {
    expect(compare([...before, row('app', 'x > three')]).out).toContain('GAINED 1x app | x > three');
    expect(compare(listOf(row('app', 'x > one'), row('app', 'x > two'), row('app', 'x > one', 'u.spec.tsx'))).code).toBe(1);
  });

  test('a row counted twice before must be there twice after', () => {
    const twice = listOf(row('app', 'x > one'), row('app', 'x > one', 'b.spec.ts'));
    expect(compare(twice, undefined, twice).code).toBe(0);
    expect(compare(listOf(row('app', 'x > one')), undefined, twice).out).toContain('LOST 1x app | x > one');
  });

  test('a renamed row maps through the table: by prefix (a fold adds the old file stem) or by exact name', () => {
    const after = listOf(row('app', 'old-stem > x > one'), row('app', 'old-stem > x > two'), row('ui', 'old-stem > x > one', 'u.spec.tsx'));
    expect(compare(after).code).toBe(1);
    expect(compare(after, { prefixes: { 'x > ': 'old-stem > x > ' } }).code).toBe(0);
    expect(compare(after, { rows: { 'x > one': 'old-stem > x > one', 'x > two': 'old-stem > x > two' } }).code).toBe(0);
    const partial = compare(after, { rows: { 'x > one': 'old-stem > x > one' } });
    expect(partial.code).toBe(1);
    expect(partial.out).toContain('LOST 1x app | x > two');
  });

  test('the longest prefix wins and a table entry that matches no row exits 2', () => {
    const { rows } = applyTable([row('app', 'a > b > c')], { prefixes: { 'a > ': 'X > ', 'a > b > ': 'Y > ' } });
    expect(rows[0].name).toBe('Y > c');
    expect(compare(before, { prefixes: { 'nothing > ': 'x' } }).code).toBe(2);
  });
});

describe('rows-collect', () => {
  const raw = [
    { name: 'a > one', file: '/r/a.spec.ts', projectName: 'app', location: { line: 1, column: 1 } },
    { name: 'a > two', file: '/r/a.spec.ts', projectName: 'app', location: { line: 2, column: 1 } },
    { name: 'b > one', file: '/r/b.spec.tsx', projectName: 'ui', location: { line: 1, column: 1 } },
  ];

  test('a vitest list becomes one entry per row and a count per project that rows-compare reads', () => {
    expect(rowsOfList(raw)[2]).toEqual({ name: 'b > one', file: '/r/b.spec.tsx', projectName: 'ui' });
    expect(countPerProject(rowsOfList(raw))).toEqual({ app: 2, ui: 1 });
    const out = join(dir, 'collected.json');
    const result = run('rows-collect.mjs', out, '--raw', write('raw-list.json', raw));
    expect(result.code).toBe(0);
    expect(result.out).toContain('3 rows in 2 files');
    expect(run('rows-compare.mjs', out, out).code).toBe(0);
  });

  test('a file that registers its rows through a helper is listed by running it, not by reading its text', () => {
    expect(listArgs(['--project', 'app'])).toEqual(['vitest', 'list', '--json', '--staticParse=false', '--project', 'app']);
    expect(listArgs(['--staticParse'])).toEqual(['vitest', 'list', '--json', '--staticParse']);
    const out = join(dir, 'helper-registered.json');
    const result = run('rows-collect.mjs', out, '--project', 'replay-core', 'packages/replay-core/test/landed-hit-sweep-3.spec.ts');
    expect(result.out).toContain('replay-core');
    expect(result.code).toBe(0);
    const rows = JSON.parse(readFileSync(out, 'utf8')) as { name: string; projectName: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.projectName === 'replay-core')).toBe(true);
  }, 120_000);
});

describe('the coverage provider', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const installed = (name: string): string => JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;

  test('@vitest/coverage-v8 is a devDependency at the exact version of the installed vitest', () => {
    expect(manifest.devDependencies['@vitest/coverage-v8']).toBe(installed('vitest'));
    expect(installed('@vitest/coverage-v8')).toBe(installed('vitest'));
  });

  test('`npm run test:coverage` runs the whole suite with the v8 provider', () => {
    expect(manifest.scripts['test:coverage']).toMatch(/^vitest run --coverage /);
  });
});
