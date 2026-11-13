import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { entryReads, methodsOf, type Consumer } from '../src/dex-facts/state-readers';
import { Interner, hitKeyReader, residualKey } from '../src/score/memo-keys';
import { playResiduals, slotsOf } from '../src/score/residuals';
import { copyOf } from '../src/sim-ask/copy';
import { loadSimMods } from '../src/forward/sim-mods';
import { SWEEPS_FULL } from './dice-fixtures';
import { SWEEP_CASES, sweepMoves } from './dice-sweep-support';
import { attackerOf, boardFor, defenderOf, HOLDERS, holderOf, verdictOf, type Holder, type Lineup } from './board-key-support';

/**
 * Round 89 (#149, step A8-6): a field that every reader in the Dex tests only as "zero or not" is keyed as that predicate. The turns
 * a body has stood on the field (`activeTurns`) is read by Stakeout, Mountaineer, Rebound, Speed Boost, Slow Start, Truant, Electrify,
 * Taunt, Octolock and a partial trap, each of them as `activeTurns` against 0 (a foe that came in this turn, a body past its first
 * turn). The key then splits a board at 0 and keeps 1, 2 and 17 together. This spec holds the predicate to the simulator in every rule
 * set the corpus plays, singles and doubles: every Dex entry the scan names as a reader of the field, placed on each holder of the
 * board, plays the same hit (and the same end of the turn) at 1, 4 and 17, and the key of the board is the same; at 0 against 3 the
 * plays differ (the teeth), so the predicate is no blanket. A simulator whose entry compares the field with a number turns the row
 * red, and the field is keyed whole again.
 */

await loadSimMods('gen9championscustomgame');

const CASES = SWEEPS_FULL ? SWEEP_CASES : SWEEP_CASES.filter(({ name }) => ['Gen 9 singles', 'Gen 9 doubles', 'Champions singles', 'Champions doubles', 'Gen 4 singles', 'Gen 7 doubles'].includes(name));
const FIELD = 'activeTurns';
const POSITIVE = [1, 4, 17];

const setTurns = (battle: Battle, turns: number): void => {
  for (const side of battle.sides) for (const body of side.active) if (body) body.activeTurns = turns;
};

/** The end of the turn of a board, played without a memo. */
function freshEnd(battle: Battle): string {
  const copy = copyOf(battle);
  return JSON.stringify(playResiduals(copy, slotsOf(copy)));
}

