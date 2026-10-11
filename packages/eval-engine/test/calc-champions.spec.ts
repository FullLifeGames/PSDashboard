import { describe, expect, test } from 'vitest';
import { Battle, Dex, type PokemonSet } from '@pkmn/sim';
import { Generations } from '@smogon/calc';
import { bodyFromInfo, bodyOf, calcPokemon, type CalcBody } from '../src/calc/body';
import { calcMove } from '../src/calc/move';
import { makePokemonInfo } from '../src/branch/pokemon-info';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 67 (decision 30, merge): @smogon/calc 0.11 does not know Pokémon Champions. The engine's one builder
 * (calcPokemon) gives a body of a Champions battle (the battle's mod) EV = 8·SP − 4 and every IV 31, so the
 * calculator's stats equal the simulator's on the Champions mod. Checker: every body of Champions battles over the
 * Champions species and six natures, read off the simulator (bodyOf) and built by calcPokemon, against the
 * simulator's stored stats and maximum HP.
 */
type Stat = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
const STATS: Stat[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const GRID = [0, 1, 2, 15, 31, 32];
const NATURES = ['Adamant', 'Modest', 'Bold', 'Calm', 'Jolly', 'Brave'];

await loadSimMods('gen9championsou');

const championsSpecies = () => Dex.dexes.champions.species.all()
  .filter(species => species.exists && !species.battleOnly && !species.maxHP)
  .map(species => species.name);

function checkerSets(): PokemonSet[] {
  return championsSpecies().flatMap((species, s) => NATURES.map((nature, n) => ({
    name: species, species, item: '', ability: '', moves: ['Splash'], nature, gender: '', level: 50,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: Object.fromEntries(STATS.map((stat, k) => [stat, GRID[(s + n + k) % GRID.length]])) as Record<Stat, number>,
  } as PokemonSet)));
}

describe('the engine prices a Champions body as the simulator plays it (decision 30)', () => {
  test('calcPokemon on bodyOf gives the simulator\'s stats on every Champions body', () => {
    const gen = Generations.get(9);
    const sets = checkerSets();
    const wrong: string[] = [];
    const unknown = new Set<string>();
    for (let start = 0; start < sets.length; start += 6) {
      const team = sets.slice(start, start + 6);
      const battle = new Battle({ formatid: 'gen9championsou' as never, seed: '1,2,3,4', p1: { name: 'A', team }, p2: { name: 'B', team: team.slice(0, 1) } });
      for (const mon of battle.sides[0].pokemon) {
        let stats: Record<Stat, number>;
        try {
          const calc = calcPokemon(gen, bodyOf(battle, mon));
          stats = { ...calc.rawStats, hp: calc.maxHP() } as Record<Stat, number>;
        } catch {
          unknown.add(mon.species.name);
          continue;
        }
        const simulated = { ...mon.storedStats, hp: mon.maxhp } as Record<Stat, number>;
        for (const stat of STATS) if (stats[stat] !== simulated[stat]) wrong.push(`${mon.species.name} ${mon.set.nature} ${stat}: ${stats[stat]} vs ${simulated[stat]}`);
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
    // Species names @smogon/calc 0.11 does not know even through calcSpecies: their bodies go uncompared.
    expect(unknown.size, [...unknown].join(', ')).toBeLessThan(championsSpecies().length / 10);
  });

  test('the picker info of a Champions body prices as the simulator plays it', () => {
    const gen = Generations.get(9);
    const team = checkerSets().slice(0, 6);
    const battle = new Battle({ formatid: 'gen9championsou' as never, seed: '1,2,3,4', p1: { name: 'A', team }, p2: { name: 'B', team: team.slice(0, 1) } });
    for (const mon of battle.sides[0].pokemon) {
      const info = makePokemonInfo(mon);
      expect(info.mod).toBe('champions');
      const calc = calcPokemon(gen, bodyFromInfo(info));
      expect({ ...calc.rawStats, hp: calc.maxHP() }, mon.species.name).toEqual({ ...mon.storedStats, hp: mon.maxhp });
    }
  });

  test('calcMove gives the move of a Champions body the power and type of the Champions mod', () => {
    const gen = Generations.get(9);
    const attacker = { mod: 'champions' } as CalcBody;
    const wrong: string[] = [];
    for (const move of Dex.dexes.champions.moves.all()) {
      // The Let's Go moves and Struggle sit outside what the calc prices; a power callback sets power at use.
      if (!move.exists || move.isNonstandard === 'LGPE' || move.id === 'struggle') continue;
      const calc = calcMove(gen, move.name, attacker);
      if (calc.type !== move.type) wrong.push(`${move.name} type ${calc.type} vs ${move.type}`);
      if (move.category !== 'Status' && !move.basePowerCallback && calc.bp !== move.basePower) wrong.push(`${move.name} power ${calc.bp} vs ${move.basePower}`);
    }
    expect(wrong).toEqual([]);
  });

  test('a body outside Champions keeps its EVs and IVs', () => {
    const gen = Generations.get(9);
    const set = {
      name: 'Garchomp', species: 'Garchomp', item: '', ability: '', moves: ['Splash'], nature: 'Jolly', gender: '', level: 100,
      evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    } as PokemonSet;
    const battle = new Battle({ formatid: 'gen9customgame' as never, seed: '1,2,3,4', p1: { name: 'A', team: [set] }, p2: { name: 'B', team: [set] } });
    const mon = battle.sides[0].pokemon[0];
    const calc = calcPokemon(gen, bodyOf(battle, mon));
    expect({ ...calc.rawStats, hp: calc.maxHP() }).toEqual({ ...mon.storedStats, hp: mon.maxhp });
  });
});
