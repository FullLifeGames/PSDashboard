import { describe, expect, test } from 'vitest';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import dexPlugin from '../eslint.dex.mjs';

/**
 * Round 75 (T160, decision D1): the rule dex/no-global-dex-read. The global Dex of @pkmn/sim (and of @pkmn/dex) is Generation 9 on
 * Scarlet/Violet, so a read of it is wrong for the type chart of Gens 1 to 5, a species' older stats and abilities, and the
 * Pokémon Champions mod. replay-core reads rules only through rules-dex.ts; the rule fails `npm run lint` on any other value
 * reference to an imported `Dex`. It replaces the census spec of round 67: no exceptions, and a new read is a lint error, not a number.
 * The rule reads code, not games: a singles and a doubles log reach it the same way.
 */
const RULE = 'dex/no-global-dex-read';
const linter = new Linter();

function lint(code: string, filename = 'packages/replay-core/src/zz-scratch.ts'): Linter.LintMessage[] {
  return linter.verify(
    code,
    [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser }, plugins: { dex: dexPlugin }, rules: { [RULE]: 'error' } }],
    { filename },
  );
}

describe(RULE, () => {
  test('a table read, a generation read and a registry read of the imported Dex are reported', () => {
    const code = [
      "import { Dex } from '@pkmn/sim';",
      "const move = Dex.moves.get('tackle');",
      'const gen = Dex.forGen(5);',
      "const format = Dex.formats.get('gen9ou');",
    ].join('\n');
    const messages = lint(code);
    expect(messages.map(m => [m.ruleId, m.line])).toEqual([[RULE, 2], [RULE, 3], [RULE, 4]]);
    expect(messages[0].message).toMatch(/rulesDex\(gen, mod\)/);
  });

  test('the Dex of @pkmn/dex and an alias count too, and so does passing the Dex on', () => {
    const code = [
      "import { Dex as SimDex } from '@pkmn/sim';",
      "import { Dex } from '@pkmn/dex';",
      'const stats = Dex.stats.ids();',
      'const pass = (dex: unknown) => dex;',
      'pass(SimDex);',
    ].join('\n');
    expect(lint(code).map(m => m.line)).toEqual([3, 5]);
  });

  test('the type of the Dex is no read: typeof in a type, an import type, a type-only specifier', () => {
    const code = [
      "import { Dex } from '@pkmn/sim';",
      "import type { Dex as TypeOnly } from '@pkmn/sim';",
      "import { type Dex as Named } from '@pkmn/sim';",
      'type Moves = ReturnType<typeof Dex.moves.get>;',
      'type Gen = ReturnType<typeof Dex.forGen>;',
      'declare const dex: TypeOnly | Named;',
      'export type { Moves, Gen };',
      'export { dex };',
    ].join('\n');
    expect(lint(code)).toEqual([]);
  });

  test('other imports of the same packages, and a Dex of another source, are no read', () => {
    const code = [
      "import { Teams, toID } from '@pkmn/sim';",
      "import { Dex } from './not-the-simulator';",
      "const packed = Teams.pack([]) + toID('x') + Dex.moves.get('tackle');",
    ].join('\n');
    expect(lint(code)).toEqual([]);
  });

  test('a reviewed exception is silenced by eslint-disable-next-line with its reason', () => {
    const code = "import { Dex } from '@pkmn/sim';\n// eslint-disable-next-line dex/no-global-dex-read -- reason\nconst a = Dex.moves.get('tackle');\nconst b = Dex.items.get('x');";
    expect(lint(code).map(m => m.line)).toEqual([4]);
  });
});

describe('the rule in the repository', () => {
  test('replay-core reads the global Dex nowhere but in rules-dex.ts', () => {
    const root = join(__dirname, '..', 'packages', 'replay-core', 'src');
    const files = (readdirSync(root, { recursive: true }) as string[]).filter(name => name.endsWith('.ts')).map(name => join('packages/replay-core/src', name));
    expect(files.length).toBeGreaterThan(70);
    const offending = files.filter(file => !file.endsWith('rules-dex.ts'))
      .flatMap(file => lint(readFileSync(join(__dirname, '..', file), 'utf8'), file).filter(message => message.ruleId === RULE).map(message => `${file}:${message.line}`));
    expect(offending).toEqual([]);
    const reading = files.filter(file => file.endsWith('rules-dex.ts')).flatMap(file => lint(readFileSync(join(__dirname, '..', file), 'utf8'), file));
    expect(reading.length).toBeGreaterThan(0);
  });

  test('the config makes it an error for replay-core sources and exempts the resolver', async () => {
    const eslint = new ESLint();
    const ruleOf = async (file: string) => ((await eslint.calculateConfigForFile(file)) as { rules?: Record<string, unknown> }).rules?.[RULE];
    expect(await ruleOf('packages/replay-core/src/team-info.ts')).toEqual([2]);
    expect(await ruleOf('packages/replay-core/src/rules-dex.ts')).toBeUndefined();
  });
});
