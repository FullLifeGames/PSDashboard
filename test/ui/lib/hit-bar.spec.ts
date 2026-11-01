import { describe, expect, test } from 'vitest';
import { hitBarSegments, hpBarClass } from '../../../src/lib/hit-bar';

/**
 * Round 84 (turn dock), lane A: the bar under a target shows what a hit does to its HP. Solid is what surely stays (after the
 * highest damage roll), striped what the roll decides, ghost what the lowest roll surely takes, lost what the target has lost
 * already. The four parts add up to the bar's 100 %. The colour follows the HP left after the highest roll.
 */
const total = (bar: ReturnType<typeof hitBarSegments>) => bar.solid + bar.striped + bar.ghost + bar.lost;

describe('hitBarSegments', () => {
  test('full HP, a roll of 20 to 35 %', () => {
    const bar = hitBarSegments(100, 20, 35);
    expect(bar).toMatchObject({ solid: 65, striped: 15, ghost: 20, lost: 0, tone: 'green' });
    expect(total(bar)).toBe(100);
  });

  test('wounded target: the lost part stays empty on the right', () => {
    const bar = hitBarSegments(60, 10, 25);
    expect(bar).toMatchObject({ solid: 35, striped: 15, ghost: 10, lost: 40 });
    expect(total(bar)).toBe(100);
  });

  test('a hit that cannot knock out keeps no striped part when both rolls agree', () => {
    expect(hitBarSegments(100, 30, 30)).toMatchObject({ solid: 70, striped: 0, ghost: 30 });
  });

  test('damage beyond the HP left clamps at the HP: a sure knock out leaves nothing solid', () => {
    const ko = hitBarSegments(40, 55, 70);
    expect(ko).toMatchObject({ solid: 0, striped: 0, ghost: 40, lost: 60, tone: 'red' });
    expect(total(ko)).toBe(100);
  });

  test('a roll that may knock out: the striped part reaches the left edge', () => {
    const maybe = hitBarSegments(40, 30, 55);
    expect(maybe).toMatchObject({ solid: 0, striped: 10, ghost: 30, lost: 60, tone: 'red' });
  });

  test('no damage (a status move or an immune target) leaves the bar at the HP', () => {
    expect(hitBarSegments(80, 0, 0)).toMatchObject({ solid: 80, striped: 0, ghost: 0, lost: 20, tone: 'green' });
  });

  test('the colour reads the HP left after the highest roll: above 50 green, above 20 yellow, else red', () => {
    expect(hitBarSegments(100, 10, 40).tone).toBe('green');
    expect(hitBarSegments(100, 10, 50).tone).toBe('yellow');
    expect(hitBarSegments(100, 10, 79).tone).toBe('yellow');
    expect(hitBarSegments(100, 10, 80).tone).toBe('red');
    expect(hitBarSegments(100, 10, 60).tone).toBe('yellow');
    expect(hitBarSegments(100, 10, 49).tone).toBe('green');
  });

  test('odd input stays inside the bar', () => {
    for (const [hp, lo, hi] of [[120, -5, 10], [-3, 5, 9], [50, 60, 20], [Number.NaN, 1, 2], [50, Number.NaN, 30]] as const) {
      const bar = hitBarSegments(hp, lo, hi);
      for (const part of [bar.solid, bar.striped, bar.ghost, bar.lost]) expect(part).toBeGreaterThanOrEqual(0);
      expect(total(bar)).toBeCloseTo(100);
    }
  });
});

describe('hpBarClass', () => {
  test('the class names of the app\'s HP colours', () => {
    expect([hpBarClass(100), hpBarClass(51), hpBarClass(50), hpBarClass(21), hpBarClass(20), hpBarClass(0)]).toEqual([
      'ps-hpbar-green', 'ps-hpbar-green', 'ps-hpbar-yellow', 'ps-hpbar-yellow', 'ps-hpbar-red', 'ps-hpbar-red',
    ]);
  });
});
