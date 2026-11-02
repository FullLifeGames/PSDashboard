import { describe, expect, test } from 'vitest';
import { hitBarSegments, hpBarClass } from '../../../src/lib/hit-bar';

/**
 * Round 84 (turn dock), lane A: the bar under a target shows what a hit does to its HP. `rest` is what surely stays (after the
 * highest damage roll, grey), `roll` what the roll decides (striped), `sure` what the lowest roll surely takes, lost what the
 * target has lost already. The four parts add up to the bar's 100 %. Variant F (A7b): `tone` is the colour of the hit's parts,
 * the share of the target's present HP that the lowest roll takes: over 50 green, over 20 yellow, else red.
 */
const total = (bar: ReturnType<typeof hitBarSegments>) => bar.rest + bar.roll + bar.sure + bar.lost;

describe('hitBarSegments', () => {
  test('full HP, a roll of 20 to 35 %', () => {
    const bar = hitBarSegments(100, 20, 35);
    expect(bar).toMatchObject({ rest: 65, roll: 15, sure: 20, lost: 0, tone: 'red' });
    expect(total(bar)).toBe(100);
  });

  test('wounded target: the lost part stays empty on the right', () => {
    const bar = hitBarSegments(60, 10, 25);
    expect(bar).toMatchObject({ rest: 35, roll: 15, sure: 10, lost: 40 });
    expect(total(bar)).toBe(100);
  });

  test('a hit that cannot knock out keeps no striped part when both rolls agree', () => {
    expect(hitBarSegments(100, 30, 30)).toMatchObject({ rest: 70, roll: 0, sure: 30 });
  });

  test('damage beyond the HP left clamps at the HP: a sure knock out leaves nothing solid', () => {
    const ko = hitBarSegments(40, 55, 70);
    expect(ko).toMatchObject({ rest: 0, roll: 0, sure: 40, lost: 60, tone: 'green' });
    expect(total(ko)).toBe(100);
  });

  test('a roll that may knock out: the striped part reaches the left edge', () => {
    const maybe = hitBarSegments(40, 30, 55);
    expect(maybe).toMatchObject({ rest: 0, roll: 10, sure: 30, lost: 60, tone: 'green' });
  });

  test('no damage (a status move or an immune target) leaves the bar at the HP', () => {
    expect(hitBarSegments(80, 0, 0)).toMatchObject({ rest: 80, roll: 0, sure: 0, lost: 20 });
  });

  test('the colour reads the share of the target HP that the lowest roll takes: over 50 green, over 20 yellow, else red', () => {
    expect(hitBarSegments(100, 51, 60).tone).toBe('green');
    expect(hitBarSegments(100, 50, 60).tone).toBe('yellow');
    expect(hitBarSegments(100, 21, 30).tone).toBe('yellow');
    expect(hitBarSegments(100, 20, 30).tone).toBe('red');
    expect(hitBarSegments(100, 0, 90).tone).toBe('red');
  });

  test('a sure knock out is all green, whatever HP the target had', () => {
    for (const hp of [100, 48, 30, 5]) expect(hitBarSegments(hp, hp + 10, hp + 30).tone).toBe('green');
    expect(hitBarSegments(30, 30, 30).tone).toBe('green');
  });

  test('the five tiles of the design page (variant F)', () => {
    // Close Combat, Earth Power, Ice Beam at full HP, Iron Head at 48 %, Freeze-Dry at 30 %: the lowest roll against the HP left.
    expect(hitBarSegments(100, 112, 132).tone).toBe('green');
    expect(hitBarSegments(100, 58, 69).tone).toBe('green');
    expect(hitBarSegments(100, 28, 33).tone).toBe('yellow');
    expect(hitBarSegments(48, 4, 5).tone).toBe('red');
    expect(hitBarSegments(30, 12, 14).tone).toBe('yellow');
  });

  test('a target at 30 %: 12 of its 30 is 40 %, so yellow, though 12 % of the full HP would read red', () => {
    expect(hitBarSegments(30, 12, 14)).toMatchObject({ rest: 16, roll: 2, sure: 12, lost: 70, tone: 'yellow' });
  });

  test('odd input stays inside the bar', () => {
    for (const [hp, lo, hi] of [[120, -5, 10], [-3, 5, 9], [50, 60, 20], [Number.NaN, 1, 2], [50, Number.NaN, 30]] as const) {
      const bar = hitBarSegments(hp, lo, hi);
      for (const part of [bar.rest, bar.roll, bar.sure, bar.lost]) expect(part).toBeGreaterThanOrEqual(0);
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
