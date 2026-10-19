import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { State, type Battle, type Pokemon } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { configureSimFast, resetSimFastForTests } from '../src/forward/sim-fast/state';
import { speedTie } from '../src/search/leaf';
import { actionsTie, AskLeak, setAskCheck } from '../src/sim-ask';
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

  test('the two speeds are read once per position, however many pairs it asks', () => {
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
