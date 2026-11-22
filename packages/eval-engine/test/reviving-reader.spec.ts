import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { revivingSlots } from '../src/forward/request-reviving';
import { switchInSlots } from '../src/forward/switches';
import { switchInsOf } from '../src/branch/forced-slots';
import type { SimBattle } from '../src/branch/types';

/**
 * Round 89 (C7): whether a request asks for a fainted body (Revival Blessing) is read in one module, `forward/request-reviving.ts`.
 * The reader is held to the simulator's own request (`reviving` on the user's party entry) and the two callers that used to copy it
 * (`switchInSlots` of the forward model, `switchInsOf` of the branch layer) agree with it, in singles and doubles.
 */

function makeSet(species: string, moves: string[], level = 100): PokemonSet {
  return {
    name: species, species, item: '', ability: '', moves, nature: 'Hardy', level, gender: '',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

/** The scene of revival-blessing.spec.ts: Magikarp fell, Pawmot (slot b in doubles) uses Revival Blessing, the battle stops at the request. */
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

/** The simulator's request, read straight from the JSON it sends: the slots whose party entry is marked `reviving`. */
const requestMarks = (battle: Battle, sideIdx: number, slots: number): boolean[] => {
  const party = (battle.sides[sideIdx].activeRequest as { side: { pokemon: { reviving?: boolean }[] } }).side.pokemon;
  return Array.from({ length: slots }, (_, slot) => !!party[slot].reviving);
};

describe('the request reading of a Revival Blessing prompt lives in one module', () => {
  for (const doubles of [false, true]) {
    const game = doubles ? 'doubles' : 'singles';
    test(`${game}: the reader names the slot the simulator's request marks`, () => {
      const battle = revivalBattle(doubles);
      const side = battle.sides[0];
      expect(side.requestState).toBe('switch');
      const slots = doubles ? 2 : 1;
      expect(requestMarks(battle, 0, slots)).toEqual(doubles ? [false, true] : [true]);
      expect(revivingSlots(side)).toEqual(requestMarks(battle, 0, slots));
      expect(revivingSlots(battle.sides[1])).toEqual(new Array(slots).fill(false));
    });

    test(`${game}: both callers follow the reader`, () => {
      const battle = revivalBattle(doubles);
      const side = battle.sides[0];
      // The prompt takes a fainted body: the branch layer counts no living bench, the forward model lists the fainted party slots.
      expect(switchInsOf(side as unknown as SimBattle['sides'][number])).toBeNull();
      const fainted = side.pokemon.flatMap((pokemon, index) => (pokemon.fainted ? [index + 1] : []));
      expect(fainted.length).toBe(1);
      expect(switchInSlots(side)).toEqual(fainted);
      // After the revive the request is gone and the same side reads as a plain bench again.
      expect(battle.choose('p1', `switch ${fainted[0]}`)).toBe(true);
      expect(revivingSlots(side).some(Boolean)).toBe(false);
    });
  }
});
