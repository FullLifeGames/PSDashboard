import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { calcGenerationFor } from '@fulllifegames/replay-core';
import { bodyOf, calcPokemon } from '../src/calc/body';

/**
 * Round 68 (T186, decision 6): @smogon/calc 0.12 computes a Gen 1 and Gen 2 stat from the EVs it is given (stat
 * experience), where 0.11 used a flat maximum. A body the engine builds from a Gen 1 or Gen 2 battle must therefore
 * carry the battle's EVs and read the simulator's stored stats and maximum HP at every EV. Singles only: the Gen 1 and
 * Gen 2 formats have no doubles. A path that differs (the spread solver's ZERO_EVS default is the suspect) is named in
 * the ledger as a TODO.
 */
const EVS = [0, 100, 252, 255];
const SPECIES = ['Alakazam', 'Snorlax', 'Tauros', 'Starmie', 'Gengar'];

function team(ev: number): PokemonSet[] {
  return SPECIES.map(species => ({
    name: species, species, item: '', ability: '', moves: ['Splash'], nature: '', gender: '', level: 100,
    evs: { hp: ev, atk: ev, def: ev, spa: ev, spd: ev, spe: ev }, ivs: { hp: 30, atk: 30, def: 30, spa: 30, spd: 30, spe: 30 },
  }));
}

describe('a Gen 1 and Gen 2 body prices the simulator\'s stats at every EV (decision 6)', () => {
  for (const formatid of ['gen1customgame', 'gen2customgame']) {
    test(`${formatid}: calcPokemon on bodyOf gives the stored stats and the maximum HP at EVs ${EVS.join(', ')}`, () => {
      const wrong: string[] = [];
      for (const ev of EVS) {
        const sets = team(ev);
        const battle = new Battle({ formatid: toID(formatid) as never, seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack(sets) }, p2: { name: 'B', team: Teams.pack(sets.slice(0, 1)) } });
        const gen = calcGenerationFor(battle.gen, battle.dex.currentMod);
        for (const mon of battle.sides[0].pokemon) {
          const calc = calcPokemon(gen, bodyOf(battle, mon));
          const stats = { ...calc.rawStats, hp: calc.maxHP() } as Record<string, number>;
          const simulated = { ...mon.storedStats, hp: mon.maxhp } as Record<string, number>;
          for (const stat of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) {
            // Gen 1 has one Special stat: the simulator keeps it in spa and spd, the calc in spa.
            if (battle.gen === 1 && stat === 'spd') continue;
            if (stats[stat] !== simulated[stat]) wrong.push(`ev ${ev} ${mon.species.name} ${stat}: ${stats[stat]} vs ${simulated[stat]}`);
          }
        }
      }
      expect(wrong.slice(0, 12)).toEqual([]);
    });
  }
});
