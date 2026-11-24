import { describe, expect, test } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import commentsPlugin from '../../eslint.comments.mjs';
import prosePlugin from '../../eslint.prose.mjs';
import testsPlugin from '../../eslint.tests.mjs';

/**
 * The rows of the project's own lint rules, run through `Linter` on source text. The tree itself is held by `npm run lint`: a rule that
 * reads the whole tree needs no row that reads the tree again.
 */

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
      "const a = 'turns 4–7';",            // 1: en dash in a string
      'const b = `from ${n} — now`;',       // 2: em dash in a template piece
      "const c = '—';",                      // 3: the empty value stays
      'const d = <p>One &mdash; two</p>;',  // 4: entity in JSX text
      'const e = <b>—</b>;',                // 5: sole child, stays
      'const f = <i>{x} — {y}</i>;',        // 6: joint between expressions
      'const g = <u title="a &ndash; b" />;', // 7: entity in an attribute
      '// a comment — with a dash',          // 8: comment, no text
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
      '// the cache grew in round 74',            // 1
      '// Runde 12 brought this',                  // 2
      '// ruling 48 of the user',                  // 3
      '// user gate: keep it',                     // 4
      '// gate 6b chose the weights',              // 5
      '// fixed on 13.10.2026',                    // 6
      '// fixed on 2026-10-13',                    // 7
      '// pin of T163',                            // 8
      '// see #145 for the scene',                 // 9
      '// issue 157 holds it',                     // 10
      '// built in lane C',                        // 11
      '// this used to read the global Dex',      // 12
      '// the old reader was removed',             // 13
      '// since round 70 the cap is 40',           // 14
      '// the user decided on a second pass',      // 15
      '// the list of the r89 branch',             // 16
      '// see H4h for the scene',                  // 17
      '// D3 of the plan',                         // 18
      '// decision 18 chose it',                   // 19
      '// the review of wave 1.5 found it',        // 20
      'export const x = 1;',                      // 21
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
      '// eslint-disable-next-line names/no-new-dex-name -- held by a sweep (round 72 W9b)', // 1
      "export const a = 'stall';",                                                              // 2
      '/* eslint-disable no-console -- the T163 probe */',                                     // 3
      '// @ts-expect-error #145 the call is wrong on purpose',                                 // 4
      '/** @vitest-environment jsdom, since round 70 */',                                      // 5
      '/* v8 ignore next -- 13.10.2026 */',                                                    // 6
      '/// <reference types="vite/client" />',                                                 // 7
      '/*! Copyright 2026-10-13 the authors */',                                               // 8
      '// oracle: packages/eval-engine/test/x-oracle.spec.ts',                                 // 9
      'export const L = 1;',                                                                   // 10
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

describe('tests/no-history', () => {
  const titles = (code: string, filename = 'x.spec.ts') =>
    lint(code, 'tests/no-history', [], filename).filter(message => message.ruleId === 'tests/no-history').map(message => message.line);

  test('each kind of history in a title reports its title', () => {
    const source = [
      "test('the cache grew (round 74)', () => {});",              // 1
      "it('T163: the floor clause', () => {});",                   // 2
      "describe('the prover (#145)', () => {});",                  // 3
      "test.each(t)('%s (T22)', () => {});",                       // 4
      "describe.each(t)('$name (ruling 4a)', () => {});",          // 5
      "test.fails('the verify row (T242)', () => {});",            // 6
      "test.skipIf(c)('the cap, set on 13.10.2026', () => {});",   // 7
      "test.describe('the flow (lane C)', () => {});",             // 8
      "(c ? test : test.skip)('the row (D3)', () => {});",         // 9
      'test(`${x}: the row (H4h)`, () => {});',                    // 10
      "test('the row (NG-2)', () => {});",                         // 11
      "test('the row (T20, decision 18)', () => {});",             // 12
      'const red = test;',                                         // 13
      "red('the row (T11)', () => {});",                           // 14
      "const rowTest = c ? test.fails : test;",                    // 15
      "rowTest.each(t)('the row (r89)', () => {});",               // 16
      "test.describe.serial('the flow (review of wave 1.5)', () => {});", // 17
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
