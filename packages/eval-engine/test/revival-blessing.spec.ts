import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createRootPosition } from '../src/forward-model';
import { legalChoices } from '../src/forward/choices';
import { resolveForcedSwitches } from '../src/forward/switches';

/**
 * Revival Blessing (round 63, T101): after the move the request marks the
 * user's slot `reviving`, and the simulator accepts only a fainted party
 * member ("You have to pass to a fainted Pokémon"). The search offered the
 * living bench, applyChoice threw, and the app left those turns without a
 * value (smogtours-gen9ou-677869: 4 of 11 turns; gen9doublesou-2662174649 t3).
 */

function makeSet(species: string, moves: string[], level = 100): PokemonSet {
  return {
    name: species, species, item: '', ability: '', moves, nature: 'Hardy', level, gender: '',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

/** Magikarp falls on turn 1, Pawmot uses Revival Blessing on turn 2: the battle stops at the reviving request. */
function revivalBattle(doubles: boolean): Battle {
  const p1 = [makeSet('Magikarp', ['Splash'], 1), makeSet('Pawmot', ['Revival Blessing', 'Nuzzle']), makeSet('Snorlax', ['Curse'])];
  const p2 = doubles
    ? [makeSet('Snorlax', ['Body Slam', 'Curse']), makeSet('Blissey', ['Soft-Boiled'])]
    : [makeSet('Snorlax', ['Body Slam', 'Curse'])];
  const battle = new Battle({
    formatid: toID(doubles ? 'gen9doublescustomgame' : 'gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  battle.choose('p1', 'team 1');
  battle.choose('p2', 'team 1');
  if (doubles) {
    battle.choose('p1', 'move splash, move nuzzle 1');
    battle.choose('p2', 'move bodyslam 1, move softboiled');
    battle.choose('p1', 'switch 3, pass');
    battle.choose('p1', 'move curse, move revivalblessing');
    battle.choose('p2', 'move curse, move softboiled');
  } else {
    battle.choose('p1', 'move splash');
    battle.choose('p2', 'move bodyslam');
    battle.choose('p1', 'switch 2');
    battle.choose('p1', 'move revivalblessing');
    battle.choose('p2', 'move curse');
  }
  return battle;
}

const magikarp = (battle: Battle) => battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Magikarp')!;

describe('Revival Blessing picks a fainted Pokémon (T101)', () => {
  test('singles: the greedy resolution revives the fainted Magikarp instead of sending Snorlax', () => {
    const battle = revivalBattle(false);
    expect(battle.sides[0].requestState).toBe('switch');
    expect(magikarp(battle).fainted).toBe(true);
    expect(() => resolveForcedSwitches(battle, '1,2,3,4')).not.toThrow();
    expect(magikarp(battle).hp).toBeGreaterThan(0);
  });

  test('singles and doubles: the reviving request offers only the fainted party members', () => {
    for (const doubles of [false, true]) {
      const position = createRootPosition(JSON.stringify(State.serializeBattle(revivalBattle(doubles))));
      const labels = legalChoices(position, 'p1').map(option => option.label);
      expect(labels, doubles ? 'doubles' : 'singles').toEqual(['→ Magikarp']);
    }
  });
});
