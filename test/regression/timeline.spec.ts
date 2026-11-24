import { test, expect } from 'vitest';
import {
  classifyDeviation, keptEntries, normalizePosition, pointerAtFrame, sliderMax, variationCovers, variationTip,
  type TimelinePosition, type VariationSpan,
} from '../../src/lib/timeline';

const span: VariationSpan = { startTurn: 15, length: 3 }; // plays turns 15,16,17 → tip position 18

test('variationTip is the position after the last played entry', () => {
  expect(variationTip(span)).toBe(18);
});

test('variationCovers spans the positions AFTER the first variation move', () => {
  expect(variationCovers(span, 15)).toBe(false);
  expect(variationCovers(span, 16)).toBe(true);
  expect(variationCovers(span, 18)).toBe(true);
  expect(variationCovers(span, 19)).toBe(false);
  expect(variationCovers(null, 16)).toBe(false);
  expect(variationCovers({ startTurn: 15, length: 0 }, 16)).toBe(false);
});

test('sliderMax extends past the replay when the variation is longer', () => {
  expect(sliderMax(24, span)).toBe(24);
  expect(sliderMax(16, span)).toBe(18);
  expect(sliderMax(24, null)).toBe(24);
});

test('sliderMax stays at the replay end when a short play-out ends inside it', () => {
  expect(sliderMax(8, { startTurn: 1, length: 4 })).toBe(8);
  expect(sliderMax(8, { startTurn: 6, length: 2 })).toBe(8);
  expect(sliderMax(8, { startTurn: 6, length: 3 })).toBe(9);
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

test('a variation-line position the variation does not cover is the main line: a move there replaces', () => {
  const at = (turn: number): TimelinePosition => ({ turn, line: 'variation' });
  expect(classifyDeviation(span, at(19))).toBe('replace');
  expect(classifyDeviation(span, at(28))).toBe('replace');
  expect(classifyDeviation(span, at(10))).toBe('replace');
  expect(classifyDeviation(span, at(15))).toBe('replace');
  expect(classifyDeviation(span, at(18))).toBe('extend');
  expect(classifyDeviation(span, at(17))).toBe('truncate');
});

test('keptEntries counts the entries that survive a truncating deviation', () => {
  expect(keptEntries(span, { turn: 16, line: 'variation' })).toBe(1);
  expect(keptEntries(span, { turn: 18, line: 'variation' })).toBe(3);
});

test('pointerAtFrame names the variation position the frame shows, clamped to the covered turns', () => {
  expect(pointerAtFrame(null, span, false)).toBeNull();
  expect(pointerAtFrame(16, null, false)).toBeNull();
  expect(pointerAtFrame(16, { startTurn: 15, length: 0 }, false)).toBeNull();
  expect(pointerAtFrame(17, span, false)).toBe(17);
  expect(pointerAtFrame(18, span, false)).toBe(18);
  expect(pointerAtFrame(15, span, false)).toBe(16); // the start turn: the frame holds back |turn|16
  expect(pointerAtFrame(30, span, false)).toBe(18);
  expect(pointerAtFrame(0, { startTurn: 0, length: 3 }, false)).toBe(1);
});

test('pointerAtFrame gives an ended variation its tip once the frame stands on the last played turn', () => {
  expect(pointerAtFrame(17, span, true)).toBe(18); // tip - 1: the frame cannot report the end position itself
  expect(pointerAtFrame(18, span, true)).toBe(18);
  expect(pointerAtFrame(16, span, true)).toBe(16);
  expect(pointerAtFrame(15, { startTurn: 15, length: 1 }, true)).toBe(16);
});
