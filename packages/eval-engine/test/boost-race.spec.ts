import { describe, expect, test } from 'vitest';
import { BITE_TURNS, benchShare, foeWins, holderActs, stageBites, type Race } from '../src/score/boost-race';

/**
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320, cause 2): the rule that says whether a standing stage
 * moves the 1v1 race of a pair in favour of the side it helps. The scenes on real boards are in boost-bite-front.spec.ts
 * and boost-bite-drops.spec.ts, held to the simulator; this spec holds the rule itself to its table.
 */

const race = (partial: Partial<Race>): Race => ({
  turnsMine: Infinity, turnsFoe: Infinity, first: false, foeFirst: false, mineSurvives: true, foeSurvives: true,
  exactMine: partial.turnsMine ?? Infinity, exactFoe: partial.turnsFoe ?? Infinity, ...partial,
});

describe('a boost counts when the holder wins the race with it and the stage made the difference', () => {
  test.each([
    ['a flip: lost without the stage, won with it', race({ turnsMine: 2, turnsFoe: 3 }), race({ turnsMine: 4, turnsFoe: 3 }), true],
    ['a faster win: won either way, one turn sooner', race({ turnsMine: 1 }), race({ turnsMine: 2 }), true],
    ['a flip by the move order: the same clocks, the first move won', race({ turnsMine: 2, turnsFoe: 2, first: true }), race({ turnsMine: 2, turnsFoe: 2 }), true],
    ['a flip from a hold: nobody won without the stage', race({ turnsMine: 2 }), race({}), true],
    ['a shorter clock in a race the foe wins anyway (the Scarf Mienshao: it moves first and KOs in one hit)',
      race({ turnsMine: 1, turnsFoe: 1, foeFirst: true, mineSurvives: false }), race({ turnsMine: 2, turnsFoe: 1, foeFirst: true, mineSurvives: false }), false],
    ['a later KO of me in a race I still lose', race({ turnsMine: 5, turnsFoe: 4 }), race({ turnsMine: 5, turnsFoe: 2 }), false],
    ['a race won either way at the same speed: the stage changed nothing', race({ turnsMine: 2 }), race({ turnsMine: 2 }), false],
    // T248 (round 73): a stage that only makes a won race safer decides the race at a lower HP, so it counts (the HP enters through the gate only).
    ['a win either way, only safer: the foe\'s clock is longer, mine is not', race({ turnsMine: 2, turnsFoe: 4 }), race({ turnsMine: 2, turnsFoe: 3 }), true],
    ['a win beyond the horizon is a stall war', race({ turnsMine: BITE_TURNS + 1 }), race({ turnsMine: BITE_TURNS + 3 }), false],
    ['nobody wins with the stage', race({}), race({}), false],
    ['equal clocks, the foe moves first: the foe wins the tie', race({ turnsMine: 2, turnsFoe: 2, foeFirst: true }), race({ turnsMine: 3, turnsFoe: 2, foeFirst: true }), false],
    ['equal clocks, neither moves first (a speed tie): nobody wins', race({ turnsMine: 2, turnsFoe: 2 }), race({ turnsMine: 3, turnsFoe: 2 }), false],
  ])('%s', (_name, held, without, expected) => {
    expect(stageBites(held, without, false)).toBe(expected);
  });

  test('the holder must get to act: the clocks say win, but the foe\'s hit KOs it before it moves', () => {
    // A healer that spends turns healing has a long clock on paper; its single hit still KOs the holder first.
    const held = race({ turnsMine: 2, turnsFoe: 3, first: false, mineSurvives: false });
    const without = race({ turnsMine: 4, turnsFoe: 3, first: false, mineSurvives: false });
    expect(holderActs(held)).toBe(false);
    expect(stageBites(held, without, false)).toBe(false);
    expect(stageBites({ ...held, first: true }, without, false)).toBe(true);
    expect(stageBites({ ...held, mineSurvives: true }, without, false)).toBe(true);
  });
});

describe('the difference a stage makes is read on the fresh race (T248, round 73)', () => {
  test('the same stage counts at every HP the gate lets through: the HP of the held race does not decide whether the stage helps', () => {
    // The stage improves the race at full HP (two hits against four): a held race that wins counts whether or not the held race alone would show a difference.
    const full = race({ turnsMine: 2, turnsFoe: 3 });
    const without = race({ turnsMine: 4, turnsFoe: 3 });
    for (const heldHere of [race({ turnsMine: 2, turnsFoe: 3 }), race({ turnsMine: 1, turnsFoe: 3 }), race({ turnsMine: 2, turnsFoe: 9 })]) {
      expect(stageBites(heldHere, without, false, full)).toBe(true);
    }
  });

  test('a stage that changes nothing at full HP counts nowhere, though the held race shows a difference at its low HP', () => {
    // The held race at a low HP of the foe differs from the race without the stage (one hit against five); the fresh races of both are the same.
    const same = race({ turnsMine: 4, turnsFoe: 3 });
    expect(stageBites(race({ turnsMine: 1, turnsFoe: 3 }), same, false, same)).toBe(false);
  });

  test('the gate still reads the held race: a held race the side loses counts nothing, whatever the fresh race says', () => {
    const lost = race({ turnsMine: 3, turnsFoe: 2 });
    expect(stageBites(lost, race({ turnsMine: 5, turnsFoe: 2 }), false, race({ turnsMine: 2, turnsFoe: 3 }))).toBe(false);
  });
});

