import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import type { PokemonSnapshot, TurnSnapshot } from '@fulllifegames/replay-core';
import { buildForcedSwitchChoice, correctActivesFromProtocol, correctBattleFromSnapshot } from '../src/branch/corrections';
import { openSession, startBattle, waitForBattle } from '../src/branch/runtime-session';
import type { SimBattle } from '../src/branch/types';

/**
 * Round 69, T172 fix after bundle e1 (smogtours-gen8ou-562428 turns 13 and 14):
 * a Choice Specs Blacephalon switched out for Weavile, Weavile fainted and
 * Blacephalon came back. The simulator took it off the field with the game,
 * its exit record held the Choice lock, and the correction put the lock back
 * on a body that entered fresh: the lock offered Shadow Ball only, and the
 * played Flamethrower had no option. Truth is the battle in which the
 * replacement is the returning body; the simulated battle sends another one.
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, ability: string, moves: string[], item = ''): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Hardy', evs, ivs, level: 100,
});

interface Scene {
  format: string;
  p1: PokemonSet[];
  p2: PokemonSet[];
  turn1: string;
  turn2: string;
  /** The bench body the simulated battle sends instead of the returning one. */
  other: string;
  /** The protocol's block of turn 2: the voluntary switch-out, the K.O. of the replacement and the return. */
  events: string[];
}

const SINGLES: Scene = {
  format: 'gen9customgame',
  p1: [set('Hatterene', 'Healer', ['Splash'], 'Choice Specs'), set('Rillaboom', 'Overgrow', ['Splash']), set('Gliscor', 'Hyper Cutter', ['Splash'])],
  p2: [set('Torkoal', 'Drought', ['Leech Seed', 'Earthquake'])],
  turn1: '>p1 move 1\n>p2 move 1',
  turn2: '>p1 switch 2\n>p2 move 2',
  other: 'Gliscor',
  events: [
    '|switch|p1a: Rillaboom|Rillaboom, M|100/100', '|move|p2a: Torkoal|Earthquake|p1a: Rillaboom',
    '|faint|p1a: Rillaboom', '|switch|p1a: Hatterene|Hatterene, F|100/100',
  ],
};

const DOUBLES: Scene = {
  format: 'gen9doublescustomgame',
  p1: [set('Hatterene', 'Healer', ['Splash'], 'Choice Specs'), set('Gliscor', 'Hyper Cutter', ['Splash']), set('Rillaboom', 'Overgrow', ['Splash']), set('Pidgey', 'Keen Eye', ['Splash'])],
  p2: [set('Tapu Koko', 'Electric Surge', ['Leech Seed', 'Earthquake']), set('Corviknight', 'Pressure', ['Splash']), set('Amoonguss', 'Regenerator', ['Splash'])],
  turn1: '>p1 move 1, move 1\n>p2 move 1 1, move 1',
  turn2: '>p1 switch 3, move 1\n>p2 move 2, move 1',
  other: 'Pidgey',
  events: [
    '|switch|p1a: Rillaboom|Rillaboom, M|100/100', '|move|p2a: Tapu Koko|Earthquake|p1a: Rillaboom',
    '|faint|p1a: Rillaboom', '|switch|p1a: Hatterene|Hatterene, F|100/100',
  ],
};

const bodyOf = (battle: SimBattle, name: string) => battle.sides[0].pokemon.find(pokemon => pokemon.name === name)!;
const ids = (battle: SimBattle, name: string) => Object.keys(bodyOf(battle, name).volatiles).sort();

/** Turn 1 (the Choice lock and Leech Seed land on Hatterene), turn 2 (it switches out and the replacement is knocked out), then the replacement the game or the simulator sent. */
async function play(scene: Scene, replacement: string): Promise<SimBattle> {
  const session = openSession({ format: scene.format, p1Team: scene.p1, p2Team: scene.p2, replayLog: '', targetTurn: 9 }, Date.now() + 60_000);
  await startBattle(session, scene.p1, scene.p2);
  const battle = session.battleStream.battle!;
  session.writeSim(scene.turn1);
  await waitForBattle(session, current => current.turn >= 2);
  bodyOf(battle, 'Rillaboom').hp = 1;
  session.writeSim(scene.turn2);
  await waitForBattle(session, current => current.turn >= 3 || current.sides[0].activeRequest?.forceSwitch !== undefined);
  const forced = buildForcedSwitchChoice(battle, 0, [replacement], { current: 0 });
  session.writeSim(`>p1 ${forced}`);
  await waitForBattle(session, current => current.turn >= 3);
  return battle;
}

function snapshotFrom(truth: SimBattle, log: string[]): TurnSnapshot {
  const side = (index: number) => ({
    name: truth.sides[index].name,
    id: truth.sides[index].id as 'p1' | 'p2',
    sideConditions: {},
    pokemon: truth.sides[index].pokemon.map((pokemon): PokemonSnapshot => ({
      name: pokemon.name, speciesForme: pokemon.species.name, hp: pokemon.hp, maxhp: pokemon.maxhp,
      hpPercent: Math.round((pokemon.hp / pokemon.maxhp) * 100), status: pokemon.status, fainted: pokemon.fainted,
      isActive: truth.sides[index].active.includes(pokemon), boosts: { ...pokemon.boosts },
      moves: pokemon.moveSlots.map(slot => slot.move), ability: pokemon.ability, item: pokemon.item,
      terastallized: '', level: pokemon.level, gender: pokemon.gender,
    })),
  });
  return { turn: truth.turn, p1: side(0), p2: side(1), field: { weather: truth.field.weather, terrain: truth.field.terrain, pseudoWeather: {} }, log };
}

describe.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('T172 a body both worlds switched out and the game brought back (%s)', (_label, scene) => {
  test('the simulator carried a Choice lock and Leech Seed out, and the game entered fresh', async () => {
    const truth = await play(scene, 'Hatterene');
    expect(ids(truth, 'Hatterene')).toEqual([]);
    expect(bodyOf(truth, 'Hatterene').moveSlots.some(slot => slot.disabled)).toBe(false);
    const simulated = await play(scene, scene.other);
    expect(simulated.sides[0].active.includes(bodyOf(simulated, 'Hatterene'))).toBe(false);
  });

  test('the protocol path puts it back without the volatiles of its first stint', async () => {
    const truth = await play(scene, 'Hatterene');
    const simulated = await play(scene, scene.other);

    correctActivesFromProtocol(simulated, scene.events);

    expect(simulated.sides[0].active.includes(bodyOf(simulated, 'Hatterene'))).toBe(true);
    expect(ids(simulated, 'Hatterene')).toEqual(ids(truth, 'Hatterene'));
  });

  test('the snapshot path puts it back without the volatiles of its first stint', async () => {
    const truth = await play(scene, 'Hatterene');
    const simulated = await play(scene, scene.other);

    correctBattleFromSnapshot(simulated, snapshotFrom(truth, scene.events));

    expect(simulated.sides[0].active.includes(bodyOf(simulated, 'Hatterene'))).toBe(true);
    expect(ids(simulated, 'Hatterene')).toEqual(ids(truth, 'Hatterene'));
  });

  test('the Choice lock does not narrow the moves the corrected body offers', async () => {
    const truth = await play(scene, 'Hatterene');
    const simulated = await play(scene, scene.other);

    correctBattleFromSnapshot(simulated, snapshotFrom(truth, scene.events));

    const slots = (battle: SimBattle) => bodyOf(battle, 'Hatterene').moveSlots.map(slot => `${slot.id}${slot.disabled ? '!' : ''}`);
    expect(slots(simulated)).toEqual(slots(truth));
  });
});
