import { describe, expect, test } from 'vitest';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import namesPlugin from '../eslint.names.mjs';
import { censusOf, loadUniverse, ROOT } from '../scripts/name-census.mjs';

/**
 * Round 72 (T236): the name ratchet. AGENTS.md says our code translates and reads library data and never writes species,
 * move, item or ability names; the lessons' census found about 440 such literals in packages/*\/src. The rule
 * names/no-new-dex-name counts a Dex name literal per file against scripts/name-baseline.json, which only shrinks: a pair that
 * is not in the baseline fails `npm run lint`, a pair that left the code does not.
 *
 * The rule reads names, not formats: a singles log and a doubles log reach it the same way, so there is no game-type case.
 * Its limit: it sees a new name per file (a second `reflect` in a file that has one passes); the twin detector
 * (regression/twin-lists.spec.ts) sees a new copy of a list across files.
 */

const FILE = 'packages/eval-engine/src/zz-scratch.ts';
const RULE = 'names/no-new-dex-name';
const linter = new Linter();

/** Lints a source text with the rule and an injected baseline; returns the rule's messages. */
function lint(code: string, files: Record<string, string[]> = {}, filename = FILE): Linter.LintMessage[] {
  return linter.verify(
    code,
    [{
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { names: namesPlugin },
      rules: { [RULE]: ['error', { baseline: { files } }] },
    }],
    { filename },
  );
}

describe('names/no-new-dex-name', () => {
  test('a new pair is reported with the name as written and its kind', () => {
    const messages = lint("const move = 'copycat';\nconst item = 'Rocky Helmet';\nconst ability = \"Mind's Eye\";\nconst species = 'Garchomp';");
    expect(messages.map(m => m.ruleId)).toEqual([RULE, RULE, RULE, RULE]);
    expect(messages[0].message).toContain('"copycat" (move)');
    expect(messages[1].message).toContain('"Rocky Helmet" (item)');
    expect(messages[2].message).toContain('"Mind\'s Eye" (ability)');
    expect(messages[3].message).toContain('"Garchomp" (species)');
    expect(messages[0].line).toBe(1);
    expect(messages[3].line).toBe(4);
    expect(messages[0].message).toMatch(/eslint-disable-next-line names\/no-new-dex-name/);
  });

  test('a pair in the baseline passes, in either spelling, and a second use passes with it', () => {
    expect(lint("const a = 'copycat';\nconst b = 'Copycat';\nconst c = `copycat`;", { [FILE]: ['copycat'] })).toEqual([]);
  });

  test('a baseline pair of another file does not cover this file', () => {
    expect(lint("const a = 'copycat';", { 'packages/eval-engine/src/other.ts': ['copycat'] })).toHaveLength(1);
  });

  test('a baseline pair that left the code does not fail', () => {
    expect(lint('const a = 1;', { [FILE]: ['copycat', 'metronome'] })).toEqual([]);
  });

  test('a plain template counts; a template with an expression does not', () => {
    expect(lint('const a = `copycat`;')).toHaveLength(1);
    expect(lint('const a = `copycat${1}`;')).toEqual([]);
  });

  test('comments, module specifiers, regexes, short strings and non-name words do not count', () => {
    const code = [
      "// 'copycat' in a comment, Rocky Helmet too",
      "/* 'metronome' */",
      "import 'sketch';",
      "export * from 'metronome';",
      'const lazy = import(\'copycat\');',
      'const re = /copycat|metronome/;',
      "const cut = 'Cut';", // three characters
      "const word = 'status';", // not a Dex id
      "const type = 'Psychic';", // a Dex move that is also a type
      "const id = 'normal';", // a type id
      "const stat = 'speed';",
      'const open = `copycat${cut}`;',
      "const nothing = 'Copy cat';",
    ].join('\n');
    expect(lint(code)).toEqual([]);
  });

  test('a reviewed exception is silenced by eslint-disable-next-line with its reason', () => {
    const code = "// eslint-disable-next-line names/no-new-dex-name -- the move's own protocol word\nconst a = 'copycat';\nconst b = 'metronome';";
    const messages = lint(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].line).toBe(3);
  });

  test('a union type of names counts like any other literal', () => {
    expect(lint("type Call = 'copycat' | 'metronome';")).toHaveLength(2);
  });
});

