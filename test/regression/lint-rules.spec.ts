import { describe, expect, test } from 'vitest';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import commentsPlugin from '../../eslint.comments.mjs';
import prosePlugin from '../../eslint.prose.mjs';
import testsPlugin from '../../eslint.tests.mjs';


const linter = new Linter();

const lint = (code: string, rule: string, options: unknown[] = [], filename = 'x.tsx') =>
  linter.verify(code, [{
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { prose: prosePlugin, comments: commentsPlugin, tests: testsPlugin },
    rules: { [rule]: ['error', ...options] },
  }], { filename });

describe('prose/no-dash', () => {
  test('strings, template pieces, JSX text and entities are flagged; comments and the empty value are not', () => {
    const source = [
      "const a = 'turns 4–7';",
      'const b = `from ${n} — now`;',
      "const c = '—';",
      'const d = <p>One &mdash; two</p>;',
      'const e = <b>—</b>;',
      'const f = <i>{x} — {y}</i>;',
      'const g = <u title="a &ndash; b" />;',
      '// a comment — with a dash',
    ].join('\n');
    expect(lint(source, 'prose/no-dash', [{ emptyValue: true }]).map(message => message.line)).toEqual([1, 2, 4, 6, 7]);
  });

  test('without the empty-value option a lone em dash is flagged too (the report prose has no empty value)', () => {
    const source = ["const a = '—';", 'const b = <b>—</b>;'].join('\n');
    expect(lint(source, 'prose/no-dash').map(message => message.line)).toEqual([1, 2]);
    expect(lint(source, 'prose/no-dash', [{ emptyValue: true }])).toEqual([]);
  });
});

