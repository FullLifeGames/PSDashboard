import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import { deniedEndSentence } from '../src/denied-end';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 64 (T123 point 3): a probability under 1 must never print as
 * certain. The near sentence called 99.5% a "sure KO" (Math.round to 100),
 * the denied-early-end sentence and chip could print "one 100% roll", and
 * the forced-win open event and sampled share could print "100%".
 */

const choice = (choiceStr: string, label: string, ev: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });

const names: [string, string] = ['Alpha', 'Beta'];

const summaryWith = (extra: Partial<EvalResult>, doubles = false) => summarizeTurn(analyzeTurn({
  turn: 21,
  result: {
    score: 0.6, interval: 0, depthCompleted: 1,
    perSide: {
      p1: [choice(doubles ? 'move 1 1, move 2 2' : 'move earthquake', doubles ? 'Earthquake + Protect' : 'Earthquake', 0.6)],
      p2: [choice(doubles ? 'move 1 1, move 1 2' : 'move roost', doubles ? 'Protect + Body Press' : 'Roost', -0.6)],
    },
    ...extra,
  },
  played: null, playedOutcome: null, scoreBefore: 0.6, scoreAfter: null, playedTracking: !doubles,
}), names);

const near = (odds: number) => ({ unanswered: { p1: [], p2: [], nearDecided: { side: 'p1' as const, species: 'Landorus-Therian', odds, removes: 'Excadrill' } } });

describe('point 3: a probability under 1 never reads as certain', () => {
  test('singles near sentence (648453 t21 shape): 99.5% is a 99% roll, only 1 is a sure KO', () => {
    expect(summaryWith(near(0.995))).toContain('Landorus-Therian is one 99% roll from clearing the rest');
    expect(summaryWith(near(0.995))).not.toContain('sure KO');
    expect(summaryWith(near(1))).toContain('Landorus-Therian is one sure KO from clearing the rest');
  });

  test('doubles near sentence (912045 t11 shape): the same rule', () => {
    expect(summaryWith(near(0.995), true)).toContain('is one 99% roll from clearing the rest');
    expect(summaryWith(near(1), true)).toContain('is one sure KO from clearing the rest');
  });

  test('the forced-win open event and the sampled share stop at 99%', () => {
    const open = summaryWith({ forcedWin: {
      side: 'p1', turns: 3, mass: 0.996, caveat: 'none', engineScore: 0.6, states: 20,
      open: { side: 'p1', moveId: 'earthquake', label: 'Earthquake', odds: 0.996, kind: 'hit' },
    } });
    expect(open).toContain('if the 99% Earthquake lands.');
    const sampled = summaryWith({ forcedWin: { side: 'p1', turns: 3, mass: 0.996, caveat: 'sampled-rolls', engineScore: 0.6, states: 20 } }, true);
    expect(sampled).toContain('in 99% of the sampled rolls.');
  });

  test('the denied-early-end sentence (573756 t73 shape): a sure KO says so, 99.5% stays a roll', () => {
    const denied = { turn: 73, side: 'p2' as const, species: 'Garchomp', removes: 'Corviknight', turnsRemaining: 66 };
    expect(deniedEndSentence({ ...denied, odds: 1 }, 'p2', 'Alpha')).toContain('Garchomp stood one sure KO from clearing the rest');
    expect(deniedEndSentence({ ...denied, odds: 0.995 }, 'p2', 'Alpha')).toContain('Garchomp stood one 99% roll from clearing the rest');
    expect(deniedEndSentence({ ...denied, odds: 0.95, move: 'Fire Fang' }, 'p2', 'Alpha'))
      .toContain('Garchomp stood one 95% roll from clearing the rest, but Fire Fang missed');
  });
});
