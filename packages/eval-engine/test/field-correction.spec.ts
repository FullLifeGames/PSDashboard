import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { correctBattleFromSnapshot } from '../src/branch/corrections';
import { advancePositionWithLog, createRootPosition } from '../src/forward-model';
import { serializeBattleStable } from '../src/forward/serialize';
import { SEEDS, stableLog, withSimFast } from './sim-fast-helpers';

/**
 * Round 60 (T92): the snapshot correction wrote side conditions without
 * their layers (Spikes priced NaN, the sim skipped the damage; Toxic Spikes
 * never poisoned badly), let corrected weather last forever and left
 * corrected terrain without its state.
 */

const mon = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', gender: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
});

function battleOf(p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) battle.makeChoices('team 1', 'team 1');
  return battle;
}

function snapshotOf(battle: Battle, field: Partial<TurnSnapshot['field']>, p1Conditions: Record<string, unknown> = {}): TurnSnapshot {
  return {
    turn: battle.turn,
    p1: { name: 'A', id: 'p1', pokemon: [], sideConditions: p1Conditions },
    p2: { name: 'B', id: 'p2', pokemon: [], sideConditions: {} },
    field: { weather: '', terrain: '', pseudoWeather: {}, ...field },
  } as TurnSnapshot;
}

describe('field correction (round 60, T92)', () => {
  test('inserted Spikes (3) and Toxic Spikes (2) hit the next switch-in', () => {
    const battle = battleOf([mon('Blissey', ['Splash']), mon('Garchomp', ['Splash'])], [mon('Blissey', ['Splash'])]);
    correctBattleFromSnapshot(battle, snapshotOf(battle, {}, {
      spikes: { name: 'Spikes', level: 3, minDuration: 0, maxDuration: 0 },
      toxicspikes: { name: 'Toxic Spikes', level: 2, minDuration: 0, maxDuration: 0 },
    }));
    expect(battle.sides[0].sideConditions['spikes'].layers).toBe(3);
    expect(battle.sides[0].sideConditions['toxicspikes'].layers).toBe(2);
    battle.makeChoices('switch 2', 'move 1');
    const chomp = battle.sides[0].active[0]!;
    expect(chomp.species.name).toBe('Garchomp');
    expect(chomp.status).toBe('tox');
    // A quarter from three layers of Spikes plus the first Toxic tick.
    expect((chomp.maxhp - chomp.hp) / chomp.maxhp).toBeGreaterThan(0.29);
  });

  test('inserted weather lasts the snapshot\'s remaining turns', () => {
    const battle = battleOf([mon('Blissey', ['Splash'])], [mon('Blissey', ['Splash'])]);
    correctBattleFromSnapshot(battle, snapshotOf(battle, { weather: 'Rain', weatherState: { minDuration: 2, maxDuration: 5 } }));
    expect(battle.field.weather).toBe('raindance');
    expect(battle.field.weatherState.duration).toBe(2);
    battle.makeChoices('move 1', 'move 1');
    expect(battle.field.weather).toBe('raindance');
    battle.makeChoices('move 1', 'move 1');
    expect(battle.field.weather).toBe('');
  });

  test('inserted terrain carries its id and remaining turns; removed terrain leaves an empty state', () => {
    const battle = battleOf([mon('Blissey', ['Splash', 'Electric Terrain'])], [mon('Blissey', ['Splash'])]);
    correctBattleFromSnapshot(battle, snapshotOf(battle, { terrain: 'Electric', terrainState: { minDuration: 3, maxDuration: 6 } }));
    expect(battle.field.terrain).toBe('electricterrain');
    expect(battle.field.terrainState.id).toBe('electricterrain');
    expect(battle.field.terrainState.duration).toBe(3);
    correctBattleFromSnapshot(battle, snapshotOf(battle, { terrain: '' }));
    expect(battle.field.terrain).toBe('');
    expect(battle.field.terrainState.id).toBe('');
    expect(battle.field.terrainState.duration).toBeUndefined();
  });

  test('a snapshot from before round 60 (no weatherState) corrects weather as before', () => {
    const battle = battleOf([mon('Blissey', ['Splash'])], [mon('Blissey', ['Splash'])]);
    expect(() => correctBattleFromSnapshot(battle, snapshotOf(battle, { weather: 'Sun' }))).not.toThrow();
    expect(battle.field.weather).toBe('sunnyday');
    expect(battle.field.weatherState.duration).toBeUndefined();
  });

  test('a corrected battle plays the same turn through the copy and through JSON', () => {
    const battle = battleOf([mon('Blissey', ['Splash']), mon('Garchomp', ['Splash'])], [mon('Blissey', ['Splash'])]);
    correctBattleFromSnapshot(battle, snapshotOf(battle,
      { weather: 'Rain', weatherState: { minDuration: 2, maxDuration: 5 }, terrain: 'Electric', terrainState: { minDuration: 3, maxDuration: 6 } },
      { spikes: { name: 'Spikes', level: 2, minDuration: 0, maxDuration: 0 } }));
    const serialized = serializeBattleStable(battle);
    const play = () => SEEDS.map(seed => {
      const result = advancePositionWithLog(createRootPosition(serialized), 'switch 2', 'move 1', seed);
      return `${result.child.serialized}\n${stableLog(result.log)}`;
    });
    expect(withSimFast(['rules', 'clone', 'dispatch'], play)).toEqual(withSimFast([], play));
  });
});
