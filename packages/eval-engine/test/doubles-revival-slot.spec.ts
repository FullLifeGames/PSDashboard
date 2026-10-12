import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations, type TurnSnapshot } from '@fulllifegames/replay-core';
import { correctBattleFromSnapshot } from '../src/branch/corrections';
import { serializeBattleStable } from '../src/forward-model';
import type { SimBattle } from '../src/branch/types';

/**
 * Round 69, T151 (spec decision 30): the snapshot carries the slot of every
 * active body, and the boundary correction stands a doubles pair on the slots
 * the game has them on (913990 turn 4: Chi-Yu stood on p2b in the game and on
 * p2a on the board, and the played Overheat was not among the options). The
 * game is battle B (team order Gliscor, Parasect); battle A is the board that
 * has the pair swapped. Every number is read from the simulator's own battles.
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level: 100,
});

const GLISCOR = set('Gliscor', ['Earthquake', 'Splash']);
const PARASECT = set('Parasect', ['Spore', 'Splash']);
const RILLABOOM = set('Rillaboom', ['Grassy Glide', 'Splash']);
const FOES = [set('Snorlax', ['Splash']), set('Corviknight', ['Splash']), set('Amoonguss', ['Splash'])];

function start(format: string, p1: PokemonSet[], p2: PokemonSet[]): { battle: SimBattle; log: string } {
  const battle = new Battle({
    formatid: toID(format), seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  battle.choose('p1', 'default');
  battle.choose('p2', 'default');
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  return { battle: battle as unknown as SimBattle, log };
}

const snapshotOf = (log: string): TurnSnapshot => parseReplayLogWithObservations(log).snapshots.find(snapshot => snapshot.turn === 1)!;
const activeNames = (battle: SimBattle) => battle.sides[0].active.map(pokemon => pokemon.name);
const moveNames = (battle: SimBattle, slot: number) =>
  (battle.sides[0].activeRequest as { active: { moves: { move: string }[] }[] }).active[slot].moves.map(move => move.move);

describe('T151 doubles revival slot', () => {
  const game = start('gen9doublescustomgame', [GLISCOR, PARASECT, RILLABOOM], FOES);
  const board = () => start('gen9doublescustomgame', [PARASECT, GLISCOR, RILLABOOM], FOES).battle;

  test('the snapshot slot puts an active on its slot, with side.pokemon and the request in step', () => {
    const snapshot = snapshotOf(game.log);
    expect(snapshot.p1.pokemon.filter(pokemon => pokemon.isActive).map(pokemon => [pokemon.name, pokemon.slot])).toEqual([['Gliscor', 0], ['Parasect', 1]]);
    const battle = board();
    expect(activeNames(battle)).toEqual(['Parasect', 'Gliscor']);

    correctBattleFromSnapshot(battle, snapshot);

    expect(activeNames(battle)).toEqual(activeNames(game.battle));
    const side = battle.sides[0];
    expect(side.active.map((pokemon, index) => side.pokemon[index] === pokemon)).toEqual([true, true]);
    expect(side.active.map(pokemon => pokemon.position)).toEqual([0, 1]);
    // The request offers the moves of the body in the slot: the game's own request is the witness.
    expect(moveNames(battle, 0)).toEqual(moveNames(game.battle, 0));
    expect(moveNames(battle, 1)).toEqual(moveNames(game.battle, 1));
  });

  test('a body that trades slots keeps its last move: it never left the field', () => {
    const battle = board();
    const parasect = battle.sides[0].active[0];
    const spore = battle.dex.getActiveMove('spore');
    parasect.lastMove = spore;
    correctBattleFromSnapshot(battle, snapshotOf(game.log));
    expect(battle.sides[0].active[1]).toBe(parasect);
    expect(parasect.lastMove).toBe(spore);
  });

  test('a snapshot without slots leaves the board as it was', () => {
    const snapshot = snapshotOf(game.log);
    for (const side of [snapshot.p1, snapshot.p2]) for (const pokemon of side.pokemon) delete pokemon.slot;
    const battle = board();
    correctBattleFromSnapshot(battle, snapshot);
    expect(activeNames(battle)).toEqual(['Parasect', 'Gliscor']);
  });

  test('a board that already stands as the game does is not touched', () => {
    const battle = start('gen9doublescustomgame', [GLISCOR, PARASECT, RILLABOOM], FOES).battle;
    const before = serializeBattleStable(battle);
    correctBattleFromSnapshot(battle, snapshotOf(game.log));
    expect(serializeBattleStable(battle)).toBe(before);
  });
});

describe('T151 singles', () => {
  test('slot 0 on a board that has the body there changes nothing', () => {
    const { battle, log } = start('gen9customgame', [GLISCOR, PARASECT], FOES.slice(0, 1));
    const snapshot = snapshotOf(log);
    expect(snapshot.p1.pokemon.find(pokemon => pokemon.isActive)!.slot).toBe(0);
    const before = serializeBattleStable(battle);
    correctBattleFromSnapshot(battle, snapshot);
    expect(serializeBattleStable(battle)).toBe(before);
  });
});
