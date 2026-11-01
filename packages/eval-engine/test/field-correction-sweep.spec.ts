import { extractChannelMessages, type Battle, type PokemonSet } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import { correctFieldFromSnapshot } from '../src/branch/field-correction';
import { loadSimMods } from '../src/forward/sim-mods';
import { CHAMPIONS, mon, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { battleOf } from './power-oracle';

/**
 * Round 83 (T307, GitHub issue #3): a screen of a Light Clay holder keeps its eight turns in a variation. The simulator sets a
 * condition with the duration its own rule gives (Light Clay: eight turns for Reflect, Light Screen and Aurora Veil). At every
 * turn boundary the reconstruction synced the field with the client's snapshot and wrote the client's minimum, which counts
 * five turns because the log never shows the item. The main line synced again every turn, so nothing ended early there; a
 * variation stops syncing, and the screen ended after five (gen9terapreviewdraft-2182991758: Latias with Light Clay, Light
 * Screen on turn 34 and Reflect on turn 35, the variation from turn 38).
 *
 * The sweep: every move that sets a side condition or a pseudo weather, in every rule set and game type the corpus plays, by a
 * holder of no item and by a holder of every item and every ability that changes the condition's duration (asked of the
 * condition's own duration rule); after one turn the turn boundary keeps the simulator's duration.
 */
await loadSimMods('gen9championsou');

type Table = Record<string, { duration?: number } | undefined>;
interface Holder { item?: string; ability?: string }
interface Row { move: string; holder: Holder; label: string }

const standard = (entry: { exists: boolean; gen: number; isNonstandard?: string | null }, gen: number): boolean =>
  entry.exists && entry.gen <= gen && (entry.isNonstandard === null || entry.isNonstandard === undefined || entry.isNonstandard === 'Past');

/** The moves of a rule set that set a side condition or a pseudo weather (no Z or Max moves). */
function conditionMoves(rules: Rules): DexMove[] {
  const dex = dexOfRules(rules);
  return dex.moves.all().filter(move => standard(move, dex.gen) && !move.isZ && !move.isMax && !!(move.sideCondition || move.pseudoWeather));
}

const conditionOf = (move: DexMove): string => (move.sideCondition ?? move.pseudoWeather)!;

/** The board: Snorlax sets the condition for side p1, a Vaporeon faces it; in doubles a Blissey and a second Vaporeon stand beside them. */
function board(rules: Rules, mode: Mode, move: string, holder: Holder): Battle {
  const setter: PokemonSet = { ...mon(rules, { species: 'Snorlax', moves: [move, 'splash'] }), ...holder };
  const foe = mon(rules, { species: 'Vaporeon', moves: ['splash'] });
  if (mode === 'singles') return battleOf(rules.singles, [setter], [foe]);
  return battleOf(rules.doubles!, [setter, mon(rules, { species: 'Blissey', moves: ['splash'] })], [foe, mon(rules, { species: 'Vaporeon', moves: ['splash'] })]);
}

/** The table a move's condition lives in: the field's pseudo weather, the foe's side for a foe-side move, else the setter's side. */
function tableOf(battle: Battle, move: DexMove): Table {
  if (move.pseudoWeather) return battle.field.pseudoWeather as unknown as Table;
  return battle.sides[move.target === 'foeSide' ? 1 : 0].sideConditions as unknown as Table;
}

/**
 * The holders whose condition lasts another number of turns, asked of the condition's own rule (its durationCallback) with the
 * setter holding each item or having each ability of the rule set. A condition without such a rule gives no holder.
 */
function durationHolders(rules: Rules, mode: Mode, move: DexMove): Row[] {
  const dex = dexOfRules(rules);
  const condition = dex.conditions.get(conditionOf(move)) as unknown as { durationCallback?: (...args: unknown[]) => number };
  if (typeof condition.durationCallback !== 'function') return [];
  const battle = board(rules, mode, move.id, {});
  const setter = battle.sides[0].active[0]!;
  const target = battle.sides[move.target === 'foeSide' ? 1 : 0].active[0];
  const ask = (): number => (move.pseudoWeather
    ? condition.durationCallback!.call(battle, setter, move)
    : condition.durationCallback!.call(battle, target, setter, move));
  const plain = ask();
  const rows: Row[] = [];
  for (const item of dex.items.all().filter(entry => standard(entry, dex.gen))) {
    setter.item = item.id;
    setter.itemState = battle.initEffectState({ id: item.id, target: setter });
    if (ask() !== plain) rows.push({ move: move.id, holder: { item: item.name }, label: `${move.id} by a holder of ${item.id}` });
  }
  setter.item = '';
  for (const ability of dex.abilities.all().filter(entry => standard(entry, dex.gen) && entry.id !== 'noability')) {
    setter.ability = ability.id;
    setter.abilityState = battle.initEffectState({ id: ability.id, target: setter });
    if (ask() !== plain) rows.push({ move: move.id, holder: { ability: ability.name }, label: `${move.id} with ${ability.id}` });
  }
  return rows;
}

function rowsOf(rules: Rules, mode: Mode): Row[] {
  return conditionMoves(rules).flatMap(move => [
    { move: move.id, holder: {}, label: `${move.id} by a holder of no item` }, ...durationHolders(rules, mode, move),
  ]);
}

/** The spectator's view of the simulator's log: what a replay shows, the lines the client reads. */
const replayLines = (battle: Battle): string => extractChannelMessages(battle.log.join('\n'), [0])[0].join('\n');

/**
 * One row: the setter adds the condition the way its move does (the move's own call, so a move that needs a weather or a
 * partner still gives its condition), both sides splash through turn 1, and the turn boundary of turn 2 syncs the field with the
 * client's snapshot of the simulator's own log.
 */
function playRow(rules: Rules, mode: Mode, row: Row): { simulator: number | undefined; synced: number | undefined } | null {
  const move = dexOfRules(rules).moves.get(row.move);
  const battle = board(rules, mode, row.move, row.holder);
  const setter = battle.sides[0].active[0]!;
  const id = conditionOf(move);
  if (move.pseudoWeather) battle.field.addPseudoWeather(id, setter, move);
  else battle.sides[move.target === 'foeSide' ? 1 : 0].addSideCondition(id, setter, move);
  const splash = mode === 'singles' ? 'move 2' : 'move 2, move 1';
  battle.choose('p1', splash);
  battle.choose('p2', mode === 'singles' ? 'move 1' : 'move 1, move 1');
  const table = tableOf(battle, move);
  if (!table[id] || battle.turn !== 2) return null;
  const simulator = table[id]!.duration;
  const snapshot = parseReplayLogWithObservations(replayLines(battle)).snapshots.find(entry => entry.turn === 2);
  if (!snapshot) throw new Error(`${row.label}: the client gave no snapshot of turn 2`);
  correctFieldFromSnapshot(battle as never, snapshot);
  return { simulator, synced: tableOf(battle, move)[id]?.duration };
}

/**
 * The second cause the sweep found (a TODO proposal of round 83, at the batch's gate): the sync deletes a condition the client's
 * snapshot does not hold. The client shows Fairy Lock only as `-fieldactivate` (Gens 6 on), and the client of Gens 8 and 9 does
 * not know the Past moves Lucky Chant, Mud Sport and Water Sport; the simulator keeps them, the turn boundary takes them away.
 * These rows fail until that fix, and turn red when it lands.
 */
const clientBlind = (rules: Rules, move: string): boolean =>
  (move === 'fairylock' && rules.generation >= 6)
  || (['luckychant', 'mudsport', 'watersport'].includes(move) && rules !== CHAMPIONS && rules.generation >= 8);

test('Gen 1 sets no side condition or pseudo weather by a move: its screens and Mist are volatiles', () => {
  expect(rowsOf(SWEEP_CASES[0].rules, 'singles')).toEqual([]);
});

describe.each(SWEEP_CASES.filter(entry => entry.rules.generation >= 2))('the turn boundary keeps the simulator\'s duration of a condition: $name', ({ rules, mode }) => {
  for (const row of rowsOf(rules, mode)) {
    (clientBlind(rules, row.move) ? test.fails : test)(row.label, () => {
      const played = playRow(rules, mode, row);
      // a condition the rule set does not keep for a turn (a guard of one turn ends before the boundary) has nothing to keep
      if (played === null) return;
      expect(played.synced, row.label).toBe(played.simulator);
    });
  }
});

describe('the reported scene: a Light Clay screen in a variation (gen9terapreviewdraft-2182991758)', () => {
  test('Light Screen of a Light Clay holder lasts eight turns when the variation starts four turns after it was set', () => {
    const gen9 = SWEEP_CASES.find(entry => entry.rules.name === 'Gen 9' && entry.mode === 'singles')!.rules;
    const latias: PokemonSet = { ...mon(gen9, { species: 'Latias', moves: ['lightscreen', 'splash'] }), item: 'Light Clay' };
    const battle = battleOf(gen9.singles, [latias], [mon(gen9, { species: 'Vaporeon', moves: ['splash'] })]);
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    // the main line: the turn boundaries of turns 2 to 4 sync the field with the client's snapshot
    for (let turn = 2; turn <= 4; turn++) {
      const snapshot = parseReplayLogWithObservations(replayLines(battle)).snapshots.find(entry => entry.turn === turn)!;
      correctFieldFromSnapshot(battle as never, snapshot);
      battle.choose('p1', 'move 2');
      battle.choose('p2', 'move 1');
    }
    // the variation from turn 5: no more syncing; the screen set on turn 1 ends at the end of turn 8
    let ended = 0;
    for (let turn = 5; turn <= 10 && !ended; turn++) {
      battle.choose('p1', 'move 2');
      battle.choose('p2', 'move 1');
      if (!battle.sides[0].sideConditions['lightscreen']) ended = turn;
    }
    expect(ended).toBe(8);
  });
});
