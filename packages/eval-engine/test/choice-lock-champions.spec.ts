import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { Field, Generations, Move, Pokemon, calculate } from '@smogon/calc';
import { calcEvs, calcIvs, evBudget, type DamageObservation, type PokemonEvs } from '@fulllifegames/replay-core';
import { corroborateChoiceItem } from '../src/choice-lock';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 67 (decision 30, merge): the guessed Choice item check prices a set of
 * a Champions game on its Stat Points (EV = 8·SP − 4, every IV 31), as the
 * server rolls the hit. Read as EVs, 32 Attack Stat Points lose a quarter of
 * Gengar's Attack, and the banded hit the log shows fits no hypothesis.
 */
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const gengar: PokemonSet = {
  name: 'Gengar', species: 'Gengar', item: 'Choice Band', ability: 'Cursed Body', moves: ['Shadow Claw'], nature: 'Adamant',
  gender: '', level: 50, evs: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, ivs: ALL_31,
};
const alakazam: PokemonSet = {
  name: 'Alakazam', species: 'Alakazam', item: '', ability: 'Magic Guard', moves: ['Psychic'], nature: 'Timid',
  gender: '', level: 50, evs: { hp: 0, atk: 0, def: 0, spa: 32, spd: 2, spe: 32 }, ivs: ALL_31,
};

/** The banded hit as the server rolls it: the calc on the Champions stats, the middle roll. */
function bandedFraction(): number {
  const gen = Generations.get(9);
  const budget = evBudget('gen9championsou');
  const body = (set: PokemonSet) => new Pokemon(gen, set.species, {
    level: 50, item: (set.item || undefined) as never, nature: set.nature as never,
    evs: calcEvs(set.evs as PokemonEvs, budget), ivs: calcIvs(set.ivs as PokemonEvs, budget),
  });
  const defender = body(alakazam);
  const rolls = calculate(gen, body(gengar), defender, new Move(gen, 'Shadow Claw'), new Field()).damage as number[];
  return rolls[8] / defender.maxHP();
}

const observations = (): DamageObservation[] => [{
  attackerSpecies: 'Gengar', defenderSpecies: 'Alakazam', attackerSide: 'p1', moveId: 'shadowclaw',
  observedFraction: bandedFraction(), lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
}];

/**
 * The Champions mod changes moves calc 0.11 still prices at Gen 9 values: Psyshield Bash hits at 90 there, not 70.
 * A banded Wyrdeer hit at the server's power fits the band only on the mod's move.
 */
await loadSimMods('gen9championsou');
const wyrdeer: PokemonSet = {
  name: 'Wyrdeer', species: 'Wyrdeer', item: 'Choice Band', ability: 'Intimidate', moves: ['Psyshield Bash'], nature: 'Adamant',
  gender: '', level: 50, evs: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, ivs: ALL_31,
};
const garchomp: PokemonSet = {
  name: 'Garchomp', species: 'Garchomp', item: '', ability: 'Rough Skin', moves: ['Earthquake'], nature: 'Impish',
  gender: '', level: 50, evs: { hp: 32, atk: 0, def: 32, spa: 0, spd: 2, spe: 0 }, ivs: ALL_31,
};

/** The banded Psyshield Bash as the server rolls it: the mod's power 90 on the Champions stats, the middle roll. */
function bashFraction(): number {
  const gen = Generations.get(9);
  const budget = evBudget('gen9championsou');
  const body = (set: PokemonSet) => new Pokemon(gen, set.species, {
    level: 50, item: (set.item || undefined) as never, nature: set.nature as never,
    evs: calcEvs(set.evs as PokemonEvs, budget), ivs: calcIvs(set.ivs as PokemonEvs, budget),
  });
  const defender = body(garchomp);
  const move = new Move(gen, 'Psyshield Bash', { overrides: { basePower: 90 } });
  const rolls = calculate(gen, body(wyrdeer), defender, move, new Field()).damage as number[];
  return rolls[8] / defender.maxHP();
}

describe('Choice item check on a Champions game (decision 30)', () => {
  test('a banded hit with a move the mod changes is judged at the power of the mod', () => {
    const observation: DamageObservation[] = [{
      attackerSpecies: 'Wyrdeer', defenderSpecies: 'Garchomp', attackerSide: 'p1', moveId: 'psyshieldbash',
      observedFraction: bashFraction(), lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    }];
    expect(corroborateChoiceItem('p1', 'Wyrdeer', 'Choice Band', { p1Team: [wyrdeer], p2Team: [garchomp] }, observation, 9, 'champions'))
      .toBe('corroborated');
  });

  test('a guessed Choice Band on Stat Points is judged as the server rolls it', () => {
    expect(corroborateChoiceItem('p1', 'Gengar', 'Choice Band', { p1Team: [gengar], p2Team: [alakazam] }, observations(), 9, 'champions'))
      .toBe('corroborated');
  });

  test('outside Champions the same spread reads as EVs', () => {
    expect(corroborateChoiceItem('p1', 'Gengar', 'Choice Band', { p1Team: [gengar], p2Team: [alakazam] }, observations(), 9))
      .not.toBe('corroborated');
  });
});
