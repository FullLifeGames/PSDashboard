import { describe, expect, test } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
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
    plugins: { prose: prosePlugin },
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
