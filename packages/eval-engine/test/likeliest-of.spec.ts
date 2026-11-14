import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { chipShown, likeliestOf } from '../src/dice/likeliest';
import type { DieName, Draw, ForcedDie } from '../src/dice/types';

/**
 * Round 89 (#104), step G2: the rule of the likeliest result, die by die, on the draws the simulator makes. The sweep
 * (likeliest-dice-sweep.spec.ts) plays whole turns; these rows hold the boundaries: one half takes the event, a tie of results takes the
 * lower middle one, a draw with no range names none, and the chip rule of question 3a.
 */

const nobody = undefined as unknown as Battle;
const die = (kind: DieName['kind']): DieName => ({ slot: 'p1a', moveId: 'tackle', targetSlot: 'p2a', kind });
const chance = (numerator: number, from: number): Draw => ({ call: 'chance', numerator, from });
const resultOf = (kind: DieName['kind'], draw: Draw, gen = 9) => likeliestOf(die(kind), draw, nobody, gen);

describe('a chance die happens from one half up', () => {
  test.each([
    ['accuracy', chance(90, 100), true, 0.9], ['accuracy', chance(50, 100), true, 0.5], ['accuracy', chance(49, 100), false, 0.51],
    ['crit', chance(1, 24), false, 23 / 24], ['crit', chance(1, 2), true, 0.5], ['move-first', chance(1, 5), false, 0.8],
  ] as const)('%s at %j', (kind, draw, happens, share) => {
    const found = resultOf(kind, draw);
    expect(found?.die.result).toEqual({ happens });
    expect(found?.chance).toBeCloseTo(share, 9);
  });

  test('a secondary effect reads the chance the recognition put on the draw', () => {
    expect(resultOf('secondary', { call: 'random', from: 100, chance: 0.3 })?.die.result).toEqual({ happens: false });
    expect(resultOf('secondary', { call: 'random', from: 100, chance: 1 })?.die.result).toEqual({ happens: true });
  });

  test('a draw with no chance (the Gen 2 crit) does not happen, and says no chance', () => {
    const found = resultOf('crit', { call: 'random', from: 256 }, 2);
    expect(found?.die.result).toEqual({ happens: false });
    expect(found?.chance).toBeUndefined();
  });
});

describe('the damage roll and the hit count', () => {
  test('the middle step of the generation\'s rolls: 8 of 16, 19 of 39 in Gens 1 and 2', () => {
    expect(resultOf('damage-roll', { call: 'random', from: 16 })?.die.result).toEqual({ step: 8 });
    expect(resultOf('damage-roll', { call: 'random', from: 217, to: 256 }, 2)?.die.result).toEqual({ step: 19 });
  });

  test('a sample takes its likeliest count, a tie the lower middle one', () => {
    expect(resultOf('hit-count', { call: 'sample', items: [2, 2, 3, 3, 4, 5] })?.die.result).toEqual({ hits: 2 });
    expect(resultOf('hit-count', { call: 'sample', items: [2, 2, 2, 3, 3, 3, 4, 5] })?.die.result).toEqual({ hits: 2 });
    expect(resultOf('hit-count', { call: 'sample', items: [5, 5, 5, 2, 3] })?.die.result).toEqual({ hits: 5 });
    expect(resultOf('hit-count', { call: 'sample', items: [2, 3, 4] })?.die.result).toEqual({ hits: 3 });
  });

  test('a range takes its middle count; a draw with no range names none', () => {
    expect(resultOf('hit-count', { call: 'random', from: 2, to: 6 })?.die.result).toEqual({ hits: 3 });
    expect(resultOf('hit-count', { call: 'random', from: 2 })).toBeNull();
  });

  test('a pick takes the likeliest option', () => {
    expect(resultOf('ability-proc', { call: 'sample', items: ['slp', 'par', 'psn', 'par'] })?.die.result).toEqual({ option: 'par' });
  });
});

describe('which dice earn a chip (ruling 33, question 3a)', () => {
  const forced = (kind: DieName['kind'], result: ForcedDie['result']): ForcedDie => ({ name: die(kind), result });

  test('an event that happens below one in one, a status check, a speed tie and a hit count show', () => {
    expect(chipShown(forced('accuracy', { happens: true }), 0.8, false)).toBe(true);
    expect(chipShown(forced('secondary', { happens: true }), 0.7, false)).toBe(true);
    expect(chipShown(forced('crit', { happens: true }), 0.5, false)).toBe(true);
    expect(chipShown(forced('status-check', { happens: true }), 0.75, false)).toBe(true);
    expect(chipShown(forced('speed-tie', { first: 'p1a' }), undefined, false)).toBe(true);
    expect(chipShown(forced('hit-count', { hits: 2 }), 0.33, false)).toBe(true);
  });

  test('a sure hit, an effect that does not land, a crit that does not come and a roll that decides nothing do not', () => {
    expect(chipShown(forced('accuracy', { happens: true }), 1, false)).toBe(false);
    expect(chipShown(forced('secondary', { happens: false }), 0.9, false)).toBe(false);
    expect(chipShown(forced('crit', { happens: false }), 0.96, false)).toBe(false);
    expect(chipShown(forced('damage-roll', { step: 8 }), undefined, false)).toBe(false);
  });

  test('a roll that decides a knock-out shows', () => {
    expect(chipShown(forced('damage-roll', { step: 8 }), 9 / 16, true)).toBe(true);
  });
});
