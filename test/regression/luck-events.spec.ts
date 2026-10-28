import { test, expect, describe } from 'vitest';
import { hasLuckAgainst, luckAgainstFavored } from './luck-events';

const LOG = [
  '|turn|3',
  '|move|p1a: Garchomp|Earthquake|p2a: Toxapex',
  '|-crit|p2a: Toxapex',
  '|turn|4',
  '|move|p2a: Toxapex|Scald|p1a: Garchomp',
  '|-miss|p2a: Toxapex|p1a: Garchomp',
  '|turn|5',
  '|cant|p1a: Garchomp|par',
  '|cant|p2a: Toxapex|slp',
  '|turn|6',
  '|move|p2a: Toxapex|Scald|p1a: Garchomp',
  '|-crit|p1a: Garchomp',
  '|cant|p1a: Garchomp|flinch',
].join('\n');

describe('luck events against the favored side (round 34)', () => {
  test('counts crits taken, own misses, and para/freeze/flinch skips from the sample turn on', () => {
    expect(luckAgainstFavored(LOG, 4, 'p1')).toEqual({ crit: 1, miss: 0, cant: 2 });
    expect(luckAgainstFavored(LOG, 4, 'p2')).toEqual({ crit: 0, miss: 1, cant: 0 });
    expect(luckAgainstFavored(LOG, 3, 'p2')).toEqual({ crit: 1, miss: 1, cant: 0 });
  });
  test('a sleep skip is no luck event and the window starts at the turn line', () => {
    expect(luckAgainstFavored(LOG, 6, 'p1')).toEqual({ crit: 1, miss: 0, cant: 1 });
    expect(hasLuckAgainst({ crit: 0, miss: 0, cant: 0 })).toBe(false);
    expect(hasLuckAgainst({ crit: 0, miss: 1, cant: 0 })).toBe(true);
  });
  test('doubles: both slots of the favored side count', () => {
    const doubles = ['|turn|2', '|-crit|p1b: Incineroar', '|-miss|p1a: Flutter Mane|p2b: Amoonguss', '|cant|p1b: Incineroar|frz'].join('\n');
    expect(luckAgainstFavored(doubles, 2, 'p1')).toEqual({ crit: 1, miss: 1, cant: 1 });
    expect(luckAgainstFavored(doubles, 2, 'p2')).toEqual({ crit: 0, miss: 0, cant: 0 });
  });
  test('a missing turn line means the whole log counts', () => {
    expect(luckAgainstFavored(LOG, 99, 'p2')).toEqual({ crit: 1, miss: 1, cant: 0 });
    expect(luckAgainstFavored(LOG, 99, 'p1')).toEqual({ crit: 1, miss: 0, cant: 2 });
  });
});