describe('the rule in the repository config', () => {
  const eslint = new ESLint();
  const ruleOf = async (file: string) => {
    const config = await eslint.calculateConfigForFile(file);
    return (config as { rules?: Record<string, unknown> }).rules?.[RULE];
  };

  test('it is an error for the sources of both packages', async () => {
    expect(await ruleOf('packages/eval-engine/src/zz.ts')).toEqual([2]);
    expect(await ruleOf('packages/replay-core/src/zz.ts')).toEqual([2]);
  });

  test('it is off for tests, root specs, e2e and the app', async () => {
    for (const file of ['packages/eval-engine/test/zz.spec.ts', 'packages/replay-core/test/zz.spec.ts', 'regression/zz.spec.ts', 'e2e/zz.spec.ts', 'src/lib/zz.ts']) {
      expect(await ruleOf(file), file).toBeUndefined();
    }
  });
});

describe('the baseline against the tree', () => {
  const baseline = JSON.parse(readFileSync(fileURLToPath(new URL('../scripts/name-baseline.json', import.meta.url)), 'utf8')) as { files: Record<string, string[]> };
  const universe = loadUniverse();
  const census = censusOf(ROOT, universe) as Record<string, string[]>;

  test('no file of packages/*/src holds a Dex name the baseline lacks', () => {
    const fresh: string[] = [];
    for (const [file, ids] of Object.entries(census)) {
      for (const id of ids) if (!baseline.files[file]?.includes(id)) fresh.push(`${file}: ${id}`);
    }
    expect(fresh).toEqual([]);
  });

  test('the baseline is sorted, holds no file twice and counts what the lessons expected (hundreds of pairs)', () => {
    const files = Object.keys(baseline.files);
    expect(files).toEqual([...files].sort());
    for (const ids of Object.values(baseline.files)) expect(ids).toEqual([...new Set(ids)].sort());
    const pairs = Object.values(baseline.files).reduce((sum, ids) => sum + ids.length, 0);
    expect(pairs).toBeGreaterThan(300);
    expect(files.every(file => /^packages\/[^/]+\/src\//.test(file))).toBe(true);
  });

  test('the universe holds the four kinds and leaves out types, natures and stats', () => {
    expect(universe.kindOf('Rocky Helmet')?.kind).toBe('item');
    expect(universe.kindOf('Psychic')).toBeNull();
    expect(universe.kindOf('Adamant')).toBeNull();
    expect(universe.kindOf('speed')).toBeNull();
  });
});

describe('scripts/update-name-baseline.mjs', () => {
  test('diffNames names the pairs that came and the pairs that left', async () => {
    const { diffNames, serialize } = await import('../scripts/update-name-baseline.mjs');
    const diff = diffNames({ 'a.ts': ['copycat', 'metronome'], 'b.ts': ['sketch'] }, { 'a.ts': ['copycat', 'mimic'], 'c.ts': ['sketch'] });
    expect(diff.added).toEqual(['a.ts: mimic', 'c.ts: sketch']);
    expect(diff.removed).toEqual(['a.ts: metronome', 'b.ts: sketch']);
    expect(serialize({ files: {} })).toBe('{\n  "files": {}\n}\n');
  });

  test('the shipped baseline is what the script would write from the tree', async () => {
    const { diffNames } = await import('../scripts/update-name-baseline.mjs');
    const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../scripts/name-baseline.json', import.meta.url)), 'utf8')) as { files: Record<string, string[]> };
    const diff = diffNames(shipped.files, censusOf(ROOT, loadUniverse()));
    expect(diff.added).toEqual([]);
  });
});
