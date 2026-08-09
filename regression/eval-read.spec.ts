import { test, expect } from '@playwright/test';
import { rankFromMatrix, toResult, type ValueMatrix } from '../src/lib/eval/rank';
import { computeRead, modelOpponent, parseTendencies, READ_CONFIDENCE, READ_LAMBDA } from '../src/lib/eval/opponent-model';

/**
 * The exploitative Read lens: a boundedly-rational opponent model (softmax
 * over their own EVs, RNR-mixed with the equilibrium) and a best response
 * over the ALREADY-SOLVED matrix. Values are wp-units (p1 perspective).
 */

const option = (choice: string, label: string) => ({ choice, label });

// The Flying-switch shape: p2 very likely clicks Earthquake (their high-EV
// column vs most of p1's rows); p1's exploit row (switch Noivern) crushes
// Earthquake but loses to the rarely-clicked Ice Beam. Equilibrium prefers
// the safe row.
const matrix: ValueMatrix = {
  p1Options: [option('move stay', 'Stay'), option('switch 3', '→ Noivern')],
  p2Options: [option('move earthquake', 'Earthquake'), option('move icebeam', 'Ice Beam')],
  values: [
    [-0.20, -0.02], // Stay: EQ chips it hard, Ice Beam barely — EQ is p2's obvious click
    [0.60, -0.50],  // Noivern: wins big vs EQ, loses big vs Ice Beam
  ],
  ended: [[false, false], [false, false]],
};

test.describe('opponent model and read solve', () => {
  test('the softmax base concentrates on the opponent high-EV column', () => {
    const ranked = rankFromMatrix(matrix, 0);
    const solved = toResult(ranked, 1).matrix!;
    const model = modelOpponent(solved, 'p1');
    // From p2's view Earthquake dominates vs the equilibrium-heavy Stay row.
    const eqIndex = 0;
    expect(model.probs[eqIndex]).toBeGreaterThan(0.5);
    expect(model.probs.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 8);
    // The attached mixes are probability distributions.
    expect(solved.mixes.p1.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 8);
    expect(solved.mixes.p2.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 8);
    // Machine-readable choice ids ride along, aligned with the label arrays.
    expect(solved.p1Choices).toEqual(['move stay', 'switch 3']);
    expect(solved.p2Choices).toEqual(['move earthquake', 'move icebeam']);
  });

  test('a confident model flips the recommendation to the exploit row', () => {
    const ranked = rankFromMatrix(matrix, 0);
    const result = toResult(ranked, 1);
    const read = computeRead(result.matrix!, 'p1');
    // Equilibrium prefers Stay; the read backs the Noivern switch.
    expect(result.perSide.p1[0].label).toBe('Stay');
    expect(read).not.toBeNull();
    expect(read!.choice.label).toBe('→ Noivern');
    expect(read!.choice.choiceId).toBe('switch 3');
    expect(read!.net).toBeGreaterThan(0);
    expect(read!.confidence).toBeGreaterThanOrEqual(READ_CONFIDENCE);
    const eqEntry = read!.breakdown.find(entry => entry.label === 'Earthquake');
    expect(eqEntry?.value).toBeCloseTo(0.6, 8);
  });

  test('an unconfident model yields no read', () => {
    // The opponent's options are interchangeable: nothing to concentrate on.
    const flat: ValueMatrix = {
      p1Options: matrix.p1Options,
      p2Options: matrix.p2Options,
      values: [[0.1, 0.1], [-0.2, -0.2]],
      ended: [[false, false], [false, false]],
    };
    const ranked = rankFromMatrix(flat, 0);
    expect(computeRead(toResult(ranked, 1).matrix!, 'p1')).toBeNull();
  });

  test('parseTendencies counts action kinds from the protocol', () => {
    const log = [
      '|start',
      '|switch|p1a: A|Snorlax, M|100/100', '|switch|p2a: B|Garchomp, F|100/100',
      '|turn|1', '|move|p2a: B|Earthquake|p1a: A',
      '|turn|2', '|move|p2a: B|Earthquake|p1a: A',
      '|turn|3', '|switch|p2a: C|Rotom-Wash|100/100',
      '|turn|4', '|move|p2a: C|Volt Switch|p1a: A',
    ].join('\n');
    const tendencies = parseTendencies(log, 'p2');
    expect(tendencies.attackRate).toBeCloseTo(0.75, 8);
    expect(tendencies.switchRate).toBeCloseTo(0.25, 8);
    // Earthquake repeated once in three move turns' two repeat chances.
    expect(tendencies.repeatBias).toBeGreaterThan(0);
  });

  test('parseTendencies ignores forced replacement switches after a faint', () => {
    // p2 never chooses to switch: B faints before acting and C is the forced
    // replacement. Counting it would fabricate a switch tendency.
    const log = [
      '|start',
      '|switch|p1a: A|Snorlax, M|100/100', '|switch|p2a: B|Garchomp, F|100/100',
      '|turn|1',
      '|move|p1a: A|Ice Beam|p2a: B',
      '|-damage|p2a: B|0 fnt',
      '|faint|p2a: B',
      '|switch|p2a: C|Rotom-Wash|100/100',
      '|turn|2',
      '|move|p1a: A|Tackle|p2a: C',
      '|move|p2a: C|Volt Switch|p1a: A',
      '|turn|3',
    ].join('\n');
    const tendencies = parseTendencies(log, 'p2');
    expect(tendencies.switchRate).toBe(0);
    expect(tendencies.attackRate).toBe(1);
  });

  test('lambda keeps the model anchored to the equilibrium', () => {
    expect(READ_LAMBDA).toBeGreaterThan(0);
    expect(READ_LAMBDA).toBeLessThan(1);
    const ranked = rankFromMatrix(matrix, 0);
    const model = modelOpponent(toResult(ranked, 1).matrix!, 'p1');
    // No probability collapses fully to zero while λ > 0.
    for (const p of model.probs) expect(p).toBeGreaterThan(0);
  });
});
