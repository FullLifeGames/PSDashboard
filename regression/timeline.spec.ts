import { expect, test } from '@playwright/test';
import {
  classifyDeviation, keptEntries, normalizePosition, sliderMax, variationCovers, variationTip,
  type TimelinePosition, type VariationSpan,
} from '../src/lib/timeline';

const span: VariationSpan = { startTurn: 15, length: 3 }; // plays turns 15,16,17 → tip position 18

test('variationTip is the position after the last played entry', () => {
  expect(variationTip(span)).toBe(18);
});

test('variationCovers spans the positions AFTER the first variation move', () => {
  expect(variationCovers(span, 15)).toBe(false); // before turn 15 = shared prefix
  expect(variationCovers(span, 16)).toBe(true);
  expect(variationCovers(span, 18)).toBe(true); // the tip
  expect(variationCovers(span, 19)).toBe(false);
  expect(variationCovers(null, 16)).toBe(false);
  expect(variationCovers({ startTurn: 15, length: 0 }, 16)).toBe(false);
});

test('sliderMax extends past the replay when the variation is longer', () => {
  expect(sliderMax(24, span)).toBe(24);
  expect(sliderMax(16, span)).toBe(18);
  expect(sliderMax(24, null)).toBe(24);
});

test('normalizePosition forces main outside coverage and variation past the replay end', () => {
  expect(normalizePosition({ turn: 10, line: 'variation' }, 24, span))
    .toEqual({ turn: 10, line: 'main' });
  expect(normalizePosition({ turn: 30, line: 'main' }, 24, span))
    .toEqual({ turn: 24, line: 'main' });
  const long: VariationSpan = { startTurn: 22, length: 5 }; // tip 27 > replayMax 24
  expect(normalizePosition({ turn: 26, line: 'main' }, 24, long))
    .toEqual({ turn: 26, line: 'variation' });
  expect(normalizePosition({ turn: 0, line: 'main' }, 24, null))
    .toEqual({ turn: 1, line: 'main' });
});

test('classifyDeviation implements the chess rules', () => {
  const at = (turn: number, line: 'main' | 'variation'): TimelinePosition => ({ turn, line });
  expect(classifyDeviation(null, at(10, 'main'))).toBe('open');
  expect(classifyDeviation({ startTurn: 15, length: 0 }, at(10, 'main'))).toBe('open');
  expect(classifyDeviation(span, at(18, 'variation'))).toBe('extend');
  expect(classifyDeviation(span, at(16, 'variation'))).toBe('truncate');
  expect(classifyDeviation(span, at(10, 'main'))).toBe('replace');
  expect(classifyDeviation(span, at(16, 'main'))).toBe('replace');
});

test('keptEntries counts the entries that survive a truncating deviation', () => {
  expect(keptEntries(span, { turn: 16, line: 'variation' })).toBe(1); // keep the turn-15 entry
  expect(keptEntries(span, { turn: 18, line: 'variation' })).toBe(3); // extend keeps all
});
