import { describe, expect, test } from 'vitest';
import { Battle, Dex, type PokemonSet } from '@pkmn/sim';
import { calcGenerationFor } from '@fulllifegames/replay-core';
import { bodyOf, calcPokemon } from '../src/calc/body';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 68 (T186, decision 3): a species the calculator does not know must not throw. Checker: every species the
 * Champions mod allows (isNonstandard null) builds through calcPokemon on a body read off the simulator (bodyOf) without a
 * throw, with the simulator's stats at 0 Stat Points on a neutral nature, the mod's types and the mod's weight. The
 * calculator's generation 0 lacks 35 of them (the base Aegislash, the Vivillon patterns, the Alcremie flavors, the
 * Ogerpon Tera forms, Terapagos-Terastal, ...); under 0.11 it lacks the Mega forms as well. The same builder serves
 * singles and doubles; the run covers the OU format and the VGC format, which load the same mod.
 */
await loadSimMods('gen9championsou');

const legalSpecies = () => Dex.dexes.champions.species.all().filter(species => species.exists && !species.isNonstandard).map(species => species.name);
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;

function neutralSet(species: string): PokemonSet {
  return {
    name: species, species, item: '', ability: '', moves: ['Splash'], nature: 'Hardy', gender: '', level: 50,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  } as PokemonSet;
}

describe('every species of the Champions mod builds in the calculator (decision 3)', () => {
  for (const formatid of ['gen9championsou', 'gen9championsvgc2026regmcbo3']) {
    test(`${formatid}: no throw, the simulator's stats, types and weight`, () => {
      const gen = calcGenerationFor(9, 'champions');
      const names = legalSpecies();
      const wrong: string[] = [];
      for (let start = 0; start < names.length; start += 6) {
        const team = names.slice(start, start + 6).map(neutralSet);
        const battle = new Battle({ formatid: formatid as never, seed: '1,2,3,4', p1: { name: 'A', team }, p2: { name: 'B', team: team.slice(0, 1) } });
        for (const mon of battle.sides[0].pokemon) {
          const name = mon.species.name;
          try {
            const calc = calcPokemon(gen, bodyOf(battle, mon));
            const stats = { ...calc.rawStats, hp: calc.maxHP() } as Record<string, number>;
            const simulated = { ...mon.storedStats, hp: mon.maxhp } as Record<string, number>;
            for (const stat of STATS) if (stats[stat] !== simulated[stat]) wrong.push(`${name} ${stat}: ${stats[stat]} vs ${simulated[stat]}`);
            if (calc.types.join('/') !== mon.species.types.join('/')) wrong.push(`${name} types ${calc.types.join('/')} vs ${mon.species.types.join('/')}`);
            if (calc.weightkg !== mon.species.weightkg) wrong.push(`${name} weight ${calc.weightkg} vs ${mon.species.weightkg}`);
          } catch (error) {
            wrong.push(`${name}: throws ${String(error).slice(0, 60)}`);
          }
        }
      }
      expect(names.length).toBeGreaterThan(300);
      expect(wrong.slice(0, 12), `${wrong.length} wrong`).toEqual([]);
    });
  }
});
