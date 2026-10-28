import { describe, expect, test } from 'vitest';
import { resultPositionLabel } from '../../../../src/components/eval/turn-copy';

// Round 77 (C6): the heading over a live result names the position the result was computed for. The tag
// ("main:<turn>", "variation:<turn>") is the same for singles and doubles; the game type does not change the label.
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
});
