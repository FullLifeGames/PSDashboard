import { describe, expect, test } from 'vitest';
import type { BranchHistoryEntry } from '../../../src/lib/branch-history';
import { variationBoardShares } from '../../../src/lib/variation-shares';
import { pokemon, type FormatKind } from '../fixtures/sim-state';

/**
 * Round 70 (T216): the fainted share of the board a variation point stands on. The share counts fainted bodies over all
 * bodies of both sides, the measure the engine routes by (battleFaintedFraction), so the branch board and its search
 * read one phase. Expected values are counted by hand from the rosters below.
 */
const BODIES: Record<FormatKind, number> = { singles: 6, doubles: 4 };

/** One side's roster: `down` of its bodies fainted (hp 0, flag set), the rest healthy. */
const roster = (kind: FormatKind, down: number) => Array.from({ length: BODIES[kind] }, (_, index) => (
  index < down ? pokemon(`Mon${index}`, { fainted: true, hp: 0, hpPercent: 0 }) : pokemon(`Mon${index}`)
));

const entry = (kind: FormatKind, downs: [number, number], extra: Partial<BranchHistoryEntry> = {}): BranchHistoryEntry => ({
  turnNumber: 1, p1Choice: 'move a', p2Choice: 'move b',
  p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [],
  p1Pokemon: roster(kind, downs[0]), p2Pokemon: roster(kind, downs[1]),
  ...extra,
});

describe.each(['singles', 'doubles'] as const)('variationBoardShares, %s', kind => {
  const total = 2 * BODIES[kind];

  test('every executed turn names the share of the board it ended on, at the turn that board opens', () => {
    const history = [entry(kind, [1, 0]), entry(kind, [2, 1]), entry(kind, [3, 2])];
    const shares = variationBoardShares(history, 4);
    // The shared prefix (turn 4 and before) has no variation board: only the main line stands there.
    expect(shares.slice(0, 4)).toEqual([null, null, null, null]);
    expect(shares[4]).toBeCloseTo(1 / total);
    expect(shares[5]).toBeCloseTo(3 / total);
    expect(shares[6]).toBeCloseTo(5 / total);
    expect(shares).toHaveLength(7);
  });

  test('a forced replacement consumes no turn: the board after it is the position before the next turn', () => {
    const history = [
      entry(kind, [1, 0]),
      entry(kind, [1, 1], { kind: 'forced', forcedSide: 'p2' }),
      entry(kind, [2, 1]),
    ];
    const shares = variationBoardShares(history, 4);
    expect(shares[4]).toBeCloseTo(2 / total);
    expect(shares[5]).toBeCloseTo(3 / total);
    expect(shares).toHaveLength(6);
  });

  test('a lead variation starts at turn 0 and its first entry opens turn 1', () => {
    const shares = variationBoardShares([entry(kind, [0, 0]), entry(kind, [0, 1])], 0);
    expect(shares[0]).toBe(0);
    expect(shares[1]).toBeCloseTo(1 / total);
  });

  test('a board with a body at 0 HP but no fainted flag counts as down, like the engine\'s phase measure', () => {
    const half = entry(kind, [0, 0], { p1Pokemon: [pokemon('Low', { hp: 0 }), ...roster(kind, 0).slice(1)] });
    expect(variationBoardShares([half], 2)[2]).toBeCloseTo(1 / total);
  });

  test('an entry without rosters leaves its turn unknown instead of inventing a share', () => {
    const blank = entry(kind, [0, 0], { p1Pokemon: [], p2Pokemon: [] });
    expect(variationBoardShares([blank], 2)[2]).toBeNull();
  });
});
