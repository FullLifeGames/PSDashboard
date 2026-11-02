import { describe, expect, test } from 'vitest';
import type { DamageResult } from '@fulllifegames/eval-engine';
import { tileBars, tileTarget } from '../../../src/lib/dock-tile';
import { moveOption, targetOption } from '../fixtures/sim-state';

/** Round 84 (turn dock): the bars under a move tile and the target a tile click takes. */
const result = (minPercent: number, maxPercent: number, koChance = ''): DamageResult =>
  ({ moveName: 'Flare Blitz', minPercent, maxPercent, range: `${minPercent}% - ${maxPercent}%`, koChance });

const targeted = moveOption('Flare Blitz', {
  slot: 2, requiresTarget: true,
  targetOptions: [targetOption('p2', 0, 'Rillaboom', 1), targetOption('p2', 1, 'Tornadus', 2), targetOption('p1', 1, 'Amoonguss', -2)],
});
const NONE = { dmg: undefined, spread: undefined, targets: {}, hpByLabel: {}, foeHp: undefined };

describe('tileTarget', () => {
  test('the played target wins for the played move, else the foe hit hardest, else the first listed', () => {
    const targets = { '2:1': result(10, 20), '2:2': result(40, 60), '2:-2': result(90, 100) };
    expect(tileTarget(targeted, 'p1', targets, 1)).toBe(1);
    expect(tileTarget(targeted, 'p1', targets, null)).toBe(2);
    expect(tileTarget(targeted, 'p1', {}, null)).toBe(1);
  });
  test('a move with no target options has none', () => {
    expect(tileTarget(moveOption('Earthquake'), 'p1', {}, null)).toBeUndefined();
  });
});

describe('tileBars', () => {
  test('a targeted move shows one bar, for the chosen target, else the preselected one', () => {
    const args = { ...NONE, move: targeted, side: 'p1' as const, targets: { '2:1': result(10, 20), '2:2': result(40, 60, '35% chance to 2HKO after Leftovers recovery') }, playedLoc: null };
    const preselected = tileBars({ ...args, chosenLoc: undefined });
    expect(preselected).toHaveLength(1);
    expect(preselected[0]).toMatchObject({ label: 'P2B', hp: 100, min: 40, max: 60, range: '40-60%', ko: '35% 2HKO' });
    expect(tileBars({ ...args, chosenLoc: 1 })[0]).toMatchObject({ label: 'P2A', min: 10, max: 20 });
  });

  test('a spread move shows one bar per row, each against that body\'s HP', () => {
    const spread = [{ label: 'P2A', result: result(30, 36) }, { label: 'P2B', result: result(30, 36) }, { label: 'P1B', result: result(25, 30) }];
    const bars = tileBars({ ...NONE, move: moveOption('Earthquake'), side: 'p1', spread, hpByLabel: { P2A: 100, P2B: 40, P1B: 80 }, chosenLoc: undefined, playedLoc: null });
    expect(bars.map(bar => [bar.label, bar.hp])).toEqual([['P2A', 100], ['P2B', 40], ['P1B', 80]]);
  });

  test('a singles move shows one bar against the foe, with no label', () => {
    const bars = tileBars({ ...NONE, move: moveOption('Earthquake'), side: 'p1', dmg: result(45.2, 53.8), foeHp: 70, chosenLoc: undefined, playedLoc: null });
    expect(bars).toEqual([expect.objectContaining({ label: '', hp: 70, min: 45.2, max: 53.8, range: '45-54%' })]);
  });

  test('a move with no damage has no bar', () => {
    expect(tileBars({ ...NONE, move: moveOption('Protect'), side: 'p1', dmg: result(0, 0), chosenLoc: undefined, playedLoc: null })).toEqual([]);
    expect(tileBars({ ...NONE, move: targeted, side: 'p1', chosenLoc: 1, playedLoc: null })).toEqual([]);
  });
});
