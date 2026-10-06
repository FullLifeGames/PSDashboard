import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 64 (T123): the report's sentence remnants, one describe per point, each
 * in the shape of its feedback-base turn (singles and doubles where both apply).
 */

const choice = (choiceStr: string, label: string, ev: number, worstCase = ev): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: ev, ev, punishedBy: 'Reply' });

const names: [string, string] = ['Alpha', 'Beta'];

describe('point 2: the forced win names its unit', () => {
  const forcedSummary = (forcedWin: NonNullable<EvalResult['forcedWin']>, score: number, doubles = false) => summarizeTurn(analyzeTurn({
    turn: 24,
    result: {
      score, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [choice(doubles ? 'move 1 1, move 2 2' : 'move hydropump', doubles ? 'Tera Starstorm + Earth Power' : 'Hydro Pump', 0.8)],
        p2: [choice(doubles ? 'move 1 1, move 1 2' : 'move roost', doubles ? 'Protect + Body Press' : 'Roost', -0.8)],
      },
      forcedWin,
    },
    played: null, playedOutcome: null, scoreBefore: score, scoreAfter: null, playedTracking: !doubles,
  }), names);

  test('singles (649664 t24): "wins within 5 turns", the open event and the caveat as before', () => {
    const summary = forcedSummary({
      side: 'p1', turns: 5, mass: 0.8, caveat: 'barring-crit', engineScore: 0.8, states: 40,
      open: { side: 'p1', moveId: 'hydropump', label: 'Hydro Pump', odds: 0.8, kind: 'hit' },
    }, 0.7875);
    expect(summary).toContain('Alpha wins within 5 turns against every reply if the 80% Hydro Pump lands, barring a crit.');
    expect(summary).not.toMatch(/wins in \d/);
  });

  test('doubles (2630685175 t7): one turn reads "within 1 turn"', () => {
    const summary = forcedSummary({ side: 'p1', turns: 1, mass: 1, caveat: 'sampled-rolls', engineScore: 1, states: 6 }, 1, true);
    expect(summary).toContain('Alpha wins within 1 turn against every reply on the sampled rolls.');
  });
});
