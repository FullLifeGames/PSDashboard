import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { forceSwitches as engineForceSwitches } from '../../packages/eval-engine/src/branch/forced-slots';
import type { SimBattle } from '../../packages/eval-engine/src/branch/types';
import { requiredChoices } from '../../src/hooks/branch/shared';

// `requiredChoices` copies the engine's `forceSwitches` on purpose: the app reaches the package by its barrel only.
const set = (species: string, moves: string[], level = 100): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: 'Hardy', level, gender: '',
  evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function battleOf(doubles: boolean, p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][]): Battle {
  const battle = new Battle({
    formatid: toID(doubles ? 'gen9doublescustomgame' : 'gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  battle.choose('p1', 'team 1');
  battle.choose('p2', 'team 1');
  for (const [a, b] of turns) {
    if (a) battle.choose('p1', a);
    if (b) battle.choose('p2', b);
  }
  return battle;
}

const SNORLAX = (moves: string[]): PokemonSet => set('Snorlax', moves);
const BLISSEY = (moves: string[]): PokemonSet => set('Blissey', moves);
const MAGIKARP = (moves: string[]): PokemonSet => set('Magikarp', moves, 1);

interface Scene { label: string; doubles: boolean; battle: () => Battle; slots: boolean[] }

const SCENES: Scene[] = [
  {
    label: 'a Revival Blessing prompt', doubles: false, slots: [true],
    battle: () => battleOf(false, [MAGIKARP(['Splash']), set('Pawmot', ['Revival Blessing', 'Nuzzle'])], [SNORLAX(['Body Slam', 'Curse'])],
      [['move splash', 'move bodyslam'], ['switch 2', ''], ['move revivalblessing', 'move curse']]),
  },
  {
    label: 'a Revival Blessing prompt', doubles: true, slots: [false, true],
    battle: () => battleOf(true, [MAGIKARP(['Splash']), set('Pawmot', ['Revival Blessing', 'Nuzzle']), SNORLAX(['Curse'])],
      [SNORLAX(['Body Slam', 'Curse']), BLISSEY(['Soft-Boiled'])],
      [['move splash, move nuzzle 1', 'move bodyslam 1, move softboiled'], ['switch 3, pass', ''], ['move curse, move revivalblessing', 'move curse, move softboiled']]),
  },
  {
    label: 'a forced replacement with a living bench', doubles: false, slots: [true],
    battle: () => battleOf(false, [MAGIKARP(['Splash']), SNORLAX(['Curse'])], [SNORLAX(['Body Slam'])], [['move splash', 'move bodyslam']]),
  },
  {
    label: 'two fainted slots and one living body behind them', doubles: true, slots: [true, false],
    battle: () => battleOf(true, [MAGIKARP(['Splash']), MAGIKARP(['Splash']), set('Pikachu', ['Thunderbolt'])], [SNORLAX(['Body Slam']), SNORLAX(['Body Slam'])],
      [['move splash, move splash', 'move bodyslam 1, move bodyslam 2']]),
  },
];

describe('the branch hook reads a request as the engine does', () => {
  for (const scene of SCENES) {
    test(`${scene.doubles ? 'doubles' : 'singles'}: ${scene.label}`, () => {
      const battle = scene.battle();
      expect(battle.sides[0].requestState).toBe('switch');
      expect(engineForceSwitches(battle as unknown as SimBattle, 0)).toEqual(scene.slots);
      expect(requiredChoices(battle, 'p1')).toEqual(scene.slots);
      expect(engineForceSwitches(battle as unknown as SimBattle, 1)).toEqual(scene.slots.map(() => false));
    });
  }
});
