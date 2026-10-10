import { describe, expect, test } from 'vitest';
import { Battle, type PokemonSet } from '@pkmn/sim';
import { createMatchupCache, evaluatePosition } from '../src/eval-function';
import { battleFaintedFraction, leafValue } from '../src/search/leaf';
import { CHAMPIONS_WINPROB_K, WINPROB_K } from '../src/winprob';

/**
 * Round 67 (T138): Pokémon Champions prices its own scale at the leaf. The search hands the rule set to the leaf
 * through its matchup cache (createMatchupCache), and the leaf maps the static's score with the phase K of that rule
 * set: Champions its own, every other rule set its game type's.
 */
const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: 'Hardy', gender: '', level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});
const team = () => [set('Garchomp', ['Earthquake']), set('Corviknight', ['Body Press']), set('Primarina', ['Moonblast']), set('Kingambit', ['Kowtow Cleave'])];

/** Four against four with one p2 Pokémon fainted on the bench (a quarter of a side, so the phase signal is not 0). */
function battleOf(formatid: string): Battle {
  const battle = new Battle({ formatid: formatid as never, seed: '1,2,3,4', p1: { name: 'A', team: team() }, p2: { name: 'B', team: team() } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) battle.makeChoices('team 1234', 'team 1234');
  const benched = battle.sides[1].pokemon[3];
  benched.hp = 0;
  benched.fainted = true;
  battle.sides[0].pokemon[0].hp = Math.floor(battle.sides[0].pokemon[0].maxhp / 2);
  return battle;
}

const expected = (raw: number, k: { k0: number; k1: number }, ff: number) => 2 / (1 + Math.exp(-(k.k0 + k.k1 * ff) * raw)) - 1;

describe('the leaf prices a position with the K of its rule set (T138)', () => {
  for (const [kind, formatid] of [['singles', 'gen9customgame'], ['doubles', 'gen9doublescustomgame']] as const) {
    test(`Champions reads its own phase K, standard and VGC their game type's (${kind})`, () => {
      const battle = battleOf(formatid);
      const ff = battleFaintedFraction(battle);
      expect(ff).toBeGreaterThan(0);
      for (const ruleset of ['champions', 'standard', 'vgc'] as const) {
        const cache = createMatchupCache(ruleset);
        const raw = evaluatePosition(battle, createMatchupCache(ruleset));
        expect(raw).not.toBe(0);
        const table = ruleset === 'champions' ? CHAMPIONS_WINPROB_K : WINPROB_K;
        expect(leafValue(battle, cache), ruleset).toBeCloseTo(expected(raw, kind === 'doubles' ? table.doubles : table.singles, ff), 12);
      }
    });
  }
});
