import { describe, expect, test } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import commentsPlugin from '../../eslint.comments.mjs';
import prosePlugin from '../../eslint.prose.mjs';

/**
 * The rows of the project's own lint rules, run through `Linter` on source text. The tree itself is held by `npm run lint`: a rule that
 * reads the whole tree needs no row that reads the tree again.
 */

const linter = new Linter();

const lint = (code: string, rule: string, options: unknown[] = []) =>
  linter.verify(code, [{
    files: ['**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { prose: prosePlugin, comments: commentsPlugin },
    rules: { [rule]: ['error', ...options] },
  }], { filename: 'x.tsx' });

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
      'export const x = 1;',                      // 16
    ].join('\n');
    expect(history(source)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
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
