import { describe, expect, test } from 'vitest';
import { forcedWinInput, PROVER_NEAR_TIE } from '../src/search/forced-win-apply';
import type { EvalResult, EvalSettings, RankedChoice } from '../src/types';

/**
 * Round 67 (T134): the prover tries its root candidates in the ranking's
 * order, the top three of them. Two estimates of one root (the app's verify
 * step and the Monte-Carlo re-merge, round 64 lane C) can rank near-tied
 * rows in either order, and at 653785 t24 round 64's reference proved a win
 * on a reordered root that the official order never tried. Rows within
 * PROVER_NEAR_TIE of the top of their group now go to the prover in an
 * order-fixed way (by label), so noise inside a near tie cannot change
 * which candidates it tries.
 */

const settings: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: false };
const row = (label: string, choice: string, ev: number): RankedChoice => ({ label, choice, ev, worstCase: ev, expected: ev, punishedBy: null });
const result = (rows: RankedChoice[]): EvalResult => ({ score: 0, interval: 0, depthCompleted: 1, perSide: { p1: rows, p2: [] } });

describe('the prover’s root order across near ties (round 67, T134)', () => {
  test('two rankings that differ only inside a near tie give the prover one root order (653785 t24)', () => {
    // The official ranking of 653785 t24 on the round-67 board (probe lanes/B/mc-oracle, RANKS=1): U-turn and Hidden
    // Power Ice stand 0.0017 apart. The second ranking is a noise-sized estimate of the same root with the two swapped
    // (every value moved by less than 0.016), the kind of reordering behind round 64's proof.
    const official = result([
      row('Hurricane', 'move hurricane', 0.1764), row('U-turn', 'move uturn', -0.0136), row('Hidden Power Ice', 'move hiddenpower', -0.0153),
      row('→ Cofagrigus', 'switch 4', -0.0329), row('Knock Off', 'move knockoff', -0.0359), row('→ Volcanion', 'switch 3', -0.1073),
    ]);
    const swapped = result([
      row('Hurricane', 'move hurricane', 0.1915), row('Hidden Power Ice', 'move hiddenpower', -0.0130), row('U-turn', 'move uturn', -0.0134),
      row('→ Cofagrigus', 'switch 4', -0.0332), row('Knock Off', 'move knockoff', -0.0358), row('→ Volcanion', 'switch 3', -0.1069),
    ]);
    expect(forcedWinInput(swapped, settings).rootOrder.p1.slice(0, 3)).toEqual(forcedWinInput(official, settings).rootOrder.p1.slice(0, 3));
  });

  test('rows further apart than the band keep the ranking order', () => {
    const ranked = result([row('B', 'move b', 0.3), row('A', 'move a', 0.3 - 2 * PROVER_NEAR_TIE), row('C', 'move c', 0.3 - 4 * PROVER_NEAR_TIE)]);
    expect(forcedWinInput(ranked, settings).rootOrder.p1).toEqual(['move b', 'move a', 'move c']);
  });

  test('a near tie goes by label from the top of its group, and the group ends one band below its top', () => {
    const ranked = result([
      row('Z', 'move z', 0.1), row('Y', 'move y', 0.1 - PROVER_NEAR_TIE / 2), row('X', 'move x', 0.1 - 0.9 * PROVER_NEAR_TIE),
      row('W', 'move w', 0.1 - 1.4 * PROVER_NEAR_TIE),
    ]);
    // W sits within one band of X but more than one band below the group's top Z: it starts a group of its own.
    expect(forcedWinInput(ranked, settings).rootOrder.p1).toEqual(['move x', 'move y', 'move z', 'move w']);
  });
});
