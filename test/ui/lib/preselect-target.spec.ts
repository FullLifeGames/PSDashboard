import { describe, expect, test } from 'vitest';
import { moveOption, targetOption } from '../fixtures/sim-state';
import { preselectTarget } from '../../../src/lib/preselect-target';

/**
 * Round 84 (turn dock), lane A: a move that needs a target in doubles opens with one target chosen, so a pick takes one click.
 * The rule: the played target for the played move, else the foe the move hurts most (the highest damage roll), else the first
 * target the move lists.
 */
const move = moveOption('Flare Blitz', {
  requiresTarget: true,
  targetOptions: [targetOption('p2', 0, 'Rillaboom', 1), targetOption('p2', 1, 'Tornadus', 2), targetOption('p1', 1, 'Amoonguss', -2)],
});

describe('preselectTarget', () => {
  test('the foe with the highest maximum damage', () => {
    expect(preselectTarget(move, 'p1', { damage: { P2A: { maxPercent: 30 }, P2B: { maxPercent: 55 } } })).toBe(2);
    expect(preselectTarget(move, 'p1', { damage: { P2A: { maxPercent: 80 }, P2B: { maxPercent: 55 } } })).toBe(1);
  });

  test('a partner with a higher number never wins: only foes compete', () => {
    expect(preselectTarget(move, 'p1', { damage: { P2A: { maxPercent: 10 }, P2B: { maxPercent: 12 }, P1B: { maxPercent: 90 } } })).toBe(2);
  });

  test('equal numbers keep the first foe', () => {
    expect(preselectTarget(move, 'p1', { damage: { P2A: { maxPercent: 40 }, P2B: { maxPercent: 40 } } })).toBe(1);
  });

  test('without numbers the first listed target', () => {
    expect(preselectTarget(move, 'p1')).toBe(1);
    expect(preselectTarget(move, 'p1', { damage: {} })).toBe(1);
    expect(preselectTarget(move, 'p1', { damage: { P2A: undefined } })).toBe(1);
  });

  test('a foe without a number loses to a foe with one', () => {
    expect(preselectTarget(move, 'p1', { damage: { P2B: { maxPercent: 5 } } })).toBe(2);
  });

  test('side two reads its own foes', () => {
    const other = moveOption('Wood Hammer', {
      requiresTarget: true,
      targetOptions: [targetOption('p1', 0, 'Incineroar', 1), targetOption('p1', 1, 'Amoonguss', 2), targetOption('p2', 1, 'Tornadus', -2)],
    });
    expect(preselectTarget(other, 'p2', { damage: { P1A: { maxPercent: 20 }, P1B: { maxPercent: 70 }, P2B: { maxPercent: 99 } } })).toBe(2);
  });

  test('the played target wins for the played move, when the move lists it', () => {
    expect(preselectTarget(move, 'p1', { damage: { P2A: { maxPercent: 80 }, P2B: { maxPercent: 55 } }, playedLoc: 2 })).toBe(2);
    expect(preselectTarget(move, 'p1', { playedLoc: -2 })).toBe(-2);
    // a loc the move does not list falls back on the rule
    expect(preselectTarget(move, 'p1', { damage: { P2A: { maxPercent: 80 } }, playedLoc: 5 })).toBe(1);
    expect(preselectTarget(move, 'p1', { playedLoc: null })).toBe(1);
  });

  test('a move with no target options has nothing to preselect (singles, spread and self moves)', () => {
    expect(preselectTarget(moveOption('Earthquake'), 'p1', { damage: { P2A: { maxPercent: 50 } }, playedLoc: 1 })).toBeUndefined();
  });

  test('only allies listed: the first listed target', () => {
    const heal = moveOption('Helping Hand', { requiresTarget: true, targetOptions: [targetOption('p1', 1, 'Amoonguss', -2)] });
    expect(preselectTarget(heal, 'p1', { damage: { P1B: { maxPercent: 0 } } })).toBe(-2);
  });
});
