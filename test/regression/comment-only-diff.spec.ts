import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commentOnlyDiff, compareSource } from '../../scripts/comment-only-diff.mjs';
import { readByCode } from '../../scripts/comment-lib.mjs';

/**
 * The checker that proves a comment edit moved no code (scripts/comment-only-diff.mjs, its reader scripts/comment-lib.mjs): the token
 * streams of both texts match, and the comments that code reads stay byte for byte. The rows run on source text; one row runs the
 * git side in a scratch repository. No game type enters: the tool reads syntax.
 */

const ts = (before: string, after: string, file = 'x.ts') => compareSource(before, after, file) as { ok: boolean; reason?: string; detail?: string };

describe('a comment-only edit passes', () => {
  test('removing, shortening and adding comments, and moving whitespace, change no token', () => {
    const before = [
      '/** The fast path. */',
      '// retold: add one',
      'export function f(a: number) { // trailing',
      '  /* inner */ return a + /* mid */ 1;',
      '}',
    ].join('\n');
    const after = ['export function f(a: number) {', '  return a +   1;', '}', '// a new line'].join('\n');
    expect(ts(before, after)).toEqual({ ok: true });
  });

  test('a regular expression, a template and a string that look like comments are code', () => {
    const code = ['const a = /\\/\\/ x/g;', 'const b = `// ${a} /* y */`;', "const c = '// z';"].join('\n');
    expect(ts(code, `// head\n${code}\n`)).toEqual({ ok: true });
    expect(ts(code, code.replace('// z', '// w')).ok).toBe(false);
  });

  test('a JSX comment child leaves no token and the text around it folds as React folds it', () => {
    const before = ['export const A = () => (', '  <p>', '    one', '    {/* why */}', '    two', '  </p>', ');'].join('\n');
    const after = ['export const A = () => (', '  <p>', '    one', '    two', '  </p>', ');'].join('\n');
    expect(ts(before, after, 'a.tsx')).toEqual({ ok: true });
    expect(ts(before, after.replace('two', 'three'), 'a.tsx').ok).toBe(false);
  });

  test('a stylesheet differs only in comments and whitespace', () => {
    const before = '/* header */\n.a { color: red; /* why */ }\n.b::after { content: "/* kept */"; }\n';
    expect(compareSource(before, '.a {\n  color: red;\n}\n.b::after { content: "/* kept */"; }\n', 'a.css')).toEqual({ ok: true });
    const changed = compareSource(before, before.replace('red', 'blue'), 'a.css') as { ok: boolean; reason?: string };
    expect(changed.ok).toBe(false);
    expect(changed.reason).toBe('token');
    expect(compareSource(before, before.replace('"/* kept */"', '""'), 'a.css').ok).toBe(false);
  });
});

describe('a code change fails and names the first differing token', () => {
  test('a changed identifier', () => {
    const result = ts('const total = 1;\nexport const x = total;', 'const totals = 1;\nexport const x = total;');
    expect(result).toMatchObject({ ok: false, reason: 'token' });
    expect(result.detail).toContain('"total"');
    expect(result.detail).toContain('"totals"');
  });

  test('a changed string literal and a changed number', () => {
    expect(ts("export const a = 'one';", "export const a = 'two';")).toMatchObject({ ok: false, reason: 'token' });
    expect(ts('export const a = 12;', 'export const a = 13;')).toMatchObject({ ok: false, reason: 'token' });
  });

  test('a joined line after return changes the program, so it fails', () => {
    const result = ts('export function f() {\n  return\n    1;\n}', 'export function f() {\n  return 1;\n}');
    expect(result).toMatchObject({ ok: false, reason: 'token' });
    expect(result.detail).toContain('after a line break');
  });

  test('a token that left or arrived, and text that does not parse', () => {
    expect(ts('export const a = 1;', 'export const a = 1;\nexport const b = 2;')).toMatchObject({ ok: false, reason: 'token' });
    expect(ts('export const a = 1;', 'export const a = ;')).toMatchObject({ ok: false, reason: 'parse' });
  });
});

