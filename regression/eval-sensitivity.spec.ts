import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { patchSerializedItem, selectProbeCombos } from '../src/lib/eval/sensitivity';
import { createRootPosition, positionBattle } from '../src/lib/eval/forward-model';

function makeSet(name: string, species: string, moves: string[], item = ''): PokemonSet {
  return {
    name, species, item, ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen9customgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

test.describe('sensitivity probe plumbing', () => {
  test('patchSerializedItem swaps the item and survives deserialization', () => {
    const serialized = serialize(makeBattle(
      [makeSet('A', 'Garchomp', ['Earthquake'])],
      [makeSet('Tran', 'Heatran', ['Magma Storm'], 'choicespecs'), makeSet('Clef', 'Clefable', ['Moonblast'], 'leftovers')],
    ));
    const patched = patchSerializedItem(serialized, 'p2', 'Heatran', 'Leftovers');
    expect(patched).not.toBeNull();
    const battle = positionBattle(createRootPosition(patched!));
    const tran = battle.sides[1].pokemon.find(pokemon => pokemon.species.id === 'heatran');
    expect(tran?.item).toBe('leftovers');
    // The other mon and the original position stay untouched.
    const clef = battle.sides[1].pokemon.find(pokemon => pokemon.species.id === 'clefable');
    expect(clef?.item).toBe('leftovers');
    const original = positionBattle(createRootPosition(serialized));
    expect(original.sides[1].pokemon.find(pokemon => pokemon.species.id === 'heatran')?.item).toBe('choicespecs');
    // Unknown species: nothing to patch.
    expect(patchSerializedItem(serialized, 'p2', 'Blissey', 'Leftovers')).toBeNull();
  });

  test('selectProbeCombos takes involved targets round-robin under the cap', () => {
    const serialized = serialize(makeBattle(
      [makeSet('A', 'Garchomp', ['Earthquake'])],
      [makeSet('Tran', 'Heatran', ['Magma Storm'], 'choicespecs'), makeSet('Clef', 'Clefable', ['Moonblast'], 'leftovers')],
    ));
    // Active Heatran is involved; benched Clefable only via a switch label.
    const targets = [
      { species: 'Heatran', items: ['Leftovers', 'Air Balloon'] },
      { species: 'Clefable', items: ['Sticky Barb'] },
    ];
    expect(selectProbeCombos(serialized, 'p2', targets, ['Magma Storm'])).toEqual([
      { species: 'Heatran', item: 'Leftovers' },
      { species: 'Heatran', item: 'Air Balloon' },
    ]);
    expect(selectProbeCombos(serialized, 'p2', targets, ['→ Clefable'])).toEqual([
      { species: 'Heatran', item: 'Leftovers' },
      { species: 'Clefable', item: 'Sticky Barb' },
    ]);
    expect(selectProbeCombos(serialized, 'p2', [], ['Magma Storm'])).toEqual([]);
  });
});
