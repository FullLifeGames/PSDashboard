import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { legalChoices } from '../src/forward/choices';
import { createRootPosition, forkBattle } from '../src/forward/position';
import { applyChoice, resolveForcedSwitches } from '../src/forward/switches';
import { serializeBattleStable } from '../src/forward/serialize';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import { createRootPosition as createRootPositionFromRevivalBlessing } from '../src/forward-model';

/**
 * A Tatsugiri that commands a Dondozo passes its slot, and the simulator hands the first part of a doubles choice to the Dondozo
 * (side.js getChoiceIndex skips fainted and commanding actives). Held against the simulator: every choice legalChoices offers is
 * played on a copy of the battle, with Commander active for either side or both and the Tatsugiri in slot a and in slot b, in both
 * rule sets. Singles is not affected (Commander's onUpdate returns outside doubles): one row shows the Tatsugiri keeps its own moves there.
 */

await loadSimMods('gen9championsou');

const RULES = [
  { name: 'Scarlet/Violet doubles', format: 'gen9doublescustomgame', singles: 'gen9customgame', level: 100 },
  { name: 'Pokémon Champions doubles', format: 'gen9championsdoublescustomgame', singles: 'gen9championscustomgame', level: 50 },
];
const SEED: [number, number, number, number] = [1, 2, 3, 4];
const SIDES = ['p1', 'p2'] as const;
const COMMANDERS: { label: string; commanders: ('p1' | 'p2')[] }[] = [
  { label: 'p1', commanders: ['p1'] },
  { label: 'p2', commanders: ['p2'] },
  { label: 'both sides', commanders: ['p1', 'p2'] },
];
const SLOTS = [{ label: 'a', tatsugiriFirst: true }, { label: 'b', tatsugiriFirst: false }];

describe.each(RULES)('$name: the search offers a choice the simulator accepts for a commanding Tatsugiri', rules => {
  const mon = (species: string, ability: string, moves: string[]): PokemonSet => set(species, moves, { ability, level: rules.level });
  const tatsugiri = mon('Tatsugiri', 'Commander', ['Draco Meteor', 'Muddy Water', 'Icy Wind', 'Protect']);
  const dondozo = mon('Dondozo', 'Unaware', ['Wave Crash', 'Earthquake', 'Order Up', 'Protect']);
  const fillers = [mon('Pikachu', 'Static', ['Thunderbolt', 'Protect']), mon('Snorlax', 'Immunity', ['Body Slam', 'Protect'])];
  const plain = [fillers[0], fillers[1], mon('Rillaboom', 'Grassy Surge', ['Grassy Glide', 'Protect']), mon('Incineroar', 'Intimidate', ['Fake Out', 'Protect'])];
  const team = (tatsugiriFirst: boolean, commands: boolean): PokemonSet[] =>
    commands ? [...(tatsugiriFirst ? [tatsugiri, dondozo] : [dondozo, tatsugiri]), ...fillers] : plain;

  const board = (commanders: ('p1' | 'p2')[], tatsugiriFirst: boolean): Battle =>
    battleOf(rules.format, team(tatsugiriFirst, commanders.includes('p1')), team(tatsugiriFirst, commanders.includes('p2')));

  function rejections(battle: Battle, side: 'p1' | 'p2'): { offered: string[]; rejected: string[] } {
    const position = createRootPosition(serializeBattleStable(battle));
    const offered = legalChoices(position, side).map(option => option.choice);
    const rejected: string[] = [];
    for (const choice of offered) {
      try {
        applyChoice(forkBattle(position, SEED), side, choice);
      } catch (error) {
        rejected.push(`${choice}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { offered, rejected };
  }

  const sideOf = (battle: Battle, side: 'p1' | 'p2') => battle.sides[side === 'p1' ? 0 : 1];

  describe.each(COMMANDERS)('Commander on $label', ({ commanders }) => {
    describe.each(SLOTS)('Tatsugiri in slot $label', ({ tatsugiriFirst }) => {
      const battle = board(commanders, tatsugiriFirst);

      test('every choice legalChoices offers is accepted by the simulator', () => {
        for (const side of SIDES) {
          const commanding = commanders.includes(side);
          const sideState = sideOf(battle, side);
          const tatsugiriSlot = tatsugiriFirst ? 0 : 1;
          expect(!!sideState.active[tatsugiriSlot]?.volatiles['commanding']).toBe(commanding);

          const { offered, rejected } = rejections(battle, side);
          expect(offered.length).toBeGreaterThan(0);
          expect(rejected).toEqual([]);

          // The commanding side chooses for one slot (the Dondozo's); the other side for two.
          const parts = new Set(offered.map(choice => choice.split(',').length));
          expect([...parts]).toEqual([commanding ? 1 : 2]);
          if (!commanding) continue;
          const request = sideState.activeRequest as { active?: { moves: { id?: string }[] }[] } | null;
          const dondozoMoves = new Set((request?.active?.[tatsugiriFirst ? 1 : 0]?.moves ?? []).map(move => move.id));
          expect(dondozoMoves.size).toBeGreaterThan(0);
          const named = offered.filter(choice => choice.startsWith('move ')).map(choice => choice.split(' ')[1]);
          expect(named.length).toBeGreaterThan(0);
          expect(named.every(id => dondozoMoves.has(id))).toBe(true);
        }
      });

      test('a side without Commander keeps the list it has when nobody commands', () => {
        const quiet = board([], tatsugiriFirst);
        for (const side of SIDES.filter(own => !commanders.includes(own))) {
          const withFoeCommanding = legalChoices(createRootPosition(serializeBattleStable(battle)), side).map(option => option.choice);
          const withNoCommander = legalChoices(createRootPosition(serializeBattleStable(quiet)), side).map(option => option.choice);
          expect(withFoeCommanding).toEqual(withNoCommander);
        }
      });
    });
  });

  test('singles: a Tatsugiri keeps its own moves and every choice is accepted', () => {
    const battle = battleOf(rules.singles, [tatsugiri, fillers[0]], [fillers[1], fillers[0]]);
    const sideState = battle.sides[0];
    expect(sideState.active[0]?.volatiles['commanding']).toBeUndefined();
    const { offered, rejected } = rejections(battle, 'p1');
    expect(rejected).toEqual([]);
    expect(offered).toContain('move dracometeor');
  });
});

describe('revival-blessing', () => {
  const createRootPosition = createRootPositionFromRevivalBlessing;
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

  describe('Revival Blessing picks a fainted Pokémon', () => {
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
});