describe('the comments that code reads stay byte for byte', () => {
  const oracle = [
    '// the lists below hold the Dex rule',
    '// oracle: packages/eval-engine/test/x-oracle.spec.ts',
    'export const LIST = [1];',
  ].join('\n');

  test('an oracle marker that is edited, cut off from its declaration or removed fails; a comment above it may go', () => {
    expect(ts(oracle, oracle.replace('x-oracle', 'y-oracle'))).toMatchObject({ ok: false, reason: 'pragma' });
    expect(ts(oracle, oracle.replace('// oracle: packages/eval-engine/test/x-oracle.spec.ts\n', ''))).toMatchObject({ ok: false, reason: 'pragma' });
    expect(ts(oracle, oracle.replace('x-oracle.spec.ts\n', 'x-oracle.spec.ts\n\n'))).toMatchObject({ ok: false, reason: 'pragma' });
    expect(ts(oracle, oracle.replace('// the lists below hold the Dex rule\n', ''))).toEqual({ ok: true });
  });

  test('an oracle marker line inside a block comment counts alone', () => {
    const block = '/**\n * The list.\n * oracle: packages/replay-core/test/y.spec.ts\n */\nexport const L = 1;';
    expect(ts(block, '/**\n * oracle: packages/replay-core/test/y.spec.ts\n */\nexport const L = 1;')).toEqual({ ok: true });
    expect(ts(block, block.replace('y.spec', 'z.spec'))).toMatchObject({ ok: false, reason: 'pragma' });
  });

  test('an edited eslint-disable reason, and a directive that left or moved, fail', () => {
    const code = [
      'const run = () => 1;',
      '// eslint-disable-next-line names/no-new-dex-name -- held by a sweep (round 72)',
      "export const a = 'stall';",
    ].join('\n');
    expect(ts(code, code.replace(' (round 72)', ''))).toMatchObject({ ok: false, reason: 'pragma' });
    expect(ts(code, code.replace(/\/\/ eslint-disable.*\n/, ''))).toMatchObject({ ok: false, reason: 'pragma' });
    expect(ts(code, code.replace('const run', '// extra\nconst run'))).toEqual({ ok: true });
    const gap = code.replace("export const a", '// reason on its own line\nexport const a');
    expect(ts(code, gap)).toMatchObject({ ok: false, reason: 'pragma' });
  });

  test('a ts pragma, a vitest environment, a coverage hint, a reference and a license stay', () => {
    for (const [line, edited] of [
      ['// @ts-expect-error the call is wrong on purpose', '// @ts-expect-error the call is wrong'],
      ['/** @vitest-environment jsdom */', '/** @vitest-environment node */'],
      ['/* v8 ignore next */', '/* v8 ignore start */'],
      ['/// <reference types="vite/client" />', '/// <reference types="node" />'],
      ['/*! Copyright (c) the authors */', '/*! Copyright (c) the writers */'],
      ['#!/usr/bin/env node', '#!/usr/bin/env tsx'],
    ]) {
      const code = `${line}\nexport const a = 1;\n`;
      expect(ts(code, code.replace(line, edited))).toMatchObject({ ok: false, reason: 'pragma' });
      expect(ts(code, code.replace(line, ''))).toMatchObject({ ok: false, reason: 'pragma' });
      if (!line.startsWith('#!')) expect(ts(code, `// before\n${code}`)).toEqual({ ok: true });
    }
  });

  test('which comments code reads', () => {
    expect(readByCode('// plain prose about a game rule')).toBeNull();
    expect(readByCode('// eslint-disable-line no-console')).toEqual({ all: 'eslint' });
    expect(readByCode('/* eslint-disable react/foo -- why */')).toEqual({ all: 'eslint' });
    expect(readByCode('// the eslint ratchet shrinks')).toBeNull();
    expect(readByCode('// oracle: a.spec.ts')).toEqual({ lines: [0] });
    expect(readByCode('/**\n * words\n * oracle: a.spec.ts\n */')).toEqual({ lines: [2] });
  });
});

describe('the command over git revisions', () => {
  test('a comment edit passes, a code edit, a new file and a non-code file are told apart', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'comment-only-'));
    try {
      const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
      run('init', '-q');
      run('config', 'user.email', 'a@b.c');
      run('config', 'user.name', 'a');
      writeFileSync(path.join(dir, 'a.ts'), '// round 74\nexport const a = 1;\n');
      writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1;\n');
      writeFileSync(path.join(dir, 'n.md'), 'one\n');
      run('add', '.');
      run('commit', '-q', '-m', 'base');
      writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
      writeFileSync(path.join(dir, 'b.ts'), 'export const b = 2;\n');
      writeFileSync(path.join(dir, 'n.md'), 'two\n');
      writeFileSync(path.join(dir, 'c.ts'), 'export const c = 1;\n');
      run('add', '.');
      const result = commentOnlyDiff({ base: 'HEAD', paths: ['*.ts', '*.md'], cwd: dir });
      expect(result.checked).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.failures.map(failure => `${failure.file}:${failure.reason}`).sort()).toEqual(['b.ts:token', 'c.ts:status']);
      run('commit', '-q', '-m', 'edit');
      expect(commentOnlyDiff({ base: 'HEAD~1', head: 'HEAD', paths: ['a.ts'], cwd: dir }).failures).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
