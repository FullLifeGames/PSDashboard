import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { buildCalcPokemon, calcBaseStats, type SpeciesDex } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { rulesDex } from '../src/rules-dex';

/**
 * Round 78 (@pkmn 0.10.12): Obliteryx 2.0 lowered its Special Defense from 90 to 78 in the Dex, and @smogon/calc 0.12
 * still lists 90. The builder took a species the calculator lists as the calculator lists it, so a gen 9 body carried
 * 90 while the simulator played 78. The battle's Dex is the rule: where the calculator's base stats or types differ, the
 * body takes the Dex's. The sweep holds every species the calculator lists, in generations 1 to 9 and in Champions, to
 * the Dex of that generation.
 */
Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;

describe('a calculator body carries the Dex values', () => {
  test('Obliteryx 2.0: a gen 9 body has the Dex Special Defense of 78, where the calculator lists 90', () => {
    const gen = calcGenerationFor(9);
    expect(gen.species.get('obliteryx' as never)?.baseStats.spd).toBe(90);
    expect(buildCalcPokemon(gen, 'Obliteryx').species.baseStats.spd).toBe(78);
    expect(calcBaseStats(gen, 'Obliteryx')?.spd).toBe(78);
  });

  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 0])('generation %i: every species the calculator lists builds with the Dex base stats and types', num => {
    const gen = calcGenerationFor(num);
    const dex = rulesDex(num) as unknown as SpeciesDex;
    const wrong: string[] = [];
    for (const listed of gen.species) {
      const row = dex.species.get(listed.name);
      if (!row.exists) continue;
      const built = buildCalcPokemon(gen, listed.name, {}, dex);
      const stats = STATS.filter(stat => built.species.baseStats[stat] !== row.baseStats[stat]);
      if (stats.length > 0 || built.types.join('/') !== row.types.join('/')) wrong.push(`${listed.name} ${stats.join(',')} ${built.types.join('/')}`);
    }
    expect(wrong).toEqual([]);
  });
});
