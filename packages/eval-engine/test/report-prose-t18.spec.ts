import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, KoOddsInfo, RankedChoice } from '../src/types';

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

const names: [string, string] = ['Alpha', 'Beta'];

/** Round 63 (T18): the small sentences of the turn card and the game report. */
describe('T18 point 6: the read clause names the click with a verb that fits the odds', () => {
  /** A gamble that paid off (Hydro Pump gave up a mistake-sized floor and landed), with the given odds on the click. */
  const paidRead = (koOdds: KoOddsInfo): string => {
    const tied: EvalResult = {
      score: -0.05, interval: 0.02, depthCompleted: 1,
      perSide: {
        p1: [choice('move ironhead', 'Iron Head', -0.05)],
        p2: [
          { ...choice('move recover', 'Recover', 0.04), ev: 0.05, punishedBy: 'Iron Head' },
          { ...choice('move hydropump', 'Hydro Pump', -0.39), ev: 0.047, punishedBy: 'Earth Power', koOdds },
        ],
      },
    };
    return summarizeTurn(analyzeTurn({
      turn: 50,
      result: tied,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'move', name: 'Hydro Pump', tera: false } },
      playedOutcome: -0.19,
      scoreBefore: -0.05,
      scoreAfter: -0.14,
    }), names);
  };

  test('singles: a sure hit into a kill range reads "kills ~43% of the time", never "was kills"', () => {
    const summary = paidRead({ accuracy: 1, killFraction: 0.43 });
    expect(summary).toContain('a read that paid off');
    expect(summary).toContain('The click kills ~43% of the time.');
    expect(summary).not.toContain('was kills');
  });

  test('doubles: a labelled click names its slot move with the same verb', () => {
    const summary = paidRead({ accuracy: 1, killFraction: 0.43, label: 'Hydro Pump→Chi-Yu' });
    expect(summary).toContain('Hydro Pump→Chi-Yu kills ~43% of the time.');
    expect(summary).not.toContain('was kills');
  });

  test('the roll shapes keep their copula', () => {
    expect(paidRead({ accuracy: 0.8, killFraction: 1 })).toContain('The click was an 80% roll to connect.');
    expect(paidRead({ accuracy: 0.9, killFraction: 0.5 })).toContain('The click was a 90% roll into a ~50% kill range.');
  });
});
