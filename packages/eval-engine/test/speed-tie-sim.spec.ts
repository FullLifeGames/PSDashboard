import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Pokemon } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { speedTie } from '../src/search/leaf';
import { actionsTie, fingerprint, setAskCheck } from '../src/sim-ask';
import { boardBattle, boardChoices, boards, cheapOracle, playedTie, SLOT_A } from './speed-tie-oracle';
import { SUITE_RULE_SETS, tieSweep } from './speed-tie-sweep';

// A tie is the condition under which `speedSort` flips a coin: `battle.comparePriority(a, b) === 0` on the actions
// `queue.resolveAction` builds (priority after ModifyPriority events, fractional priority, speed with Trick Room).

await loadSimMods('gen9championsou');

const FORMATS = [
  { name: 'Gen 9', singles: 'gen9customgame', doubles: 'gen9doublescustomgame' },
  { name: 'Champions', singles: 'gen9championsou', doubles: 'gen9championsdoublescustomgame' },
];

describe('the eight boards: played turn, queue answer and speedTie', () => {
  describe.each(FORMATS)('$name', ({ singles, doubles }) => {
    test('the played turn and the cheap queue answer agree on every board, singles and doubles', () => {
      const rows: string[] = [];
      let ties = 0;
      for (const isDoubles of [false, true]) {
        for (const board of boards()) {
          const battle = boardBattle(isDoubles ? doubles : singles, isDoubles, board);
          const cheap = cheapOracle(battle, ...SLOT_A)(board.m1, board.m2);
          const played = playedTie(battle, ...SLOT_A, boardChoices(board, isDoubles));
          rows.push(`${isDoubles ? 'doubles' : 'singles'} ${board.name}: queue ${cheap}, played ${played}`);
          expect(played, rows[rows.length - 1]).toBe(cheap);
          if (cheap) ties++;
        }
      }
      expect(ties).toBeGreaterThan(0);
      expect(ties).toBeLessThan(rows.length);
    });

    test('speedTie equals the simulator on the eight singles boards', () => {
      const wrong: string[] = [];
      for (const board of boards()) {
        const battle = boardBattle(singles, false, board);
        const expected = cheapOracle(battle, ...SLOT_A)(board.m1, board.m2);
        const ours = speedTie(battle as never, `move ${board.m1}`, `move ${board.m2}`);
        if (ours !== expected) wrong.push(`${board.name}: simulator ${expected}, speedTie ${ours}`);
      }
      process.stdout.write(`speed-tie boards ${singles}: ${wrong.length} of ${boards().length} differ\n`);
      expect(wrong).toEqual([]);
    });

    test('doubles: actionsTie equals the simulator for slot a against slot a, and speedTie stays singles only', () => {
      for (const board of boards()) {
        const battle = boardBattle(doubles, true, board);
        const expected = cheapOracle(battle, ...SLOT_A)(board.m1, board.m2);
        const ask = (side: 0 | 1, moveId: string) => ({ pokemon: battle.sides[side].active[0] as Pokemon, moveId });
        expect(actionsTie(battle, ask(0, board.m1), ask(1, board.m2)), board.name).toBe(expected);
        expect(speedTie(battle as never, `move ${board.m1} 1, move tackle 1`, `move ${board.m2} 1, move tackle 1`), board.name).toBe(false);
      }
    });

    test('the live battle is unchanged by the question, with the development check on', () => {
      setAskCheck(true);
      try {
        for (const board of boards()) {
          const battle = boardBattle(singles, false, board);
          const before = fingerprint(battle);
          speedTie(battle as never, `move ${board.m1}`, `move ${board.m2}`);
          expect(fingerprint(battle), board.name).toBe(before);
        }
      } finally {
        setAskCheck(null);
      }
    });
  });
});

describe('the sweep over every priority and speed entry of the Dex', () => {
  beforeAll(() => setAskCheck(false));
  afterAll(() => setAskCheck(null));

  test.each(SUITE_RULE_SETS)('$name: speedTie equals the simulator, the live battle stays as it was', ({ format }) => {
    const { holders, scenarios, asked, ties, wrong } = tieSweep(format, speedTie as never);
    process.stdout.write(`speed-tie sweep ${format}: ${holders} holders, ${scenarios} scenarios, ${asked} asks, ${ties} ties
`);
    expect(wrong).toEqual([]);
    expect(asked).toBeGreaterThan(0);
    expect(ties).toBeGreaterThan(0);
    expect(ties).toBeLessThan(asked);
  }, 240_000);
});
