import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { State, type Battle, type Pokemon } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { configureSimFast, resetSimFastForTests } from '../src/forward/sim-fast/state';
import { speedTie } from '../src/search/leaf';
import { actionsTie, AskLeak, setAskCheck } from '../src/sim-ask';
import { set } from './move-oracle';
import { boardBattle, boards, cheapOracle, SLOT_A, type Board } from './speed-tie-oracle';

/**
 * Round 72 (T196b): the prefilters of the speed tie answer from the simulator's own numbers and skip the queue's copy.
 * Forks are counted as `State.deserializeBattle` calls, which only the standard path makes (the speed layer's clone
 * copies a template), so the layer stays off here; speed-tie-sim.spec.ts holds every answer to the plain queue, and the
 * eight-mode matrix of lanes/B/tie-matrix.vt.ts holds them in every speed-layer mode.
 */

await loadSimMods('gen9championsou');

beforeEach(() => configureSimFast([]));
afterEach(() => { resetSimFastForTests(); setAskCheck(null); });

const FORMATS = [
  { name: 'Gen 9', singles: 'gen9customgame', doubles: 'gen9doublescustomgame' },
  { name: 'Champions', singles: 'gen9championsou', doubles: 'gen9championsdoublescustomgame' },
];

function forksOf(run: () => void): number {
  const original = State.deserializeBattle;
  let forks = 0;
  State.deserializeBattle = ((serialized: Parameters<typeof original>[0]) => { forks++; return original.call(State, serialized); }) as typeof original;
  try { run(); } finally { State.deserializeBattle = original; }
  return forks;
}

/** The board with its second body without speed training: the speeds differ, the handlers stay. */
const slower = (board: Board): Board => ({ ...board, p2: { ...board.p2, evs: { ...board.p2.evs, spe: 0 } } });

/** The same board with the sides swapped, so the holder of the entry stands on either side. */
const mirrored = (board: Board): Board => ({ ...board, p1: board.p2, p2: board.p1, m1: board.m2, m2: board.m1 });

/** Which of the eight boards need the queue: the others hold no handler for the priority and answer from the Dex. */
const NEEDS_QUEUE = [false, true, true, true, true, true, true, false];

describe.each(FORMATS)('$name', ({ singles, doubles }) => {
  test('two different action speeds answer no tie without a copy, on every board, singles and doubles', () => {
    for (const isDoubles of [false, true]) {
      for (const board of boards().filter(candidate => !candidate.setup).map(slower)) {
        const battle = boardBattle(isDoubles ? doubles : singles, isDoubles, board);
        const expected = cheapOracle(battle, ...SLOT_A)(board.m1, board.m2);
        const ask = (side: 0 | 1, moveId: string) => ({ pokemon: battle.sides[side].active[0] as Pokemon, moveId });
        let answer = true;
        const forks = forksOf(() => { answer = actionsTie(battle, ask(0, board.m1), ask(1, board.m2)); });
        expect(answer, `${isDoubles ? 'doubles' : 'singles'} ${board.name}`).toBe(expected);
        expect(forks, `${isDoubles ? 'doubles' : 'singles'} ${board.name}`).toBe(0);
      }
    }
  });

  test('at equal speed a pair without a priority handler answers from the Dex priority, and a handler sends it to the queue', () => {
    const queueBoards: string[] = [];
    const all = boards();
    for (const isDoubles of [false, true]) {
      for (const [index, board] of [...all, ...all.map(mirrored)].entries()) {
        const battle = boardBattle(isDoubles ? doubles : singles, isDoubles, board);
        const expected = cheapOracle(battle, ...SLOT_A)(board.m1, board.m2);
        const ask = (side: 0 | 1, moveId: string) => ({ pokemon: battle.sides[side].active[0] as Pokemon, moveId });
        let answer = !expected;
        const forks = forksOf(() => { answer = actionsTie(battle, ask(0, board.m1), ask(1, board.m2)); });
        const label = `${isDoubles ? 'doubles' : 'singles'} ${board.name}${index >= all.length ? ' (mirrored)' : ''}`;
        expect(answer, label).toBe(expected);
        expect(forks > 0, label).toBe(NEEDS_QUEUE[index % all.length]);
        if (forks > 0) queueBoards.push(label);
      }
    }
    expect(queueBoards.length).toBe(2 * 2 * NEEDS_QUEUE.filter(Boolean).length);
  });

  test('a move with a priority handler of its own sends the pair to the queue; a move without one and equal Dex priority does not', () => {
    const body = (moves: string[]) => set('Snorlax', moves, { evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 } });
    const priorityHandler = (battle: Battle, id: string) => typeof (battle.dex.moves.get(id) as unknown as Record<string, unknown>)['onModifyPriority'] === 'function';
    const probe = boardBattle(singles, false, boards()[0]);
    const withHandler = (probe.dex.moves.all() as unknown as { id: string; exists: boolean; gen: number }[])
      .filter(move => move.exists && move.gen <= probe.dex.gen && priorityHandler(probe, move.id)).map(move => move.id);
    expect(withHandler.length).toBeGreaterThan(0);
    for (const id of withHandler) {
      const board: Board = { name: id, p1: body([id]), p2: body(['tackle']), m1: id, m2: 'tackle' };
      const battle = boardBattle(singles, false, board);
      const expected = cheapOracle(battle, ...SLOT_A)(id, 'tackle');
      let answer = !expected;
      const forks = forksOf(() => { answer = speedTie(battle as never, `move ${id}`, 'move tackle'); });
      expect(answer, id).toBe(expected);
      expect(forks, id).toBeGreaterThan(0);
    }
  });

  test('the two speeds are read once per position, however many pairs it asks', () => {
    setAskCheck(false); // the development check reads a hit again on purpose
    const board = boards()[0];
    const battle = boardBattle(singles, false, board);
    const reads = new Map<Pokemon, number>();
    for (const side of battle.sides) {
      const mon = side.active[0] as Pokemon;
      const read = mon.getActionSpeed.bind(mon);
      mon.getActionSpeed = () => { reads.set(mon, (reads.get(mon) ?? 0) + 1); return read(); };
    }
    for (const [m1, m2] of [['tackle', 'tackle'], ['tackle', 'quickattack'], ['quickattack', 'tackle']]) speedTie(battle as never, `move ${m1}`, `move ${m2}`);
    expect([...reads.values()]).toEqual([1, 1]);
  });

  test('a battle that changed after its first question fails the development check instead of answering from the memo', () => {
    const board = boards()[0];
    const battle: Battle = boardBattle(singles, false, board);
    setAskCheck(true);
    speedTie(battle as never, 'move tackle', 'move tackle');
    battle.field.addPseudoWeather('trickroom', battle.sides[0].active[0] as Pokemon);
    battle.sides[0].active[0].boostBy({ spe: 2 });
    expect(() => speedTie(battle as never, 'move tackle', 'move tackle')).toThrow(AskLeak);
  });
});
