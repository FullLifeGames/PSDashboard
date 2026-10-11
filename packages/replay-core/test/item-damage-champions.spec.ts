import { describe, expect, test } from 'vitest';
import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import { judgeItemsByDamage } from '../src/team/item-damage';
import { calcEvs, calcIvs, evBudget } from '../src/spreads/ev-budget';
import { guessedEvs, guessedField, revealedField, unknownField } from '../src/team-info';
import type { HitParty, LoggedHit, PokemonEvs, RevealedPokemonInfo } from '../src/types';

/**
 * Round 67 (decision 30 and lane C's ruling R10, merge): the damage judge
 * reads a Champions game. Stat Points go to the calculator as EV = 8·SP − 4
 * with every IV 31 (a Champions body has no IVs), the defender as built on its
 * Stat Points. Read as EVs, Corviknight's 32 HP and Special Defense Stat
 * Points vanish, and a hit only Choice Specs explains looks unboosted.
 */
const budget = evBudget('gen9championsou');
const party = (species: string, extra: Partial<HitParty> = {}): HitParty => ({
  species, level: 50, boosts: {}, status: '', hp: 1, ability: '', held: '', itemChanged: false, gender: '', alliesFainted: 0,
  flashFire: false, slowStart: false, boostedStat: '', charged: false, ...extra,
});
const corviknightSp: PokemonEvs = { hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 2 };
const corviknight: RevealedPokemonInfo = {
  species: 'Corviknight', moves: [], ability: revealedField('Pressure'), item: revealedField('Leftovers'), teraType: unknownField(),
  evs: guessedEvs(corviknightSp), nature: guessedField('Calm'), level: 50, gender: '',
};

/** Gholdengo's Shadow Ball as the server rolls it: 32 Special Attack Stat Points, Modest, Choice Specs, the top roll. */
function observed(): number {
  const gen = Generations.get(9);
  const ivs = calcIvs(undefined, budget);
  const attacker = new Pokemon(gen, 'Gholdengo', {
    level: 50, nature: 'Modest', item: 'Choice Specs', ability: 'Good as Gold',
    evs: calcEvs({ hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }, budget), ivs,
  });
  const defender = new Pokemon(gen, 'Corviknight', { level: 50, nature: 'Calm', item: 'Leftovers', ability: 'Pressure', evs: calcEvs(corviknightSp, budget), ivs });
  const rolls = calculate(gen, attacker, defender, new Move(gen, 'Shadow Ball'), new Field()).damage as number[];
  return rolls[rolls.length - 1] / defender.maxHP();
}

function gholdengo(): RevealedPokemonInfo {
  const hit: LoggedHit = {
    move: 'shadowball', attacker: party('Gholdengo', { ability: 'Good as Gold' }), defender: { ...party('Corviknight', { ability: 'Pressure' }), side: 'p1' },
    observed: observed(), lowerBound: false, weather: '', terrain: '', screens: [], helpingHand: false, defenderNew: false,
    doubles: false, spread: false, others: [], doubt: '', gen: 9, format: '[Gen 9] Champions OU',
  };
  return {
    species: 'Gholdengo', moves: [], ability: revealedField('Good as Gold'), item: unknownField(), teraType: unknownField(),
    evs: guessedEvs({ hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }), nature: guessedField('Modest'), level: 50, gender: '', hits: [hit],
  };
}

describe('the damage judge on a Champions game (R10)', () => {
  test('a hit only Choice Specs explains rules out Leftovers, priced on Stat Points', () => {
    const attacker = gholdengo();
    expect(judgeItemsByDamage(attacker, ['Choice Specs', 'Leftovers'], { p1: { pokemon: [corviknight] }, p2: { pokemon: [attacker] } }))
      .toEqual(['leftovers']);
  });
});
