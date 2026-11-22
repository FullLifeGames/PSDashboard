import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { State, type Battle } from '@pkmn/sim';
import { evaluatePosition } from '../src/eval-function';
import { createMatchupCache } from '../src/score/threat';
import { resetHitMemo } from '../src/score/contact';
import { resetResidualMemo } from '../src/score/residuals';
import { searchPosition } from '../src/search';
import { configureSearchBudget, SEARCH_BUDGET_DEFAULT } from '../src/search/budget';
import type { StaticRuleset } from '../src/score/weights';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#149, step A8): the A, B, A test. The hit-cost memo is a tool of one process and the app's workers keep it
 * across turns, so a board's value must not depend on which boards the process read before it. Two boards collide under
 * the old key: Rillaboom stands at +2 Attack with Wood Hammer against a Dragonite behind a Substitute, and the Substitute
 * has 200 HP on board A and 10 HP on board B (Rillaboom at 45 % and Dragonite at 50 %, with a Dragon Claw to answer: a
 * race the chip of the recoil decides). The boosts term (boostsBiting) asks what a hit of Wood Hammer costs its user,
 * and the answer follows the damage the Substitute takes, so the two boards price it differently. The orders: A alone,
 * B alone, then A B A, B A B in one process, and A B A with one clear of the memos between B and A (the clear at 20,000
 * entries must change nothing). Every reading of a board equals its reading alone. Part (a) reads the static evaluation,
 * part (b) one search per board with a small budget. Singles in Scarlet/Violet, and the doubles twin under the VGC weights
 * (Doubles OU weighs the term 0, so the twin plays the VGC rule set).
 */

const MOVE = 'woodhammer';

function board(format: string, substituteHp: number): Battle {
  const battle = battleOf(
    format,
    [set('Rillaboom', [MOVE, 'swordsdance'], { ability: 'Grassy Surge' }), set('Clefable', ['splash'])],
    [set('Dragonite', ['dragonclaw', 'splash']), set('Snorlax', ['splash'])],
  );
  const attacker = battle.sides[0].active[0]!;
  attacker.boosts.atk = 2;
  attacker.hp = Math.floor(attacker.maxhp * 0.45);
  const target = battle.sides[1].active[0]!;
  target.hp = Math.floor(target.maxhp * 0.5);
  target.addVolatile('substitute');
  (target.volatiles.substitute as { hp: number }).hp = substituteHp;
  return battle;
}

const CASES: { name: string; format: string; ruleset: StaticRuleset }[] = [
  { name: 'singles', format: 'gen9customgame', ruleset: 'standard' },
  { name: 'VGC doubles', format: 'gen9doublescustomgame', ruleset: 'vgc' },
];

const clear = (): void => { resetHitMemo(); resetResidualMemo(); };

beforeEach(clear);
afterEach(() => configureSearchBudget(null));

describe.each(CASES)('a board reads the same whichever boards came before it ($name)', ({ format, ruleset }) => {
  const evaluate = (substituteHp: number): number => evaluatePosition(board(format, substituteHp), createMatchupCache(ruleset));
  const search = (substituteHp: number): string => {
    const battle = board(format, substituteHp);
    const result = searchPosition(JSON.stringify(State.serializeBattle(battle)), { depth: 1, samples: 1, tera: false, mode: 'matrix', ruleset });
    return JSON.stringify([result.score, result.perSide.p1.map(row => [row.choice, row.ev]), result.perSide.p2.map(row => [row.choice, row.ev])]);
  };
  const ORDERS: { name: string; boards: (200 | 10)[]; clearBefore?: number }[] = [
    { name: 'A B A', boards: [200, 10, 200] },
    { name: 'B A B', boards: [10, 200, 10] },
    { name: 'A B A with a clear between B and A', boards: [200, 10, 200], clearBefore: 2 },
  ];

  test.each([['the static evaluation', evaluate], ['one search per board', search]] as const)('%s: every reading of a board equals its reading alone', (_kind, read) => {
    if (read === search) configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, iterations: 40 });
    const alone = { 200: (clear(), read(200)), 10: (clear(), read(10)) };
    // Teeth: the Substitute's HP moves the reading.
    expect(JSON.stringify(alone[200])).not.toBe(JSON.stringify(alone[10]));
    const wrong: string[] = [];
    for (const order of ORDERS) {
      clear();
      order.boards.forEach((hp, step) => {
        if (step === order.clearBefore) clear();
        if (JSON.stringify(read(hp)) !== JSON.stringify(alone[hp])) wrong.push(`${order.name}: step ${step + 1} (${hp === 200 ? 'A' : 'B'})`);
      });
    }
    expect(wrong).toEqual([]);
  });
});
