import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { speedTie } from '../src/search/leaf';
import { actionsTie, fingerprint, setAskCheck } from '../src/sim-ask';
import { boardBattle, boardChoices, boards, cheapOracle, playedTie, SLOT_A } from './speed-tie-oracle';
import { holdersOf, moveReps, scenariosOf, sweepBattle, type Holder, type Scenario } from './speed-tie-sweep';

/**
 * Round 72 (T196, step 4): `speedTie` against the simulator's own queue. A tie is the condition under which
 * `speedSort` flips a coin between two move actions: `battle.comparePriority(a, b) === 0` on the actions that
 * `queue.resolveAction` builds (priority after ModifyPriority events, fractional priority, speed with Trick Room).
 *   1. The eight boards of the round-70 probe, in Gen 9 and Champions, singles and doubles: the played turn (a shuffle
 *      of the two move actions on a copy) and the cheap queue answer agree, and `speedTie` equals them.
 *   2. The sweep: every Dex entry that can move a priority or a speed, as the holder on either side, in every
 *      generation and the Champions mod, against the Dex's moves, at equal and unequal speed, Trick Room, Tailwind and
 *      paralysis; the live battle's fingerprint is unchanged by every ask.
 */

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
      // The oracle is not vacuous: boards tie and boards do not.
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

const EQUAL: Scenario = { name: 'equal speed', holderLevel: 100, otherLevel: 100, full: true };

const RULE_SETS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `gen ${gen}`, format: `gen${gen}customgame` })),
  { name: 'Champions', format: 'gen9championsou' },
];

describe('the sweep over every priority and speed entry of the Dex', () => {
  beforeAll(() => setAskCheck(false));
  afterAll(() => setAskCheck(null));

  test.each(RULE_SETS)('$name: speedTie equals the simulator, the live battle stays as it was', ({ format }) => {
    const probe = sweepBattle(format, null, 0, EQUAL);
    const holders: (Holder | null)[] = [null, ...holdersOf(probe)];
    const reps = moveReps(probe);
    const scenarios = scenariosOf(probe);
    let asked = 0;
    let ties = 0;
    const wrong: string[] = [];
    for (const holder of holders) {
      for (const scenario of scenarios) {
        // Holders that only change the speed run in the equal-speed cases; the others run every scenario.
        if (holder?.speedOnly && !scenario.full) continue;
        for (const side of [0, 1] as const) {
          const battle: Battle = sweepBattle(format, holder, side, scenario);
          const before = fingerprint(battle);
          const tieOf = cheapOracle(battle, ...SLOT_A);
          // A holder that moves only the speed does not read the move: the few priority classes tell it apart.
          const holderMoves = scenario.full && !holder?.speedOnly ? reps.holder : reps.other;
          for (const own of holderMoves) {
            for (const foe of reps.other) {
              const [m1, m2] = side === 0 ? [own, foe] : [foe, own];
              const expected = tieOf(m1, m2);
              const ours = speedTie(battle as never, `move ${m1}`, `move ${m2}`);
              asked++;
              if (expected) ties++;
              if (ours !== expected && wrong.length < 12) wrong.push(`${holder?.id ?? 'no holder'} on p${side + 1}, ${scenario.name}, ${m1} against ${m2}: simulator ${expected}, speedTie ${ours}`);
            }
          }
          expect(fingerprint(battle), `${holder?.id ?? 'no holder'} on p${side + 1}, ${scenario.name}`).toBe(before);
        }
      }
    }
    process.stdout.write(`speed-tie sweep ${format}: ${holders.length} holders, ${scenarios.length} scenarios, ${asked} asks, ${ties} ties\n`);
    expect(wrong).toEqual([]);
    expect(asked).toBeGreaterThan(0);
    expect(ties).toBeGreaterThan(0);
    expect(ties).toBeLessThan(asked);
  }, 240_000);
});