describe('a drop is the mirror: it counts when the foe wins the race with it and the drop made the difference', () => {
  test.each([
    ['a flip: I won without the drop, the foe wins with it', race({ turnsMine: 3, turnsFoe: 3, foeFirst: true }), race({ turnsMine: 2, turnsFoe: 3, foeFirst: true }), true],
    ['a faster win for the foe: it won either way, one turn sooner', race({ turnsFoe: 2 }), race({ turnsFoe: 3 }), true],
    ['a flip by the move order: the foe moves first with it', race({ turnsMine: 2, turnsFoe: 2, foeFirst: true }), race({ turnsMine: 2, turnsFoe: 2, first: true }), true],
    ['a flip from a hold: nobody won without the drop', race({ turnsFoe: 3 }), race({}), true],
    ['a later KO of the foe in a race I still win: the drop costs nothing', race({ turnsMine: 3 }), race({ turnsMine: 2 }), false],
    ['a shorter clock for the foe in a race the foe loses anyway', race({ turnsMine: 2, turnsFoe: 3, first: true }), race({ turnsMine: 2, turnsFoe: 4, first: true }), false],
    ['the foe wins beyond the horizon', race({ turnsFoe: BITE_TURNS + 1 }), race({ turnsFoe: BITE_TURNS + 4 }), false],
    ['the drop changed nothing', race({ turnsFoe: 2 }), race({ turnsFoe: 2 }), false],
  ])('%s', (_name, held, without, expected) => {
    expect(stageBites(held, without, true)).toBe(expected);
  });

  test('the foe must get to act: it moves first or it survives my hit', () => {
    const held = race({ turnsMine: 5, turnsFoe: 2, foeFirst: false, foeSurvives: false });
    const without = race({ turnsMine: 5, turnsFoe: 3, foeFirst: false, foeSurvives: false });
    expect(stageBites(held, without, true)).toBe(false);
    expect(stageBites({ ...held, foeFirst: true }, without, true)).toBe(true);
    expect(stageBites({ ...held, foeSurvives: true }, without, true)).toBe(true);
  });
});

describe('the gates read the race from the foe in front', () => {
  test('the foe wins on a shorter clock, or on an equal finite one when it moves first, and never on infinite clocks', () => {
    expect(foeWins(race({ turnsMine: 3, turnsFoe: 2 }))).toBe(true);
    expect(foeWins(race({ turnsMine: 2, turnsFoe: 2, foeFirst: true }))).toBe(true);
    expect(foeWins(race({ turnsMine: 2, turnsFoe: 2, first: true }))).toBe(false);
    expect(foeWins(race({ turnsMine: 2, turnsFoe: 3 }))).toBe(false);
    expect(foeWins(race({}))).toBe(false);
  });

  test('the holder acts when it moves first or survives the foe\'s hit', () => {
    expect(holderActs(race({ first: true, mineSurvives: false }))).toBe(true);
    expect(holderActs(race({ first: false, mineSurvives: true }))).toBe(true);
    expect(holderActs(race({ first: false, mineSurvives: false }))).toBe(false);
  });
});

describe('T259 (round 76): the bench behind a front foe opens by a ramp over the race margin, not by a whole turn', () => {
  const share = (partial: Partial<Race>): number => benchShare(race(partial));

  test('a clear win is a whole credit, a clear loss none, the same as the whole-turn gate on both ends', () => {
    expect(share({ turnsMine: 1, turnsFoe: 4, exactMine: 0.6, exactFoe: 3.2 })).toBe(1);
    expect(share({ turnsMine: 2, exactMine: 1.5 })).toBe(1);
    expect(share({ turnsMine: 4, turnsFoe: 1, exactMine: 3.2, exactFoe: 0.6 })).toBe(0);
    expect(share({ turnsMine: Infinity, turnsFoe: 2 })).toBe(0);
  });

  test('the horizon ramps over its last turn: three turns is whole, four is none', () => {
    expect(share({ turnsMine: BITE_TURNS, exactMine: BITE_TURNS })).toBe(1);
    expect(share({ turnsMine: BITE_TURNS + 1, exactMine: BITE_TURNS + 0.5 })).toBeCloseTo(0.5, 12);
    expect(share({ turnsMine: BITE_TURNS + 1, exactMine: BITE_TURNS + 1 })).toBe(0);
  });

  test('a close race is a part credit that grows with the margin; the first move tips a tie', () => {
    const at = (exactMine: number, exactFoe: number, extra: Partial<Race> = {}) =>
      share({ turnsMine: Math.ceil(exactMine), turnsFoe: Math.ceil(exactFoe), exactMine, exactFoe, ...extra });
    expect(at(2, 2)).toBeCloseTo(0.5, 12);
    expect(at(2, 2, { first: true })).toBeGreaterThan(at(2, 2));
    expect(at(2, 2, { foeFirst: true })).toBeLessThan(at(2, 2));
    expect(at(1.9, 2.6)).toBeGreaterThan(at(2.0, 2.6));
  });

  test('no step in the exact clocks moves the share by more than the step over the ramp: the Incineroar of Champions 2634199230 turn 5 (whole clocks 3 against 3, then 2 against 3)', () => {
    let worst = 0;
    let last = share({ turnsMine: 3, turnsFoe: 3, exactMine: 2.2, exactFoe: 2.9 });
    for (let step = 1; step <= 40; step++) {
      const exactMine = 2.2 - step * 0.01;
      const now = share({ turnsMine: Math.ceil(exactMine), turnsFoe: 3, exactMine, exactFoe: 2.9 });
      worst = Math.max(worst, Math.abs(now - last));
      last = now;
    }
    expect(worst).toBeLessThanOrEqual(0.01 + 1e-12);
  });
});
