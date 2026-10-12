import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calcGenerationFor, calcModOf, simGenNum } from '@fulllifegames/replay-core';

/**
 * Round 68 (T186, decisions 1 and 6): one function decides the calculator's generation from the game generation and
 * the battle's mod (replay-core calc-gen.ts), and every caller takes it. The calculator's generation number is not the
 * simulator's: the Champions mod is the calculator's generation 0, which plays on Gen 9's rules, so a reader that wants
 * the simulator's generation asks simGenNum.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = `${dir}/${name}`;
    if (name === 'node_modules' || name === 'dist') return [];
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}
const sourceFiles = () => ['packages/eval-engine/src', 'packages/replay-core/src', 'src'].flatMap(dir => sources(`${ROOT}${dir}`));
const rel = (path: string) => path.slice(ROOT.length);

describe('the calculator generation of a battle (decision 1)', () => {
  test('a game generation without a mod, or under a mod other than Champions, is its own generation, clamped to 1..9', () => {
    for (const gen of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      for (const mod of [undefined, 'base', 'gen7letsgo']) {
        expect(calcGenerationFor(gen, mod).num, `${gen} ${mod}`).toBe(gen);
        expect(simGenNum(calcGenerationFor(gen, mod)), `${gen} ${mod}`).toBe(gen);
      }
    }
    expect(calcGenerationFor(12).num).toBe(9);
    expect(calcGenerationFor(-3).num).toBe(1);
  });

  test('the Champions mod prices on the calculator\'s own generation 0, which the simulator reads as generation 9', () => {
    const gen = calcGenerationFor(9, 'champions');
    expect(simGenNum(gen)).toBe(9);
    expect(gen.species.get('garchomp' as never), 'a generation with data').toBeDefined();
    expect(gen.num).toBe(0);
  });

  test('generation 0 is the Champions generation whatever the mod argument says', () => {
    expect(calcGenerationFor(0).num).toBe(0);
    expect(calcGenerationFor(9, 'champions').num).toBe(0);
    expect(calcGenerationFor(9).num).toBe(9);
  });

  test('a format id names its mod: Champions formats of both game types, no other', () => {
    for (const format of ['gen9championsou', 'gen9championsvgc2026regmbbo3', 'gen9championscustomgame', 'gen9championsdoublescustomgame']) {
      expect(calcModOf(format), format).toBe('champions');
    }
    for (const format of ['gen9ou', 'gen9doublesou', 'gen9vgc2026regi', 'gen3customgame', 'gen9draft']) expect(calcModOf(format), format).toBeUndefined();
  });

  test('no source file but replay-core\'s calc-gen.ts asks the calculator for a generation', () => {
    const callers = sourceFiles().filter(path => /\bGenerations\.get\(/.test(readFileSync(path, 'utf-8'))).map(rel);
    expect(callers).toEqual(['packages/replay-core/src/calc-gen.ts']);
  });

  test('no source file reads the calculator generation\'s number as the simulator\'s generation', () => {
    // calc/body.ts keys its memos by the calculator generation itself (calcAddsStages, calcSpecies) and tells generation 0 apart.
    const allowedInBody = /calcAddsStages\(gen\.num|calcSpecies\(gen\.num|\(gen\.num as number\)/;
    const reads = sourceFiles().filter(path => !path.endsWith('replay-core/src/calc-gen.ts')).flatMap(path => readFileSync(path, 'utf-8').split(/\r?\n/)
      .filter(line => /\b(?:gen|calcGen|ctx\.gen)\.num\b/.test(line) && !(path.endsWith('eval-engine/src/calc/body.ts') && allowedInBody.test(line)))
      .map(line => `${rel(path)}: ${line.trim()}`));
    expect(reads).toEqual([]);
  });
});

describe('the small consequences of the 0.12 diff (decision 6)', () => {
  test('the damage preview passes no species option to the calculator\'s move (0.12 dropped it)', () => {
    const source = readFileSync(`${ROOT}packages/eval-engine/src/damage-calc.ts`, 'utf-8');
    expect(source).not.toMatch(/\bCalcSpecies\b/);
    expect(source).not.toMatch(/^\s*species: attacker\.species/m);
  });
});
