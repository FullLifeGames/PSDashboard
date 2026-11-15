import { describe, expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { proveForcedWin } from '../src/endgame/prover';
import { loadSimMods } from '../src/forward/sim-mods';
import type { StaticRuleset } from '../src/eval-function';
import type { TeraAllowance } from '../src/types';

/**
 * Round 89 (#130, step 1): `proveForcedWin` called as the app calls it (no `floor`, no `plan`) must read as it did before the win
 * paths gave the prover those options. `fixtures/forced-win-default-path.json` holds the whole proof (mass, turns, caveat, the open
 * branch, the states and cells spent) of every scene below, recorded from the prover of commit 65a49132, before the change. A row
 * that differs means the default path moved: a score, a grade or the analysis' time would move with it.
 * Re-record only on purpose: `RECORD_DEFAULT_PATH=1 npx vitest run --project eval-engine packages/eval-engine/test/forced-win-default-path.spec.ts`.
 */
interface Scene { serialized: string; side: 'p1' | 'p2'; rootOrder?: string[]; tera?: TeraAllowance; sleepClause?: boolean; ruleset?: StaticRuleset }
const load = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url), 'utf-8'));

const budget = (name: string): Scene => {
  const board = load(`forced-win/budget-${name}`);
  const side = board.expected.side as 'p1' | 'p2';
  return { serialized: board.serialized, side, rootOrder: board.input.rootOrder[side], tera: board.input.tera ?? false, sleepClause: board.input.sleepClause ?? false, ruleset: board.input.ruleset };
};

const SCENES: Array<[string, () => Scene, 'doubles' | 'singles']> = [
  ...['gen9doublesou-2695084835-t8', 'gen9vgc2026regf-2532857804-t7'].map(name => [`budget ${name}`, () => budget(name), 'doubles'] as [string, () => Scene, 'doubles']),
  ...['plain-dice-gen9championsvgc2026regmbbo3-2679549596-t7', 'plain-dice-gen9vgc2025regi-2408473310-t13',
    'scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6', 'scout-miss-gen9championsvgc2026regmc-2694684816-t8',
    'scout-miss-gen9doublesou-2661746817-t8', 'scout-miss-gen9vgc2024regg-2163312677-t8',
  ].map(name => [name, () => load(`forced-win/${name}`) as Scene, 'doubles'] as [string, () => Scene, 'doubles']),
  ...[['smogtours-gen9ou-749351-t10', 'p1'], ['smogtours-gen9ou-749828-t23', 'p2']].map(([name, side]) =>
    [name, () => ({ ...load(`positions/${name}`), side, rootOrder: [] }) as Scene, 'singles'] as [string, () => Scene, 'singles']),
];

const recorded: Record<string, unknown> = process.env.RECORD_DEFAULT_PATH ? {} : load('forced-win-default-path');

describe('the prover on its default path reads as before the win paths', () => {
  test.each(SCENES)('%s', { timeout: 240_000 }, async (name, scene, mode) => {
    const board = scene();
    await loadSimMods('gen9championsou');
    await loadSimMods(mode === 'doubles' ? (board.ruleset === 'champions' ? 'gen9championsdoublescustomgame' : 'gen9doublescustomgame') : 'gen9customgame');
    const proof = proveForcedWin(board.serialized, { side: board.side, rootOrder: board.rootOrder ?? [], tera: board.tera ?? false, sleepClause: board.sleepClause, ruleset: board.ruleset });
    const actual = JSON.parse(JSON.stringify(proof));
    if (process.env.RECORD_DEFAULT_PATH) {
      recorded[name] = actual;
      writeFileSync(new URL('./fixtures/forced-win-default-path.json', import.meta.url), JSON.stringify(recorded, null, 1) + '\n');
      return;
    }
    expect(actual).toEqual(recorded[name]);
  });
});