describe.each(CASES)('$name: the turns a body has stood are keyed as zero or not', ({ rules, mode, name }) => {
  // A move that costs its user HP by itself: the cost of the hit then follows the damage a Stakeout or a Slow Start changes.
  const recoil = sweepMoves(rules, move => !!move.recoil || !!move.struggleRecoil, true).moves.find(move => move.category === 'Physical')?.id ?? 'tackle';
  const base = boardFor(rules, mode, recoil);
  const { dex } = base;
  const methods = methodsOf(base);
  const valid = (entry: { exists?: boolean; isNonstandard?: string | null }) => entry.exists && (entry.isNonstandard === null || entry.isNonstandard === undefined || entry.isNonstandard === 'Past');
  const readers = (consumer: Consumer) => ({
    abilities: rules.generation >= 3 ? dex.abilities.all().filter(entry => valid(entry) && entryReads(entry, consumer, methods).fields.has(FIELD)).map(entry => entry.id) : [],
    items: rules.generation >= 2 ? dex.items.all().filter(entry => valid(entry) && entryReads(entry, consumer, methods).fields.has(FIELD)).map(entry => entry.id) : [],
    moves: dex.moves.all().filter(entry => valid(entry) && !entry.isZ && !entry.isMax && entryReads(entry, consumer, methods).fields.has(FIELD)).map(entry => entry.id),
    conditions: Object.keys(dex.data.Conditions).filter(id => entryReads(dex.conditions.get(id), consumer, methods).fields.has(FIELD)),
  });
  const holders: readonly Holder[] = mode === 'doubles' ? HOLDERS : ['attacker', 'defender'];
  const lineupOf = (kind: 'ability' | 'item', id: string, holder: Holder): Lineup => ({ [holder]: { [kind]: id } });

  test('the hit: every reader plays the same at 1, 4 and 17, and the keys are one', () => {
    const { abilities, items, moves } = readers('hit');
    const wrong: string[] = [];
    let rows = 0;
    let teeth = 0;
    const play = (turns: number, move: string, lineup: Lineup): Battle => { const battle = boardFor(rules, mode, move, lineup); setTurns(battle, turns); return battle; };
    const check = (label: string, move: string, lineup: Lineup): void => {
      const boards = POSITIVE.map(turns => play(turns, move, lineup));
      rows++;
      const interner = new Interner();
      const keys = boards.map(battle => hitKeyReader(battle, interner)(attackerOf(battle), defenderOf(battle), move));
      if (new Set(keys).size !== 1) wrong.push(`${name} ${label}: keys differ`);
      for (let index = 1; index < boards.length; index++) if (verdictOf(boards[0], boards[index], move) !== 'same') wrong.push(`${name} ${label}: ${POSITIVE[0]} against ${POSITIVE[index]}`);
      if (verdictOf(play(0, move, lineup), play(3, move, lineup), move) === 'split') teeth++;
    };
    for (const [kind, ids] of [['ability', abilities], ['item', items]] as const) {
      for (const id of ids) for (const holder of holders) if (holderOf(base, holder)) check(`${kind} ${id} on ${holder}`, recoil, lineupOf(kind, id, holder));
    }
    for (const move of moves) check(`move ${move}`, move, {});
    // Generations 1 and 2 have no entry that reads the field.
    if (rules.generation >= 3) expect(rows).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
    // The teeth: Stakeout on the attacker (Gen 7 on) and Mountaineer-like entries read the zero.
    if (rules.generation >= 7 || rules.name === 'Champions') expect(teeth).toBeGreaterThan(0);
  });

  test('the end of the turn: every reader plays the same at 1, 4 and 17, and the keys are one', () => {
    const { abilities, conditions } = readers('residual');
    const wrong: string[] = [];
    let rows = 0;
    let teeth = 0;
    const place = (turns: number, kind: 'ability' | 'volatile', id: string, holder: Holder): Battle | null => {
      const battle = boardFor(rules, mode, 'tackle', kind === 'ability' ? lineupOf('ability', id, holder) : {});
      const body = holderOf(battle, holder);
      if (!body) return null;
      if (kind === 'volatile' && !body.addVolatile(id, holder === 'attacker' ? defenderOf(battle) : attackerOf(battle))) return null;
      setTurns(battle, turns);
      return battle;
    };
    const rowsOf: ['ability' | 'volatile', string][] = [...abilities.map(id => ['ability', id] as ['ability', string]), ...conditions.map(id => ['volatile', id] as ['volatile', string])];
    for (const [kind, id] of rowsOf) {
      for (const holder of holders) {
        const boards = POSITIVE.map(turns => place(turns, kind, id, holder));
        if (boards.some(board => !board)) continue;
        rows++;
        const interner = new Interner();
        const keys = boards.map(battle => residualKey(battle!, slotsOf(battle!), interner));
        if (new Set(keys).size !== 1) wrong.push(`${name} ${kind} ${id} on ${holder}: keys differ`);
        const plays = boards.map(battle => freshEnd(battle!));
        if (new Set(plays).size !== 1) wrong.push(`${name} ${kind} ${id} on ${holder}: plays differ`);
        if (freshEnd(place(0, kind, id, holder)!) !== freshEnd(place(3, kind, id, holder)!)) teeth++;
      }
    }
    expect(wrong).toEqual([]);
    if (rules.generation >= 3) { expect(rows).toBeGreaterThan(0); expect(teeth).toBeGreaterThan(0); }
  });
});
