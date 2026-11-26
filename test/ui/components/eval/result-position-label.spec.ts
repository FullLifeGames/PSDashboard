import { describe, expect, test } from 'vitest';
import { resultPositionLabel } from '../../../../src/components/eval/turn-copy';

describe('resultPositionLabel', () => {
  test('names the position of the result tag, not the one the pointer holds now', () => {
    expect(resultPositionLabel('variation:10', { viewTurn: 11, viewingVariation: true })).toBe('Turn 10 · variation');
    expect(resultPositionLabel('main:4', { viewTurn: 11, viewingVariation: true })).toBe('Turn 4 · main line');
    expect(resultPositionLabel('variation:2', { viewTurn: 2, viewingVariation: false })).toBe('Turn 2 · variation');
  });

  test('a result without a tag, or with an unknown one, falls back to the position on screen', () => {
    expect(resultPositionLabel(null, { viewTurn: 7, viewingVariation: true })).toBe('Turn 7 · variation');
    expect(resultPositionLabel('weird', { viewTurn: 7, viewingVariation: false })).toBe('Turn 7 · main line');
  });

  test.each([
    ['singles, a pivot on turn 1', 'variation:2', 1, 'Replacement after turn 1 · variation'],
    ['singles, a knock-out', 'variation:7', 6, 'Replacement after turn 6 · variation'],
    ['doubles, one slot replaces', 'variation:3', 2, 'Replacement after turn 2 · variation'],
    ['VGC Scarlet/Violet, both slots replace', 'variation:5', 4, 'Replacement after turn 4 · variation'],
    ['VGC Champions, both slots replace', 'variation:5', 4, 'Replacement after turn 4 · variation'],
    ['a replacement on the main line', 'main:5', 4, 'Replacement after turn 4 · main line'],
  ])('a result computed while a replacement was open names the turn the replay frame shows: %s', (_scene, tag, frameTurn, label) => {
    expect(Number(tag.split(':')[1])).toBe(frameTurn + 1);
    expect(resultPositionLabel(tag, { viewTurn: frameTurn + 1, viewingVariation: tag.startsWith('variation') }, true)).toBe(label);
  });

  test('the replacement flag belongs to the result: a screen that moved on keeps the result\'s heading, and no flag keeps the turn', () => {
    expect(resultPositionLabel('variation:5', { viewTurn: 6, viewingVariation: true }, true)).toBe('Replacement after turn 4 · variation');
    expect(resultPositionLabel('variation:5', { viewTurn: 5, viewingVariation: true }, false)).toBe('Turn 5 · variation');
    expect(resultPositionLabel(null, { viewTurn: 5, viewingVariation: true }, true)).toBe('Turn 5 · variation');
  });
});
