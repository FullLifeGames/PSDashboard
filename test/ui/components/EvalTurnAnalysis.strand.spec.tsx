import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { summarizeTurn } from '@fulllifegames/eval-engine';
import { EvalTurnAnalysis } from '../../../src/components/EvalTurnAnalysis';
import { misplayedSide, turnAnalysis } from '../fixtures/analysis';

/**
 * Round 89 (T322, #59), block 2 stage 5: the card says it when the strand round softened a grade. The sentence sits in the
 * explanation under the toggle, next to the decision note it qualifies; a side without a strand has no such sentence. Singles
 * (the move comes from the side's own choice) and doubles (the key names the move) both.
 */
const names: [string, string] = ['Alice', 'Bob'];
const SENTENCE = /first priced the \d+% .* roughly; searched in full, the played line holds up better there\./;

const softened = (kind: 'singles' | 'doubles') => turnAnalysis(9, {
  attribution: 'p1-decision', swing: -0.1, decisionDelta: -0.1, chanceDelta: 0,
  p1: misplayedSide('mistake', {
    tier: 'inaccuracy',
    strand: kind === 'singles'
      ? { role: 'P', classKey: 'hit-nokill+par', chance: 0.1, column: 'Leech Seed', tier: 'inaccuracy', from: 'mistake', dice: [{ kind: 'effect', move: 'Stone Edge', effect: 'paralysis' }] }
      : { role: 'P', classKey: 'p1b:flareblitz>p2a=hit-nokill+brn', chance: 0.1, column: 'Tackle + Protect', tier: 'inaccuracy', from: 'mistake', dice: [{ kind: 'effect', move: 'Flare Blitz', effect: 'burn' }] },
  }),
});

describe('EvalTurnAnalysis with a softened grade', () => {
  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: the explanation names the die and its chance, and opens under the toggle`, async () => {
      const analysis = softened(kind);
      render(<EvalTurnAnalysis analysis={analysis} playerNames={names} />);
      const summary = screen.getByText(SENTENCE, { exact: false });
      expect(summary).toHaveTextContent(summarizeTurn(analysis, names));
      expect(summary).toHaveTextContent(kind === 'singles'
        ? "Alice's mistake softens to an inaccuracy: against Leech Seed, the engine first priced the 10% paralysis from Stone Edge roughly"
        : "Alice's mistake softens to an inaccuracy: against Tackle + Protect, the engine first priced the 10% burn from Flare Blitz roughly");
      expect(summary).not.toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: /Explanation/ }));
      expect(summary).toBeVisible();
    });
  }

  test('a side without a strand has no such sentence', () => {
    const analysis = turnAnalysis(9, { attribution: 'p1-decision', swing: -0.1, decisionDelta: -0.1, chanceDelta: 0, p1: misplayedSide('mistake') });
    render(<EvalTurnAnalysis analysis={analysis} playerNames={names} />);
    expect(screen.queryByText(SENTENCE, { exact: false })).not.toBeInTheDocument();
  });
});