describe('comments/no-history', () => {
  const history = (code: string, baseline: Record<string, number> = {}) =>
    lint(code, 'comments/no-history', [{ baseline }]).filter(message => message.ruleId === 'comments/no-history').map(message => message.line);

  test('each pattern of history reports its comment line', () => {
    const source = [
      '// the cache grew in round 74',
      '// Runde 12 brought this',
      '// ruling 48 of the user',
      '// user gate: keep it',
      '// gate 6b chose the weights',
      '// fixed on 13.10.2026',
      '// fixed on 2026-10-13',
      '// pin of T163',
      '// see #145 for the scene',
      '// issue 157 holds it',
      '// built in lane C',
      '// this used to read the global Dex',
      '// the old reader was removed',
      '// since round 70 the cap is 40',
      '// the user decided on a second pass',
      '// the list of the r89 branch',
      '// see H4h for the scene',
      '// D3 of the plan',
      '// decision 18 chose it',
      '// the review of wave 1.5 found it',
      'export const x = 1;',
    ].join('\n');
    expect(history(source)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  test('a comment that explains the code, a string with the same text and a type parameter are not history', () => {
    const source = [
      '// A Pokemon that faints on the same turn cannot move: the simulator drops its action.',
      '/** The ratio of the first hit, 0 to 1. */',
      "export const a = 'round 74 #145 13.10.2026 T163';",
      "export const b = `gate 6b ${a}`;",
      '// the table has 100 rows and 12 columns; T and U stand for the two sides',
      '// the 3rd round of the tournament decides',
      '// a #1 seed and 4 rounds',
    ].join('\n');
    expect(history(source)).toEqual([]);
  });

  test('a block comment reports the line inside it, not the first line', () => {
    const source = ['/**', ' * The prover.', ' * Added in round 89.', ' */', 'export const p = 1;'].join('\n');
    expect(history(source)).toEqual([3]);
  });

  test('the comments that code reads never report: directives, pragmas, oracle marker lines, references, legal headers', () => {
    const source = [
      '// eslint-disable-next-line names/no-new-dex-name -- held by a sweep (round 72 W9b)',
      "export const a = 'stall';",
      '/* eslint-disable no-console -- the T163 probe */',
      '// @ts-expect-error #145 the call is wrong on purpose',
      '/** @vitest-environment jsdom, since round 70 */',
      '/* v8 ignore next -- 13.10.2026 */',
      '/// <reference types="vite/client" />',
      '/*! Copyright 2026-10-13 the authors */',
      '// oracle: packages/eval-engine/test/x-oracle.spec.ts',
      'export const L = 1;',
    ].join('\n');
    expect(history(source)).toEqual([]);
  });

  test('an oracle marker line in a block comment is read by code, the line beside it is not', () => {
    const source = ['/**', ' * Added in round 89.', ' * oracle: packages/replay-core/test/y.spec.ts round 4', ' */', 'export const L = 1;'].join('\n');
    expect(history(source)).toEqual([2]);
  });

  test('a file reports nothing at or below its baseline and every line above it', () => {
    const source = ['// round 74', '// round 75', 'export const x = 1;'].join('\n');
    expect(history(source, { 'x.tsx': 2 })).toEqual([]);
    expect(history(source, { 'x.tsx': 3 })).toEqual([]);
    expect(history(source, { 'x.tsx': 1 })).toEqual([1, 2]);
    expect(history(source, { 'other.tsx': 2 })).toEqual([1, 2]);
  });
});

describe('comments/shape', () => {
  const shape = (code: string, options: Record<string, unknown> = {}) =>
    lint(code, 'comments/shape', [options]).filter(message => message.ruleId === 'comments/shape').map(message => `${message.line}:${/^(\w+):/.exec(message.message)?.[1]}`);

  const fixed = (code: string) =>
    linter.verifyAndFix(code, [{
      files: ['**/*.{ts,tsx}'],
      languageOptions: { parser: tseslint.parser },
      plugins: { comments: commentsPlugin },
      rules: { 'comments/shape': 'error' },
    }], { filename: 'x.ts' }).output;

  const wide = (columns: number, lead = '// ') => lead + 'x'.repeat(columns - lead.length);

  test('a comment line past column 120 reports, one at 120 does not, and the code before a trailing comment counts', () => {
    expect(shape(`${wide(121)}\nexport const a = 1;`)).toEqual(['1:wide']);
    expect(shape(`${wide(120)}\nexport const a = 1;`)).toEqual([]);
    expect(shape(`const a = 1; ${wide(121 - 13)}`)).toEqual(['1:wide']);
    expect(shape(`const a = 1; ${wide(120 - 13)}`)).toEqual([]);
    expect(shape(`/**\n * one\n * ${'x'.repeat(130)}\n */\nconst a = 1;`)).toEqual(['3:wide']);
  });

  test('a custom width moves the limit', () => {
    expect(shape(`${wide(61)}\nexport const a = 1;`, { width: 60 })).toEqual(['1:wide']);
  });

  test('a lone URL line is exempt', () => {
    expect(shape(`// https://example.com/${'a'.repeat(120)}\nexport const a = 1;`)).toEqual([]);
  });

  test('more than two text lines in a row report, two do not, and the delimiter lines of a JSDoc do not count', () => {
    expect(shape('const a = 1;\n// one\n// two\n// three\nconst b = 2;')).toEqual(['2:lines']);
    expect(shape('const a = 1;\n// one\n// two\nconst b = 2;')).toEqual([]);
    expect(shape('const a = 1;\n/**\n * one\n * two\n */\nconst b = 2;')).toEqual([]);
    expect(shape('const a = 1;\n/**\n * one\n * two\n * three\n */\nconst b = 2;')).toEqual(['3:lines']);
  });

  test('a blank line does not split a block, and a file header counts apart from the comment of the first import', () => {
    expect(shape('const a = 1;\n// one\n// two\n\n// three\n// four\nconst b = 2;')).toEqual(['2:lines']);
    expect(shape("// one\n// two\n\n// three\n// four\nimport a from 'a';\nexport const b = a;")).toEqual([]);
    expect(shape("// one\n// two\n// three\n\nimport a from 'a';\nexport const b = a;")).toEqual(['1:lines']);
  });

  test('a trailing comment is its own comment', () => {
    expect(shape('const a = 1; // one\n// two\n// three\nconst b = 2;')).toEqual([]);
  });

  test('the JSDoc of an exported declaration holds one text line; a member, a non-exported declaration and a named export follow their own rule', () => {
    const two = '/**\n * one\n * two\n */\n';
    expect(shape(`${two}export function f() {}`)).toEqual(['1:exportDoc']);
    expect(shape(`${two}export const c = 1;`)).toEqual(['1:exportDoc']);
    expect(shape('/** one */\nexport function f() {}')).toEqual([]);
    expect(shape(`export interface I {\n  /**\n   * one\n   * two\n   */\n  a: number;\n}`)).toEqual([]);
    expect(shape(`${two}function g() {}`)).toEqual([]);
    expect(shape(`${two}function g() {}\nexport { g };`)).toEqual(['1:exportDoc']);
  });

  test('a comment of one text line on three physical lines reports, and the autofix writes it on one line', () => {
    const source = '/**\n * one line\n */\nexport const a = 1;';
    expect(shape(source)).toEqual(['1:oneLine']);
    expect(fixed(source)).toBe('/** one line */\nexport const a = 1;');
    expect(fixed('const a = 1;\n  /*\n   * one line\n   */\nconst b = 2;')).toBe('const a = 1;\n  /* one line */\nconst b = 2;');
    expect(fixed(`/**\n * ${'x'.repeat(115)}\n */\nexport const a = 1;`)).toContain('\n * ');
  });

  test('comments that code reads never report: directives, references, legal headers, an oracle line inside a block', () => {
    const source = [
      `// eslint-disable-next-line no-console -- ${'x'.repeat(140)}`,
      `// @ts-expect-error ${'x'.repeat(140)}`,
      '/// <reference types="vite/client" />',
      '/*! legal',
      ' * a',
      ' * b',
      ' * c',
      ' */',
      '// one',
      '// oracle: packages/eval-engine/test/x-oracle.spec.ts',
      '// two',
      'export const a = 1;',
    ].join('\n');
    expect(shape(source)).toEqual([]);
  });

  test('with localDoc forbid a JSDoc on a declaration the module does not export reports; an export does not', () => {
    expect(shape('/** one */\nfunction f() {}', { localDoc: 'forbid' })).toEqual(['1:localDoc']);
    expect(shape('/** one */\nconst c = 1;\nexport { c };', { localDoc: 'forbid' })).toEqual([]);
    expect(shape('/** one */\nexport function f() {}', { localDoc: 'forbid' })).toEqual([]);
    expect(shape('/** one */\nfunction f() {}')).toEqual([]);
    expect(shape('/** one */\n\nfunction f() {}', { localDoc: 'forbid' })).toEqual([]);
  });
});

describe('tests/no-history', () => {
  const titles = (code: string, filename = 'x.spec.ts') =>
    lint(code, 'tests/no-history', [], filename).filter(message => message.ruleId === 'tests/no-history').map(message => message.line);

  test('each kind of history in a title reports its title', () => {
    const source = [
      "test('the cache grew (round 74)', () => {});",
      "it('T163: the floor clause', () => {});",
      "describe('the prover (#145)', () => {});",
      "test.each(t)('%s (T22)', () => {});",
      "describe.each(t)('$name (ruling 4a)', () => {});",
      "test.fails('the verify row (T242)', () => {});",
      "test.skipIf(c)('the cap, set on 13.10.2026', () => {});",
      "test.describe('the flow (lane C)', () => {});",
      "(c ? test : test.skip)('the row (D3)', () => {});",
      'test(`${x}: the row (H4h)`, () => {});',
      "test('the row (NG-2)', () => {});",
      "test('the row (T20, decision 18)', () => {});",
      'const red = test;',
      "red('the row (T11)', () => {});",
      "const rowTest = c ? test.fails : test;",
      "rowTest.each(t)('the row (r89)', () => {});",
      "test.describe.serial('the flow (review of wave 1.5)', () => {});",
    ].join('\n');
    expect(titles(source)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 17]);
  });

  test('game facts and strings outside a title never report', () => {
    const source = [
      "test('653785 t24: Rock Slide hits both foes', () => {});",
      "test('the score at turn 35 and GPL t38', () => {});",
      "test('p1a and P1 swap, and a #1 seed stays', () => {});",
      "test('gen9ou and Gen 9 with K 1.85 and x1.1 in UTF-8', () => {});",
      "test('Porygon2 at T0', () => {});",
      "test('a step', async () => { await test.step('round 74', async () => {}); });",
      "test('a check', () => { expect(x).toBe('round 74'); });",
      "test.skip(c, 'T163 is not ready');",
      "const a = 'T163';",
      "log('round 74 (#145)');",
      '// round 74',
    ].join('\n');
    expect(titles(source)).toEqual([]);
  });

  test('a spec file named with a T-number or a round reports once', () => {
    const code = 'export const x = 1;';
    const at = (filename: string) => titles(code, filename);
    expect(at('packages/eval-engine/test/luck-rolls-t22.spec.ts')).toEqual([1]);
    expect(at('test/ui/components/percent-share-t51.spec.tsx')).toEqual([1]);
    expect(at('test/regression/x-round-89.spec.ts')).toEqual([1]);
    expect(at('test/regression/x-r89.spec.ts')).toEqual([1]);
    expect(at('packages/eval-engine/test/luck.ledger.spec.ts')).toEqual([]);
    expect(at('packages/eval-engine/test/gen9-luck.spec.ts')).toEqual([]);
    expect(at('test/regression/sets-roundtrip.spec.ts')).toEqual([]);
    expect(at('test/regression/helper-t22.ts')).toEqual([]);
  });
});

describe('comment rules in the project config', () => {
  const files = [
    'src/lib/x.ts',
    'packages/eval-engine/src/x.ts',
    'packages/replay-core/src/x.ts',
    'test/ui/x.spec.tsx',
    'test/regression/x.spec.ts',
    'test/e2e-feedback/corpus.ts',
    'packages/eval-engine/test/x.spec.ts',
    'scripts/x.mjs',
    'eslint.config.js',
    'packages/eval-engine/bin/eval-engine.mjs',
    'packages/replay-core/examples/parse-replay.mjs',
  ];

  test.each(files)('%s fails on a history line and on shape, JSDoc on a local declaration included', async file => {
    const config = await new ESLint().calculateConfigForFile(file);
    expect(config?.rules?.['comments/no-history']?.[0]).toBe(2);
    expect(config?.rules?.['comments/shape']).toEqual([2, { localDoc: 'forbid' }]);
  });
});
